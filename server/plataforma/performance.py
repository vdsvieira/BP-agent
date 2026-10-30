"""Performance — ciclos de avaliação (auto, gestor, pares), calibração, PDI e feedback contínuo.

A IA revisa textos de feedback (modelo SBI, linguagem enviesada, falta de evidência), sintetiza
as avaliações e propõe o PDI 70-20-10. Ao encerrar o ciclo, desempenho e potencial calibrados
atualizam a base de pessoas e o modelo de risco do cockpit.
"""
from __future__ import annotations

import random

from .. import conectores, ia
from ..ia import S, lista, obj
from ..rotas import INTERNOS, STAFF, Ctx, Erro, agora, jd, jl, rota

COMPETENCIAS = ["Foco no cliente", "Entrega de resultados", "Colaboração", "Inovação e aprendizado", "Ética e gestão de riscos"]
COMP_LIDER = ["Desenvolvimento de pessoas"]
STATUS = ["avaliacoes", "calibracao", "encerrado"]
PESOS = {"gestor": 0.7, "par": 0.15, "auto": 0.15}


def criar_tabelas(con) -> None:
    con.executescript("""
    CREATE TABLE IF NOT EXISTS perf_ciclos (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, status TEXT, inicio TEXT, fim TEXT, criado_em TEXT);
    CREATE TABLE IF NOT EXISTS perf_avaliacoes (id INTEGER PRIMARY KEY AUTOINCREMENT, ciclo_id INTEGER, avaliado TEXT, avaliador TEXT, tipo TEXT, status TEXT,
      notas TEXT, resultado REAL, potencial INTEGER, pontos_fortes TEXT, desenvolver TEXT, comentario TEXT, atualizado_em TEXT);
    CREATE INDEX IF NOT EXISTS ix_perf_av ON perf_avaliacoes (ciclo_id, avaliador);
    CREATE TABLE IF NOT EXISTS perf_resultados (id INTEGER PRIMARY KEY AUTOINCREMENT, ciclo_id INTEGER, matricula TEXT, nota_final REAL, potencial INTEGER,
      nota_calibrada REAL, potencial_calibrado INTEGER, calibrado INTEGER DEFAULT 0, comentario_calibracao TEXT, resumo_ia TEXT, pdi TEXT, UNIQUE(ciclo_id, matricula));
    CREATE TABLE IF NOT EXISTS perf_feedbacks (id INTEGER PRIMARY KEY AUTOINCREMENT, de_matricula TEXT, de_nome TEXT, para_matricula TEXT, tipo TEXT, texto TEXT, data TEXT);
    """)


def _competencias(lider: bool) -> list[str]:
    return COMPETENCIAS + (COMP_LIDER if lider else [])


def _ciclo(ctx: Ctx, cid) -> dict:
    c = ctx.q1("SELECT * FROM perf_ciclos WHERE id = ?", cid)
    if not c:
        raise Erro(404, "Ciclo não encontrado.")
    return c


def _nomes(ctx: Ctx, mats) -> dict:
    mats = [m for m in set(mats) if m]
    if not mats:
        return {}
    return {r["matricula"]: r for r in ctx.q(f"SELECT matricula, nome, cargo, nivel, diretoria, tribo, gestor_matricula, lider FROM colaboradores WHERE matricula IN ({','.join('?' * len(mats))})", *mats)}


# ------------------------------------------------------------------ ciclos
@rota("GET", "/api/performance/ciclos", INTERNOS)
def ciclos(ctx: Ctx):
    out = []
    for c in ctx.q("SELECT * FROM perf_ciclos ORDER BY id DESC"):
        st = ctx.q1("SELECT COUNT(*) total, SUM(status='enviada') enviadas, SUM(tipo='auto') autos, SUM(tipo='auto' AND status='enviada') autos_ok, "
                    "SUM(tipo='gestor') gestores, SUM(tipo='gestor' AND status='enviada') gestores_ok FROM perf_avaliacoes WHERE ciclo_id = ?", c["id"])
        out.append({**c, "adesao": st if ctx.staff else None})
    return out


@rota("POST", "/api/performance/ciclos", STAFF)
def abrir_ciclo(ctx: Ctx):
    if ctx.q1("SELECT 1 FROM perf_ciclos WHERE status IN ('avaliacoes','calibracao')"):
        raise Erro(409, "Já existe um ciclo em andamento. Encerre-o antes de abrir outro.")
    cid = ctx.ex("INSERT INTO perf_ciclos (nome, status, inicio, fim, criado_em) VALUES (?,?,?,?,?)", ctx.campo("nome"), "avaliacoes",
                 ctx.campo("inicio", False, agora()[:10]), ctx.campo("fim", False, ""), agora())
    gerar_avaliacoes(ctx.con, cid)
    ctx.con.commit()
    return {"id": cid}


def gerar_avaliacoes(con, cid: int) -> None:
    for p in con.execute("SELECT matricula, gestor_matricula FROM colaboradores WHERE status = 'ativo'").fetchall():
        con.execute("INSERT INTO perf_avaliacoes (ciclo_id, avaliado, avaliador, tipo, status, notas, atualizado_em) VALUES (?,?,?,?,?,?,?)", (cid, p["matricula"], p["matricula"], "auto", "pendente", "{}", agora()))
        if p["gestor_matricula"]:
            con.execute("INSERT INTO perf_avaliacoes (ciclo_id, avaliado, avaliador, tipo, status, notas, atualizado_em) VALUES (?,?,?,?,?,?,?)", (cid, p["matricula"], p["gestor_matricula"], "gestor", "pendente", "{}", agora()))


@rota("POST", r"/api/performance/ciclos/(?P<cid>\d+)/avancar", STAFF)
def avancar(ctx: Ctx, cid: str):
    c = _ciclo(ctx, cid)
    if c["status"] == "encerrado":
        raise Erro(409, "Ciclo já encerrado.")
    if c["status"] == "avaliacoes":
        consolidar(ctx.con, int(cid))
        ctx.ex("UPDATE perf_ciclos SET status = 'calibracao' WHERE id = ?", cid)
    else:
        encerrar(ctx.con, int(cid))
    ctx.con.commit()
    return {"status": ctx.q1("SELECT status FROM perf_ciclos WHERE id = ?", cid)["status"]}


def consolidar(con, cid: int) -> None:
    """Nota final ponderada: gestor 70%, pares 15%, autoavaliação 15% (pesos redistribuídos quando falta alguma fonte)."""
    por = {}
    for a in con.execute("SELECT * FROM perf_avaliacoes WHERE ciclo_id = ? AND status = 'enviada' AND resultado IS NOT NULL", (cid,)).fetchall():
        por.setdefault(a["avaliado"], []).append(dict(a))
    for mat, avs in por.items():
        fontes = {}
        for a in avs:
            fontes.setdefault(a["tipo"], []).append(a["resultado"])
        peso = sum(PESOS[t] for t in fontes)
        nota = sum(PESOS[t] * sum(v) / len(v) for t, v in fontes.items()) / peso
        pot = next((a["potencial"] for a in avs if a["tipo"] == "gestor" and a["potencial"]), None)
        con.execute("""INSERT INTO perf_resultados (ciclo_id, matricula, nota_final, potencial, nota_calibrada, potencial_calibrado) VALUES (?,?,?,?,?,?)
                       ON CONFLICT(ciclo_id, matricula) DO UPDATE SET nota_final = excluded.nota_final, potencial = excluded.potencial""",
                    (cid, mat, round(nota, 2), pot, round(nota, 2), pot))


def encerrar(con, cid: int) -> None:
    for r in con.execute("SELECT * FROM perf_resultados WHERE ciclo_id = ?", (cid,)).fetchall():
        nota = r["nota_calibrada"] or r["nota_final"]
        sets, vals = ["desempenho = ?"], [int(round(nota))]
        if r["potencial_calibrado"] or r["potencial"]:
            sets.append("potencial = ?")
            vals.append(r["potencial_calibrado"] or r["potencial"])
        con.execute(f"UPDATE colaboradores SET {', '.join(sets)} WHERE matricula = ?", (*vals, r["matricula"]))
    con.execute("UPDATE perf_ciclos SET status = 'encerrado', fim = ? WHERE id = ?", (agora()[:10], cid))
    conectores.retreinar(con)  # desempenho é variável do modelo de risco de saída


# ------------------------------------------------------------------ avaliações
@rota("GET", "/api/performance/minhas", INTERNOS)
def minhas(ctx: Ctx):
    m = ctx.u.get("matricula")
    atual = ctx.q1("SELECT * FROM perf_ciclos WHERE status IN ('avaliacoes','calibracao') ORDER BY id DESC LIMIT 1")
    a_fazer = []
    if atual and m:
        avs = ctx.q("SELECT * FROM perf_avaliacoes WHERE ciclo_id = ? AND avaliador = ? ORDER BY tipo DESC, id", atual["id"], m)
        nomes = _nomes(ctx, [a["avaliado"] for a in avs])
        a_fazer = [{**a, "notas": jl(a["notas"], {}), "avaliado_nome": nomes.get(a["avaliado"], {}).get("nome"), "avaliado_cargo": nomes.get(a["avaliado"], {}).get("cargo")} for a in avs]
    ultimo = ctx.q1("SELECT * FROM perf_ciclos WHERE status = 'encerrado' ORDER BY id DESC LIMIT 1")
    resultado = ctx.q1("SELECT * FROM perf_resultados WHERE ciclo_id = ? AND matricula = ?", ultimo["id"], m) if ultimo and m else None
    if resultado:
        resultado = {**resultado, "resumo_ia": jl(resultado["resumo_ia"]), "pdi": jl(resultado["pdi"]), "ciclo": ultimo["nome"]}
    fbs = ctx.q("SELECT * FROM perf_feedbacks WHERE para_matricula = ? OR de_matricula = ? ORDER BY id DESC LIMIT 30", m, m) if m else []
    return {"ciclo_atual": atual, "a_fazer": a_fazer, "resultado": resultado, "feedbacks": fbs, "competencias": COMPETENCIAS + COMP_LIDER}


def _avaliacao(ctx: Ctx, aid) -> tuple[dict, dict]:
    a = ctx.q1("SELECT * FROM perf_avaliacoes WHERE id = ?", aid)
    if not a:
        raise Erro(404, "Avaliação não encontrada.")
    c = _ciclo(ctx, a["ciclo_id"])
    ctx.exigir(ctx.staff or a["avaliador"] == ctx.u.get("matricula") or (c["status"] == "encerrado" and a["avaliado"] == ctx.u.get("matricula")))
    return a, c


@rota("GET", r"/api/performance/avaliacoes/(?P<aid>\d+)", INTERNOS)
def ver_avaliacao(ctx: Ctx, aid: str):
    a, c = _avaliacao(ctx, aid)
    p = _nomes(ctx, [a["avaliado"]]).get(a["avaliado"], {})
    metas = ctx.q("""SELECT o.titulo, k.titulo kr, k.inicial, k.alvo, k.atual, k.unidade FROM meta_objetivos o JOIN meta_krs k ON k.objetivo_id = o.id
                     WHERE o.nivel = 'individual' AND o.dono = ?""", a["avaliado"])
    fbs = ctx.q("SELECT tipo, texto, data, de_nome FROM perf_feedbacks WHERE para_matricula = ? ORDER BY id DESC LIMIT 10", a["avaliado"])
    return {"avaliacao": {**a, "notas": jl(a["notas"], {})}, "ciclo": c, "avaliado": p, "competencias": _competencias(bool(p.get("lider"))),
            "metas": metas, "feedbacks": fbs if a["tipo"] == "gestor" else []}


@rota("POST", r"/api/performance/avaliacoes/(?P<aid>\d+)", INTERNOS)
def salvar_avaliacao(ctx: Ctx, aid: str):
    a, c = _avaliacao(ctx, aid)
    ctx.exigir(a["avaliador"] == ctx.u.get("matricula"), "Somente quem avalia pode preencher.")
    if c["status"] != "avaliacoes" or a["status"] == "enviada":
        raise Erro(409, "Esta avaliação não pode mais ser alterada.")
    notas = ctx.campo("notas", False, {}) or {}
    if not all(isinstance(v, (int, float)) and 1 <= v <= 5 for v in notas.values()):
        raise Erro(400, "As notas vão de 1 a 5.")
    enviar = bool(ctx.campo("enviar", False, False))
    if enviar and len(notas) < len(COMPETENCIAS):
        raise Erro(400, "Avalie todas as competências antes de enviar.")
    if enviar and a["tipo"] == "gestor" and not ctx.campo("potencial", False):
        raise Erro(400, "Informe o potencial (1 a 3) antes de enviar.")
    resultado = round(sum(notas.values()) / len(notas), 2) if notas else None
    ctx.ex("""UPDATE perf_avaliacoes SET notas=?, resultado=?, potencial=?, pontos_fortes=?, desenvolver=?, comentario=?, status=?, atualizado_em=? WHERE id=?""",
           jd(notas), resultado, ctx.campo("potencial", False), ctx.campo("pontos_fortes", False, ""), ctx.campo("desenvolver", False, ""),
           ctx.campo("comentario", False, ""), "enviada" if enviar else "rascunho", agora(), aid)
    ctx.con.commit()
    return {"ok": True, "resultado": resultado}


ESQ_TEXTO = obj({"alertas": lista(obj({"trecho": S, "problema": S, "sugestao": S})), "falta_evidencia": {"type": "boolean"},
                 "versao_sugerida": S, "dica": S})


@rota("POST", "/api/performance/ia-revisar-texto", INTERNOS)
def ia_revisar_texto(ctx: Ctx):
    """Revisa feedback/avaliação: modelo SBI, evidências e vieses de linguagem."""
    return ia.gerar("Revise um texto de feedback ou avaliação de desempenho. Aponte: (1) linguagem enviesada ou estereotipada (gênero, idade, origem, "
                    "maternidade/paternidade, aparência, 'personalidade' em vez de comportamento), (2) julgamentos sem evidência, (3) vagueza. "
                    "Proponha uma versão no modelo SBI (Situação, Comportamento, Impacto), respeitosa e acionável, mantendo a intenção de quem escreveu.",
                    f"Tipo: {ctx.campo('tipo', False, 'feedback')}\nTexto:\n{ctx.campo('texto')}", ESQ_TEXTO)


# ------------------------------------------------------------------ calibração e PDI
@rota("GET", r"/api/performance/calibracao/(?P<cid>\d+)", {"rh", "bp", "gestor"})
def calibracao(ctx: Ctx, cid: str):
    c = _ciclo(ctx, cid)
    rs = ctx.q("SELECT * FROM perf_resultados WHERE ciclo_id = ?", cid)
    nomes = _nomes(ctx, [r["matricula"] for r in rs])
    dire = ctx.query.get("diretoria")
    out = []
    for r in rs:
        p = nomes.get(r["matricula"])
        if not p or (dire and p["diretoria"] != dire):
            continue
        if ctx.perfil == "gestor" and p["gestor_matricula"] != ctx.u.get("matricula"):
            continue
        out.append({**r, "nome": p["nome"], "cargo": p["cargo"], "nivel": p["nivel"], "diretoria": p["diretoria"], "tribo": p["tribo"], "resumo_ia": jl(r["resumo_ia"]), "pdi": jl(r["pdi"])})
    dist = {n: sum(1 for r in out if round(r["nota_calibrada"] or r["nota_final"] or 0) == n) for n in range(1, 6)}
    return {"ciclo": c, "resultados": out, "distribuicao": dist, "referencia": {1: 0.05, 2: 0.15, 3: 0.50, 4: 0.20, 5: 0.10}}


@rota("POST", r"/api/performance/calibracao/(?P<cid>\d+)/(?P<mat>\w+)", STAFF)
def calibrar(ctx: Ctx, cid: str, mat: str):
    c = _ciclo(ctx, cid)
    if c["status"] != "calibracao":
        raise Erro(409, "O ciclo não está em calibração.")
    nota, pot = float(ctx.campo("nota_calibrada")), ctx.campo("potencial_calibrado", False)
    if not 1 <= nota <= 5:
        raise Erro(400, "Nota de 1 a 5.")
    ctx.ex("UPDATE perf_resultados SET nota_calibrada = ?, potencial_calibrado = COALESCE(?, potencial_calibrado), calibrado = 1, comentario_calibracao = ? WHERE ciclo_id = ? AND matricula = ?",
           nota, pot, ctx.campo("comentario", False, ""), cid, mat)
    ctx.con.commit()
    return {"ok": True}


ESQ_PDI = obj({"sintese": S, "forcas": lista(S), "oportunidades": lista(S),
               "pdi": lista(obj({"objetivo": S, "acoes_70_experiencia": lista(S), "acoes_20_relacoes": lista(S), "acoes_10_formal": lista(S), "prazo": S, "indicador": S}))})


@rota("POST", r"/api/performance/resultados/(?P<cid>\d+)/(?P<mat>\w+)/ia-pdi", INTERNOS)
def ia_pdi(ctx: Ctx, cid: str, mat: str):
    r = ctx.q1("SELECT * FROM perf_resultados WHERE ciclo_id = ? AND matricula = ?", cid, mat)
    if not r:
        raise Erro(404, "Resultado não encontrado (o ciclo precisa estar consolidado).")
    p = _nomes(ctx, [mat]).get(mat, {})
    ctx.exigir(ctx.staff or mat == ctx.u.get("matricula") or p.get("gestor_matricula") == ctx.u.get("matricula"))
    avs = ctx.q("SELECT tipo, notas, pontos_fortes, desenvolver, comentario FROM perf_avaliacoes WHERE ciclo_id = ? AND avaliado = ? AND status = 'enviada'", cid, mat)
    pessoa = ctx.q1("SELECT cargo, nivel, skill, potencial FROM colaboradores WHERE matricula = ?", mat) or {}
    res = ia.gerar("Sintetize as avaliações (auto, gestor e pares) de um colaborador e proponha um PDI no modelo 70-20-10 com 2 ou 3 objetivos de desenvolvimento "
                   "concretos, ligados ao cargo, com prazo e indicador. Não exponha quem disse o quê.",
                   f"Cargo: {pessoa.get('cargo')} ({pessoa.get('nivel')})\nNota consolidada: {r['nota_calibrada'] or r['nota_final']} / 5; potencial: {r['potencial_calibrado'] or r['potencial']}\n"
                   f"Aspirações informadas: {ctx.campo('aspiracoes', False, '(não informadas)')}\nAvaliações:\n" + jd([{**a, "notas": jl(a["notas"], {})} for a in avs]),
                   ESQ_PDI, effort="medium")
    ctx.ex("UPDATE perf_resultados SET resumo_ia = ?, pdi = ? WHERE id = ?", jd({k: res[k] for k in ("sintese", "forcas", "oportunidades")}), jd(res["pdi"]), r["id"])
    ctx.con.commit()
    return res


# ------------------------------------------------------------------ feedback contínuo
@rota("POST", "/api/performance/feedbacks", INTERNOS)
def dar_feedback(ctx: Ctx):
    para = ctx.campo("para")
    ctx.exigir(ctx.q1("SELECT 1 FROM colaboradores WHERE matricula = ? AND status = 'ativo'", para) is not None, "Colaborador não encontrado.")
    ctx.exigir(para != ctx.u.get("matricula"), "Você não pode enviar feedback para si mesmo.")
    tipo = ctx.campo("tipo", False, "reconhecimento")
    if tipo not in ("reconhecimento", "desenvolvimento"):
        raise Erro(400, "Tipo inválido.")
    fid = ctx.ex("INSERT INTO perf_feedbacks (de_matricula, de_nome, para_matricula, tipo, texto, data) VALUES (?,?,?,?,?,?)",
                 ctx.u.get("matricula"), ctx.u["nome"], para, tipo, ctx.campo("texto"), agora())
    ctx.con.commit()
    return {"id": fid}


@rota("GET", "/api/performance/pessoas", INTERNOS)
def pessoas(ctx: Ctx):
    """Busca de colegas para feedback (nome, cargo e tribo apenas)."""
    termo = f"%{ctx.query.get('q', '').strip()}%"
    return ctx.q("SELECT matricula, nome, cargo, tribo FROM colaboradores WHERE status = 'ativo' AND (nome LIKE ? OR matricula LIKE ?) ORDER BY nome LIMIT 15", termo, termo)


@rota("GET", "/api/performance/meu-time", {"gestor", "rh", "bp"})
def meu_time(ctx: Ctx):
    m = ctx.u.get("matricula")
    time = ctx.q("""SELECT matricula, nome, cargo, nivel, desempenho, potencial, enps, risco_saida_12m, faixa_risco, tempo_casa_meses FROM colaboradores
                    WHERE status = 'ativo' AND gestor_matricula = ? ORDER BY nome""", m)
    return time


# ------------------------------------------------------------------ semente
def semear(con) -> None:
    if con.execute("SELECT 1 FROM perf_ciclos LIMIT 1").fetchone():
        return
    r = random.Random(5)
    c25 = con.execute("INSERT INTO perf_ciclos (nome, status, inicio, fim, criado_em) VALUES (?,?,?,?,?)", ("Avaliação 2025", "encerrado", "2025-10-01", "2025-12-15", agora())).lastrowid
    for p in con.execute("SELECT matricula, desempenho, potencial FROM colaboradores WHERE status = 'ativo' AND tempo_casa_meses >= 12").fetchall():
        con.execute("INSERT INTO perf_resultados (ciclo_id, matricula, nota_final, potencial, nota_calibrada, potencial_calibrado, calibrado) VALUES (?,?,?,?,?,?,1)",
                    (c25, p["matricula"], p["desempenho"], p["potencial"], p["desempenho"], p["potencial"]))
    c26 = con.execute("INSERT INTO perf_ciclos (nome, status, inicio, fim, criado_em) VALUES (?,?,?,?,?)", ("Avaliação 2026", "avaliacoes", "2026-10-01", "2026-12-15", agora())).lastrowid
    gerar_avaliacoes(con, c26)
    demo = {row["matricula"] for row in con.execute("SELECT matricula FROM usuarios WHERE demo = 1 AND matricula IS NOT NULL")}
    gestor_demo = con.execute("SELECT matricula FROM usuarios WHERE login = 'gestor'").fetchone()
    for a in con.execute("SELECT a.id, a.tipo, a.avaliado, a.avaliador, c.desempenho FROM perf_avaliacoes a JOIN colaboradores c ON c.matricula = a.avaliado WHERE a.ciclo_id = ?", (c26,)).fetchall():
        if a["avaliador"] in demo or (gestor_demo and a["avaliador"] == gestor_demo["matricula"]):
            continue  # deixa pendentes as avaliações das contas de demonstração
        if r.random() < (0.6 if a["tipo"] == "auto" else 0.4):
            base = a["desempenho"] + (0.4 if a["tipo"] == "auto" else 0)
            notas = {comp: max(1, min(5, round(base + r.uniform(-0.8, 0.8)))) for comp in COMPETENCIAS}
            con.execute("UPDATE perf_avaliacoes SET notas=?, resultado=?, potencial=?, status='enviada', atualizado_em=? WHERE id=?",
                        (jd(notas), round(sum(notas.values()) / len(notas), 2), r.randint(1, 3) if a["tipo"] == "gestor" else None, agora(), a["id"]))
    colab = con.execute("SELECT matricula, gestor_matricula FROM usuarios u JOIN colaboradores c USING (matricula) WHERE u.login = 'colaborador'").fetchone()
    if colab:
        g = con.execute("SELECT nome FROM colaboradores WHERE matricula = ?", (colab["gestor_matricula"],)).fetchone()
        for tipo, texto in [("reconhecimento", "Na migração do pipeline de dados da semana passada, você antecipou os riscos e documentou tudo — o time conseguiu fazer o deploy sem incidentes. Obrigado!"),
                            ("desenvolvimento", "Na apresentação para a diretoria, os números estavam certos, mas a mensagem principal só apareceu no fim. Começar pela conclusão vai deixar suas recomendações mais fortes.")]:
            con.execute("INSERT INTO perf_feedbacks (de_matricula, de_nome, para_matricula, tipo, texto, data) VALUES (?,?,?,?,?,?)",
                        (colab["gestor_matricula"], g["nome"] if g else "Gestor", colab["matricula"], tipo, texto, agora()))
    con.commit()
