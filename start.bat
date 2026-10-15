@echo off
title ORCAS
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies, one moment...
  call npm install --no-audit --no-fund
)
start "" http://localhost:3000
node server.js
pause
