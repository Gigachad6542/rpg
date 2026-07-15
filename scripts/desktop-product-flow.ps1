param(
  [Parameter(Mandatory = $true)][string]$PreviousMsi,
  [Parameter(Mandatory = $true)][string]$CurrentMsi,
  [Parameter(Mandatory = $true)][string]$EvidenceDir,
  [switch]$KeepWorkspace
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$previousMsiPath = (Resolve-Path -LiteralPath $PreviousMsi).Path
$currentMsiPath = (Resolve-Path -LiteralPath $CurrentMsi).Path
$evidenceRoot = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $EvidenceDir))
$workRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("local-first-ai-rpg-product-flow-" + [guid]::NewGuid().ToString("N"))
$previousInstallRoot = Join-Path $workRoot "previous-install"
$currentInstallRoot = Join-Path $workRoot "current-install"
$profileRoot = Join-Path $workRoot "profile"
$installEvidenceRoot = Join-Path $evidenceRoot "install"

if ([System.IO.Path]::GetExtension($previousMsiPath) -ne ".msi") {
  throw "PreviousMsi must identify a packaged MSI file."
}
if ([System.IO.Path]::GetExtension($currentMsiPath) -ne ".msi") {
  throw "CurrentMsi must identify a packaged MSI file."
}

New-Item -ItemType Directory -Force -Path $workRoot, $previousInstallRoot, $currentInstallRoot, $profileRoot, $installEvidenceRoot | Out-Null

function Extract-PackagedMsi {
  param(
    [Parameter(Mandatory = $true)][string]$MsiPath,
    [Parameter(Mandatory = $true)][string]$InstallRoot,
    [Parameter(Mandatory = $true)][string]$LogPath
  )

  $arguments = @(
    "/a",
    "`"$MsiPath`"",
    "/qn",
    "TARGETDIR=`"$InstallRoot`"",
    "/L*v",
    "`"$LogPath`""
  )
  $installer = Start-Process -FilePath "msiexec.exe" -ArgumentList $arguments -Wait -PassThru
  if ($installer.ExitCode -ne 0) {
    throw "MSI administrative extraction failed with code $($installer.ExitCode). See $LogPath."
  }

  $exe = Get-ChildItem -LiteralPath $InstallRoot -Recurse -File -Filter "local-first-ai-rpg-runtime.exe" |
    Sort-Object FullName |
    Select-Object -First 1
  if (-not $exe) {
    throw "The extracted package did not contain local-first-ai-rpg-runtime.exe under $InstallRoot."
  }
  return $exe.FullName
}

try {
  $previousLog = Join-Path $installEvidenceRoot "previous-msi-extraction.log"
  $currentLog = Join-Path $installEvidenceRoot "current-msi-extraction.log"
  $previousExe = Extract-PackagedMsi -MsiPath $previousMsiPath -InstallRoot $previousInstallRoot -LogPath $previousLog
  $currentExe = Extract-PackagedMsi -MsiPath $currentMsiPath -InstallRoot $currentInstallRoot -LogPath $currentLog

  & node (Join-Path $PSScriptRoot "desktop-product-flow.mjs") `
    --previous-exe $previousExe `
    --current-exe $currentExe `
    --previous-msi $previousMsiPath `
    --current-msi $currentMsiPath `
    --profile $profileRoot `
    --evidence $evidenceRoot
  if ($LASTEXITCODE -ne 0) {
    throw "Packaged desktop product flow failed with exit code $LASTEXITCODE."
  }

  Write-Output "Packaged desktop product flow passed. Evidence: $evidenceRoot"
} finally {
  if (-not $KeepWorkspace -and (Test-Path -LiteralPath $workRoot)) {
    $resolvedWorkRoot = [System.IO.Path]::GetFullPath($workRoot)
    $resolvedTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if (-not $resolvedWorkRoot.StartsWith($resolvedTempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to clean product-flow workspace outside the system temp root: $resolvedWorkRoot"
    }
    Remove-Item -LiteralPath $resolvedWorkRoot -Recurse -Force
  }
}
