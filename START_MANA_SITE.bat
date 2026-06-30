@echo off
title MANA SITE START
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo [MANA] Fix npm registry...
call npm config set registry https://registry.npmjs.org/
call npm config delete proxy >nul 2>&1
call npm config delete https-proxy >nul 2>&1

echo.
echo [MANA] Install dependencies...
call npm run install:all
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
