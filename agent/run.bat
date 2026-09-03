@echo off
REM Sightline scrim agent — double-click to start, leave this window open while you scrim.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org  ^(LTS is fine, needs v20+^).
  pause
  exit /b 1
)

if not exist config.json (
  echo No config.json found. Copying the example — edit it with your ingest key, then run again.
  copy config.example.json config.json >nul
  notepad config.json
  exit /b 1
)

echo Starting Sightline scrim agent. Keep this window open while playing scrims.
echo Ctrl+C to stop.
echo.
node sightline-agent.mjs
pause
