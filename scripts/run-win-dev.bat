@echo off
setlocal
title Shideh / SauronHarness Dev
cd /d "%~dp0.."
REM Full scripts\code.bat preLaunch runs npm run compile (tsgo typecheck), which
REM currently fails on this tree (~145 TS errors). Use transpile emit + skip preLaunch.
if not exist "out\vs\code\electron-main\main.js" (
  echo [run] out\ missing ? running npm run transpile-client ...
  call npm run transpile-client || exit /b 1
)
if not exist ".build\electron\SauronHarness.exe" (
  echo [run] Electron missing ? running npm run electron ...
  call npm run electron || exit /b 1
)
set VSCODE_SKIP_PRELAUNCH=1
call scripts\code.bat %*
