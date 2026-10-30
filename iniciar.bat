@echo off
REM Inicia o Cockpit do BP (Windows). Requer Python 3.10+.
REM Deixe esta janela ABERTA enquanto usa o cockpit: ela e o servidor.
cd /d "%~dp0"
where py >nul 2>nul && (set "PY=py") || (set "PY=python")
echo Preparando o Cockpit do BP...
%PY% -m pip install -q -r server\requirements.txt
REM abre o navegador alguns segundos depois, quando o servidor ja estiver no ar
start "" /min cmd /c "timeout /t 5 /nobreak >nul && start http://localhost:8765"
%PY% -m server %*
echo.
echo O servidor foi encerrado. Se apareceu algum erro acima, copie a mensagem.
pause
