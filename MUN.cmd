@echo off
rem Delayed expansion is deliberately OFF: it is not used anywhere below, and it
rem makes the launcher fail outright if the folder path contains a "!".
setlocal
title MUN Live Command Center - Canada / UNGA
rem UTF-8, so the flag and the box-drawing in the banner render instead of mojibake.
chcp 65001 >nul 2>&1

rem ---------------------------------------------------------------------------
rem  Portable launcher. Double-click this on any Windows PC.
rem
rem  It works from a pendrive with no installation and no admin rights, as long
rem  as either (a) node.exe sits in the "node" folder next to this file, or
rem  (b) the PC already has Node.js 22.5 or newer installed.
rem
rem  All data - the database, your notes, the search index, the embedding model -
rem  is kept in the "MUN-Data" folder on this drive. Nothing is written to the
rem  host PC, so your work travels with the drive and leaves nothing behind on a
rem  school computer.
rem
rem  Every check below jumps to a labelled section rather than living inside a
rem  multi-line "if (...)" block. A path like "C:\Users\me\Downloads\MUN (1)\"
rem  closes such a block early, and the window vanishes with a syntax error
rem  before it can ever reach a "pause" - which looks exactly like "it does
rem  nothing when I double-click it".
rem ---------------------------------------------------------------------------

set "HERE=%~dp0"

rem --- A network location cannot be a working directory for cmd.exe ------------
if "%HERE:~0,2%"=="\\" goto :unc_path

cd /d "%HERE%" || goto :bad_cwd

rem --- Find a Node runtime -----------------------------------------------------
set "NODE_EXE="
if exist "%HERE%node\node.exe" set "NODE_EXE=%HERE%node\node.exe"
if defined NODE_EXE goto :have_node

where node >nul 2>&1 && set "NODE_EXE=node"
if not defined NODE_EXE goto :no_node

:have_node

rem --- Node must be new enough for node:sqlite (the database engine) ------------
set "NODE_MAJOR="
set "NODE_MINOR="
for /f "usebackq tokens=1,2 delims=v." %%a in (`"%NODE_EXE%" --version`) do (
  set "NODE_MAJOR=%%a"
  set "NODE_MINOR=%%b"
)
if not defined NODE_MAJOR goto :node_broken
if %NODE_MAJOR% GEQ 23 goto :node_ok
if %NODE_MAJOR% LSS 22 goto :old_node
if %NODE_MINOR% LSS 5 goto :old_node
:node_ok

rem --- Sanity checks -----------------------------------------------------------
if not exist "%HERE%app\server\index.js" goto :no_app
if not exist "%HERE%app\node_modules\fastify\package.json" goto :no_modules
if not exist "%HERE%app\dist\index.html" goto :no_build

rem --- Keep every byte of data on this drive ----------------------------------
set "MUN_DATA_DIR=%HERE%MUN-Data"
set "NODE_ENV=production"

if not exist "%MUN_DATA_DIR%" mkdir "%MUN_DATA_DIR%"

echo.
echo   Starting the MUN Live Command Center...
echo   Data folder: "%MUN_DATA_DIR%"
echo.
echo   Leave this black window OPEN while you work.
echo   Close it when you are finished, then eject the drive safely.
echo.

rem Give the server a moment to bind the port, then open the browser.
rem `ping` rather than `timeout`: timeout aborts whenever stdin is redirected.
if not defined PORT set "PORT=8788"
start "" /b cmd /c "ping -n 4 127.0.0.1 >nul & start http://127.0.0.1:%PORT%"

"%NODE_EXE%" --disable-warning=ExperimentalWarning "%HERE%app\server\index.js"

echo.
echo   The server has stopped.
pause
exit /b 0


rem ===========================================================================
rem  Failure messages. Each one ends in a pause, so the window always stays up.
rem ===========================================================================

:unc_path
echo.
echo   ===================================================================
echo    This folder is on a network location:
echo.
echo      "%HERE%"
echo.
echo    Windows will not let a command window run from there.
echo    Copy the whole MUN folder onto the Desktop and run it from there.
echo   ===================================================================
echo.
pause
exit /b 1

:bad_cwd
echo.
echo   Could not switch to this folder:
echo.
echo      "%HERE%"
echo.
echo   Copy the whole MUN folder onto the Desktop and run it from there.
echo.
pause
exit /b 1

:no_node
echo.
echo   ===================================================================
echo    Node.js was not found on this PC, and there is no portable copy
echo    in this folder.
echo.
echo    To fix it WITHOUT installing anything or needing admin rights:
echo.
echo      1. On a PC with internet, go to  https://nodejs.org/en/download
echo      2. Choose  Windows Binary ^(.zip^)  -  64-bit.  NOT the installer.
echo      3. Unzip it. Inside is a folder like  node-v24.x.x-win-x64
echo      4. Copy the CONTENTS of that folder into a new folder called
echo         "node" right next to this MUN.cmd file, so that this exists:
echo.
echo            "%HERE%node\node.exe"
echo.
echo      5. Run MUN.cmd again.
echo   ===================================================================
echo.
pause
exit /b 1

:node_broken
echo.
echo   Found Node at "%NODE_EXE%" but it would not report its version.
echo   The copy may be incomplete. Re-copy the "node" folder, or install
echo   Node.js 22.5 or newer.
echo.
pause
exit /b 1

:old_node
echo.
echo   ===================================================================
echo    The Node.js on this PC is too old.
echo.
echo      Found:    v%NODE_MAJOR%.%NODE_MINOR%      at "%NODE_EXE%"
echo      Needed:   v22.5 or newer
echo.
echo    The database uses Node's built-in SQLite, which older versions
echo    do not have. Put a portable Node.js in a "node" folder next to
echo    this file - see https://nodejs.org/en/download, Windows Binary
echo    ^(.zip^), 64-bit - and run MUN.cmd again. It is used in preference
echo    to whatever is installed on the PC.
echo   ===================================================================
echo.
pause
exit /b 1

:no_app
echo.
echo   Could not find app\server\index.js next to this launcher.
echo   Copy the WHOLE MUN folder, not just some of it.
echo.
echo   Looked in: "%HERE%app\server\"
echo.
pause
exit /b 1

:no_modules
echo.
echo   ===================================================================
echo    The app's dependencies are missing ^(app\node_modules^).
echo.
echo    A zip made from the source code alone leaves these out. Either:
echo.
echo      - get the full folder ^(with app\node_modules and node^), or
echo      - on a PC with internet, open a terminal here and run:
echo            cd app
echo            npm install
echo            npm run build
echo   ===================================================================
echo.
pause
exit /b 1

:no_build
echo.
echo   The user interface has not been built ^(app\dist is missing^).
echo   On a PC with internet run:   cd app  ^&^&  npm install  ^&^&  npm run build
echo   then copy the folder across again.
echo.
pause
exit /b 1
