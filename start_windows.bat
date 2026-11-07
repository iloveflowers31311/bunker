@echo off
chcp 65001 >nul
echo ========================================
echo    БУНКЕР: ЕКОНОМІКА / ONLINE
 echo ========================================
where node >nul 2>nul
if errorlevel 1 (
 echo Node.js не знайдено. Встановіть Node.js 20+ з https://nodejs.org/
 pause
 exit /b 1
)
node server.js
pause
