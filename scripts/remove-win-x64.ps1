#requires -Version 5.1
# Stop Shideh and delete only the installed Shideh.exe.
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

$AppName = 'Shideh'
$InstalledExe = Join-Path $env:LOCALAPPDATA "$AppName\Shideh.exe"

function Get-InstalledProcesses {
    foreach ($proc in @(Get-Process -Name $AppName -ErrorAction SilentlyContinue)) {
        $path = $null
        try { $path = $proc.Path } catch { continue }
        if ($path -and ($path -ieq $InstalledExe)) { $proc }
    }
}

$service = Get-Service -Name $AppName -ErrorAction SilentlyContinue
if ($service -and $service.Status -ne 'Stopped') {
    Write-Info "Stopping Windows service $AppName"
    try {
        Stop-Service -Name $AppName -Force -ErrorAction Stop
        $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(20))
    }
    catch {
        Write-Err "Could not stop the $AppName service. Nothing was deleted."
        exit 1
    }
}

foreach ($proc in @(Get-InstalledProcesses)) {
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
        Write-Err "Could not stop $AppName (pid $($proc.Id)). Nothing was deleted."
        exit 1
    }
}

if (@(Get-InstalledProcesses).Count -gt 0) {
    Write-Err "$AppName is still running from $InstalledExe. Nothing was deleted."
    exit 1
}

if (-not (Test-Path -LiteralPath $InstalledExe)) {
    Write-Info "Installed executable already absent: $InstalledExe"
    Write-Ok 'Remove complete.'
    exit 0
}

try {
    Remove-Item -LiteralPath $InstalledExe -Force -ErrorAction Stop
}
catch {
    Write-Err "Could not remove $InstalledExe. $_"
    exit 1
}
Write-Ok "Removed $InstalledExe"
Write-Ok 'Remove complete.'
exit 0
