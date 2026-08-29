@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found in PATH.
  pause
  exit /b 1
)

where codex >nul 2>nul
if errorlevel 1 (
  echo Codex CLI was not found in PATH.
  pause
  exit /b 1
)

start "" "http://127.0.0.1:4317"
node server.js

if errorlevel 1 pause
