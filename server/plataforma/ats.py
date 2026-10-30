"""ATS — recrutamento e seleção, de ponta a ponta.

Fluxo: gestor requisita → IA redige a vaga → RH aprova e publica → candidatos (externos ou
mobilidade interna) se inscrevem com currículo lido pela IA → triagem por IA sem dados pessoais
→ entrevistas com roteiro e scorecard → oferta → aceite → abre o processo de admissão.
O pipeline alimenta as tabelas analíticas do cockpit (vagas e candidatos).
"""
from __future__ import annotations

import base64
import datetime as dt
import random

from .. import ia
from ..ia import I, S, lista, obj
from ..rotas import Ctx, Erro, agora, hoje, jd, jl, rota
from . import arquivos

ETAPAS = ["Inscrito", "Triagem", "Entrevista RH", "Entrevista Gestor", "Proposta", "Contratado"]
FINAIS = ["Reprovado", "Desistiu"]
ETAPA_COCKPIT = {"Inscrito": "Aberta", "Triagem": "Triagem", "Entrevista RH": "Entrevistas", "Entrevista Gestor": "Entrevistas", "Proposta": "Proposta", "Contratado": "Admissão"}
COMPETENCIAS_PADRAO = ["Foco no cliente", "Colaboração", "Aprendizado contínuo", "Ética e conformidade", "Resolução de problemas"]


def criar_tabelas(con) -> None:
    con.executescript("""
    CREATE TABLE IF NOT EXISTS ats_vagas (id TEXT PRIMARY KEY, titulo TEXT, diretoria TEXT, tribo TEXT, nivel TEXT, motivo TEXT, gestor_matricula TEXT,
      status TEXT, briefing TEXT, descricao TEXT, requisitos TEXT, competencias TEXT, salario_min REAL, salario_max REAL, sla INTEGER, afirmativa INTEGER,
      orcada INTEGER, prioridade TEXT, recrutador TEXT, modelo_trabalho TEXT, criada_em TEXT, publicada_em TEXT, fechada_em TEXT);
    CREATE TABLE IF NOT EXISTS ats_candidatos (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, email TEXT, telefone TEXT, cidade TEXT, linkedin TEXT,
      matricula TEXT, resumo TEXT, cargo_atual TEXT, anos_experiencia REAL, experiencias TEXT, formacao TEXT, habilidades TEXT, certificacoes TEXT,
      idiomas TEXT, curriculo_arquivo INTEGER, origem TEXT, diverso INTEGER, criado_em TEXT);
    CREATE TABLE IF NOT EXISTS ats_candidaturas (id INTEGER PRIMARY KEY AUTOINCREMENT, vaga_id TEXT, candidato_id INTEGER, etapa TEXT, fonte TEXT,
      score_ia INTEGER, analise_ia TEXT, motivo_reprovacao TEXT, criado_em TEXT, atualizado_em TEXT, UNIQUE(vaga_id, candidato_id));
    CREATE TABLE IF NOT EXISTS ats_entrevistas (id INTEGER PRIMARY KEY AUTOINCREMENT, candidatura_id INTEGER, tipo TEXT, entrevistador_matricula TEXT,
      entrevistador_nome TEXT, data TEXT, roteiro TEXT, notas TEXT, recomendacao TEXT, comentario TEXT, status TEXT);
    CREATE TABLE IF NOT EXISTS ats_eventos (id INTEGER PRIMARY KEY AUTOINCREMENT, candidatura_id INTEGER, data TEXT, autor TEXT, texto TEXT);
    CREATE TABLE IF NOT EXISTS ats_ofertas (id INTEGER PRIMARY KEY AUTOINCREMENT, candidatura_id INTEGER, salario REAL, data_inicio TEXT, status TEXT,
      carta TEXT, criada_em TEXT, respondida_em TEXT);
    """)


# ------------------------------------------------------------------ helpers
def _evento(ctx_or_con, cand_id: int, autor: str, texto: str) -> None:
    con = getattr(ctx_or_con, "con", ctx_or_con)
    con.execute("INSERT INTO ats_eventos (candidatura_id, data, autor, texto) VALUES (?,?,?,?)", (cand_id, agora(), autor, texto))


def _vaga(ctx: Ctx, vid: str) -> dict:
    v = ctx.q1("SELECT * FROM ats_vagas WHERE id = ?", vid)
    if not v:
        raise Erro(404, "Vaga não encontrada.")
    return v


def _pode_gerir(ctx: Ctx, vaga: dict) -> bool:
    return ctx.staff or (ctx.perfil == "gestor" and vaga["gestor_matricula"] == ctx.u["matricula"])


def _candidatura(ctx: Ctx, cid) -> tuple[dict, dict]:
    c = ctx.q1("SELECT * FROM ats_candidaturas WHERE id = ?", cid)
    if not c:
        raise Erro(404, "Candidatura não encontrada.")
    v = _vaga(ctx, c["vaga_id"])
    return c, v


def _meu_candidato(ctx: Ctx, criar: bool = False) -> dict | None:
    if ctx.u.get("candidato_id"):
        return ctx.q1("SELECT * FROM ats_candidatos WHERE id = ?", ctx.u["candidato_id"])
    if ctx.u.get("matricula"):  # mobilidade interna: colaborador vira candidato
        c = ctx.q1("SELECT * FROM ats_candidatos WHERE matricula = ?", ctx.u["matricula"])
        if c or not criar:
            return c
        p = ctx.q1("SELECT * FROM colaboradores WHERE matricula = ?", ctx.u["matricula"])
        cid = ctx.ex("INSERT INTO ats_candidatos (nome, email, matricula, cargo_atual, habilidades, origem, criado_em) VALUES (?,?,?,?,?,?,?)",
                     ctx.u["nome"], ctx.u.get("email"), ctx.u["matricula"], p and p["cargo"], jd([p["skill"]] if p and p["skill"] else []), "Mobilidade interna", agora())
        return ctx.q1("SELECT * FROM ats_candidatos WHERE id = ?", cid)
    return None


def _perfil_candidato(c: dict) -> dict:
    return {**c, **{k: jl(c.get(k), []) for k in ("experiencias", "formacao", "habilidades", "certificacoes", "idiomas")}}


_TRIBOS: dict = {}


def _vaga_pub(v: dict, con=None) -> dict:
    if con is not None and not _TRIBOS:
        _TRIBOS.update({r[0]: r[1] for r in con.execute("SELECT id, nome FROM tribos")})
    return {**v, "requisitos": jl(v.get("requisitos"), {}), "competencias": jl(v.get("competencias"), []),
            "tribo_nome": _TRIBOS.get(v.get("tribo"), v.get("tribo"))}


def sincronizar_cockpit(con) -> None:
    """Reescreve as tabelas analíticas `vagas` e `candidatos` a partir do ATS (o cockpit passa a refletir o ATS real)."""
    from .. import banco
    hoje_ = dt.date.today()
    vagas, cands = [], []
    for v in con.execute("SELECT * FROM ats_vagas WHERE status IN ('aberta','aprovacao','pausada')").fetchall():
        v = dict(v)
        cs = [dict(r) for r in con.execute("SELECT * FROM ats_candidaturas WHERE vaga_id = ?", (v["id"],))]
        ativos = [c for c in cs if c["etapa"] in ETAPAS]
        etapa_max = max((ETAPAS.index(c["etapa"]) for c in ativos), default=-1)
        abertura = dt.date.fromisoformat(v["criada_em"][:10])
        vagas.append({"id": v["id"], "diretoria": v["diretoria"], "tribo": v["tribo"], "cargo": v["titulo"], "nivel": v["nivel"], "motivo": v["motivo"],
                      "abertura": abertura.isoformat(), "dias_aberta": max(0, (hoje_ - abertura).days), "sla": v["sla"],
                      "etapa": ETAPA_COCKPIT[ETAPAS[etapa_max]] if etapa_max >= 0 else "Aberta", "recrutador": v["recrutador"], "orcada": v["orcada"],
                      "salario_previsto": round(((v["salario_min"] or 0) + (v["salario_max"] or 0)) / 2), "prioridade": v["prioridade"],
                      "afirmativa": v["afirmativa"], "candidatos": len(cs)})
        for c in cs:
            diverso = con.execute("SELECT diverso FROM ats_candidatos WHERE id = ?", (c["candidato_id"],)).fetchone()
            cands.append({"vaga_id": v["id"], "fonte": c["fonte"], "etapa": ETAPA_COCKPIT.get(c["etapa"], "Aberta"), "diverso": (diverso[0] or 0) if diverso else 0,
                          "dias_no_processo": max(1, (hoje_ - dt.date.fromisoformat(c["criado_em"][:10])).days)})
    banco.gravar_tabela(con, "vagas", vagas, origem="plataforma:ats")
    banco.gravar_tabela(con, "candidatos", cands, origem="plataforma:ats")


# ------------------------------------------------------------------ vagas
@rota("GET", "/api/ats/vagas")
def listar_vagas(ctx: Ctx):
    """RH/BP: todas · gestor: as suas · demais: só as publicadas (mural de vagas)."""
    escopo = ctx.query.get("escopo", "minhas")
    if ctx.staff and escopo != "mural":
        vs = ctx.q("SELECT * FROM ats_vagas ORDER BY criada_em DESC")
    elif ctx.perfil == "gestor" and escopo != "mural":
        vs = ctx.q("SELECT * FROM ats_vagas WHERE gestor_matricula = ? ORDER BY criada_em DESC", ctx.u["matricula"])
    else:
        vs = ctx.q("SELECT id, titulo, diretoria, tribo, nivel, descricao, requisitos, competencias, modelo_trabalho, afirmativa, publicada_em, criada_em FROM ats_vagas WHERE status = 'aberta' ORDER BY publicada_em DESC")
        return [_vaga_pub(v, ctx.con) for v in vs]
    cont = {}
    for r in ctx.q("SELECT vaga_id, etapa, COUNT(*) n FROM ats_candidaturas GROUP BY vaga_id, etapa"):
        cont.setdefault(r["vaga_id"], {})[r["etapa"]] = r["n"]
    hoje_ = dt.date.today()
    return [{**_vaga_pub(v, ctx.con), "pipeline": cont.get(v["id"], {}), "dias_aberta": (hoje_ - dt.date.fromisoformat(v["criada_em"][:10])).days} for v in vs]


@rota("GET", r"/api/ats/vagas/(?P<vid>[\w-]+)")
def ver_vaga(ctx: Ctx, vid: str):
    v = _vaga(ctx, vid)
    if not _pode_gerir(ctx, v):
        ctx.exigir(v["status"] == "aberta", "Vaga não disponível.")
        return {"vaga": _vaga_pub({k: v[k] for k in ("id", "titulo", "diretoria", "tribo", "nivel", "descricao", "requisitos", "competencias", "modelo_trabalho", "afirmativa")}, ctx.con)}
    cands = ctx.q("""SELECT ca.*, c.nome, c.cargo_atual, c.anos_experiencia, c.matricula FROM ats_candidaturas ca JOIN ats_candidatos c ON c.id = ca.candidato_id
                     WHERE ca.vaga_id = ? ORDER BY COALESCE(ca.score_ia, -1) DESC, ca.criado_em""", vid)
    return {"vaga": _vaga_pub(v, ctx.con), "candidaturas": [{**c, "analise_ia": jl(c["analise_ia"])} for c in cands]}


@rota("POST", "/api/ats/vagas", {"gestor", "rh", "bp"})
def criar_vaga(ctx: Ctx):
    gestor = ctx.u["matricula"] if ctx.perfil == "gestor" else ctx.campo("gestor_matricula", False)
    g = ctx.q1("SELECT * FROM colaboradores WHERE matricula = ?", gestor) if gestor else None
    seq = (ctx.q1("SELECT MAX(CAST(substr(id, 5) AS INTEGER)) n FROM ats_vagas")["n"] or 27000) + 1
    vid = f"REQ-{seq}"
    nivel = ctx.campo("nivel")
    sla = {"Assistente": 30, "Analista Jr": 30, "Analista Pl": 40, "Analista Sr": 45, "Especialista": 60, "Coordenador": 60, "Gerente": 75}.get(nivel, 60)
    ctx.ex("""INSERT INTO ats_vagas (id, titulo, diretoria, tribo, nivel, motivo, gestor_matricula, status, briefing, descricao, requisitos, competencias,
              salario_min, salario_max, sla, afirmativa, orcada, prioridade, recrutador, modelo_trabalho, criada_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
           vid, ctx.campo("titulo"), (g and g["diretoria"]) or ctx.campo("diretoria"), (g and g["tribo"]) or ctx.campo("tribo", False), nivel,
           ctx.campo("motivo", False, "Reposição"), gestor, "aprovacao" if ctx.perfil == "gestor" else "aberta", ctx.campo("briefing", False, ""),
           "", jd({}), jd(COMPETENCIAS_PADRAO), ctx.campo("salario_min", False), ctx.campo("salario_max", False), sla, int(bool(ctx.campo("afirmativa", False, False))),
           int(bool(ctx.campo("orcada", False, True))), ctx.campo("prioridade", False, "Média"), "Recrutador A", ctx.campo("modelo_trabalho", False, "Híbrido"), agora())
    if ctx.perfil != "gestor":
        ctx.ex("UPDATE ats_vagas SET publicada_em = ? WHERE id = ?", agora(), vid)
    sincronizar_cockpit(ctx.con)
    ctx.con.commit()
    return {"id": vid}


ESQ_VAGA = obj({"titulo": S, "resumo": S, "responsabilidades": lista(S), "requisitos_obrigatorios": lista(S), "requisitos_desejaveis": lista(S),
                "competencias": lista(S), "diferenciais_da_oportunidade": lista(S), "alertas_de_vies": lista(S)})


@rota("POST", r"/api/ats/vagas/(?P<vid>[\w-]+)/ia-descricao", {"gestor", "rh", "bp"})
def ia_descricao(ctx: Ctx, vid: str):
    v = _vaga(ctx, vid)
    ctx.exigir(_pode_gerir(ctx, v))
    tribo = ctx.q1("SELECT nome, missao FROM tribos WHERE id = ?", v["tribo"]) or {}
    r = ia.gerar("Redija a descrição de uma vaga de banco atraente, objetiva e inclusiva. Requisitos obrigatórios devem ser poucos (até 6) e realmente "
                 "necessários — excesso de requisitos afasta mulheres e grupos sub-representados. Liste em alertas_de_vies qualquer termo excludente do briefing.",
                 f"Cargo: {v['titulo']} ({v['nivel']})\nTribo: {tribo.get('nome')} — {tribo.get('missao')}\nModelo de trabalho: {v['modelo_trabalho']}\n"
                 f"Vaga afirmativa: {'sim' if v['afirmativa'] else 'não'}\nBriefing do gestor:\n{ctx.corpo.get('briefing') or v['briefing'] or '(sem briefing)'}", ESQ_VAGA)
    desc = (f"{r['resumo']}\n\n## Responsabilidades\n" + "\n".join(f"- {x}" for x in r["responsabilidades"])
            + "\n\n## O que você vai encontrar\n" + "\n".join(f"- {x}" for x in r["diferenciais_da_oportunidade"]))
    ctx.ex("UPDATE ats_vagas SET titulo = ?, descricao = ?, requisitos = ?, competencias = ?, briefing = COALESCE(?, briefing) WHERE id = ?",
           r["titulo"], desc, jd({"obrigatorios": r["requisitos_obrigatorios"], "desejaveis": r["requisitos_desejaveis"]}), jd(r["competencias"][:6] or COMPETENCIAS_PADRAO),
           ctx.corpo.get("briefing"), vid)
    ctx.con.commit()
    return {"ok": True, "alertas_de_vies": r["alertas_de_vies"]}


@rota("POST", r"/api/ats/vagas/(?P<vid>[\w-]+)/editar", {"gestor", "rh", "bp"})
def editar_vaga(ctx: Ctx, vid: str):
    v = _vaga(ctx, vid)
    ctx.exigir(_pode_gerir(ctx, v))
    campos = {k: ctx.corpo[k] for k in ("titulo", "descricao", "briefing", "salario_min", "salario_max", "prioridade", "modelo_trabalho", "afirmativa") if k in ctx.corpo}
    if "requisitos" in ctx.corpo:
        campos["requisitos"] = jd(ctx.corpo["requisitos"])
    if "competencias" in ctx.corpo:
        campos["competencias"] = jd(ctx.corpo["competencias"])
    if campos:
        ctx.ex(f"UPDATE ats_vagas SET {', '.join(k + ' = ?' for k in campos)} WHERE id = ?", *campos.values(), vid)
        ctx.con.commit()
    return {"ok": True}


@rota("POST", r"/api/ats/vagas/(?P<vid>[\w-]+)/acao", {"gestor", "rh", "bp"})
def acao_vaga(ctx: Ctx, vid: str):
    v = _vaga(ctx, vid)
    acao = ctx.campo("acao")
    transicoes = {"publicar": ({"aprovacao", "pausada", "rascunho"}, "aberta", True), "pausar": ({"aberta"}, "pausada", True),
                  "fechar": ({"aberta", "pausada"}, "fechada", True), "cancelar": ({"aprovacao", "aberta", "pausada", "rascunho"}, "cancelada", False)}
    ctx.exigir(acao in transicoes, "Ação inválida.")
    origem, destino, so_staff = transicoes[acao]
    ctx.exigir(ctx.staff or (not so_staff and _pode_gerir(ctx, v)), "Somente o RH pode executar esta ação.")
    if v["status"] not in origem:
        raise Erro(409, f"Não é possível {acao} uma vaga com status '{v['status']}'.")
    if acao == "publicar" and not v["descricao"]:
        raise Erro(409, "Escreva (ou gere com IA) a descrição antes de publicar.")
    ctx.ex("UPDATE ats_vagas SET status = ?, publicada_em = CASE WHEN ? = 'aberta' THEN ? ELSE publicada_em END, fechada_em = CASE WHEN ? IN ('fechada','cancelada') THEN ? ELSE fechada_em END WHERE id = ?",
           destino, destino, agora(), destino, agora(), vid)
    sincronizar_cockpit(ctx.con)
    ctx.con.commit()
    return {"status": destino}


# ------------------------------------------------------------------ candidato
@rota("GET", "/api/ats/meu-perfil", {"candidato", "colaborador", "gestor"})
def meu_perfil(ctx: Ctx):
    c = _meu_candidato(ctx, criar=True)
    ctx.con.commit()
    return _perfil_candidato(c) if c else {}


@rota("POST", "/api/ats/meu-perfil", {"candidato", "colaborador", "gestor"})
def salvar_perfil(ctx: Ctx):
    c = _meu_candidato(ctx, criar=True)
    campos = {k: ctx.corpo[k] for k in ("telefone", "cidade", "linkedin", "resumo", "cargo_atual", "anos_experiencia") if k in ctx.corpo}
    for k in ("habilidades", "formacao", "certificacoes", "idiomas", "experiencias"):
        if k in ctx.corpo:
            campos[k] = jd(ctx.corpo[k])
    if "diverso" in ctx.corpo:  # autodeclaração voluntária, usada só em indicadores agregados
        campos["diverso"] = 1 if ctx.corpo["diverso"] else 0
    if campos:
        ctx.ex(f"UPDATE ats_candidatos SET {', '.join(k + ' = ?' for k in campos)} WHERE id = ?", *campos.values(), c["id"])
    ctx.con.commit()
    return {"ok": True}


ESQ_CV = obj({"resumo": S, "cargo_atual": S, "anos_experiencia": I,
              "experiencias": lista(obj({"empresa": S, "cargo": S, "periodo": S, "destaques": lista(S)})),
              "formacao": lista(S), "habilidades": lista(S), "certificacoes": lista(S), "idiomas": lista(S)})


@rota("POST", "/api/ats/meu-perfil/curriculo", {"candidato", "colaborador", "gestor"})
def enviar_curriculo(ctx: Ctx):
    c = _meu_candidato(ctx, criar=True)
    nome, mime, dados = ctx.campo("nome"), ctx.campo("mime", False, ""), base64.b64decode(ctx.campo("base64"))
    aid = arquivos.salvar(ctx.con, nome, mime, dados, ctx.u["id"], "curriculo")
    ctx.con.commit()  # não segura o banco travado durante a chamada à IA
    bloco = arquivos.bloco_ia(nome, mime, dados)
    r = ia.gerar("Extraia o perfil profissional deste currículo. Ignore e NÃO transcreva dados pessoais sensíveis (CPF, RG, endereço, idade, estado civil, foto).",
                 [bloco, {"type": "text", "text": "Extraia o perfil profissional."}], ESQ_CV)
    ctx.ex("""UPDATE ats_candidatos SET resumo=?, cargo_atual=?, anos_experiencia=?, experiencias=?, formacao=?, habilidades=?, certificacoes=?, idiomas=?, curriculo_arquivo=? WHERE id=?""",
           r["resumo"], r["cargo_atual"], r["anos_experiencia"], jd(r["experiencias"]), jd(r["formacao"]), jd(r["habilidades"]), jd(r["certificacoes"]), jd(r["idiomas"]), aid, c["id"])
    ctx.con.commit()
    return {"ok": True, "perfil": r}


@rota("POST", r"/api/ats/vagas/(?P<vid>[\w-]+)/candidatar", {"candidato", "colaborador"})
def candidatar(ctx: Ctx, vid: str):
    v = _vaga(ctx, vid)
    if v["status"] != "aberta":
        raise Erro(409, "Esta vaga não está recebendo candidaturas.")
    c = _meu_candidato(ctx, criar=True)
    if not (c.get("resumo") or jl(c.get("experiencias"), [])):
        raise Erro(409, "Complete seu perfil (ou envie o currículo) antes de se candidatar.")
    if ctx.q1("SELECT 1 FROM ats_candidaturas WHERE vaga_id = ? AND candidato_id = ?", vid, c["id"]):
        raise Erro(409, "Você já se candidatou a esta vaga.")
    fonte = "Mobilidade interna" if c.get("matricula") else (c.get("origem") or "Site de carreiras/ATS")
    cid = ctx.ex("INSERT INTO ats_candidaturas (vaga_id, candidato_id, etapa, fonte, criado_em, atualizado_em) VALUES (?,?,?,?,?,?)", vid, c["id"], "Inscrito", fonte, agora(), agora())
    _evento(ctx, cid, ctx.u["nome"], "Candidatura enviada." + (f" Mensagem: {ctx.corpo['mensagem']}" if ctx.corpo.get("mensagem") else ""))
    sincronizar_cockpit(ctx.con)
    ctx.con.commit()
    return {"id": cid}


@rota("GET", "/api/ats/minhas-candidaturas", {"candidato", "colaborador"})
def minhas_candidaturas(ctx: Ctx):
    c = _meu_candidato(ctx)
    if not c:
        return []
    out = []
    for ca in ctx.q("SELECT ca.id, ca.etapa, ca.criado_em, ca.atualizado_em, v.titulo, v.id vaga_id FROM ats_candidaturas ca JOIN ats_vagas v ON v.id = ca.vaga_id WHERE ca.candidato_id = ? ORDER BY ca.criado_em DESC", c["id"]):
        of = ctx.q1("SELECT id, salario, data_inicio, status, carta FROM ats_ofertas WHERE candidatura_id = ? ORDER BY id DESC", ca["id"])
        ent = ctx.q("SELECT tipo, data, status FROM ats_entrevistas WHERE candidatura_id = ? AND status = 'agendada'", ca["id"])
        out.append({**ca, "etapa_publica": "Encerrada" if ca["etapa"] in FINAIS else ca["etapa"], "oferta": of, "entrevistas": ent})
    return out


# ------------------------------------------------------------------ RH / gestor
@rota("GET", "/api/ats/minhas-entrevistas", {"gestor", "rh", "bp"})
def minhas_entrevistas(ctx: Ctx):
    """Entrevistas agendadas em que a pessoa logada é a entrevistadora (RH/BP veem as sem entrevistador definido também)."""
    return ctx.q("""SELECT e.id, e.tipo, e.data, ca.id candidatura_id, c.nome candidato, v.titulo vaga FROM ats_entrevistas e
                     JOIN ats_candidaturas ca ON ca.id = e.candidatura_id JOIN ats_candidatos c ON c.id = ca.candidato_id JOIN ats_vagas v ON v.id = ca.vaga_id
                     WHERE e.status = 'agendada' AND ca.etapa NOT IN ('Reprovado','Desistiu') AND (e.entrevistador_matricula = ? OR (? AND e.entrevistador_matricula IS NULL))
                     ORDER BY e.data""", ctx.u.get("matricula"), 1 if ctx.staff else 0)


@rota("GET", r"/api/ats/candidaturas/(?P<cid>\d+)", {"gestor", "rh", "bp"})
def ver_candidatura(ctx: Ctx, cid: str):
    ca, v = _candidatura(ctx, cid)
    ctx.exigir(_pode_gerir(ctx, v))
    cand = ctx.q1("SELECT * FROM ats_candidatos WHERE id = ?", ca["candidato_id"])
    return {"candidatura": {**ca, "analise_ia": jl(ca["analise_ia"])}, "vaga": _vaga_pub(v), "candidato": _perfil_candidato(cand),
            "entrevistas": [{**e, "roteiro": jl(e["roteiro"]), "notas": jl(e["notas"], {})} for e in ctx.q("SELECT * FROM ats_entrevistas WHERE candidatura_id = ? ORDER BY id", cid)],
            "eventos": ctx.q("SELECT * FROM ats_eventos WHERE candidatura_id = ? ORDER BY id DESC", cid),
            "oferta": ctx.q1("SELECT * FROM ats_ofertas WHERE candidatura_id = ? ORDER BY id DESC", cid)}


ESQ_TRIAGEM = obj({"score": I, "aderencia": lista(obj({"requisito": S, "atende": {"type": "string", "enum": ["sim", "parcial", "nao", "sem_evidencia"]}, "evidencia": S})),
                   "pontos_fortes": lista(S), "lacunas": lista(S), "perguntas_para_entrevista": lista(S),
                   "recomendacao": {"type": "string", "enum": ["avançar", "avaliar com cautela", "não avançar"]}, "justificativa": S})


def _triar(ctx: Ctx, ca: dict, v: dict) -> dict:
    c = _perfil_candidato(ctx.q1("SELECT * FROM ats_candidatos WHERE id = ?", ca["candidato_id"]))
    anon = {k: c.get(k) for k in ("resumo", "cargo_atual", "anos_experiencia", "experiencias", "formacao", "habilidades", "certificacoes", "idiomas")}
    r = ia.gerar("Faça a triagem de um candidato para a vaga, comparando requisito a requisito e citando a EVIDÊNCIA do perfil. "
                 "O perfil vem anonimizado de propósito. Score de 0 a 100 = aderência aos requisitos obrigatórios (peso 70) e desejáveis (peso 30). "
                 "Experiência equivalente ou transferível conta. Não penalize lacunas de carreira nem formação em instituições menos conhecidas.",
                 f"VAGA: {v['titulo']} ({v['nivel']})\n{v['descricao']}\nRequisitos: {v['requisitos']}\nCompetências: {v['competencias']}\n\nPERFIL DO CANDIDATO (anonimizado):\n{jd(anon)}",
                 ESQ_TRIAGEM)
    r["score"] = max(0, min(100, int(r["score"])))
    ctx.ex("UPDATE ats_candidaturas SET score_ia = ?, analise_ia = ?, etapa = CASE WHEN etapa = 'Inscrito' THEN 'Triagem' ELSE etapa END, atualizado_em = ? WHERE id = ?",
           r["score"], jd(r), agora(), ca["id"])
    _evento(ctx, ca["id"], "IA", f"Triagem por IA: {r['score']}/100 — {r['recomendacao']}.")
    return r


@rota("POST", r"/api/ats/candidaturas/(?P<cid>\d+)/triar", {"gestor", "rh", "bp"})
def triar(ctx: Ctx, cid: str):
    ca, v = _candidatura(ctx, cid)
    ctx.exigir(_pode_gerir(ctx, v))
    r = _triar(ctx, ca, v)
    ctx.con.commit()
    return r


@rota("POST", r"/api/ats/vagas/(?P<vid>[\w-]+)/triar-todos", {"gestor", "rh", "bp"})
def triar_todos(ctx: Ctx, vid: str):
    v = _vaga(ctx, vid)
    ctx.exigir(_pode_gerir(ctx, v))
    pend = ctx.q("SELECT * FROM ats_candidaturas WHERE vaga_id = ? AND score_ia IS NULL AND etapa IN ('Inscrito','Triagem') LIMIT 10", vid)
    for ca in pend:  # lote limitado para controlar custo e tempo
        _triar(ctx, ca, v)
        ctx.con.commit()
    restantes = ctx.q1("SELECT COUNT(*) n FROM ats_candidaturas WHERE vaga_id = ? AND score_ia IS NULL AND etapa IN ('Inscrito','Triagem')", vid)["n"]
    sincronizar_cockpit(ctx.con)
    ctx.con.commit()
    return {"triados": len(pend), "restantes": restantes}


@rota("POST", r"/api/ats/candidaturas/(?P<cid>\d+)/mover", {"gestor", "rh", "bp"})
def mover(ctx: Ctx, cid: str):
    ca, v = _candidatura(ctx, cid)
    ctx.exigir(_pode_gerir(ctx, v))
    etapa = ctx.campo("etapa")
    if etapa not in ETAPAS + FINAIS or etapa == "Contratado":
        raise Erro(400, "Etapa inválida (a contratação acontece pelo aceite da oferta).")
    motivo = ctx.campo("motivo", etapa == "Reprovado")
    ctx.ex("UPDATE ats_candidaturas SET etapa = ?, motivo_reprovacao = ?, atualizado_em = ? WHERE id = ?", etapa, motivo, agora(), cid)
    _evento(ctx, cid, ctx.u["nome"], f"Moveu para {etapa}." + (f" Motivo: {motivo}" if motivo else ""))
    sincronizar_cockpit(ctx.con)
    ctx.con.commit()
    return {"ok": True}


ESQ_ROTEIRO = obj({"abertura": S, "blocos": lista(obj({"competencia": S, "perguntas": lista(S), "sinais_positivos": lista(S), "sinais_de_alerta": lista(S)})),
                   "perguntas_tecnicas": lista(S), "encerramento": S})


@rota("POST", r"/api/ats/candidaturas/(?P<cid>\d+)/entrevista", {"gestor", "rh", "bp"})
def agendar_entrevista(ctx: Ctx, cid: str):
    ca, v = _candidatura(ctx, cid)
    ctx.exigir(_pode_gerir(ctx, v))
    tipo = ctx.campo("tipo", False, "Entrevista Gestor" if ctx.perfil == "gestor" else "Entrevista RH")
    roteiro = None
    if ctx.corpo.get("roteiro_ia", True):
        analise = jl(ca["analise_ia"], {})
        roteiro = ia.gerar("Monte um roteiro de entrevista ESTRUTURADA por competências, com perguntas comportamentais no formato STAR, "
                           "iguais para todos os candidatos da vaga (reduz viés). Inclua o que observar.",
                           f"Vaga: {v['titulo']} ({v['nivel']})\nCompetências: {v['competencias']}\nRequisitos: {v['requisitos']}\n"
                           f"Pontos a aprofundar apontados na triagem: {jd(analise.get('perguntas_para_entrevista', []))}", ESQ_ROTEIRO)
    eid = ctx.ex("INSERT INTO ats_entrevistas (candidatura_id, tipo, entrevistador_matricula, entrevistador_nome, data, roteiro, notas, status) VALUES (?,?,?,?,?,?,?,?)",
                 cid, tipo, ctx.u.get("matricula"), ctx.u["nome"], ctx.campo("data", False, hoje()), jd(roteiro) if roteiro else None, jd({}), "agendada")
    if ca["etapa"] in ETAPAS and tipo in ETAPAS and ETAPAS.index(ca["etapa"]) < ETAPAS.index(tipo):
        ctx.ex("UPDATE ats_candidaturas SET etapa = ?, atualizado_em = ? WHERE id = ?", tipo, agora(), cid)
    _evento(ctx, cid, ctx.u["nome"], f"{tipo} agendada para {ctx.campo('data', False, hoje())}.")
    sincronizar_cockpit(ctx.con)
    ctx.con.commit()
    return {"id": eid, "roteiro": roteiro}


@rota("POST", r"/api/ats/entrevistas/(?P<eid>\d+)/avaliar", {"gestor", "rh", "bp"})
def avaliar_entrevista(ctx: Ctx, eid: str):
    e = ctx.q1("SELECT * FROM ats_entrevistas WHERE id = ?", eid)
    if not e:
        raise Erro(404, "Entrevista não encontrada.")
    ca, v = _candidatura(ctx, e["candidatura_id"])
    ctx.exigir(_pode_gerir(ctx, v))
    notas = ctx.campo("notas")
    if not isinstance(notas, dict) or not all(isinstance(x, (int, float)) and 1 <= x <= 5 for x in notas.values()):
        raise Erro(400, "Dê uma nota de 1 a 5 para cada competência.")
    rec = ctx.campo("recomendacao")
    ctx.ex("UPDATE ats_entrevistas SET notas = ?, recomendacao = ?, comentario = ?, status = 'realizada' WHERE id = ?", jd(notas), rec, ctx.campo("comentario", False, ""), eid)
    media = sum(notas.values()) / len(notas)
    _evento(ctx, ca["id"], ctx.u["nome"], f"Avaliou a {e['tipo']}: média {media:.1f}/5, recomendação '{rec}'.")
    ctx.con.commit()
    return {"ok": True, "media": round(media, 2)}


ESQ_CARTA = obj({"assunto": S, "carta_markdown": S})


@rota("POST", r"/api/ats/candidaturas/(?P<cid>\d+)/oferta", {"rh", "bp"})
def fazer_oferta(ctx: Ctx, cid: str):
    ca, v = _candidatura(ctx, cid)
    cand = ctx.q1("SELECT nome FROM ats_candidatos WHERE id = ?", ca["candidato_id"])
    salario, inicio = float(ctx.campo("salario")), ctx.campo("data_inicio")
    try:
        carta = ia.gerar("Escreva uma carta-proposta calorosa e clara para um candidato aprovado no Bradesco. Não invente benefícios além dos informados; "
                         "inclua cargo, salário, data de início, modelo de trabalho e próximos passos (documentos de admissão e exame admissional).",
                         f"Candidato: {cand['nome']}\nCargo: {v['titulo']} ({v['nivel']})\nSalário mensal: R$ {salario:,.2f}\nInício: {inicio}\n"
                         f"Modelo: {v['modelo_trabalho']}\nBenefícios: {ctx.campo('beneficios', False, 'pacote de benefícios Bradesco conforme política vigente')}", ESQ_CARTA)["carta_markdown"]
    except Erro:
        carta = (f"Olá, {cand['nome']}!\n\nTemos a alegria de convidar você para a posição de **{v['titulo']}** ({v['nivel']}).\n\n"
                 f"- Salário mensal: R$ {salario:,.2f}\n- Início previsto: {inicio}\n- Modelo de trabalho: {v['modelo_trabalho']}\n\n"
                 "Ao aceitar, você receberá o checklist de documentos e o agendamento do exame admissional.")
    ctx.ex("UPDATE ats_ofertas SET status = 'substituida' WHERE candidatura_id = ? AND status = 'enviada'", cid)
    oid = ctx.ex("INSERT INTO ats_ofertas (candidatura_id, salario, data_inicio, status, carta, criada_em) VALUES (?,?,?,?,?,?)", cid, salario, inicio, "enviada", carta, agora())
    ctx.ex("UPDATE ats_candidaturas SET etapa = 'Proposta', atualizado_em = ? WHERE id = ?", agora(), cid)
    _evento(ctx, cid, ctx.u["nome"], f"Proposta enviada: R$ {salario:,.2f}, início {inicio}.")
    sincronizar_cockpit(ctx.con)
    ctx.con.commit()
    return {"id": oid, "carta": carta}


@rota("POST", r"/api/ats/ofertas/(?P<oid>\d+)/responder", {"candidato", "colaborador"})
def responder_oferta(ctx: Ctx, oid: str):
    of = ctx.q1("SELECT * FROM ats_ofertas WHERE id = ?", oid)
    if not of or of["status"] != "enviada":
        raise Erro(404, "Proposta não encontrada ou já respondida.")
    ca, v = _candidatura(ctx, of["candidatura_id"])
    c = _meu_candidato(ctx)
    ctx.exigir(c and c["id"] == ca["candidato_id"])
    aceitar = bool(ctx.campo("aceitar", False, False))
    ctx.ex("UPDATE ats_ofertas SET status = ?, respondida_em = ? WHERE id = ?", "aceita" if aceitar else "recusada", agora(), oid)
    if not aceitar:
        ctx.ex("UPDATE ats_candidaturas SET etapa = 'Desistiu', motivo_reprovacao = 'Recusou a proposta', atualizado_em = ? WHERE id = ?", agora(), ca["id"])
        _evento(ctx, ca["id"], c["nome"], "Recusou a proposta.")
        sincronizar_cockpit(ctx.con)
        ctx.con.commit()
        return {"ok": True}
    ctx.ex("UPDATE ats_candidaturas SET etapa = 'Contratado', atualizado_em = ? WHERE id = ?", agora(), ca["id"])
    ctx.ex("UPDATE ats_vagas SET status = 'fechada', fechada_em = ? WHERE id = ?", agora(), v["id"])
    _evento(ctx, ca["id"], c["nome"], "Aceitou a proposta. Processo de admissão aberto.")
    from . import admissao
    pid = admissao.criar_processo(ctx.con, ca, v, of)
    sincronizar_cockpit(ctx.con)
    ctx.con.commit()
    return {"ok": True, "admissao_id": pid}


# ------------------------------------------------------------------ semente (ambiente simulado)
NOMES = ["Ana", "Bruno", "Carla", "Diego", "Elisa", "Fábio", "Gisele", "Hugo", "Isabela", "João", "Karina", "Leonardo", "Marina", "Nicolas", "Olívia",
         "Pedro", "Quésia", "Rafael", "Sabrina", "Tiago", "Úrsula", "Vitor", "Wanessa", "Yago"]
SOBRENOMES = ["Alves", "Batista", "Correia", "Duarte", "Esteves", "Farias", "Guimarães", "Holanda", "Lacerda", "Macedo", "Nogueira", "Prado", "Queiroz", "Rezende", "Sampaio", "Teixeira"]
EMPRESAS = ["Banco Exemplo", "Fintech Alfa", "Consultoria Beta", "Varejista Gama", "Seguradora Delta", "Tech Ômega", "Cooperativa Sigma"]


def semear(con) -> None:
    if con.execute("SELECT 1 FROM ats_vagas LIMIT 1").fetchone():
        return
    r = random.Random(7)
    gestores = {}
    for g in con.execute("SELECT matricula, diretoria, tribo FROM colaboradores WHERE status='ativo' AND nivel IN ('Gerente','Coordenador')"):
        gestores.setdefault((g["diretoria"], g["tribo"]), []).append(g["matricula"])
    demo = con.execute("SELECT u.matricula, c.diretoria, c.tribo FROM usuarios u JOIN colaboradores c ON c.matricula = u.matricula WHERE u.login = 'gestor'").fetchone()
    vagas = [dict(v) for v in con.execute("SELECT * FROM vagas")]
    competencias_por_dir = {"tecnologia": ["Engenharia de software", "Arquitetura cloud", "Colaboração", "Aprendizado contínuo", "Segurança da informação"]}
    demo_vagas = 0
    for v in vagas:
        g = r.choice(gestores.get((v["diretoria"], v["tribo"])) or sum((x for k, x in gestores.items() if k[0] == v["diretoria"]), []) or [None])
        if demo and v["diretoria"] == demo["diretoria"] and (v["tribo"] == demo["tribo"] or demo_vagas < 3) and demo_vagas < 4:
            g, demo_vagas = demo["matricula"], demo_vagas + 1
        abertura = v["abertura"]
        con.execute("""INSERT INTO ats_vagas (id, titulo, diretoria, tribo, nivel, motivo, gestor_matricula, status, briefing, descricao, requisitos, competencias,
                       salario_min, salario_max, sla, afirmativa, orcada, prioridade, recrutador, modelo_trabalho, criada_em, publicada_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (v["id"], v["cargo"], v["diretoria"], v["tribo"], v["nivel"], v["motivo"], g, "aberta", "",
                     f"Buscamos {v['cargo']} ({v['nivel']}) para fortalecer o time. Atuação em ambiente ágil, com foco em cliente e resultados.",
                     jd({"obrigatorios": [f"Experiência como {v['cargo']} ou função similar", "Boa comunicação"], "desejaveis": ["Vivência no setor financeiro"]}),
                     jd(competencias_por_dir.get(v["diretoria"], COMPETENCIAS_PADRAO)), round(v["salario_previsto"] * 0.9), round(v["salario_previsto"] * 1.1),
                     v["sla"], v["afirmativa"], v["orcada"], v["prioridade"], v["recrutador"], r.choice(["Híbrido", "Híbrido", "Presencial", "Remoto"]), abertura + "T09:00:00", abertura + "T10:00:00"))
        cs = [dict(c) for c in con.execute("SELECT * FROM candidatos WHERE vaga_id = ? LIMIT 8", (v["id"],))]
        mapa = {"Aberta": "Inscrito", "Triagem": "Triagem", "Entrevistas": r.choice(["Entrevista RH", "Entrevista Gestor"]), "Proposta": "Proposta"}
        for c in cs:
            nome = f"{r.choice(NOMES)} {r.choice(SOBRENOMES)}"
            anos = r.randint(1, 15)
            cid = con.execute("""INSERT INTO ats_candidatos (nome, email, cidade, resumo, cargo_atual, anos_experiencia, experiencias, formacao, habilidades, origem, diverso, criado_em)
                                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                              (nome, f"{nome.lower().replace(' ', '.')}@exemplo.com", r.choice(["São Paulo", "Osasco", "Rio de Janeiro", "Belo Horizonte", "Curitiba"]),
                               f"Profissional com {anos} anos de experiência em funções relacionadas a {v['cargo'].lower()}.", v["cargo"], anos,
                               jd([{"empresa": r.choice(EMPRESAS), "cargo": v["cargo"], "periodo": f"{2026 - anos}–atual", "destaques": ["Entregas relevantes na área"]}]),
                               jd([r.choice(["Administração", "Economia", "Engenharia", "Ciência da Computação", "Sistemas de Informação"])]),
                               jd([v["cargo"].split()[0], "Excel", "Comunicação"]), c["fonte"], c["diverso"], abertura + "T12:00:00")).lastrowid
            if c["fonte"] == "Mobilidade interna":
                con.execute("UPDATE ats_candidatos SET origem = 'Mobilidade interna' WHERE id = ?", (cid,))
            dia = (dt.date.fromisoformat(abertura) + dt.timedelta(days=r.randint(0, max(1, v["dias_aberta"] // 2)))).isoformat()
            con.execute("INSERT INTO ats_candidaturas (vaga_id, candidato_id, etapa, fonte, criado_em, atualizado_em) VALUES (?,?,?,?,?,?)",
                        (v["id"], cid, mapa.get(c["etapa"], "Inscrito"), c["fonte"], dia + "T12:00:00", dia + "T12:00:00"))
    # candidata de demonstração em fase final, com entrevista do gestor de demonstração
    if demo:
        vg = con.execute("SELECT * FROM ats_vagas WHERE gestor_matricula = ? ORDER BY id LIMIT 1", (demo["matricula"],)).fetchone()
        cid = con.execute("""INSERT INTO ats_candidatos (nome, email, cidade, resumo, cargo_atual, anos_experiencia, experiencias, formacao, habilidades, certificacoes, idiomas, origem, diverso, criado_em)
                             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                          ("Carla Menezes (candidata demo)", "candidato@demo.local", "São Paulo",
                           "Engenheira de dados com 6 anos de experiência em pipelines em nuvem, modelagem e governança de dados em instituições financeiras.",
                           "Engenheira de Dados Sênior", 6,
                           jd([{"empresa": "Fintech Alfa", "cargo": "Engenheira de Dados Sênior", "periodo": "2022–atual", "destaques": ["Migrou data lake para a nuvem", "Reduziu custo de processamento em 30%"]},
                               {"empresa": "Banco Exemplo", "cargo": "Analista de Dados", "periodo": "2019–2022", "destaques": ["Criou painéis regulatórios"]}]),
                           jd(["Bacharelado em Ciência da Computação"]), jd(["Python", "SQL", "Spark", "AWS", "Governança de dados"]), jd(["AWS Data Analytics"]),
                           jd(["Inglês avançado"]), "LinkedIn", 1, agora())).lastrowid
        from ..auth import SENHA_DEMO, criar_usuario
        criar_usuario(con, "candidato", "Carla Menezes (candidata demo)", "candidato", SENHA_DEMO, email="candidato@demo.local", candidato_id=cid, demo=1)
        caid = con.execute("INSERT INTO ats_candidaturas (vaga_id, candidato_id, etapa, fonte, criado_em, atualizado_em) VALUES (?,?,?,?,?,?)",
                           (vg["id"], cid, "Entrevista Gestor", "LinkedIn", agora(), agora())).lastrowid
        con.execute("INSERT INTO ats_entrevistas (candidatura_id, tipo, entrevistador_matricula, entrevistador_nome, data, notas, status) VALUES (?,?,?,?,?,?,?)",
                    (caid, "Entrevista Gestor", demo["matricula"], "Gestor(a) da vaga", hoje(), jd({}), "agendada"))
        _evento(con, caid, "RH", "Aprovada na entrevista com RH. Entrevista com gestor agendada.")
    sincronizar_cockpit(con)
    con.commit()
