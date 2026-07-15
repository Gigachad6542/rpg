$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$bundleRoot = Join-Path $projectRoot "src-tauri\target\release\bundle"
$releaseExe = Join-Path $projectRoot "src-tauri\target\release\local-first-ai-rpg-runtime.exe"
$smokeRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("local-first-ai-rpg-installed-smoke-" + [guid]::NewGuid().ToString("N"))
$installRoot = Join-Path $smokeRoot "install"
$profileRoot = Join-Path $smokeRoot "profile"
$roamingRoot = Join-Path $profileRoot "Roaming"
$localRoot = Join-Path $profileRoot "Local"
$tempRoot = Join-Path $profileRoot "Temp"
$runtimeDataRoot = Join-Path $tempRoot "RuntimeData"

New-Item -ItemType Directory -Force -Path $installRoot, $roamingRoot, $localRoot, $tempRoot, $runtimeDataRoot | Out-Null

function Stage-SmokeBundle {
  param(
    [Parameter(Mandatory = $true)][string]$BundleRoot,
    [Parameter(Mandatory = $true)][string]$InstallRoot,
    [Parameter(Mandatory = $true)][string]$FallbackExe
  )

  $msi = Get-ChildItem -Path $BundleRoot -Recurse -File -Filter "*.msi" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if ($msi) {
    $installerArgs = @("/a", "`"$($msi.FullName)`"", "/qn", "TARGETDIR=`"$InstallRoot`"")
    $installer = Start-Process -FilePath "msiexec.exe" -ArgumentList $installerArgs -Wait -PassThru
    if ($installer.ExitCode -ne 0) {
      throw "MSI administrative extraction failed with code $($installer.ExitCode) for $($msi.FullName)."
    }
  } elseif (Test-Path -LiteralPath $FallbackExe) {
    Copy-Item -LiteralPath $FallbackExe -Destination (Join-Path $InstallRoot "local-first-ai-rpg-runtime.exe")
  } else {
    throw "No MSI bundle found under $BundleRoot and no release executable found at $FallbackExe. Run pnpm desktop:build first."
  }

  $exe = Get-ChildItem -Path $InstallRoot -Recurse -File -Filter "local-first-ai-rpg-runtime.exe" |
    Sort-Object FullName |
    Select-Object -First 1
  if (-not $exe) {
    throw "Staged desktop executable was not found under $InstallRoot."
  }
  return $exe.FullName
}

function Start-IsolatedRuntime {
  param(
    [Parameter(Mandatory = $true)][string]$ExePath,
    [Parameter(Mandatory = $true)][string]$RoamingRoot,
    [Parameter(Mandatory = $true)][string]$LocalRoot,
    [Parameter(Mandatory = $true)][string]$TempRoot,
    [Parameter(Mandatory = $true)][string]$RuntimeDataRoot
  )

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $ExePath
  $startInfo.WorkingDirectory = Split-Path -Parent $ExePath
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.EnvironmentVariables["APPDATA"] = $RoamingRoot
  $startInfo.EnvironmentVariables["LOCALAPPDATA"] = $LocalRoot
  $startInfo.EnvironmentVariables["TEMP"] = $TempRoot
  $startInfo.EnvironmentVariables["TMP"] = $TempRoot
  $startInfo.EnvironmentVariables["LOCAL_FIRST_AI_RPG_RUNTIME_APP_DATA_DIR"] = $RuntimeDataRoot

  $process = [System.Diagnostics.Process]::Start($startInfo)
  if (-not $process) {
    throw "Failed to start staged desktop executable at $ExePath."
  }
  return $process
}

function Stop-SmokeProcess {
  param([Parameter(Mandatory = $true)]$Process)

  if ($Process -and -not $Process.HasExited) {
    Stop-Process -Id $Process.Id -Force
    $Process.WaitForExit(5000) | Out-Null
  }
}

function Wait-ForRuntimeDatabase {
  param([Parameter(Mandatory = $true)][string]$ProfileRoot)

  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $database = Get-ChildItem -Path $ProfileRoot -Recurse -File -Filter "local-first-ai-rpg-runtime.db" -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($database) {
      return $database
    }
    Start-Sleep -Milliseconds 500
  }

  throw "Runtime database was not created under isolated profile root $ProfileRoot."
}

try {
  $exePath = Stage-SmokeBundle -BundleRoot $bundleRoot -InstallRoot $installRoot -FallbackExe $releaseExe

  $first = Start-IsolatedRuntime -ExePath $exePath -RoamingRoot $roamingRoot -LocalRoot $localRoot -TempRoot $tempRoot -RuntimeDataRoot $runtimeDataRoot
  try {
    Start-Sleep -Seconds 5
    if ($first.HasExited) {
      throw "MSI-payload smoke exited during first startup with code $($first.ExitCode)."
    }
  } finally {
    Stop-SmokeProcess $first
  }

  $database = Wait-ForRuntimeDatabase -ProfileRoot $profileRoot

  $second = Start-IsolatedRuntime -ExePath $exePath -RoamingRoot $roamingRoot -LocalRoot $localRoot -TempRoot $tempRoot -RuntimeDataRoot $runtimeDataRoot
  try {
    Start-Sleep -Seconds 5
    if ($second.HasExited) {
      throw "MSI-payload smoke exited during restart with code $($second.ExitCode)."
    }
  } finally {
    Stop-SmokeProcess $second
  }

  if (-not (Test-Path -LiteralPath $database.FullName)) {
    throw "Runtime database disappeared before restart verification: $($database.FullName)"
  }

  Write-Output "MSI-payload smoke passed: staged $exePath and created $($database.FullName)."
} finally {
  if (-not $env:KEEP_RPG_INSTALLED_SMOKE -and (Test-Path -LiteralPath $smokeRoot)) {
    Remove-Item -LiteralPath $smokeRoot -Recurse -Force
  }
}
