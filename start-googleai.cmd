@echo off
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
if exist "out\main\index.js" (
  start "" ".\node_modules\electron\dist\electron.exe" .
) else (
  pnpm.cmd run dev
)
