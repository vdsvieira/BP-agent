"""Usuários, senhas e sessões da plataforma.

Protótipo: contas de demonstração (senha demo123) ligadas a pessoas da base simulada,
e autocadastro de candidatos. Em produção, o login de funcionários passa a ser o SSO
corporativo (SAML/OIDC) e só o portal de candidatos mantém senha própria.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import re
import secrets

from .rotas import Ctx, Erro, agora, rota

SENHA_DEMO = "demo123"
COOKIE = "bp_sessao"
DURACAO_H = 12


def criar_tabelas(con) -> None:
    con.execute("""CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT UNIQUE NOT NULL, nome TEXT NOT NULL,
                   email TEXT, perfil TEXT NOT NULL, matricula TEXT, candidato_id INTEGER, senha_hash TEXT NOT NULL, demo INTEGER DEFAULT 0, criado_em TEXT)""")
    con.execute("CREATE TABLE IF NOT EXISTS sessoes (token TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL, expira_em TEXT NOT NULL)")


def hash_senha(senha: str) -> str:
    sal = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", senha.encode(), bytes.fromhex(sal), 200_000).hex()
    return f"pbkdf2_sha256$200000${sal}${h}"


def verificar_senha(senha: str, armazenado: str) -> bool:
    try:
        _, it, sal, h = armazenado.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", senha.encode(), bytes.fromhex(sal), int(it)).hex()
        return hmac.compare_digest(calc, h)
    except ValueError:
        return False


def publico(u: dict) -> dict:
    return {k: u.get(k) for k in ("id", "login", "nome", "email", "perfil", "matricula", "candidato_id", "diretoria", "tribo", "cargo")}


def usuario_da_sessao(con, token: str | None) -> dict | None:
    if not token:
        return None
    r = con.execute("""SELECT u.*, c.diretoria, c.tribo, c.cargo FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
                       LEFT JOIN colaboradores c ON c.matricula = u.matricula WHERE s.token = ? AND s.expira_em > ?""", (token, agora())).fetchone()
    return dict(r) if r else None


def _abrir_sessao(ctx: Ctx, uid: int) -> None:
    token = secrets.token_urlsafe(32)
    expira = (dt.datetime.now() + dt.timedelta(hours=DURACAO_H)).isoformat(timespec="seconds")
    ctx.ex("DELETE FROM sessoes WHERE expira_em < ?", agora())
    ctx.ex("INSERT INTO sessoes VALUES (?,?,?)", token, uid, expira)
    ctx.con.commit()
    ctx.cookies.append(f"{COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={DURACAO_H * 3600}")


def criar_usuario(con, login: str, nome: str, perfil: str, senha: str, email=None, matricula=None, candidato_id=None, demo=0) -> int:
    return con.execute("INSERT INTO usuarios (login, nome, email, perfil, matricula, candidato_id, senha_hash, demo, criado_em) VALUES (?,?,?,?,?,?,?,?,?)",
                       (login, nome, email, perfil, matricula, candidato_id, hash_senha(senha), demo, agora())).lastrowid


# ------------------------------------------------------------------ rotas
@rota("POST", "/api/auth/login", "publico")
def login(ctx: Ctx):
    u = ctx.q1("SELECT * FROM usuarios WHERE lower(login) = lower(?) OR lower(email) = lower(?)", ctx.campo("login"), ctx.campo("login"))
    if not u or not verificar_senha(ctx.campo("senha"), u["senha_hash"]):
        raise Erro(401, "Login ou senha inválidos.")
    _abrir_sessao(ctx, u["id"])
    return {"ok": True, "perfil": u["perfil"]}


@rota("POST", "/api/auth/logout", "logado")
def logout(ctx: Ctx):
    ctx.ex("DELETE FROM sessoes WHERE usuario_id = ?", ctx.u["id"])
    ctx.con.commit()
    ctx.cookies.append(f"{COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")
    return {"ok": True}


@rota("GET", "/api/auth/eu", "logado")
def eu(ctx: Ctx):
    return publico(ctx.u)


@rota("GET", "/api/auth/demo", "publico")
def contas_demo(ctx: Ctx):
    """Lista as contas de demonstração (somente no ambiente simulado)."""
    return [{"login": u["login"], "nome": u["nome"], "perfil": u["perfil"], "cargo": u["cargo"]} for u in
            ctx.q("SELECT u.login, u.nome, u.perfil, c.cargo FROM usuarios u LEFT JOIN colaboradores c ON c.matricula = u.matricula WHERE u.demo = 1 ORDER BY u.id")]


@rota("POST", "/api/auth/cadastro", "publico")
def cadastro_candidato(ctx: Ctx):
    nome, email, senha = ctx.campo("nome"), ctx.campo("email").lower(), ctx.campo("senha")
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise Erro(400, "E-mail inválido.")
    if len(senha) < 8:
        raise Erro(400, "A senha precisa ter pelo menos 8 caracteres.")
    if ctx.q1("SELECT 1 FROM usuarios WHERE lower(login) = ? OR lower(email) = ?", email, email):
        raise Erro(409, "Já existe uma conta com este e-mail.")
    cid = ctx.ex("INSERT INTO ats_candidatos (nome, email, criado_em, origem) VALUES (?,?,?,?)", nome, email, agora(), "Site de carreiras/ATS")
    uid = criar_usuario(ctx.con, email, nome, "candidato", senha, email=email, candidato_id=cid)
    _abrir_sessao(ctx, uid)
    return {"ok": True, "perfil": "candidato"}


def semear_demo(con) -> None:
    """Cria as contas de demonstração a partir de pessoas reais da base simulada."""
    if con.execute("SELECT 1 FROM usuarios WHERE demo = 1").fetchone():
        return
    # gestor: gerente de Tecnologia com o maior time direto
    g = con.execute("""SELECT g.matricula, g.nome FROM colaboradores g JOIN colaboradores c ON c.gestor_matricula = g.matricula AND c.status='ativo'
                       WHERE g.status='ativo' AND g.nivel IN ('Gerente','Coordenador') AND g.diretoria='tecnologia' GROUP BY g.matricula ORDER BY COUNT(*) DESC LIMIT 1""").fetchone()
    col = con.execute("SELECT matricula, nome FROM colaboradores WHERE gestor_matricula=? AND status='ativo' AND lider=0 AND tempo_casa_meses>12 ORDER BY desempenho DESC LIMIT 1", (g["matricula"],)).fetchone()
    contas = [
        ("bp", "HRBP (você)", "bp", None), ("rh", "Equipe de RH · Recrutamento e DP", "rh", None),
        ("gestor", g["nome"], "gestor", g["matricula"]), ("colaborador", col["nome"], "colaborador", col["matricula"]),
    ]
    for login_, nome, perfil, mat in contas:
        criar_usuario(con, login_, nome, perfil, SENHA_DEMO, email=f"{login_}@demo.local", matricula=mat, demo=1)
    con.commit()
