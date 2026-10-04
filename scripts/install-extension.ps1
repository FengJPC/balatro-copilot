param([string]$ModDirectory = (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Balatro\Mods\balatro-agent'), [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$modRoot = (Resolve-Path -LiteralPath $ModDirectory).ProviderPath
$mainPath = Join-Path $modRoot 'main.lua'
$backupPath = Join-Path $modRoot 'main.lua.copilot-original'
$extensionPath = Join-Path $modRoot 'copilot-extension.lua'
$sourcePath = Join-Path $PSScriptRoot '..\bridge\copilot-extension.lua'
$originalHash = '08244AB20D29AF9790DDB2BF6A5AF780AF8A02369C003B21D30A328B6794DEE3'
$manifest = Get-Content -LiteralPath (Join-Path $modRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.id -ne 'balatro-agent' -or $manifest.version -ne '0.2.4') { throw 'Extension requires Balatro Agent v0.2.4.' }
$utf8 = [System.Text.UTF8Encoding]::new($false)
$main = [System.IO.File]::ReadAllText($mainPath, $utf8)
$mainHash = (Get-FileHash -LiteralPath $mainPath -Algorithm SHA256).Hash
if ($mainHash -eq $originalHash) { $original = $main }
else {
    if (-not (Test-Path -LiteralPath $backupPath) -or (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash -ne $originalHash) { throw 'Unknown main.lua modifications; refusing to overwrite.' }
    $original = [System.IO.File]::ReadAllText($backupPath, $utf8)
}
$needle = 'state.configure(card_ids)'
if ([regex]::Matches($original, [regex]::Escape($needle)).Count -ne 1) { throw 'Expected exactly one extension insertion point.' }
$newline = if ($original.Contains("`r`n")) { "`r`n" } else { "`n" }
$hook = "-- Balatro Copilot extension (MIT, Copyright 2026 FengJ)" + $newline + "assert(load(NFS.read(mod_path .. 'copilot-extension.lua'), '@copilot-extension.lua'))()(actions, state, round_eval, card_ids, instance)"
$patched = $original.Replace($needle, $needle + $newline + $hook)
if ($main -ne $original -and $main -ne $patched) { throw 'Unknown main.lua modifications; refusing to overwrite.' }
if (Test-Path -LiteralPath $backupPath) {
    if ((Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash -ne $originalHash) { throw 'Original backup checksum mismatch.' }
}
if (-not $CheckOnly) {
    if (-not (Test-Path -LiteralPath $backupPath)) { Copy-Item -LiteralPath $mainPath -Destination $backupPath }
    Copy-Item -LiteralPath $sourcePath -Destination $extensionPath -Force
    [System.IO.File]::WriteAllText($mainPath, $patched, $utf8)
    if ((Get-FileHash -LiteralPath $sourcePath).Hash -ne (Get-FileHash -LiteralPath $extensionPath).Hash) { throw 'Installed extension checksum mismatch.' }
}
[ordered]@{ version = '0.4.0'; checked_only = [bool]$CheckOnly; mod = $modRoot; original_sha256 = $originalHash; restart_balatro = $true } | ConvertTo-Json
