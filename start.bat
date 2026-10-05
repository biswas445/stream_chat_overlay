@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Hikasha Chat - Stream Chat Overlay

:: --- 1. Node + npm on PATH ---------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo [start] ERROR: node not found on PATH.
  echo [start] Install Node.js 18+ from https://nodejs.org then re-run start.bat
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [start] ERROR: npm not found on PATH. Reinstall Node.js 18+.
  pause
  exit /b 1
)
for /f "tokens=1 delims=v" %%v in ('node -e "console.log(process.version)"') do set NODEV=%%v
echo [start] node !NODEV! detected.

:: --- 2. Dependencies present (electron + vite) ---------------------------
if not exist "node_modules\electron\package.json" goto :install
if not exist "node_modules\vite\package.json" goto :install
if not exist "package.json" (
  echo [start] ERROR: package.json missing - are you in the app folder?
  pause
  exit /b 1
)
goto :envcheck

:install
echo [start] dependencies missing - running npm install (first run)...
call npm install
if errorlevel 1 (
  echo [start] ERROR: npm install failed. Check your connection and re-run.
  pause
  exit /b 1
)

:: --- 3. Fresh-clone config: .env.example -> .env -------------------------
:envcheck
if not exist ".env" (
  if exist ".env.example" (
    echo [start] no .env found - creating one from .env.example...
    copy /y ".env.example" ".env" >nul
    echo [start] Created .env. Open it and paste your BotRix widget URL:
    echo [start]   BOTRIX_WIDGET_URL="https://botrix.live/widgets/multistream?bid=YOUR_BID"
    echo.
    echo [start] The panel will open with a setup card until this is set.
    pause
  ) else (
    echo [start] WARNING: neither .env nor .env.example found. The panel will show setup help.
    pause
  )
)

:: --- 4. Build + launch ----------------------------------------------------
echo [start] building renderer...
call npm start
set CODE=!errorlevel!
if not "!CODE!"=="0" (
  echo [start] app exited with error !CODE!.
  echo [start] Common fixes: delete node_modules + package-lock.json, run npm install again.
  pause
  exit /b !CODE!
)
endlocal
