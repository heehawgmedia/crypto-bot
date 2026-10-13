@echo off
setlocal EnableExtensions
title Barndo Planner
:: =====================================================================
::  Barndo Planner launcher for Windows
::  Double-click to start the app. First run downloads the code and
::  installs dependencies (needs internet). Run with "update" as an
::  argument, or delete %USERPROFILE%\BarndoPlanner, to fetch fresh code.
::
::  When the project moves to its own repository, change REPO/BRANCH and
::  set SUBDIR to empty.
:: =====================================================================
set "REPO=heehawgmedia/crypto-bot"
set "BRANCH=ccr-838d8070-g86avi"
set "SUBDIR=barndo-planner"
set "BASE=%USERPROFILE%\BarndoPlanner"
set "CHECKOUT=%BASE%\source"
set "APP=%CHECKOUT%"
if not "%SUBDIR%"=="" set "APP=%CHECKOUT%\%SUBDIR%"

echo.
echo  =========================================
echo    Barndo Planner
echo  =========================================
echo.

:: ---- Node.js -----------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js is not installed. It is required to run the app.
  where winget >nul 2>nul
  if not errorlevel 1 (
    echo  Installing Node.js LTS with winget...
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    echo.
    echo  Node.js installed. Please close this window and double-click the launcher again.
    pause
    exit /b 0
  )
  echo  Opening the Node.js download page. Install the LTS version, then run this launcher again.
  start "" https://nodejs.org/
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo  Node.js %%v found.

:: ---- Get the code ------------------------------------------------------
if /i "%~1"=="update" (
  echo  Removing old copy for a fresh download...
  rmdir /s /q "%BASE%" 2>nul
)
if exist "%APP%\package.json" goto :have_code

echo  Downloading Barndo Planner (%REPO% @ %BRANCH%)...
if not exist "%BASE%" mkdir "%BASE%"
where git >nul 2>nul
if not errorlevel 1 (
  git clone --depth 1 --branch "%BRANCH%" "https://github.com/%REPO%.git" "%CHECKOUT%"
  if errorlevel 1 goto :download_failed
  goto :have_code
)
:: No git: download the branch as a ZIP and extract it.
set "ZIP=%TEMP%\barndo-planner.zip"
set "TMPX=%TEMP%\barndo-planner-extract"
rmdir /s /q "%TMPX%" 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest -Uri 'https://github.com/%REPO%/archive/refs/heads/%BRANCH%.zip' -OutFile '%ZIP%'; Expand-Archive -Path '%ZIP%' -DestinationPath '%TMPX%' -Force"
if errorlevel 1 goto :download_failed
for /d %%D in ("%TMPX%\*") do set "EXTRACTED=%%~D"
if not defined EXTRACTED goto :download_failed
robocopy "%EXTRACTED%" "%CHECKOUT%" /E /MOVE /NFL /NDL /NJH /NJS /NC /NS /NP >nul
if errorlevel 8 goto :download_failed
rmdir /s /q "%TMPX%" 2>nul
del /q "%ZIP%" 2>nul
if not exist "%APP%\package.json" goto :download_failed

:have_code
cd /d "%APP%"

:: ---- Dependencies ------------------------------------------------------
if not exist "node_modules\" (
  echo  Installing dependencies (first run only, this takes a minute)...
  call npm install
  if errorlevel 1 (
    echo  npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

:: ---- Run ---------------------------------------------------------------
echo.
echo  Starting Barndo Planner. Your browser will open at http://localhost:5173
echo  Keep this window open while you use the app. Close it to stop.
echo.
call npm run dev -- --open --port 5173
pause
exit /b 0

:download_failed
echo.
echo  Could not download the code. If the repository is private, install Git
echo  (https://git-scm.com) and sign in to GitHub, then run this launcher again.
pause
exit /b 1
