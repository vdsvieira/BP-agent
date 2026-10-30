"""Onboarding — plano 30-60-90 com tarefas por responsável, buddy e check-ins de experiência.

A IA personaliza o plano para o cargo e a tribo e lê os check-ins para sinalizar risco de
saída precoce (early attrition), com sugestões ao gestor.
"""
from __future__ import annotations

import datetime as dt

from .. import ia
from ..ia import I, S, lista, obj
from ..rotas import Ctx, Erro, agora, hoje, jd, jl, rota

FASES = ["Pré-boarding", "Semana 1", "Até 30 dias", "Até 60 dias", "Até 90 dias"]
MODELO = [
    ("Pré-boarding", "Enviar mensagem de boas-vindas e agenda da primeira semana", "gestor", -3),
    ("Pré-boarding", "Preparar acessos, e-mail e equipamento", "ti", -2),
    ("Semana 1", "Integração institucional: cultura, código de ética e benefícios", "rh", 1),
    ("Semana 1", "Conversa de expectativas com o gestor (papel, prioridades, como será avaliado)", "gestor", 2),
    ("Semana 1", "Primeiro café com o buddy e apresentação ao time", "buddy", 2),
    ("Semana 1", "Concluir treinamentos regulatórios (PLD/FT, LGPD, Ética, Segurança da Informação)", "novo", 7),
    ("Até 30 dias", "Mapear stakeholders e conversar com 5 pessoas-chave da tribo", "novo", 20),
    ("Até 30 dias", "Definir metas (OKRs) individuais do período com o gestor", "gestor", 30),
    ("Até 30 dias", "Check-in de 30 dias", "novo", 30),
    ("Até 60 dias", "Primeira entrega relevante acompanhada pelo buddy", "novo", 55),
    ("Até 60 dias", "Check-in de 60 dias e feedback do gestor", "gestor", 60),
    ("Até 90 dias", "Avaliação de experiência (fim do contrato de experiência)", "gestor", 85),
    ("Até 90 dias", "Check-in de 90 dias e plano de desenvolvimento", "novo", 90),
]


def criar_tabelas(con) -> None:
    con.executescript("""
    CREATE TABLE IF NOT EXISTS onb_planos (id INTEGER PRIMARY KEY AUTOINCREMENT, matricula TEXT UNIQUE, gestor_matricula TEXT, buddy_matricula TEXT,
      data_inicio TEXT, status TEXT, plano_ia TEXT, criado_em TEXT);
    CREATE TABLE IF NOT EXISTS onb_tarefas (id INTEGER PRIMARY KEY AUTOINCREMENT, plano_id INTEGER, fase TEXT, titulo TEXT, descricao TEXT,
      responsavel TEXT, prazo TEXT, status TEXT, concluido_em TEXT, origem TEXT);
    CREATE TABLE IF NOT EXISTS onb_checkins (id INTEGER PRIMARY KEY AUTOINCREMENT, plano_id INTEGER, marco INTEGER, respostas TEXT, sentimento INTEGER,
      comentario TEXT, analise_ia TEXT, data TEXT);
    """)


def criar_plano(con, matricula: str, data_inicio: str) -> int:
    p = con.execute("SELECT * FROM colaboradores WHERE matricula = ?", (matricula,)).fetchone()
    buddy = con.execute("""SELECT matricula FROM colaboradores WHERE status='ativo' AND tribo = ? AND matricula != ? AND lider = 0 AND tempo_casa_meses > 18
                           ORDER BY desempenho DESC, enps DESC LIMIT 1""", (p["tribo"], matricula)).fetchone()
    pid = con.execute("INSERT INTO onb_planos (matricula, gestor_matricula, buddy_matricula, data_inicio, status, criado_em) VALUES (?,?,?,?,?,?)",
                      (matricula, p["gestor_matricula"], buddy and buddy["matricula"], data_inicio, "ativo", agora())).lastrowid
    inicio = dt.date.fromisoformat(data_inicio[:10])
    for fase, titulo, resp, dias in MODELO:
        con.execute("INSERT INTO onb_tarefas (plano_id, fase, titulo, responsavel, prazo, status, origem) VALUES (?,?,?,?,?,?,?)",
                    (pid, fase, titulo, resp, (inicio + dt.timedelta(days=dias)).isoformat(), "pendente", "modelo"))
    return pid


def _plano(ctx: Ctx, pid) -> dict:
    p = ctx.q1("SELECT * FROM onb_planos WHERE id = ?", pid)
    if not p:
        raise Erro(404, "Plano de onboarding não encontrado.")
    ctx.exigir(ctx.staff or p["matricula"] == ctx.u.get("matricula") or p["gestor_matricula"] == ctx.u.get("matricula") or p["buddy_matricula"] == ctx.u.get("matricula"))
    return p


def _detalhar(ctx: Ctx, p: dict) -> dict:
    pessoa = ctx.q1("SELECT matricula, nome, cargo, nivel, diretoria, tribo FROM colaboradores WHERE matricula = ?", p["matricula"]) or {}
    nomes = {r["matricula"]: r["nome"] for r in ctx.q("SELECT matricula, nome FROM colaboradores WHERE matricula IN (?, ?)", p["gestor_matricula"] or "", p["buddy_matricula"] or "")}
    tarefas = ctx.q("SELECT * FROM onb_tarefas WHERE plano_id = ? ORDER BY prazo, id", p["id"])
    feitas = sum(t["status"] == "feito" for t in tarefas)
    atrasadas = sum(t["status"] != "feito" and t["prazo"] < hoje() for t in tarefas)
    # check-ins e risco de saída são confidenciais: só a pessoa, o gestor e RH/BP (o buddy vê apenas o plano)
    ve_checkins = ctx.staff or ctx.u.get("matricula") in (p["matricula"], p["gestor_matricula"])
    checkins = [{**c, "respostas": jl(c["respostas"], {}), "analise_ia": jl(c["analise_ia"])} for c in ctx.q("SELECT * FROM onb_checkins WHERE plano_id = ? ORDER BY marco", p["id"])] if ve_checkins else []
    dias = (dt.date.today() - dt.date.fromisoformat(p["data_inicio"][:10])).days
    return {**p, "pessoa": pessoa, "gestor_nome": nomes.get(p["gestor_matricula"]), "buddy_nome": nomes.get(p["buddy_matricula"]), "plano_ia": jl(p["plano_ia"]),
            "tarefas": tarefas, "progresso": feitas / max(1, len(tarefas)), "atrasadas": atrasadas, "checkins": checkins, "dias_de_casa": dias}


@rota("GET", "/api/onboarding", {"rh", "bp", "gestor", "colaborador"})
def listar(ctx: Ctx):
    if ctx.staff:
        ps = ctx.q("SELECT * FROM onb_planos ORDER BY data_inicio DESC")
    else:
        m = ctx.u.get("matricula")
        ps = ctx.q("SELECT * FROM onb_planos WHERE matricula = ? OR gestor_matricula = ? OR buddy_matricula = ? ORDER BY data_inicio DESC", m, m, m)
    out = []
    for p in ps:
        d = _detalhar(ctx, p)
        risco = next((c["analise_ia"]["risco_saida_precoce"] for c in reversed(d["checkins"]) if c.get("analise_ia")), None)
        out.append({k: d[k] for k in ("id", "matricula", "pessoa", "gestor_nome", "buddy_nome", "data_inicio", "status", "progresso", "atrasadas", "dias_de_casa")} | {"risco": risco})
    return out


@rota("GET", r"/api/onboarding/(?P<pid>\d+)", {"rh", "bp", "gestor", "colaborador"})
def ver(ctx: Ctx, pid: str):
    return _detalhar(ctx, _plano(ctx, pid))


ESQ_PLANO = obj({"mensagem_de_boas_vindas": S, "objetivos_90_dias": lista(S), "pessoas_chave_para_conhecer": lista(S), "trilha_de_aprendizagem": lista(S),
                 "tarefas": lista(obj({"fase": {"type": "string", "enum": FASES}, "titulo": S, "descricao": S,
                                       "responsavel": {"type": "string", "enum": ["novo", "gestor", "buddy", "rh", "ti"]}, "dia": I}))})


@rota("POST", r"/api/onboarding/(?P<pid>\d+)/ia-plano", {"rh", "bp", "gestor"})
def ia_plano(ctx: Ctx, pid: str):
    p = _plano(ctx, pid)
    ctx.exigir(ctx.staff or p["gestor_matricula"] == ctx.u.get("matricula"))
    pessoa = ctx.q1("SELECT cargo, nivel, diretoria, tribo FROM colaboradores WHERE matricula = ?", p["matricula"])
    tribo = ctx.q1("SELECT nome, missao, okr_atingimento FROM tribos WHERE id = ?", pessoa["tribo"]) or {}
    r = ia.gerar("Personalize um plano de onboarding 30-60-90 para um novo colaborador de banco. Inclua de 6 a 10 tarefas ESPECÍFICAS do cargo "
                 "(além das institucionais que já existem), com responsável e o dia (a partir do início) em que devem ser concluídas.",
                 f"Cargo: {pessoa['cargo']} ({pessoa['nivel']})\nTribo: {tribo.get('nome')} — missão: {tribo.get('missao')}\n"
                 f"Contexto adicional do gestor: {ctx.corpo.get('contexto', '(nenhum)')}", ESQ_PLANO, effort="medium")
    inicio = dt.date.fromisoformat(p["data_inicio"][:10])
    ctx.ex("DELETE FROM onb_tarefas WHERE plano_id = ? AND origem = 'ia' AND status != 'feito'", pid)
    for t in r["tarefas"]:
        ctx.ex("INSERT INTO onb_tarefas (plano_id, fase, titulo, descricao, responsavel, prazo, status, origem) VALUES (?,?,?,?,?,?,?,?)",
               pid, t["fase"], t["titulo"], t["descricao"], t["responsavel"], (inicio + dt.timedelta(days=max(-5, min(100, t["dia"])))).isoformat(), "pendente", "ia")
    ctx.ex("UPDATE onb_planos SET plano_ia = ? WHERE id = ?", jd({k: r[k] for k in r if k != "tarefas"}), pid)
    ctx.con.commit()
    return {"ok": True, "tarefas_criadas": len(r["tarefas"])}


@rota("POST", r"/api/onboarding/tarefas/(?P<tid>\d+)/concluir", {"rh", "bp", "gestor", "colaborador"})
def concluir(ctx: Ctx, tid: str):
    t = ctx.q1("SELECT * FROM onb_tarefas WHERE id = ?", tid)
    if not t:
        raise Erro(404, "Tarefa não encontrada.")
    p = _plano(ctx, t["plano_id"])
    m = ctx.u.get("matricula")
    pode = ctx.staff or m == p["gestor_matricula"] or (t["responsavel"] == "novo" and m == p["matricula"]) or (t["responsavel"] == "buddy" and m == p["buddy_matricula"])
    ctx.exigir(pode, "Esta tarefa é de outro responsável.")
    feito = bool(ctx.campo("feito", False, True))
    ctx.ex("UPDATE onb_tarefas SET status = ?, concluido_em = ? WHERE id = ?", "feito" if feito else "pendente", agora() if feito else None, tid)
    if not ctx.q1("SELECT 1 FROM onb_tarefas WHERE plano_id = ? AND status != 'feito'", p["id"]):
        ctx.ex("UPDATE onb_planos SET status = 'concluido' WHERE id = ?", p["id"])
    ctx.con.commit()
    return {"ok": True}


ESQ_CHECKIN = obj({"risco_saida_precoce": {"type": "string", "enum": ["baixo", "médio", "alto"]}, "sinais": lista(S), "sugestoes_ao_gestor": lista(S), "resumo": S})
PERGUNTAS = {"clareza": "Está claro o que se espera de mim", "acolhimento": "Me sinto acolhido(a) pelo time", "ferramentas": "Tenho as ferramentas e acessos de que preciso",
             "gestor": "Meu gestor tem me dado apoio e feedback", "expectativa": "A vaga corresponde ao que foi apresentado no processo seletivo"}


@rota("POST", r"/api/onboarding/(?P<pid>\d+)/checkin", {"colaborador", "gestor"})
def checkin(ctx: Ctx, pid: str):
    p = _plano(ctx, pid)
    ctx.exigir(p["matricula"] == ctx.u.get("matricula"), "O check-in é respondido pela própria pessoa.")
    marco = int(ctx.campo("marco"))
    if marco not in (7, 30, 60, 90):
        raise Erro(400, "Marco inválido.")
    resp = ctx.campo("respostas")
    if not isinstance(resp, dict) or not all(k in PERGUNTAS and isinstance(v, (int, float)) and 1 <= v <= 5 for k, v in resp.items()):
        raise Erro(400, "Responda as afirmações com notas de 1 a 5.")
    sentimento, comentario = int(ctx.campo("sentimento")), ctx.campo("comentario", False, "")
    try:
        analise = ia.gerar("Analise o check-in de experiência de um novo colaborador e avalie o risco de saída precoce. Seja específico e construtivo nas sugestões ao gestor.",
                           f"Marco: {marco} dias\nNotas (1 a 5):\n" + "\n".join(f"- {PERGUNTAS[k]}: {v}" for k, v in resp.items())
                           + f"\nComo se sente (1 a 5): {sentimento}\nComentário: {comentario or '(nenhum)'}", ESQ_CHECKIN)
    except Erro:
        media = sum(resp.values()) / len(resp)
        analise = {"risco_saida_precoce": "alto" if media < 2.5 or sentimento <= 2 else "médio" if media < 3.5 else "baixo", "sinais": [],
                   "sugestoes_ao_gestor": ["Converse com a pessoa sobre as notas mais baixas."], "resumo": "Análise automática (sem IA)."}
    ctx.ex("INSERT INTO onb_checkins (plano_id, marco, respostas, sentimento, comentario, analise_ia, data) VALUES (?,?,?,?,?,?,?)",
           pid, marco, jd(resp), sentimento, comentario, jd(analise), agora())
    ctx.con.commit()
    return {"ok": True, "analise": analise}


def semear(con) -> None:
    """Planos para contratados recentes do time do gestor de demonstração e a conta 'novo' (colaborador em onboarding)."""
    if con.execute("SELECT 1 FROM onb_planos LIMIT 1").fetchone():
        return
    g = con.execute("SELECT u.matricula, c.tribo FROM usuarios u JOIN colaboradores c ON c.matricula = u.matricula WHERE u.login = 'gestor'").fetchone()
    if not g:
        return
    recentes = con.execute("""SELECT matricula FROM colaboradores WHERE status='ativo' AND tempo_casa_meses <= 2 AND lider = 0 AND tribo = ?
                              ORDER BY tempo_casa_meses LIMIT 3""", (g["tribo"],)).fetchall()
    for i, r in enumerate(recentes):
        con.execute("UPDATE colaboradores SET gestor_matricula = ? WHERE matricula = ?", (g["matricula"], r["matricula"]))  # entram no time do gestor demo
        inicio = (dt.date.today() - dt.timedelta(days=[12, 40, 75][i])).isoformat()
        pid = criar_plano(con, r["matricula"], inicio)
        con.execute("UPDATE onb_tarefas SET status = 'feito', concluido_em = ? WHERE plano_id = ? AND prazo < ? AND id % 4 != 0", (agora(), pid, hoje()))
    if recentes:
        from ..auth import SENHA_DEMO, criar_usuario
        p = con.execute("SELECT nome FROM colaboradores WHERE matricula = ?", (recentes[0]["matricula"],)).fetchone()
        criar_usuario(con, "novo", p["nome"], "colaborador", SENHA_DEMO, email="novo@demo.local", matricula=recentes[0]["matricula"], demo=1)
    con.commit()
