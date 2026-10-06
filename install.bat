@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Hikasha Chat - Installer

echo ============================================
echo  Hikasha Chat - Stream Chat Overlay
echo  First-time installer
echo ============================================
echo.

:: --- 1. Node + npm -------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo [install] ERROR: node not found on PATH.
  echo [install] Install Node.js 18+ from https://nodejs.org then re-run install.bat
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [install] ERROR: npm not found on PATH. Reinstall Node.js 18+.
  pause
  exit /b 1
)
for /f %%v in ('node -p "process.versions.node"') do set NODEV=%%v
echo [install] node v!NODEV! detected.
node -e "const m=Number(process.versions.node.split('.')[0]); if (m<18){console.error('[install] ERROR: Node 18+ required, found '+process.versions.node);process.exit(1)}"
if errorlevel 1 (
  pause
  exit /b 1
)

:: --- 2. Project files -----------------------------------------------------
if not exist "package.json" (
  echo [install] ERROR: package.json missing - run install.bat from the app folder.
  pause
  exit /b 1
)
if not exist "package-lock.json" (
  echo [install] WARNING: package-lock.json missing - install may resolve newer deps.
)

:: --- 3. Clean-option: stale or broken node_modules -------------------------
if exist "node_modules" (
  if not exist "node_modules\electron\package.json" (
    echo [install] node_modules looks broken ^(electron missing^) - removing for a clean install...
    rmdir /s /q "node_modules"
  )
)

:: --- 4. Install dependencies (ci for reproducible lockfile, fallback) -----
if exist "node_modules\electron\package.json" (
  echo [install] dependencies already present - verifying...
) else (
  if exist "package-lock.json" (
    echo [install] running npm ci ^(clean, lockfile-exact^)...
    call npm ci
    if errorlevel 1 (
      echo [install] npm ci failed - falling back to npm install...
      call npm install
    )
  ) else (
    echo [install] running npm install...
    call npm install
  )
  if errorlevel 1 (
    echo [install] ERROR: dependency install failed. Check your connection and re-run.
    pause
    exit /b 1
  )
)

:: --- 5. Verify install ----------------------------------------------------
if not exist "node_modules\electron\package.json" (
  echo [install] ERROR: electron still missing after install.
  pause
  exit /b 1
)
if not exist "node_modules\vite\package.json" (
  echo [install] ERROR: vite still missing after install.
  pause
  exit /b 1
)
echo [install] dependencies OK.

:: --- 6. Verify build + tests ----------------------------------------------
echo [install] verifying with npm test ^(syntax + unit + build^)...
call npm test
if errorlevel 1 (
  echo [install] ERROR: verification failed. See output above.
  pause
  exit /b 1
)

echo.
echo ============================================
echo  Install complete.
echo  1. Run start.bat to launch the overlay.
echo  2. Click the gear icon in the panel and enter
echo     your BotRix widget URL, then restart the app.
echo ============================================
pause
endlocal
