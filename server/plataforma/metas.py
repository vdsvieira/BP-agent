"""Metas — OKRs em cascata (empresa → diretoria → tribo → individual) com check-ins.

A IA sugere OKRs alinhados ao objetivo-pai e revisa a qualidade (resultado × tarefa, mensurável,
ambicioso). O atingimento das tribos alimenta o indicador de OKR do cockpit.
"""
from __future__ import annotations

import random

from .. import ia
from ..ia import N, S, lista, obj
from ..rotas import INTERNOS, Ctx, Erro, agora, rota

NIVEIS = ["empresa", "diretoria", "tribo", "individual"]


def criar_tabelas(con) -> None:
    con.executescript("""
    CREATE TABLE IF NOT EXISTS meta_ciclos (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, inicio TEXT, fim TEXT, status TEXT);
    CREATE TABLE IF NOT EXISTS meta_objetivos (id INTEGER PRIMARY KEY AUTOINCREMENT, ciclo_id INTEGER, nivel TEXT, dono TEXT, dono_nome TEXT, pai_id INTEGER,
      titulo TEXT, descricao TEXT, criado_por TEXT, criado_em TEXT);
    CREATE TABLE IF NOT EXISTS meta_krs (id INTEGER PRIMARY KEY AUTOINCREMENT, objetivo_id INTEGER, titulo TEXT, unidade TEXT, inicial REAL, alvo REAL, atual REAL);
    CREATE TABLE IF NOT EXISTS meta_checkins (id INTEGER PRIMARY KEY AUTOINCREMENT, kr_id INTEGER, autor TEXT, data TEXT, valor REAL, confianca INTEGER, comentario TEXT);
    """)


def _prog_kr(k: dict) -> float:
    span = (k["alvo"] or 0) - (k["inicial"] or 0)
    return max(0.0, min(1.0, ((k["atual"] or 0) - (k["inicial"] or 0)) / span)) if span else (1.0 if (k["atual"] or 0) >= (k["alvo"] or 0) else 0.0)


def _ciclo(ctx: Ctx) -> dict:
    c = ctx.q1("SELECT * FROM meta_ciclos WHERE status = 'ativo' ORDER BY id DESC LIMIT 1")
    if not c:
        raise Erro(404, "Nenhum ciclo de metas ativo.")
    return c


def _pode_editar(ctx: Ctx, o: dict) -> bool:
    if ctx.staff:
        return True
    m = ctx.u.get("matricula")
    if o["nivel"] == "individual":
        dono = ctx.q1("SELECT gestor_matricula FROM colaboradores WHERE matricula = ?", o["dono"]) or {}
        return o["dono"] == m or dono.get("gestor_matricula") == m
    if o["nivel"] == "tribo" and ctx.perfil == "gestor":
        return ctx.u.get("tribo") == o["dono"]
    if o["nivel"] == "diretoria" and ctx.perfil == "gestor":
        return ctx.u.get("diretoria") == o["dono"]
    return False


def _pode_ver(ctx: Ctx, o: dict) -> bool:
    if o["nivel"] != "individual" or ctx.staff:
        return True  # OKRs coletivos são transparentes para toda a empresa
    return _pode_editar(ctx, o)


@rota("GET", "/api/metas", INTERNOS)
def arvore(ctx: Ctx):
    c = _ciclo(ctx)
    objs = [o for o in ctx.q("SELECT * FROM meta_objetivos WHERE ciclo_id = ? ORDER BY id", c["id"]) if _pode_ver(ctx, o)]
    krs = {}
    for k in ctx.q("SELECT * FROM meta_krs WHERE objetivo_id IN (SELECT id FROM meta_objetivos WHERE ciclo_id = ?)", c["id"]):
        krs.setdefault(k["objetivo_id"], []).append({**k, "progresso": _prog_kr(k)})
    out = []
    for o in objs:
        ks = krs.get(o["id"], [])
        out.append({**o, "krs": ks, "progresso": sum(k["progresso"] for k in ks) / len(ks) if ks else 0, "pode_editar": _pode_editar(ctx, o)})
    return {"ciclo": c, "objetivos": out}


@rota("POST", "/api/metas/objetivos", INTERNOS)
def criar_objetivo(ctx: Ctx):
    c = _ciclo(ctx)
    nivel = ctx.campo("nivel")
    if nivel not in NIVEIS:
        raise Erro(400, "Nível inválido.")
    dono = ctx.campo("dono", False) or (ctx.u.get("matricula") if nivel == "individual" else None)
    if not dono:
        raise Erro(400, "Informe o dono do objetivo.")
    novo = {"nivel": nivel, "dono": dono}
    ctx.exigir(nivel != "empresa" or ctx.staff, "Somente RH/BP cadastram objetivos da empresa.")
    ctx.exigir(_pode_editar(ctx, novo), "Você não pode criar objetivos para este dono.")
    pai = ctx.campo("pai_id", False)
    if pai and not ctx.q1("SELECT 1 FROM meta_objetivos WHERE id = ? AND ciclo_id = ?", pai, c["id"]):
        raise Erro(400, "Objetivo-pai inválido.")
    krs = ctx.campo("krs")
    if not isinstance(krs, list) or not 1 <= len(krs) <= 5:
        raise Erro(400, "Inclua de 1 a 5 resultados-chave.")
    nome = {"individual": lambda: (ctx.q1("SELECT nome FROM colaboradores WHERE matricula = ?", dono) or {}).get("nome"),
            "tribo": lambda: (ctx.q1("SELECT nome FROM tribos WHERE id = ?", dono) or {}).get("nome"),
            "diretoria": lambda: (ctx.q1("SELECT nome FROM diretorias WHERE id = ?", dono) or {}).get("nome"), "empresa": lambda: "Bradesco"}[nivel]()
    oid = ctx.ex("INSERT INTO meta_objetivos (ciclo_id, nivel, dono, dono_nome, pai_id, titulo, descricao, criado_por, criado_em) VALUES (?,?,?,?,?,?,?,?,?)",
                 c["id"], nivel, dono, nome or dono, pai, ctx.campo("titulo"), ctx.campo("descricao", False, ""), ctx.u["nome"], agora())
    for k in krs:
        if not k.get("titulo") or k.get("alvo") in (None, ""):
            raise Erro(400, "Cada resultado-chave precisa de título e alvo.")
        ini = float(k.get("inicial") or 0)
        ctx.ex("INSERT INTO meta_krs (objetivo_id, titulo, unidade, inicial, alvo, atual) VALUES (?,?,?,?,?,?)", oid, k["titulo"], k.get("unidade", ""), ini, float(k["alvo"]), ini)
    ctx.con.commit()
    return {"id": oid}


@rota("POST", r"/api/metas/krs/(?P<kid>\d+)/checkin", INTERNOS)
def checkin(ctx: Ctx, kid: str):
    k = ctx.q1("SELECT * FROM meta_krs WHERE id = ?", kid)
    if not k:
        raise Erro(404, "Resultado-chave não encontrado.")
    o = ctx.q1("SELECT * FROM meta_objetivos WHERE id = ?", k["objetivo_id"])
    ctx.exigir(_pode_editar(ctx, o), "Somente o dono, o gestor ou o RH atualizam esta meta.")
    valor = float(ctx.campo("valor"))
    conf = int(ctx.campo("confianca", False, 7))
    ctx.ex("UPDATE meta_krs SET atual = ? WHERE id = ?", valor, kid)
    ctx.ex("INSERT INTO meta_checkins (kr_id, autor, data, valor, confianca, comentario) VALUES (?,?,?,?,?,?)", kid, ctx.u["nome"], agora(), valor, conf, ctx.campo("comentario", False, ""))
    if o["nivel"] == "tribo":
        atualizar_okr_tribo(ctx.con, o["dono"])
    ctx.con.commit()
    return {"ok": True}


def atualizar_okr_tribo(con, tribo: str) -> None:
    """Leva o atingimento médio dos OKRs da tribo para o indicador de negócio do cockpit."""
    ks = [dict(k) for k in con.execute("""SELECT k.* FROM meta_krs k JOIN meta_objetivos o ON o.id = k.objetivo_id JOIN meta_ciclos c ON c.id = o.ciclo_id
                                          WHERE o.nivel = 'tribo' AND o.dono = ? AND c.status = 'ativo'""", (tribo,))]
    if ks:
        con.execute("UPDATE tribos SET okr_atingimento = ? WHERE id = ?", (round(sum(_prog_kr(k) for k in ks) / len(ks), 2), tribo))


ESQ_SUGESTAO = obj({"objetivos": lista(obj({"titulo": S, "por_que_importa": S,
                                            "krs": lista(obj({"titulo": S, "unidade": S, "inicial": N, "alvo": N}))})), "observacoes": S})
ESQ_REVISAO = obj({"nota_qualidade": {"type": "integer"}, "problemas": lista(S), "versao_melhorada": obj({"titulo": S, "krs": lista(obj({"titulo": S, "unidade": S, "inicial": N, "alvo": N}))})})


@rota("POST", "/api/metas/ia-sugerir", INTERNOS)
def ia_sugerir(ctx: Ctx):
    pai = ctx.q1("SELECT * FROM meta_objetivos WHERE id = ?", ctx.campo("pai_id", False)) if ctx.campo("pai_id", False) else None
    pai_txt = ""
    if pai:
        ks = ctx.q("SELECT titulo, alvo, unidade FROM meta_krs WHERE objetivo_id = ?", pai["id"])
        pai_txt = f"Objetivo-pai ({pai['nivel']}): {pai['titulo']}\nKRs do pai: " + "; ".join(f"{k['titulo']} (alvo {k['alvo']} {k['unidade']})" for k in ks)
    p = ctx.q1("SELECT cargo, nivel, tribo FROM colaboradores WHERE matricula = ?", ctx.u.get("matricula")) or {}
    r = ia.gerar("Sugira de 2 a 3 OKRs no padrão: objetivo qualitativo e inspirador + 2 a 4 resultados-chave MENSURÁVEIS de resultado (não tarefas), "
                 "ambiciosos porém realistas para o trimestre/ano, alinhados ao objetivo-pai. Use números plausíveis para valor inicial e alvo.",
                 f"Nível: {ctx.campo('nivel', False, 'individual')}\nQuem: {p.get('cargo', ctx.u['perfil'])} ({p.get('nivel', '')})\n{pai_txt}\n"
                 f"Contexto informado: {ctx.campo('contexto', False, '(nenhum)')}", ESQ_SUGESTAO)
    return r


@rota("POST", "/api/metas/ia-revisar", INTERNOS)
def ia_revisar(ctx: Ctx):
    return ia.gerar("Revise a qualidade deste OKR: o objetivo é claro e inspirador? Os KRs medem RESULTADO (e não atividade)? São mensuráveis, com alvo e prazo? "
                    "Dê nota de 0 a 10, aponte os problemas e proponha uma versão melhorada.",
                    f"Objetivo: {ctx.campo('titulo')}\nKRs: {ctx.corpo.get('krs', [])}", ESQ_REVISAO)


# ------------------------------------------------------------------ semente
def semear(con) -> None:
    if con.execute("SELECT 1 FROM meta_ciclos LIMIT 1").fetchone():
        return
    r = random.Random(11)
    cid = con.execute("INSERT INTO meta_ciclos (nome, inicio, fim, status) VALUES (?,?,?,?)", ("OKRs 2026", "2026-01-01", "2026-12-31", "ativo")).lastrowid

    def obj_(nivel, dono, nome, pai, titulo, krs):
        oid = con.execute("INSERT INTO meta_objetivos (ciclo_id, nivel, dono, dono_nome, pai_id, titulo, descricao, criado_por, criado_em) VALUES (?,?,?,?,?,?,?,?,?)",
                          (cid, nivel, dono, nome, pai, titulo, "", "Carga inicial", agora())).lastrowid
        for t, u, ini, alvo, prog in krs:
            con.execute("INSERT INTO meta_krs (objetivo_id, titulo, unidade, inicial, alvo, atual) VALUES (?,?,?,?,?,?)",
                        (oid, t, u, ini, alvo, round(ini + (alvo - ini) * prog, 1)))
        return oid

    e1 = obj_("empresa", "bradesco", "Bradesco", None, "Ser o banco mais relevante na vida financeira dos clientes",
              [("NPS de clientes", "pontos", 42, 55, 0.62), ("Clientes ativos no app", "milhões", 28, 34, 0.7)])
    e2 = obj_("empresa", "bradesco", "Bradesco", None, "Acelerar eficiência com tecnologia e IA",
              [("Índice de eficiência operacional", "%", 52, 47, 0.55), ("Processos automatizados com IA", "processos", 10, 60, 0.48)])
    e3 = obj_("empresa", "bradesco", "Bradesco", None, "Ter as melhores pessoas e a melhor liderança do setor",
              [("eNPS", "pontos", 18, 35, 0.4), ("Turnover voluntário regretted", "%", 6, 4, 0.5)])
    for d in con.execute("SELECT * FROM diretorias").fetchall():
        pai = e2 if d["id"] in ("tecnologia", "operacoes", "digital") else e1
        od = obj_("diretoria", d["id"], d["nome"], pai, f"{d['nome']}: crescer com eficiência e experiência do cliente",
                  [("Atingimento do orçamento de receita", "%", 0, 100, r.uniform(0.5, 0.95)), ("Satisfação dos clientes atendidos", "NPS", 30, 50, r.uniform(0.4, 0.9))])
        obj_("diretoria", d["id"], d["nome"], e3, f"{d['nome']}: engajar e reter talentos", [("eNPS da diretoria", "pontos", 10, 30, r.uniform(0.2, 0.8)), ("Talentos retidos", "%", 85, 95, r.uniform(0.4, 0.9))])
        for t in con.execute("SELECT * FROM tribos WHERE diretoria = ?", (d["id"],)).fetchall():
            prog = max(0.1, min(1.0, t["okr_atingimento"] or 0.7))
            obj_("tribo", t["id"], t["nome"], od, f"{t['nome']}: {t['missao'].lower()} com excelência",
                 [("Entregas do roadmap no prazo", "%", 0, 100, prog), ("Incidentes críticos", "qtde", 12, 4, prog * r.uniform(0.8, 1.1)), ("NPS da jornada", "pontos", 30, 50, prog * r.uniform(0.8, 1.1))])
    g = con.execute("SELECT u.matricula, c.tribo FROM usuarios u JOIN colaboradores c ON c.matricula = u.matricula WHERE u.login = 'gestor'").fetchone()
    if g:
        pai_t = con.execute("SELECT id FROM meta_objetivos WHERE nivel = 'tribo' AND dono = ? LIMIT 1", (g["tribo"],)).fetchone()
        for p in con.execute("SELECT matricula, nome, cargo FROM colaboradores WHERE status='ativo' AND (gestor_matricula = ? OR matricula = ?) LIMIT 12", (g["matricula"], g["matricula"])).fetchall():
            obj_("individual", p["matricula"], p["nome"], pai_t and pai_t["id"], f"Elevar a qualidade e a velocidade das entregas como {p['cargo']}",
                 [("Entregas concluídas no prazo", "%", 60, 90, r.uniform(0.3, 0.95)), ("Defeitos em produção", "qtde", 8, 2, r.uniform(0.2, 0.9))])
    for t in con.execute("SELECT id FROM tribos").fetchall():
        atualizar_okr_tribo(con, t["id"])
    con.commit()
