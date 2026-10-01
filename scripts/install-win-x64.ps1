#requires -Version 5.1
# Rebuild Shideh for Windows x64 and replace only the installed Shideh.exe.
# Electron also needs the other files under ..\VSCode-win32-x64. This script
# does not copy those files and does not claim a standalone executable.
$ErrorActionPreference = 'Stop'

function Write-Ok($Message) { Write-Host $Message -ForegroundColor Green }
function Write-Info($Message) { Write-Host $Message -ForegroundColor Yellow }
function Write-Err($Message) { Write-Host $Message -ForegroundColor Red }
function Test-IsAdmin {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if ($args.Count -gt 0) {
    Write-Err 'This script accepts no parameters. Run it without port, directory, host, or hosts-file options.'
    exit 1
}
if (-not (Test-IsAdmin)) {
    Write-Err "Administrator rights are required. Right-click PowerShell, choose Run as administrator, then run: $($PSCommandPath)"
    exit 1
}

$Repo = Split-Path -Parent $PSScriptRoot
$AppName = 'Shideh'
$ExeName = 'Shideh.exe'
$ReleaseExe = Join-Path $Repo "release\$ExeName"
$BuiltExe = Join-Path (Split-Path -Parent $Repo) "VSCode-win32-x64\$ExeName"
$InstallDir = Join-Path $env:LOCALAPPDATA $AppName
$InstalledExe = Join-Path $InstallDir $ExeName

function Require-Tool($Name, $Hint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Write-Err "Missing $Name. $Hint The installed app was left unchanged."
        exit 1
    }
}

Require-Tool 'node' 'Install the Node.js version in .nvmrc.'
Require-Tool 'npm' 'Install Node.js, which includes npm.'
Require-Tool 'git' 'Install Git for Windows.'
Require-Tool 'python' 'Install Python and make sure `python` runs.'

$nodeVersion = [version]((& node -p "process.versions.node").Trim().Split('-')[0])
$nvmrcPath = Join-Path $Repo '.nvmrc'
if (Test-Path -LiteralPath $nvmrcPath) {
    $required = [version]((Get-Content -LiteralPath $nvmrcPath -Raw).Trim().TrimStart('v'))
    if ($nodeVersion -lt $required) {
        Write-Err "Node $nodeVersion is installed. .nvmrc requires $required. The installed app was left unchanged."
        exit 1
    }
}

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path -LiteralPath $vswhere)) {
    Write-Err 'Visual Studio Build Tools are missing (vswhere.exe not found). Install the C++ workload, then run this script again. The installed app was left unchanged.'
    exit 1
}
$vc = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vc) {
    Write-Err 'Visual Studio C++ tools are missing. Install the Desktop development with C++ workload, then run this script again. The installed app was left unchanged.'
    exit 1
}
$gulpJs = Join-Path $Repo 'node_modules\gulp\bin\gulp.js'
if (-not (Test-Path -LiteralPath $gulpJs)) {
    Write-Info 'gulp is not installed. Installing dependencies with npm ci'
    Push-Location $Repo
    try {
        & npm ci
        if ($LASTEXITCODE -ne 0) {
            Write-Err 'npm ci failed. The installed app was left unchanged.'
            exit 1
        }
    }
    finally {
        Pop-Location
    }
    if (-not (Test-Path -LiteralPath $gulpJs)) {
        Write-Err "npm ci finished but $gulpJs is missing. The installed app was left unchanged."
        exit 1
    }
}

Write-Info 'Building vscode-win32-x64'
$buildStarted = Get-Date
Push-Location $Repo
try {
    & npm run gulp -- vscode-win32-x64
    if ($LASTEXITCODE -ne 0) {
        Write-Err 'The Windows x64 build failed. The installed app was left running and unchanged.'
        exit 1
    }
}
finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $BuiltExe)) {
    Write-Err "Build finished but $BuiltExe is missing. The installed app was left running and unchanged."
    exit 1
}
$built = Get-Item -LiteralPath $BuiltExe
if ($built.LastWriteTime -lt $buildStarted.AddSeconds(-5)) {
    Write-Err "Build finished but $BuiltExe was not updated. The installed app was left running and unchanged."
    exit 1
}

$releaseDir = Split-Path -Parent $ReleaseExe
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
try {
    Copy-Item -LiteralPath $BuiltExe -Destination $ReleaseExe -Force -ErrorAction Stop
}
catch {
    Write-Err "Could not copy the executable to $ReleaseExe. The installed app was left running and unchanged."
    exit 1
}
Write-Ok "Exported $ReleaseExe"

function Get-InstalledProcesses {
    foreach ($proc in @(Get-Process -Name $AppName -ErrorAction SilentlyContinue)) {
        $path = $null
        try { $path = $proc.Path } catch { continue }
        if ($path -and ($path -ieq $InstalledExe)) { $proc }
    }
}

$service = Get-Service -Name $AppName -ErrorAction SilentlyContinue
$serviceWasRunning = $service -and $service.Status -ne 'Stopped'
$runningProcs = @(Get-InstalledProcesses)

if ($serviceWasRunning) {
    Write-Info "Stopping Windows service $AppName"
    try {
        Stop-Service -Name $AppName -Force -ErrorAction Stop
        $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(20))
    }
    catch {
        Write-Err "Could not stop the $AppName service. The installed executable was not replaced."
        exit 1
    }
    $runningProcs = @(Get-InstalledProcesses)
}

foreach ($proc in $runningProcs) {
    Write-Info "Stopping $AppName (pid $($proc.Id))"
    try {
        $closed = $false
        try { $closed = [bool]$proc.CloseMainWindow() } catch { $closed = $false }
        if ($closed) {
            if (-not $proc.WaitForExit(8000)) { Stop-Process -Id $proc.Id -Force -ErrorAction Stop }
        }
        else {
            Stop-Process -Id $proc.Id -Force -ErrorAction Stop
        }
        if (-not $proc.HasExited) { [void]$proc.WaitForExit(8000) }
    }
    catch {
        Write-Err "Could not stop $AppName (pid $($proc.Id)). The installed executable was not replaced."
        exit 1
    }
}

if (@(Get-InstalledProcesses).Count -gt 0) {
    Write-Err "$AppName is still running from $InstalledExe. The installed executable was not replaced."
    exit 1
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$copied = $false
for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
        Copy-Item -LiteralPath $ReleaseExe -Destination $InstalledExe -Force -ErrorAction Stop
        $copied = $true
        break
    }
    catch {
        Start-Sleep -Milliseconds 400
    }
}
if (-not $copied) {
    Write-Err "Could not replace $InstalledExe. It may still be in use."
    exit 1
}
Write-Ok "Installed $InstalledExe"

if ($serviceWasRunning) {
    try {
        Start-Service -Name $AppName -ErrorAction Stop
        Write-Ok "Started service $AppName"
    }
    catch {
        Write-Err "The executable was replaced, but service $AppName did not start."
        exit 1
    }
}
elseif ($runningProcs.Count -gt 0) {
    if (Test-Path -LiteralPath (Join-Path $InstallDir 'resources')) {
        Start-Process -FilePath $InstalledExe -WorkingDirectory $InstallDir | Out-Null
        Start-Sleep -Seconds 2
        if (@(Get-InstalledProcesses).Count -eq 0) {
            Write-Err 'The executable was replaced, but Shideh did not stay running.'
            exit 1
        }
        Write-Ok 'Restarted Shideh'
    }
    else {
        Write-Info 'Shideh.exe was updated. It was not started: Electron needs the other files from the Windows x64 build beside the executable.'
    }
}
exit 0
