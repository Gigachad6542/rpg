param(
  [string]$BundleRoot = "",
  [string]$EvidenceDir = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "windows-file-hash.ps1")

$productName = "Local-First RPG"
$publisher = "localfirst"
$binaryName = "local-first-ai-rpg-runtime.exe"
$uninstallRegistryPath = "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\Local-First RPG"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $BundleRoot) {
  $BundleRoot = Join-Path $projectRoot "src-tauri\target\release\bundle"
}
if (-not $EvidenceDir) {
  $EvidenceDir = Join-Path $projectRoot "release-evidence\windows\installer-lifecycle"
}

$tauriConfig = Get-Content -LiteralPath (Join-Path $projectRoot "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$expectedVersion = [string]$tauriConfig.version
$expectedInstallerName = "${productName}_${expectedVersion}_x64-setup.exe"
$expectedInstallLocation = Join-Path $env:LOCALAPPDATA $productName
$smokeRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("local-first-rpg-installer-lifecycle-" + [guid]::NewGuid().ToString("N"))
$profileRoot = Join-Path $smokeRoot "Profile"
$roamingRoot = Join-Path $profileRoot "Roaming"
$localRoot = Join-Path $profileRoot "Local"
$tempRoot = Join-Path $profileRoot "Temp"
$runtimeDataRoot = Join-Path $tempRoot "RuntimeData"
$createdInstall = $false
$installedLocation = $null
$runtimeProcess = $null
$observations = [ordered]@{
  schema = "rpg.release.windows-installer-lifecycle"
  schemaVersion = 1
  status = "pending"
  product = $productName
  version = $expectedVersion
  installer = $null
  installerSha256 = $null
  installLocation = $null
  firstLaunchDatabase = $false
  repairReinstall = $false
  secondLaunchPersistence = $false
  uninstallRegistrationRemoved = $false
  installDirectoryRemoved = $false
  failureMessage = $null
  completedAtUtc = $null
}

function Write-LifecycleEvidence {
  $observations.completedAtUtc = [DateTime]::UtcNow.ToString("o")
  $evidencePath = Join-Path $EvidenceDir "windows-installer-lifecycle.json"
  $json = $observations | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText($evidencePath, $json, [System.Text.UTF8Encoding]::new($false))
  return $evidencePath
}

function Get-RegisteredProduct {
  $matches = @()
  if (Test-Path -LiteralPath $uninstallRegistryPath) {
    $matches += @(Get-ItemProperty -LiteralPath $uninstallRegistryPath)
  }
  foreach ($registryPattern in @(
    "Registry::HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "Registry::HKEY_LOCAL_MACHINE\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )) {
    $matches += @(Get-ItemProperty -Path $registryPattern -ErrorAction SilentlyContinue |
      Where-Object {
        $displayNameProperty = $_.PSObject.Properties["DisplayName"]
        $publisherProperty = $_.PSObject.Properties["Publisher"]
        $displayNameProperty -and $publisherProperty -and
          $displayNameProperty.Value -eq $productName -and
          $publisherProperty.Value -eq $publisher
      })
  }
  return @($matches)
}

function Get-CurrentUserRegistration {
  if (-not (Test-Path -LiteralPath $uninstallRegistryPath)) {
    return $null
  }
  return Get-ItemProperty -LiteralPath $uninstallRegistryPath
}

function Invoke-Installer {
  param(
    [Parameter(Mandatory = $true)][string]$InstallerPath,
    [Parameter(Mandatory = $true)][string]$Phase
  )

  $installerProcess = Start-Process -FilePath $InstallerPath -ArgumentList "/S" -Wait -PassThru
  if ($installerProcess.ExitCode -ne 0) {
    throw "$Phase failed with installer exit code $($installerProcess.ExitCode)."
  }
}

function Assert-Registration {
  $registration = Get-CurrentUserRegistration
  if (-not $registration) {
    throw "The current-user uninstall registration was not created."
  }
  if ([string]$registration."DisplayName" -ne $productName) {
    throw "Unexpected DisplayName in uninstall registration: $($registration.DisplayName)"
  }
  if ([string]$registration."DisplayVersion" -ne $expectedVersion) {
    throw "Unexpected DisplayVersion in uninstall registration: $($registration.DisplayVersion)"
  }
  $location = ([string]$registration."InstallLocation").Trim('"')
  if (-not $location) {
    throw 'The uninstall registration did not provide an "InstallLocation".'
  }
  if (-not [string]::Equals(
    [System.IO.Path]::GetFullPath($location).TrimEnd('\'),
    [System.IO.Path]::GetFullPath($expectedInstallLocation).TrimEnd('\'),
    [System.StringComparison]::OrdinalIgnoreCase
  )) {
    throw "Installer used unexpected location $location instead of $expectedInstallLocation."
  }
  return [System.IO.Path]::GetFullPath($location)
}

function Start-IsolatedRuntime {
  param([Parameter(Mandatory = $true)][string]$ExecutablePath)

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $ExecutablePath
  $startInfo.WorkingDirectory = Split-Path -Parent $ExecutablePath
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.EnvironmentVariables["APPDATA"] = $roamingRoot
  $startInfo.EnvironmentVariables["LOCALAPPDATA"] = $localRoot
  $startInfo.EnvironmentVariables["TEMP"] = $tempRoot
  $startInfo.EnvironmentVariables["TMP"] = $tempRoot
  $startInfo.EnvironmentVariables["LOCAL_FIRST_AI_RPG_RUNTIME_APP_DATA_DIR"] = $runtimeDataRoot
  $process = [System.Diagnostics.Process]::Start($startInfo)
  if (-not $process) {
    throw "Failed to launch installed runtime at $ExecutablePath."
  }
  return $process
}

function Stop-Runtime {
  param($Process)

  if ($Process -and -not $Process.HasExited) {
    Stop-Process -Id $Process.Id -Force
    $Process.WaitForExit(5000) | Out-Null
  }
}

function Wait-ForDatabase {
  param([Parameter(Mandatory = $true)]$Process)

  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($Process.HasExited) {
      throw "Installed runtime exited before creating its database with code $($Process.ExitCode)."
    }
    $database = Get-ChildItem -LiteralPath $runtimeDataRoot -File -Filter "local-first-ai-rpg-runtime.db" -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($database) {
      return $database
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Installed runtime did not create local-first-ai-rpg-runtime.db under its isolated app-data directory."
}

function Wait-ForRemoval {
  param([Parameter(Mandatory = $true)][string]$Path)

  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if (-not (Test-Path -LiteralPath $Path)) {
      return
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Installer lifecycle left residue at $Path."
}

New-Item -ItemType Directory -Force -Path $roamingRoot, $localRoot, $tempRoot, $runtimeDataRoot, $EvidenceDir | Out-Null

try {
  $existing = @(Get-RegisteredProduct)
  if ($existing.Count -gt 0) {
    throw "Existing Local-First RPG installation detected; refusing to alter a user installation."
  }
  if (Test-Path -LiteralPath $expectedInstallLocation) {
    throw "Orphaned Local-First RPG install directory detected at $expectedInstallLocation; refusing to overwrite it."
  }

  $installers = @(Get-ChildItem -LiteralPath $BundleRoot -Recurse -File -Filter "Local-First RPG_*_x64-setup.exe" -ErrorAction SilentlyContinue)
  if ($installers.Count -ne 1) {
    throw "Expected exactly one current NSIS installer but found $($installers.Count) under $BundleRoot."
  }
  $installer = $installers[0]
  if ($installer.Name -ne $expectedInstallerName) {
    throw "Expected installer $expectedInstallerName but found $($installer.Name)."
  }
  $observations.installer = $installer.FullName
  $observations.installerSha256 = Get-Sha256Hex -Path $installer.FullName

  $createdInstall = $true
  $installedLocation = $expectedInstallLocation
  Invoke-Installer -InstallerPath $installer.FullName -Phase "Initial silent install"
  $installedLocation = Assert-Registration
  $observations.installLocation = $installedLocation
  $installedExecutable = Join-Path $installedLocation $binaryName
  if (-not (Test-Path -LiteralPath $installedExecutable)) {
    throw "Installed executable is missing at $installedExecutable."
  }

  $runtimeProcess = Start-IsolatedRuntime -ExecutablePath $installedExecutable
  $database = Wait-ForDatabase -Process $runtimeProcess
  Start-Sleep -Seconds 2
  if ($runtimeProcess.HasExited) {
    throw "Installed runtime exited during first launch with code $($runtimeProcess.ExitCode)."
  }
  $observations.firstLaunchDatabase = $true
  Stop-Runtime $runtimeProcess
  $runtimeProcess = $null

  Invoke-Installer -InstallerPath $installer.FullName -Phase "Silent repair/reinstall"
  $repairedLocation = Assert-Registration
  if (-not [string]::Equals($repairedLocation, $installedLocation, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "The repair/reinstall moved the application from $installedLocation to $repairedLocation."
  }
  $observations.repairReinstall = $true

  $runtimeProcess = Start-IsolatedRuntime -ExecutablePath $installedExecutable
  Start-Sleep -Seconds 3
  if ($runtimeProcess.HasExited) {
    throw "Installed runtime exited after repair/reinstall with code $($runtimeProcess.ExitCode)."
  }
  if (-not (Test-Path -LiteralPath $database.FullName)) {
    throw "Runtime database did not persist through repair/reinstall."
  }
  $observations.secondLaunchPersistence = $true
  Stop-Runtime $runtimeProcess
  $runtimeProcess = $null

  $uninstaller = Join-Path $installedLocation "uninstall.exe"
  if (-not (Test-Path -LiteralPath $uninstaller)) {
    throw "Expected uninstall.exe at $uninstaller."
  }
  $uninstallProcess = Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -PassThru
  if ($uninstallProcess.ExitCode -ne 0) {
    throw "Silent uninstall failed with exit code $($uninstallProcess.ExitCode)."
  }
  Wait-ForRemoval -Path $uninstallRegistryPath
  $observations.uninstallRegistrationRemoved = $true
  Wait-ForRemoval -Path $installedLocation
  $observations.installDirectoryRemoved = $true
  $createdInstall = $false

  $observations.status = "pass"
  $evidencePath = Write-LifecycleEvidence
  Write-Output "Installer lifecycle passed: install, launch, repair/reinstall, persistent relaunch, and uninstall completed. Evidence: $evidencePath"
} catch {
  $observations.status = "fail"
  $observations.failureMessage = $_.Exception.Message
  Write-LifecycleEvidence | Out-Null
  throw
} finally {
  Stop-Runtime $runtimeProcess
  if ($createdInstall -and $installedLocation) {
    $cleanupUninstaller = Join-Path $installedLocation "uninstall.exe"
    if (Test-Path -LiteralPath $cleanupUninstaller) {
      Start-Process -FilePath $cleanupUninstaller -ArgumentList "/S" -Wait -ErrorAction SilentlyContinue | Out-Null
    }
  }
  if (Test-Path -LiteralPath $smokeRoot) {
    Remove-Item -LiteralPath $smokeRoot -Recurse -Force
  }
}
