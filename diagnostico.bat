@echo off
REM Diagnostico da IA do Cockpit do BP: testa chave, proxy e conexao com a API.
cd /d "%~dp0"
where py >nul 2>nul && (set "PY=py") || (set "PY=python")
%PY% --version
if errorlevel 1 (
  echo.
  echo Python nao encontrado. Instale em python.org e marque "Add python.exe to PATH".
  pause
  exit /b 1
)
%PY% -m pip install -q -r server\requirements.txt
echo.
%PY% -m server --diagnostico
echo.
echo Copie o texto acima ^(ele nao mostra a sua chave inteira^) e envie para analise.
pause
