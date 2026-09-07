# Peri Studio installer for Windows. Uses Peri's %USERPROFILE%\.peri layout
# with Studio-specific binary and version names so both products can coexist.
# Usage: irm https://raw.githubusercontent.com/KonghaYao/peri-studio/main/scripts/install.ps1 | iex
# Options: PERI_STUDIO_INSTALL_VERSION, PERI_STUDIO_INSTALL_DIR,
# GITHUB_PROXY, GITHUB_TOKEN, PERI_STUDIO_NO_PATH_HINT.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Info([string]$Message) { Write-Host "[INFO] $Message" -ForegroundColor Green }
function Fail([string]$Message) { throw $Message }
function Publish-File([string]$Source, [string]$Destination) {
    $temporary = "$Destination.install-$([Guid]::NewGuid().ToString('N'))"
    Copy-Item -LiteralPath $Source -Destination $temporary
    try {
        if (Test-Path -LiteralPath $Destination) {
            [IO.File]::Replace($temporary, $Destination, $null)
        } else {
            [IO.File]::Move($temporary, $Destination)
        }
    } finally {
        Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    }
}

$Repository = 'KonghaYao/peri-studio'
$GitHubApi = "https://api.github.com/repos/$Repository"
$InstallDir = if ($env:PERI_STUDIO_INSTALL_DIR) { $env:PERI_STUDIO_INSTALL_DIR } else { Join-Path $env:USERPROFILE '.peri' }
$headers = @{}
if ($env:GITHUB_TOKEN) { $headers.Authorization = "Bearer $env:GITHUB_TOKEN" }

$arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
if ($arch -ne 'AMD64') { Fail "Unsupported Windows architecture: $arch" }
$target = 'x86_64-pc-windows-msvc'

$requested = $env:PERI_STUDIO_INSTALL_VERSION
if ($requested) {
    if ($requested -notmatch '^[0-9A-Za-z.+-]+$') { Fail "Invalid version: $requested" }
    $tag = if ($requested.StartsWith('peri-studio-v')) { $requested } else { "peri-studio-v$requested" }
    try {
        $release = Invoke-RestMethod -Uri "$GitHubApi/releases/tags/$tag" -Headers $headers
    } catch {
        Fail "Release not found: $tag"
    }
} else {
    try {
        $releases = Invoke-RestMethod -Uri "$GitHubApi/releases?per_page=30" -Headers $headers
    } catch {
        Fail 'Unable to fetch releases.'
    }
    $release = $releases | Where-Object { $_.tag_name -like 'peri-studio-v*' } | Select-Object -First 1
    if (-not $release) { Fail 'No Peri Studio release found.' }
    $tag = $release.tag_name
}

$version = $tag.Substring('peri-studio-v'.Length)
$assetName = "peri-studio-$version-$target.exe"
$checksumName = "$assetName.sha256"
$asset = $release.assets | Where-Object { $_.name -eq $assetName } | Select-Object -First 1
$checksumAsset = $release.assets | Where-Object { $_.name -eq $checksumName } | Select-Object -First 1
if (-not $asset -or -not $checksumAsset) { Fail "No verified binary found for windows-x86_64 in $tag." }

function Get-DownloadUrl([string]$Url) {
    if ($env:GITHUB_PROXY) { return "$($env:GITHUB_PROXY.TrimEnd('/'))/$Url" }
    return $Url
}

$versionDir = Join-Path $InstallDir $tag
$tempDir = Join-Path ([IO.Path]::GetTempPath()) ("peri-studio-install-" + [Guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Force -Path $versionDir | Out-Null
    New-Item -ItemType Directory -Path $tempDir | Out-Null
    $download = Join-Path $tempDir $assetName
    $checksum = Join-Path $tempDir $checksumName
    Info "Downloading $assetName"
    Invoke-WebRequest -Uri (Get-DownloadUrl $asset.browser_download_url) -OutFile $download -Headers $headers
    Invoke-WebRequest -Uri (Get-DownloadUrl $checksumAsset.browser_download_url) -OutFile $checksum -Headers $headers

    $expected = ((Get-Content -LiteralPath $checksum -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant()
    if (-not $expected -or $expected -ne $actual) { Fail 'Release checksum mismatch.' }

    $targetPath = Join-Path $versionDir 'peri-studio.exe'
    $entryPath = Join-Path $InstallDir 'peri-studio.exe'
    $versionPath = Join-Path $InstallDir 'peri-studio-current-version.txt'
    $versionRecord = Join-Path $tempDir 'peri-studio-current-version.txt'
    Set-Content -LiteralPath $versionRecord -Value $tag -Encoding ascii -NoNewline
    Publish-File $download $targetPath
    Publish-File $targetPath $entryPath
    Publish-File $versionRecord $versionPath

    if ($env:PERI_STUDIO_NO_PATH_HINT -ne '1') {
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        $entries = @($userPath -split ';' | Where-Object { $_ })
        if ($entries -notcontains $InstallDir) {
            [Environment]::SetEnvironmentVariable('Path', ((@($InstallDir) + $entries) -join ';'), 'User')
            Info "Added $InstallDir to user PATH"
        }
    }
    $env:Path = "$InstallDir;$env:Path"
    & (Join-Path $InstallDir 'peri-studio.exe') --version
    Info "Installed to $targetPath"
    Info 'Open a new terminal and run: peri-studio'
} finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
