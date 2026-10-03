$ErrorActionPreference = 'Stop'
$packageRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath
$upstream = Get-Content -LiteralPath (Join-Path $packageRoot 'upstream-lock.json') -Raw | ConvertFrom-Json
$staging = Join-Path $env:TEMP ('balatro-package-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null

function Get-VerifiedAsset($asset, [string]$destination) {
    Invoke-WebRequest -Uri $asset.url -OutFile $destination
    $actual = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $asset.sha256) { throw "Upstream checksum mismatch: $destination" }
}

$binaryArchive = Join-Path $staging 'mcp.tar.gz'
Get-VerifiedAsset $upstream.binary $binaryArchive
$binaryStage = Join-Path $staging 'binary'
New-Item -ItemType Directory -Path $binaryStage | Out-Null
& tar -xzf $binaryArchive -C $binaryStage
if ($LASTEXITCODE -ne 0) { throw 'Could not extract upstream MCP binary.' }
$binaries = @(Get-ChildItem -LiteralPath $binaryStage -Recurse -Filter 'balatro-mcp.exe')
if ($binaries.Count -ne 1) { throw 'Expected exactly one upstream Windows MCP executable.' }
$binDir = Join-Path $packageRoot 'bin'
New-Item -ItemType Directory -Path $binDir -Force | Out-Null
Copy-Item -LiteralPath $binaries[0].FullName -Destination (Join-Path $binDir 'balatro-mcp.exe') -Force

$modArchive = Join-Path $staging 'mod.zip'
Get-VerifiedAsset $upstream.mod $modArchive
$modStage = Join-Path $staging 'mod'
Expand-Archive -LiteralPath $modArchive -DestinationPath $modStage
$manifests = @(Get-ChildItem -LiteralPath $modStage -Recurse -Filter 'manifest.json' | Where-Object {
    (Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json).id -eq 'balatro-agent'
})
if ($manifests.Count -ne 1) { throw 'Expected exactly one Balatro Agent mod.' }
$modDir = Join-Path $packageRoot 'game-mod\balatro-agent'
New-Item -ItemType Directory -Path $modDir -Force | Out-Null
Get-ChildItem -LiteralPath $manifests[0].DirectoryName -Force | Copy-Item -Destination $modDir -Recurse -Force

$licenseDir = Join-Path $packageRoot 'licenses'
New-Item -ItemType Directory -Path $licenseDir -Force | Out-Null
Invoke-WebRequest -Uri ($upstream.repository.Replace('https://github.com/', 'https://raw.githubusercontent.com/') + '/' + $upstream.source_commit + '/LICENSE') -OutFile (Join-Path $licenseDir 'balatro-agent-MIT.txt')
$provenance = [ordered]@{
    version = $upstream.version
    source_commit = $upstream.source_commit
    binary_sha256 = (Get-FileHash -LiteralPath (Join-Path $binDir 'balatro-mcp.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
    binary_archive_sha256 = $upstream.binary.sha256
    mod_archive_sha256 = $upstream.mod.sha256
}
$provenance | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $packageRoot 'provenance.json') -Encoding utf8
& node (Join-Path $PSScriptRoot 'server.mjs') --version
if ($LASTEXITCODE -ne 0) { throw 'Upstream binary failed its version check.' }
