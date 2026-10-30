@echo off
REM Inicia o Cockpit do BP (Windows). Requer Python 3.10+.
cd /d "%~dp0"
py -m pip install -q -r server\requirements.txt
start "" http://localhost:8765
py -m server %*
