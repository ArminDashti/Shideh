#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$LocalAddress = 'shideh.local'
foreach ($arg in $args) {
    if ($arg -match '^--local-address=(.+)$') { $LocalAddress = $Matches[1] }
}

function Write-Ok($Message) { Write-Host $Message -ForegroundColor Green }
function Write-Info($Message) { Write-Host $Message -ForegroundColor Yellow }
function Write-Err($Message) { Write-Host $Message -ForegroundColor Red }
function Assert-True($Condition, $Message) {
    if ($Condition) { Write-Ok "PASS $Message"; return }
    Write-Err "FAIL $Message"
    exit 1
}

$AppName = 'Shideh'
$ExeName = 'Shideh.exe'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$BuildExe = Join-Path (Split-Path -Parent $RepoRoot) "VSCode-win32-x64\$ExeName"
$Base = Join-Path $env:LOCALAPPDATA $AppName
$HostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$Marker = '# Shideh local-address'
$Installer = Join-Path $PSScriptRoot 'installer-win-x64.ps1'
$Remover = Join-Path $PSScriptRoot 'Remove-win-x64.ps1'

function Test-PathEntry {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    return [bool]($userPath -and ($userPath -split ';' | Where-Object { $_.TrimEnd('\') -ieq $Base.TrimEnd('\') }))
}
function Test-HostEntry {
    $pattern = '^\s*127\.0\.0\.1\s+' + [regex]::Escape($LocalAddress) + '(\s|$)'
    return [bool](@(Get-Content -LiteralPath $HostsPath) | Where-Object { $_ -match $pattern })
}
function Assert-Installed {
    Assert-True (Test-Path -LiteralPath $BuildExe) "build exe exists ($BuildExe)"
    Assert-True (Test-Path -LiteralPath (Join-Path $Base $ExeName)) "installed $ExeName"
    Assert-True (Test-Path -LiteralPath (Join-Path $Base 'Settings.json')) 'Settings.json exists'
    Assert-True (Test-Path -LiteralPath (Join-Path $Base 'Data.db')) 'Data.db exists'
    Assert-True (Test-PathEntry) 'User PATH contains base path'
    Assert-True (Test-HostEntry) "hosts maps 127.0.0.1 $LocalAddress"
}

Write-Info "Lifecycle: build + install --local-address=$LocalAddress"
& $Installer "--local-address=$LocalAddress"
if ($LASTEXITCODE -ne 0) { Write-Err "Install exit $LASTEXITCODE"; exit 1 }
Assert-Installed

Write-Info 'Lifecycle: update (re-run installer)'
& $Installer "--local-address=$LocalAddress"
if ($LASTEXITCODE -ne 0) { Write-Err "Update exit $LASTEXITCODE"; exit 1 }
Assert-Installed

Write-Info 'Lifecycle: remove'
& $Remover
if ($LASTEXITCODE -ne 0) { Write-Err "Remove exit $LASTEXITCODE"; exit 1 }
Assert-True (-not (Test-Path -LiteralPath $Base)) 'base path removed'
Assert-True (-not (Test-PathEntry)) 'User PATH no longer contains base path'
$markerLeft = @(Get-Content -LiteralPath $HostsPath | Where-Object { $_ -like "*$Marker*" })
Assert-True ($markerLeft.Count -eq 0) 'Shideh hosts marker removed'
Assert-True (-not (Test-HostEntry)) "hosts no longer maps $LocalAddress"
Write-Ok 'Lifecycle tests passed.'
exit 0
