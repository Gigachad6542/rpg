$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$exePath = Join-Path $projectRoot "src-tauri\target\release\local-first-ai-rpg-runtime.exe"

if (-not (Test-Path -LiteralPath $exePath)) {
  throw "Desktop executable not found at $exePath. Run pnpm desktop:build first."
}

$process = Start-Process -FilePath $exePath -PassThru -WindowStyle Hidden
try {
  Start-Sleep -Seconds 5
  if ($process.HasExited) {
    throw "Desktop executable exited during smoke startup with code $($process.ExitCode)."
  }
  Write-Output "Desktop executable smoke passed: process $($process.Id) stayed alive."
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
    $process.WaitForExit(5000) | Out-Null
  }
}
