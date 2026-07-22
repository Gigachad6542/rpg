param(
  [Parameter(Mandatory = $true)][string]$BundleRoot,
  [Parameter(Mandatory = $true)][string]$EvidenceDir,
  [Parameter(Mandatory = $true)][string]$ExpectedPublisherSubject,
  [string]$ReleaseExecutable = "src-tauri\target\release\local-first-ai-rpg-runtime.exe"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "windows-file-hash.ps1")
$bundlePath = (Resolve-Path -LiteralPath $BundleRoot).Path
$releaseExePath = (Resolve-Path -LiteralPath $ReleaseExecutable).Path
$evidencePath = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $EvidenceDir))
New-Item -ItemType Directory -Force -Path $evidencePath | Out-Null

$files = @($releaseExePath) + @(
  Get-ChildItem -LiteralPath $bundlePath -Recurse -File |
    Where-Object { $_.Extension -in @(".msi", ".exe") } |
    ForEach-Object { $_.FullName }
)
$files = @($files | Sort-Object -Unique)
if ($files.Count -lt 2) {
  throw "Expected a signed release executable and at least one Windows installer."
}

$results = foreach ($file in $files) {
  $signature = Get-AuthenticodeSignature -LiteralPath $file
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    throw "Invalid Authenticode signature for ${file}: $($signature.Status) $($signature.StatusMessage)"
  }
  if (-not $signature.SignerCertificate -or -not [string]::Equals(
      $signature.SignerCertificate.Subject,
      $ExpectedPublisherSubject,
      [System.StringComparison]::Ordinal
    )) {
    throw "Authenticode signer for ${file} does not match trusted publisher '$ExpectedPublisherSubject'."
  }
  if (-not $signature.TimeStamperCertificate) {
    throw "Authenticode signature for ${file} is missing a trusted timestamp."
  }
  [ordered]@{
    file = Split-Path -Leaf $file
    status = $signature.Status.ToString()
    signerSubject = $signature.SignerCertificate.Subject
    signerThumbprint = $signature.SignerCertificate.Thumbprint
    timestampSubject = if ($signature.TimeStamperCertificate) { $signature.TimeStamperCertificate.Subject } else { $null }
    sha256 = Get-Sha256Hex -Path $file
  }
}

$payload = [ordered]@{
  schema = "rpg.release.windows-signatures"
  version = 1
  verifiedAt = [DateTimeOffset]::UtcNow.ToString("o")
  files = @($results)
}
$payload | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $evidencePath "windows-signatures.json") -Encoding utf8
Write-Output "Verified $($files.Count) Authenticode signatures."
