"""Arquivos enviados na plataforma (currículos, documentos de admissão).

Ficam em server/dados/arquivos (fora do Git) e só são baixados por RH/BP ou pelo próprio dono.
"""
from __future__ import annotations

import base64
import secrets
from pathlib import Path

from ..rotas import Ctx, Erro, agora, rota

PASTA = Path(__file__).resolve().parent.parent / "dados" / "arquivos"
LIMITE = 10 * 1024 * 1024
TIPOS = {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp", "txt": "text/plain", "md": "text/plain"}


def criar_tabelas(con) -> None:
    con.execute("""CREATE TABLE IF NOT EXISTS arquivos (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, mime TEXT, caminho TEXT, tamanho INTEGER,
                   dono_usuario_id INTEGER, finalidade TEXT, criado_em TEXT)""")


def tipo(nome: str) -> str:
    ext = nome.rsplit(".", 1)[-1].lower() if "." in nome else ""
    if ext not in TIPOS:
        raise Erro(400, "Formato não aceito. Envie PDF, imagem (PNG/JPG/WEBP) ou texto.")
    return TIPOS[ext]


def salvar(con, nome: str, mime: str, dados: bytes, dono: int, finalidade: str) -> int:
    if len(dados) > LIMITE:
        raise Erro(400, "Arquivo acima de 10 MB.")
    mime = tipo(nome)
    PASTA.mkdir(parents=True, exist_ok=True)
    caminho = PASTA / (secrets.token_hex(12) + "." + nome.rsplit(".", 1)[-1].lower())
    caminho.write_bytes(dados)
    return con.execute("INSERT INTO arquivos (nome, mime, caminho, tamanho, dono_usuario_id, finalidade, criado_em) VALUES (?,?,?,?,?,?,?)",
                       (nome, mime, caminho.name, len(dados), dono, finalidade, agora())).lastrowid


def bloco_ia(nome: str, mime: str, dados: bytes) -> dict:
    mime = tipo(nome)
    b64 = base64.standard_b64encode(dados).decode()
    if mime == "application/pdf":
        return {"type": "document", "source": {"type": "base64", "media_type": mime, "data": b64}}
    if mime.startswith("image/"):
        return {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}}
    return {"type": "text", "text": f"<arquivo nome='{nome}'>\n{dados.decode('utf-8', 'ignore')[:100000]}\n</arquivo>"}


def ler(con, aid: int) -> tuple[dict, bytes]:
    a = con.execute("SELECT * FROM arquivos WHERE id = ?", (aid,)).fetchone()
    if not a:
        raise Erro(404, "Arquivo não encontrado.")
    return dict(a), (PASTA / a["caminho"]).read_bytes()


@rota("GET", r"/api/arquivos/(?P<aid>\d+)")
def baixar(ctx: Ctx, aid: str):
    a, dados = ler(ctx.con, int(aid))
    ctx.exigir(ctx.staff or a["dono_usuario_id"] == ctx.u["id"])
    return {"__arquivo__": True, "nome": a["nome"], "mime": a["mime"], "dados": dados}
