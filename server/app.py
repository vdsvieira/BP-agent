"""Servidor local do Cockpit do BP + Plataforma de Gente & Gestão.

    python -m server                      # sobe tudo em http://localhost:8765 (login: contas demo, senha demo123)
    python -m server --reset              # recria o ambiente simulado
    python -m server --pergunta "..." --modo coach
    python -m server --rotina briefing    # rotina agendável (cron / Agendador de Tarefas)
    python -m server --exportar-demo      # gera data/base_demo.js (cockpit offline)
    python -m server --diagnostico        # testa chave, proxy e conexão com a IA
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import sys
import threading
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from . import auth, banco, conectores, ia, ingestao, plataforma, rotas
from .rotas import STAFF, Ctx, Erro, rota

RAIZ = Path(__file__).resolve().parent.parent
PUBLICO = ("index.html", "login.html", "portal.html", "assets/", "data/")  # banco, arquivos enviados e código do servidor não são servidos
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
        plataforma.iniciar(con)
        con.commit()
    finally:
        con.close()


# ------------------------------------------------------------------ rotas do cockpit (somente RH/BP)
@rota("GET", "/api/saude", "publico")
def saude(ctx: Ctx):
    return {"ok": True, "ia": ia.status_credencial()}


@rota("GET", "/api/dados", STAFF)
def dados(ctx: Ctx):
    return banco.montar_base_front(ctx.con)


@rota("GET", "/api/catalogo", STAFF)
def catalogo(ctx: Ctx):
    docs = ctx.q("SELECT id, nome, tipo_arquivo, tipo_documento, resumo, tabelas_geradas, enviado_em FROM documentos ORDER BY id DESC")
    return {"tabelas": banco.tabelas(ctx.con), "documentos": docs, "conectores": conectores.listar(ctx.con)}


@rota("POST", "/api/upload", STAFF)
def upload(ctx: Ctx):
    return ingestao.ingerir(ctx.con, ctx.campo("nome"), ctx.corpo.get("mime", ""), base64.b64decode(ctx.campo("base64")))


@rota("POST", r"/api/conectores/(?P<cid>\w+)/sincronizar", STAFF)
def sincronizar(ctx: Ctx, cid: str):
    if cid != "todos" and cid not in conectores.POR_ID:
        raise Erro(404, "Conector inexistente.")
    r = conectores.sincronizar(ctx.con, None if cid == "todos" else [cid])
    plataforma.pos_sincronizacao(ctx.con)
    return r


@rota("POST", "/api/snapshot", STAFF)
def snapshot(ctx: Ctx):
    banco.kv_set(ctx.con, "snapshot_cockpit", ctx.corpo)
    ctx.con.commit()
    return {"ok": True}


@rota("POST", "/api/chat", STAFF)
def chat(ctx: Ctx):
    try:
        return agente().conversar(f"{ctx.u['id']}:{ctx.corpo.get('sessao', 'padrao')}", ctx.corpo.get("modo", "analista"),
                                  ctx.corpo.get("mensagem", ""), ctx.corpo.get("contexto", ""))
    except Exception as e:  # classifica pelo tipo/código HTTP e mostra a causa real
        ia.registrar_erro("chat", e)
        codigo, msg = ia.explicar_erro(e)
        raise Erro(codigo, msg) from e


# ------------------------------------------------------------------ HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "CockpitBP/3"

    def _enviar(self, codigo: int, corpo: bytes, tipo: str, extras: list[tuple[str, str]] = ()) -> None:
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        for k, v in extras:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(corpo)

    def _json(self, codigo: int, obj, cookies: list[str] = ()) -> None:
        self._enviar(codigo, json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8"), "application/json; charset=utf-8",
                     [("Set-Cookie", c) for c in cookies])

    def _token(self) -> str | None:
        c = SimpleCookie(self.headers.get("Cookie", ""))
        return c[auth.COOKIE].value if auth.COOKIE in c else None

    def _api(self, metodo: str) -> None:
        url = urlparse(self.path)
        achado = rotas.resolver(metodo, url.path)
        if not achado:
            return self._json(404, {"erro": "Rota inexistente."})
        fn, params, perfis = achado
        corpo = {}
        if metodo == "POST":
            # só JSON: navegadores não enviam JSON entre sites sem CORS, o que bloqueia CSRF por formulário
            if "application/json" not in self.headers.get("Content-Type", ""):
                return self._json(415, {"erro": "Envie JSON."})
            n = int(self.headers.get("Content-Length", 0))
            if n > 40 * 1024 * 1024:
                return self._json(413, {"erro": "Requisição muito grande."})
            try:
                corpo = json.loads(self.rfile.read(n) or b"{}")
            except json.JSONDecodeError:
                return self._json(400, {"erro": "JSON inválido."})
        con = banco.conectar()
        try:
            usuario = auth.usuario_da_sessao(con, self._token())
            ctx = Ctx(con, usuario, corpo if isinstance(corpo, dict) else {}, {k: v[0] for k, v in parse_qs(url.query).items()})
            rotas.autorizar(perfis, usuario)
            r = fn(ctx, **params)
            if isinstance(r, dict) and r.get("__arquivo__"):
                nome = r["nome"].replace('"', "")
                return self._enviar(200, r["dados"], r["mime"], [("Content-Disposition", f'inline; filename="{nome}"')])
            return self._json(200, r, ctx.cookies)
        except Erro as e:
            con.rollback()
            return self._json(e.status, {"erro": e.msg})
        except (ValueError, KeyError, TypeError) as e:
            con.rollback()
            return self._json(400, {"erro": f"Dados inválidos: {e}"})
        except Exception as e:  # erro inesperado: registra e devolve mensagem em vez de derrubar a conexão
            con.rollback()
            ia.registrar_erro(url.path, e)
            return self._json(500, {"erro": f"Erro interno: {type(e).__name__}: {e}"})
        finally:
            con.close()

    def do_POST(self):
        self._api("POST")

    def do_GET(self):
        caminho = urlparse(self.path).path
        if caminho.startswith("/api/"):
            return self._api("GET")
        arq = (RAIZ / (unquote(caminho.lstrip("/")) or "portal.html")).resolve()
        # valida o caminho JÁ resolvido: impede "assets/../server/..." de escapar das pastas públicas
        rel = arq.relative_to(RAIZ).as_posix() if arq.is_relative_to(RAIZ) else ""
        if not rel.startswith(PUBLICO) or not arq.is_file():
            self.send_error(404)
            return
        tipo = (mimetypes.guess_type(arq.name)[0] or "application/octet-stream") + ("; charset=utf-8" if arq.suffix in (".html", ".js", ".css", ".csv", ".json") else "")
        self._enviar(200, arq.read_bytes(), tipo)

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

    if a.reset:
        for f in banco.ARQUIVO.parent.glob("bp.db*"):
            f.unlink()
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
    print(f"Plataforma de Gente & Gestão em http://localhost:{a.porta}  (Ctrl+C para encerrar)")
    print(f"Contas de demonstração: bp, rh, gestor, colaborador, novo, candidato — senha {auth.SENHA_DEMO}")
    print(f"IA: {ia.status_credencial()}  ·  problemas? rode: python -m server --diagnostico")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
