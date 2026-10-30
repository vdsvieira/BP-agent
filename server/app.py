"""Servidor local do Cockpit do BP.

    python -m server                      # sobe cockpit + API em http://localhost:8765
    python -m server --reset              # recria o ambiente simulado
    python -m server --pergunta "..." --modo coach
    python -m server --rotina briefing    # rotina agendável (cron / Agendador de Tarefas)
    python -m server --exportar-demo      # gera data/base_demo.js (cockpit offline)
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from . import banco, conectores, ia, ingestao

RAIZ = Path(__file__).resolve().parent.parent
PUBLICO = ("index.html", "assets/", "data/")  # o banco SQLite e o código do servidor não são servidos
_agente = None
_lock_agente = threading.Lock()


def agente():
    global _agente
    with _lock_agente:
        if _agente is None:
            from .agente import Agente
            _agente = Agente(os.environ.get("BP_EFFORT", "medium"))
        return _agente


def garantir_base() -> None:
    con = banco.conectar()
    try:
        if not banco.tabelas(con):
            print("Criando ambiente simulado (primeira execução)…")
            conectores.sincronizar(con)
        banco.criar_auxiliares(con)
        con.commit()
    finally:
        con.close()


class Handler(BaseHTTPRequestHandler):
    server_version = "CockpitBP/2"

    def _json(self, codigo: int, obj) -> None:
        corpo = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(corpo)

    def _corpo(self) -> dict:
        n = int(self.headers.get("Content-Length", 0))
        if n > 40 * 1024 * 1024:
            raise ValueError("Requisição muito grande.")
        return json.loads(self.rfile.read(n) or b"{}")

    # ---------------------------------------------------------------- GET
    def do_GET(self):
        caminho = urlparse(self.path).path
        if caminho.startswith("/api/"):
            con = banco.conectar()
            try:
                if caminho == "/api/saude":
                    return self._json(200, {"ok": True, "ia": ia.status_credencial()})
                if caminho == "/api/dados":
                    return self._json(200, banco.montar_base_front(con))
                if caminho == "/api/catalogo":
                    docs = [dict(r) for r in con.execute("SELECT id, nome, tipo_arquivo, tipo_documento, resumo, tabelas_geradas, enviado_em FROM documentos ORDER BY id DESC")]
                    return self._json(200, {"tabelas": banco.tabelas(con), "documentos": docs, "conectores": conectores.listar(con)})
                return self._json(404, {"erro": "rota inexistente"})
            finally:
                con.close()
        arq = (RAIZ / (unquote(caminho.lstrip("/")) or "index.html")).resolve()
        # valida o caminho JÁ resolvido: impede "assets/../server/..." de escapar das pastas públicas
        rel = arq.relative_to(RAIZ).as_posix() if arq.is_relative_to(RAIZ) else ""
        if not rel.startswith(PUBLICO) or not arq.is_file():
            self.send_error(404)
            return
        dados = arq.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", (mimetypes.guess_type(arq.name)[0] or "application/octet-stream") + ("; charset=utf-8" if arq.suffix in (".html", ".js", ".css", ".csv", ".json") else ""))
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    # --------------------------------------------------------------- POST
    def do_POST(self):
        caminho = urlparse(self.path).path
        try:
            corpo = self._corpo()
        except (ValueError, json.JSONDecodeError) as e:
            return self._json(400, {"erro": str(e)})
        con = banco.conectar()
        try:
            if caminho == "/api/upload":
                dados = base64.b64decode(corpo["base64"])
                return self._json(200, ingestao.ingerir(con, corpo["nome"], corpo.get("mime", ""), dados))
            if caminho.startswith("/api/conectores/") and caminho.endswith("/sincronizar"):
                cid = caminho.split("/")[3]
                ids = None if cid == "todos" else [cid]
                if ids and ids[0] not in conectores.POR_ID:
                    return self._json(404, {"erro": "conector inexistente"})
                return self._json(200, conectores.sincronizar(con, ids))
            if caminho == "/api/snapshot":
                banco.kv_set(con, "snapshot_cockpit", corpo)
                con.commit()
                return self._json(200, {"ok": True})
            if caminho == "/api/chat":
                try:
                    ag = agente()
                    r = ag.conversar(str(corpo.get("sessao", "padrao")), corpo.get("modo", "analista"), corpo.get("mensagem", ""), corpo.get("contexto", ""))
                    return self._json(200, r)
                except Exception as e:  # classifica pelo tipo/código HTTP e mostra a causa real
                    ia.registrar_erro("chat", e)
                    codigo, msg = ia.explicar_erro(e)
                    return self._json(codigo, {"erro": msg})
            return self._json(404, {"erro": "rota inexistente"})
        except (ValueError, KeyError) as e:
            return self._json(400, {"erro": str(e)})
        except Exception as e:  # erro inesperado: devolve mensagem em vez de derrubar a conexão
            return self._json(500, {"erro": f"{type(e).__name__}: {e}"})
        finally:
            con.close()

    def log_message(self, fmt, *args):
        if "/api/" in str(args[0] if args else ""):
            sys.stderr.write("[cockpit] " + (fmt % args) + "\n")


def exportar_demo() -> Path:
    con = banco.conectar()
    try:
        base = banco.montar_base_front(con)
    finally:
        con.close()
    destino = RAIZ / "data" / "base_demo.js"
    destino.write_text("/* Base SINTÉTICA para abrir o cockpit sem servidor. Gerada por: python -m server --exportar-demo */\nwindow.BP_BASE_DEMO = "
                       + json.dumps(base, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    return destino


def main() -> None:
    ap = argparse.ArgumentParser(description="Cockpit do BP — servidor local")
    ap.add_argument("--porta", type=int, default=8765)
    ap.add_argument("--reset", action="store_true", help="Recria o ambiente simulado")
    ap.add_argument("--exportar-demo", action="store_true")
    ap.add_argument("--pergunta")
    ap.add_argument("--modo", default="analista", choices=["analista", "materiais", "coach"])
    ap.add_argument("--rotina", help="briefing | pautas | retencao | org-health")
    ap.add_argument("--diagnostico", action="store_true", help="Testa credencial, proxy e conexão com a IA")
    a = ap.parse_args()
    ia.carregar_env()  # chave e proxy podem vir de um arquivo .env na pasta do cockpit

    if a.diagnostico:
        sys.exit(ia.diagnostico())

    if a.reset and banco.ARQUIVO.exists():
        banco.ARQUIVO.unlink()
    garantir_base()
    if a.exportar_demo:
        print("Gerado:", exportar_demo())
        return
    if a.pergunta or a.rotina:
        from .agente import ROTINAS
        modo, texto = ROTINAS[a.rotina] if a.rotina else (a.modo, a.pergunta)
        r = agente().conversar("cli", modo, texto)
        print(r["resposta"])
        for m in r["materiais"]:
            print("\nMaterial salvo em:", m["arquivo"])
        return
    srv = ThreadingHTTPServer(("127.0.0.1", a.porta), Handler)  # só localhost: a base contém dados de pessoas
    print(f"Cockpit do BP em http://localhost:{a.porta}  (Ctrl+C para encerrar)")
    print(f"IA: {ia.status_credencial()}  ·  problemas? rode: python -m server --diagnostico")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
