@echo off
REM Starts the RIPPLE API (8787) and dashboard dev server (5175), then opens the browser.
REM The launcher window closes itself; only the two server windows stay open.
set ROOT=%~dp0
start "RIPPLE API" /min cmd /k "cd /d %ROOT% && python -m ripple serve --port 8787"
start "RIPPLE Web" /min cmd /k "cd /d %ROOT%web && npm run dev -- --port 5175"
start "" /b cmd /c "timeout /t 6 /nobreak >nul & start "" http://localhost:5175"
exit
