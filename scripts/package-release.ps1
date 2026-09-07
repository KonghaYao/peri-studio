[CmdletBinding()]
param(
    [string]$BinDir = (Join-Path $PSScriptRoot '..\target\release'),
    [string]$OutDir = (Join-Path $PSScriptRoot '..\dist'),
    [string]$Target = 'x86_64-pc-windows-msvc',
    [switch]$AllowDirty
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$manifest = Get-Content -LiteralPath (Join-Path $root 'Cargo.toml') -Raw
$versionMatch = [regex]::Match($manifest, '(?ms)^\[workspace\.package\].*?^version\s*=\s*"([^"]+)"')
if (-not $versionMatch.Success) {
    throw 'Unable to resolve the workspace version.'
}
$version = $versionMatch.Groups[1].Value
$source = Join-Path $BinDir 'peri-studio.exe'
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Missing release executable: $source"
}
if ((& $source --version) -ne "peri-studio $version") {
    throw "Binary version does not match workspace $version."
}

$dirty = (& git -C $root status --porcelain --untracked-files=normal) -join ''
if ($dirty -and -not $AllowDirty) {
    throw 'Refusing to package a dirty source tree. Use -AllowDirty only for local diagnostics.'
}
$revision = (& git -C $root rev-parse HEAD).Trim()
$asset = "peri-studio-$version-$Target.exe"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$destination = Join-Path $OutDir $asset
$temp = "$destination.tmp.$PID"
try {
    Copy-Item -LiteralPath $source -Destination $temp -Force
    Move-Item -LiteralPath $temp -Destination $destination -Force
} finally {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
}
$hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$destination.sha256" -Value "$hash  $asset" -Encoding ascii -NoNewline
$metadata = "version=$version`ntarget=$Target`nsource_revision=$revision`n"
Set-Content -LiteralPath "$destination.metadata" -Value $metadata -Encoding ascii -NoNewline
Write-Host "Release binary ready: $destination"
