@echo off
rem ============================================================
rem  AI Edu Agent - Windows portable build script
rem  (kept ASCII-only on purpose: cmd.exe mis-parses non-ASCII
rem   bytes in .bat files, which breaks the script itself.
rem   The build script prints Chinese messages; chcp 65001 below
rem   makes them render correctly in the console.)
rem ============================================================
chcp 65001 >nul 2>nul
setlocal
cd /d "%~dp0"

echo ============================================================
echo   AI Edu Agent - Windows portable build
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 goto no_node

if not exist "packaging\node_modules" goto install_deps
goto build

:install_deps
echo [1/2] Installing build-time dependencies (esbuild / postject)...
pushd packaging
call npm install --no-audit --no-fund
if errorlevel 1 goto install_failed
popd
goto build

:build
echo [2/2] Building portable release...
echo.
node "packaging\scripts\build-release.mjs"
if errorlevel 1 goto build_failed
echo.
echo Build OK. Output is in the "release" folder (see paths above).
echo.
pause
exit /b 0

:no_node
echo [ERROR] Node.js not found.
echo         Node.js is required on the BUILD machine only (20+ recommended).
echo         End users do not need to install anything.
pause
exit /b 1

:install_failed
popd
echo [ERROR] Failed to install build-time dependencies. Check the network and retry.
pause
exit /b 1

:build_failed
echo.
echo [ERROR] Build failed. See the output above.
pause
exit /b 1
