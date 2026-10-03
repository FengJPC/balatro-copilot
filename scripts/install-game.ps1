param([Parameter(Mandatory = $true)][string]$GameDirectory)
$ErrorActionPreference = 'Stop'
$packageRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath
$gameRoot = (Resolve-Path -LiteralPath $GameDirectory).ProviderPath
$modsRoot = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Balatro\Mods'
if (-not (Test-Path -LiteralPath (Join-Path $gameRoot 'Balatro.exe'))) { throw 'Balatro.exe not found.' }
if (Get-Process -Name Balatro -ErrorAction SilentlyContinue) { throw 'Close Balatro before installing its mods.' }
foreach ($target in @((Join-Path $gameRoot 'winmm.dll'), (Join-Path $gameRoot 'version.dll'), (Join-Path $modsRoot 'smods'), (Join-Path $modsRoot 'balatro-agent'))) {
    if (Test-Path -LiteralPath $target) { throw "Existing mod dependency needs inspection; refusing to replace: $target" }
}
if (-not (Test-Path -LiteralPath (Join-Path $packageRoot 'game-mod\balatro-agent\main.lua'))) { throw 'Run bootstrap.ps1 first.' }

$staging = Join-Path $env:TEMP ('balatro-game-setup-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null
$lovelyArchive = Join-Path $staging 'lovely.zip'
Invoke-WebRequest -Uri 'https://github.com/ethangreen-dev/lovely-injector/releases/download/v0.10.0/lovely-x86_64-pc-windows-msvc.zip' -OutFile $lovelyArchive
$lovelyHash = (Get-FileHash -LiteralPath $lovelyArchive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($lovelyHash -ne '7f481f984ab8ee633c90ce18220c88a2da8f93ca86b6c3e3ff70a725c05807ab') { throw 'Lovely release checksum mismatch.' }
$lovelyStage = Join-Path $staging 'lovely'
Expand-Archive -LiteralPath $lovelyArchive -DestinationPath $lovelyStage
$lovelyDlls = @(Get-ChildItem -LiteralPath $lovelyStage -Recurse -Filter 'winmm.dll')
if ($lovelyDlls.Count -ne 1) { throw 'Expected exactly one Lovely winmm.dll.' }

$smodsCommit = 'af0fdb1eb2c9e191262c128bc88bbc4da991e12d'
$smodsArchive = Join-Path $staging 'smods.zip'
Invoke-WebRequest -Uri ('https://codeload.github.com/Steamodded/smods/zip/' + $smodsCommit) -OutFile $smodsArchive
$smodsStage = Join-Path $staging 'smods'
Expand-Archive -LiteralPath $smodsArchive -DestinationPath $smodsStage
$smodsSource = Join-Path $smodsStage ('smods-' + $smodsCommit)
if (-not (Test-Path -LiteralPath (Join-Path $smodsSource 'lovely'))) { throw 'Invalid Steamodded source archive.' }

New-Item -ItemType Directory -Path $modsRoot -Force | Out-Null
Copy-Item -LiteralPath $smodsSource -Destination (Join-Path $modsRoot 'smods') -Recurse
Copy-Item -LiteralPath (Join-Path $packageRoot 'game-mod\balatro-agent') -Destination (Join-Path $modsRoot 'balatro-agent') -Recurse
Copy-Item -LiteralPath $lovelyDlls[0].FullName -Destination (Join-Path $gameRoot 'winmm.dll')
$record = [ordered]@{
    lovely_version = '0.10.0'
    lovely_archive_sha256 = $lovelyHash
    lovely_dll_sha256 = (Get-FileHash -LiteralPath (Join-Path $gameRoot 'winmm.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
    steamodded_version = '26.1002.0'
    steamodded_commit = $smodsCommit
    steamodded_archive_sha256 = (Get-FileHash -LiteralPath $smodsArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    balatro_agent_version = '0.2.4'
}
$record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $packageRoot 'game-setup.json') -Encoding utf8
Write-Output "Installed Lovely 0.10.0, Steamodded 26.1002.0 and Balatro Agent 0.2.4."
Write-Output "Game: $gameRoot"
Write-Output "Mods: $modsRoot"
