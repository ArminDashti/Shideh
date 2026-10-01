#requires -Version 5.1
param([string]$LocalAddress)
$ErrorActionPreference = 'Stop'
foreach ($arg in @($LocalAddress) + @($args)) {
    if ($arg -match '^--local-address=(.+)$') { $LocalAddress = $Matches[1] }
}

function Write-Ok($Message) { Write-Host $Message -ForegroundColor Green }
function Write-Info($Message) { Write-Host $Message -ForegroundColor Yellow }
function Write-Err($Message) { Write-Host $Message -ForegroundColor Red }
function Test-IsAdmin {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

$AppName = 'Shideh'
$ExeName = 'Shideh.exe'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$BuildExe = Join-Path (Split-Path -Parent $RepoRoot) "VSCode-win32-x64\$ExeName"
$Base = Join-Path $env:LOCALAPPDATA $AppName
$HostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$Marker = '# Shideh local-address'
$AddressFile = Join-Path $Base 'local-addresses.txt'

if ($LocalAddress -and -not (Test-IsAdmin)) {
    Write-Info "Restarting elevated for hosts ($LocalAddress)"
    $elevated = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, "--local-address=$LocalAddress"
    )
    if (-not $elevated -or $elevated.ExitCode -ne 0) {
        Write-Err 'Elevation cancelled or the elevated installer failed.'
        exit 1
    }
    exit 0
}

Write-Info "Building $AppName (vscode-win32-x64-min)"
Push-Location $RepoRoot
try {
    $gulpJs = Join-Path $RepoRoot 'node_modules\gulp\bin\gulp.js'
    if (-not (Test-Path -LiteralPath $gulpJs)) {
        Write-Info 'gulp is not installed. Installing dependencies with npm ci'
        & npm ci
        if ($LASTEXITCODE -ne 0) { Write-Err 'npm ci failed. The Windows build was not started.'; exit 1 }
        if (-not (Test-Path -LiteralPath $gulpJs)) { Write-Err "npm ci finished but $gulpJs is missing."; exit 1 }
    }
    & npm run gulp -- vscode-win32-x64-min
    if ($LASTEXITCODE -ne 0) { Write-Err 'Build failed.'; exit 1 }
}
finally { Pop-Location }
if (-not (Test-Path -LiteralPath $BuildExe)) { Write-Err "Built exe missing: $BuildExe"; exit 1 }
Write-Ok "Built $BuildExe"

Write-Info "Stopping $AppName"
$running = @(Get-Process -Name $AppName -ErrorAction SilentlyContinue)
foreach ($proc in $running) { [void]$proc.CloseMainWindow() }
if ($running.Count -gt 0) { Start-Sleep -Seconds 2 }
Get-Process -Name $AppName -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Ok "$AppName is not running"

New-Item -ItemType Directory -Force -Path $Base | Out-Null
foreach ($fileName in @('Settings.json', 'Data.db')) {
    $filePath = Join-Path $Base $fileName
    if (Test-Path -LiteralPath $filePath) { Write-Info "$fileName already exists" }
    else { New-Item -ItemType File -Path $filePath | Out-Null; Write-Ok "Created $fileName" }
}

$installedExe = Join-Path $Base $ExeName
if (Test-Path -LiteralPath $installedExe) { Remove-Item -LiteralPath $installedExe -Force; Write-Info "Removed old $ExeName" }
Copy-Item -LiteralPath $BuildExe -Destination $installedExe -Force
Write-Ok "Copied $installedExe"

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = @()
if ($userPath) { $parts = @($userPath -split ';' | Where-Object { $_ -and ($_.TrimEnd('\') -ine $Base.TrimEnd('\')) }) }
if ($userPath -and ($userPath -split ';' | Where-Object { $_.TrimEnd('\') -ieq $Base.TrimEnd('\') })) {
    Write-Info 'User PATH already contains the base path'
}
else {
    $updated = (@($parts) + $Base) -join ';'
    [Environment]::SetEnvironmentVariable('Path', $updated, 'User')
    Write-Ok "Added $Base to User PATH"
}

if ($LocalAddress) {
    if ($LocalAddress -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]*$') { Write-Err "Invalid --local-address: $LocalAddress"; exit 1 }
    if (-not (Test-IsAdmin)) { Write-Err 'Administrator rights are required to edit the hosts file.'; exit 1 }
    $hosts = @(Get-Content -LiteralPath $HostsPath -ErrorAction Stop)
    $pattern = '^\s*127\.0\.0\.1\s+' + [regex]::Escape($LocalAddress) + '(\s|$)'
    if ($hosts | Where-Object { $_ -match $pattern }) { Write-Info "hosts already maps $LocalAddress" }
    else {
        Add-Content -LiteralPath $HostsPath -Value "127.0.0.1 $LocalAddress $Marker" -Encoding ascii
        Write-Ok "hosts: 127.0.0.1 $LocalAddress"
    }
    $known = @()
    if (Test-Path -LiteralPath $AddressFile) { $known = @(Get-Content -LiteralPath $AddressFile | Where-Object { $_ }) }
    if ($known -notcontains $LocalAddress) { Add-Content -LiteralPath $AddressFile -Value $LocalAddress -Encoding ascii }
}

Write-Ok 'Install complete.'
exit 0
