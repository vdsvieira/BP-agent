"""Roteador da API com controle de acesso por perfil.

Cada rota declara quem pode chamá-la: "publico", "logado" (qualquer perfil) ou um
conjunto de perfis (rh, bp, gestor, colaborador, candidato). A checagem acontece aqui,
antes do handler — nenhum handler precisa lembrar de verificar login.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sqlite3

STAFF = frozenset({"rh", "bp"})
TODOS = frozenset({"rh", "bp", "gestor", "colaborador", "candidato"})
INTERNOS = frozenset({"rh", "bp", "gestor", "colaborador"})


class Erro(Exception):
    def __init__(self, status: int, msg: str):
        super().__init__(msg)
        self.status, self.msg = status, msg


class Ctx:
    def __init__(self, con: sqlite3.Connection, usuario: dict | None, corpo: dict, query: dict):
        self.con, self.u, self.corpo, self.query = con, usuario, corpo, query
        self.cookies: list[str] = []  # cabeçalhos Set-Cookie a enviar

    # ---------- atalhos de banco ----------
    def q(self, sql: str, *a) -> list[dict]:
        return [dict(r) for r in self.con.execute(sql, a)]

    def q1(self, sql: str, *a) -> dict | None:
        r = self.con.execute(sql, a).fetchone()
        return dict(r) if r else None

    def ex(self, sql: str, *a) -> int:
        return self.con.execute(sql, a).lastrowid

    def campo(self, nome: str, obrigatorio: bool = True, padrao=None):
        v = self.corpo.get(nome, padrao)
        if obrigatorio and (v is None or (isinstance(v, str) and not v.strip())):
            raise Erro(400, f"Campo obrigatório: {nome}")
        return v.strip() if isinstance(v, str) else v

    def exigir(self, condicao: bool, msg: str = "Você não tem acesso a este recurso.") -> None:
        if not condicao:
            raise Erro(403, msg)

    @property
    def perfil(self) -> str:
        return self.u["perfil"] if self.u else ""

    @property
    def staff(self) -> bool:
        return self.perfil in STAFF


ROTAS: list[tuple[str, re.Pattern, object, object]] = []


def rota(metodo: str, padrao: str, perfis="logado"):
    def deco(fn):
        ROTAS.append((metodo, re.compile("^" + padrao + "$"), perfis, fn))
        return fn
    return deco


def resolver(metodo: str, caminho: str):
    for m, rx, perfis, fn in ROTAS:
        if m == metodo:
            achou = rx.match(caminho)
            if achou:
                return fn, achou.groupdict(), perfis
    return None


def autorizar(perfis, usuario: dict | None) -> None:
    if perfis == "publico":
        return
    if not usuario:
        raise Erro(401, "Faça login para continuar.")
    if perfis != "logado" and usuario["perfil"] not in perfis:
        raise Erro(403, "Seu perfil não tem acesso a esta função.")


# ---------- utilidades comuns aos módulos ----------
def agora() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


def hoje() -> str:
    return dt.date.today().isoformat()


def jl(v, padrao=None):
    if v in (None, ""):
        return padrao
    try:
        return json.loads(v)
    except (TypeError, json.JSONDecodeError):
        return padrao


def jd(v) -> str:
    return json.dumps(v, ensure_ascii=False)
