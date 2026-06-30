@echo off
title MANA SITE START
chcp 65001 >nul
cd /d "C:\cs2-lanonline"

echo.
echo [MANA] Fix npm registry...
call npm config set registry https://registry.npmjs.org/
call npm config delete proxy >nul 2>&1
call npm config delete https-proxy >nul 2>&1

echo.
echo [MANA] Remove old package-lock files with wrong registry...
if exist package-lock.json del /f /q package-lock.json
if exist server\package-lock.json del /f /q server\package-lock.json
if exist client\package-lock.json del /f /q client\package-lock.json

echo.
echo [MANA] Install dependencies...
call npm install --package-lock=false --registry=https://registry.npmjs.org/
if errorlevel 1 goto error
call npm install --prefix server --package-lock=false --registry=https://registry.npmjs.org/
if errorlevel 1 goto error
call npm install --prefix client --package-lock=false --registry=https://registry.npmjs.org/
if errorlevel 1 goto error

echo.
echo [MANA] Start site...
call npm run dev
goto end

:error
echo.
echo [MANA] ERROR: send this window screenshot to ChatGPT.
pause
exit /b 1

:end
pause
