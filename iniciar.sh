#!/usr/bin/env sh
# Inicia o Cockpit do BP (Linux/macOS). Requer Python 3.10+.
cd "$(dirname "$0")"
python3 -m pip install -q -r server/requirements.txt
python3 -m server "$@"
