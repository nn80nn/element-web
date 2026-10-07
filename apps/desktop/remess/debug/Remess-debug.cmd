@echo off
rem Starts Remess with its console being recorded to %USERPROFILE%\remess-debug.log.
rem Close any running Remess first (check the tray): only one copy can run at a time.
rem Use it as normal. When something goes wrong, send the log file.
set "REMESS=%ProgramFiles%\Remess\Remess.exe"
if not exist "%REMESS%" set "REMESS=%LOCALAPPDATA%\remess-desktop\Remess.exe"
start "" "%REMESS%" --remote-debugging-port=9222
start "Remess capture" /min node "%~dp0capture.js"
echo Remess started. Recording to %USERPROFILE%\remess-debug.log
