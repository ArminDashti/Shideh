# Install or update Shideh (Windows x64). Rebuilds when the source changed.
$ErrorActionPreference = 'Stop'

function Write-Ok($Message) { Write-Host $Message -ForegroundColor Green }
function Write-Info($Message) { Write-Host $Message -ForegroundColor Yellow }
function Write-Err($Message) { Write-Host $Message -ForegroundColor Red }

$Repo = Split-Path -Parent $PSScriptRoot
$InstallDir = Join-Path $env:LOCALAPPDATA 'Shideh'
$StampPath = Join-Path $InstallDir '.build-stamp'
$OutputDir = Join-Path (Split-Path -Parent $Repo) 'VSCode-win32-x64'
$ExeName = 'Shideh.exe'

function Require-Tool($Name, $Hint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Write-Err "Missing $Name. $Hint"
        exit 1
    }
}

function Get-NodeVersion {
    $raw = (& node -p "process.versions.node").Trim()
    return [version]($raw.Split('-')[0])
}

Require-Tool 'git' 'Install Git for Windows, then run this script again.'
Require-Tool 'node' 'Install Node.js. This repo .nvmrc says which version the build expects.'
Require-Tool 'python' 'Install Python and make sure python runs from a command prompt.'
Require-Tool 'npm' 'Install Node.js, which includes npm. Shideh uses package-lock.json, so the install uses npm.'

$nodeVersion = Get-NodeVersion
$nvmrcPath = Join-Path $Repo '.nvmrc'
if (Test-Path $nvmrcPath) {
    $required = [version]((Get-Content $nvmrcPath -Raw).Trim().TrimStart('v'))
    if ($nodeVersion -lt $required) {
        Write-Err "Node $nodeVersion is installed. .nvmrc requires $required. Install that version, then run this script again."
        exit 1
    }
} elseif ($nodeVersion.Major -lt 22) {
    Write-Err "Node $nodeVersion is installed. Shideh needs Node 22 or newer."
    exit 1
}

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) {
    Write-Err "Visual Studio Build Tools are missing (vswhere.exe not found). Install the C++ workload, then run this script again."
    exit 1
}
$vc = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vc) {
    Write-Err "Visual Studio C++ tools are missing. Install the Desktop development with C++ workload, then run this script again."
    exit 1
}

Set-Location $Repo
Write-Info "Updating $Repo"
git pull --ff-only
if ($LASTEXITCODE -ne 0) {
    Write-Err "git pull failed. Fix the repo, then run this script again."
    exit 1
}

function Get-SourceStamp {
    $head = (git rev-parse HEAD).Trim()
    $dirty = (git status --porcelain | Out-String).Trim()
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($dirty)
        $hash = ([BitConverter]::ToString($hasher.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
        $hasher.Dispose()
    }
    return "$head|$hash"
}

$stamp = Get-SourceStamp
$previous = ''
if (Test-Path $StampPath) {
    $previous = (Get-Content $StampPath -Raw).Trim()
}
$installed = Test-Path (Join-Path $InstallDir $ExeName)
$needsBuild = (-not $installed) -or ($stamp -ne $previous)

if ($needsBuild) {
    Get-Process -Name 'Shideh' -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Info "Stopping Shideh (pid $($_.Id))"
        $_.CloseMainWindow() | Out-Null
        if (-not $_.WaitForExit(5000)) {
            Stop-Process -Id $_.Id -Force
        }
    }

    Write-Info 'Installing npm dependencies'
    npm ci
    if ($LASTEXITCODE -ne 0) {
        Write-Err 'npm ci failed.'
        exit 1
    }

    Write-Info 'Building vscode-win32-x64'
    npm run gulp -- vscode-win32-x64
    if ($LASTEXITCODE -ne 0) {
        Write-Err 'The Windows x64 build failed.'
        exit 1
    }

    $builtExe = Join-Path $OutputDir $ExeName
    if (-not (Test-Path $builtExe)) {
        Write-Err "Build finished but $builtExe is missing."
        exit 1
    }

    Write-Info "Copying build to $InstallDir"
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    & robocopy $OutputDir $InstallDir /MIR /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
    if ($LASTEXITCODE -ge 8) {
        Write-Err "robocopy failed with exit code $LASTEXITCODE."
        exit 1
    }
    Set-Content -Path $StampPath -Value $stamp -Encoding ascii
    Write-Ok "Built and installed $stamp"
} else {
    Write-Ok 'Already up to date. Skipped rebuild.'
}

$bin = Join-Path $InstallDir 'bin'
if (Test-Path $bin) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $entries = @()
    if ($userPath) {
        $entries = @($userPath.Split(';') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    }
    $present = @($entries | Where-Object { $_.TrimEnd('\') -ieq $bin.TrimEnd('\') })
    if ($present.Count -eq 0) {
        $updated = (@($entries) + $bin) -join ';'
        [Environment]::SetEnvironmentVariable('Path', $updated, 'User')
        Write-Ok "Added $bin to the user PATH"
    }
}

$shortcutPath = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Shideh.lnk'
$target = Join-Path $InstallDir $ExeName
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $InstallDir
$shortcut.Description = 'Shideh'
$shortcut.IconLocation = "$target,0"
$shortcut.Save()
Write-Ok "Start Menu shortcut: $shortcutPath"

if ($needsBuild) {
    Write-Info 'Launching Shideh'
    Start-Process -FilePath $target -WorkingDirectory $InstallDir
}
