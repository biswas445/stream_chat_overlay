@echo off
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo [start] npm not found on PATH. Install Node.js 18+ from https://nodejs.org
  pause
  exit /b 1
)
if not exist "node_modules\electron\package.json" (
  echo [start] dependencies missing - running npm install first...
  call npm install
  if errorlevel 1 (
    echo [start] npm install failed.
    pause
    exit /b 1
  )
)
call npm start
if errorlevel 1 (
  echo [start] app exited with error %errorlevel%.
  pause
  exit /b %errorlevel%
)
