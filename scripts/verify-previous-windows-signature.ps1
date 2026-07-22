param(
  [Parameter(Mandatory = $true)][string]$MsiPath,
  [Parameter(Mandatory = $true)][string]$ExpectedPublisherSubject,
  [Parameter(Mandatory = $true)][string]$EvidenceDir
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "windows-file-hash.ps1")
$resolvedMsi = (Resolve-Path -LiteralPath $MsiPath).Path
$evidencePath = if ([System.IO.Path]::IsPathRooted($EvidenceDir)) {
  [System.IO.Path]::GetFullPath($EvidenceDir)
} else {
  [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $EvidenceDir))
}
if ([System.IO.Path]::GetExtension($resolvedMsi) -ne ".msi") {
  throw "Previous release artifact must be an MSI file."
}
if ([string]::IsNullOrWhiteSpace($ExpectedPublisherSubject)) {
  throw "ExpectedPublisherSubject is required."
}

$signature = Get-AuthenticodeSignature -LiteralPath $resolvedMsi
if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
  throw "Invalid previous-release Authenticode signature: $($signature.Status) $($signature.StatusMessage)"
}
if (-not $signature.SignerCertificate) {
  throw "Previous-release Authenticode signature did not expose a signer certificate."
}
if (-not [string]::Equals(
    $signature.SignerCertificate.Subject,
    $ExpectedPublisherSubject,
    [System.StringComparison]::Ordinal
  )) {
  throw "Previous-release signer subject '$($signature.SignerCertificate.Subject)' does not match trusted publisher '$ExpectedPublisherSubject'."
}
if (-not $signature.TimeStamperCertificate) {
  throw "Previous-release Authenticode signature is missing a trusted timestamp."
}

New-Item -ItemType Directory -Force -Path $evidencePath | Out-Null
$payload = [ordered]@{
  schema = "rpg.release.previous-windows-signature"
  version = 1
  status = "pass"
  verifiedAt = [DateTimeOffset]::UtcNow.ToString("o")
  file = Split-Path -Leaf $resolvedMsi
  sha256 = Get-Sha256Hex -Path $resolvedMsi
  signerSubject = $signature.SignerCertificate.Subject
  signerThumbprint = $signature.SignerCertificate.Thumbprint
  timestampSubject = $signature.TimeStamperCertificate.Subject
  timestampThumbprint = $signature.TimeStamperCertificate.Thumbprint
}
$payload | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $evidencePath "previous-windows-signature.json") -Encoding utf8
Write-Output "Verified previous-release Authenticode signature and trusted publisher identity."
