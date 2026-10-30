"""Armazenamento local (SQLite) da base de pessoas.

Todas as fontes — conectores, simulador e arquivos enviados — viram tabelas aqui.
O agente consulta via SQL somente leitura; o cockpit recebe a base montada.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sqlite3
import unicodedata
from pathlib import Path

ARQUIVO = Path(__file__).resolve().parent / "dados" / "bp.db"

VIEWS = {
    "v_ativos": "SELECT * FROM colaboradores WHERE status = 'ativo'",
    "v_spans": """
        SELECT g.matricula AS gestor, g.nivel AS nivel_gestor, g.diretoria, g.tribo, g.camada,
               COUNT(c.matricula) AS span, ROUND(AVG(c.enps), 2) AS enps_medio_time,
               ROUND(AVG(c.risco_saida_12m), 3) AS risco_medio_time, SUM(c.desempenho >= 4) AS altos_desempenhos
        FROM colaboradores g JOIN colaboradores c ON c.gestor_matricula = g.matricula AND c.status = 'ativo'
        WHERE g.status = 'ativo' GROUP BY g.matricula""",
    "v_indicadores_diretoria": """
        SELECT d.id AS diretoria, d.nome, d.vice_presidencia,
          SUM(c.status = 'ativo') AS headcount,
          SUM(c.status = 'desligado') AS desligamentos_12m,
          SUM(c.status = 'desligado' AND c.tipo_desligamento = 'Voluntário') AS deslig_voluntarios_12m,
          SUM(c.regretted) AS deslig_regretted_12m,
          ROUND(1.0 * SUM(c.status = 'desligado') / (SUM(c.status = 'ativo') + SUM(c.status = 'desligado') / 2.0), 4) AS turnover_12m,
          ROUND(100.0 * (SUM(c.status = 'ativo' AND c.enps >= 9) - SUM(c.status = 'ativo' AND c.enps <= 6)) / SUM(c.status = 'ativo'), 1) AS enps,
          ROUND(AVG(CASE WHEN c.status = 'ativo' THEN c.risco_saida_12m END), 4) AS risco_medio,
          SUM(c.faixa_risco = 'Alto') AS pessoas_risco_alto,
          ROUND(AVG(CASE WHEN c.status = 'ativo' THEN c.he_mes END), 1) AS he_media_mes,
          ROUND(AVG(CASE WHEN c.status = 'ativo' THEN c.absenteismo_dias END), 1) AS absenteismo_medio_dias,
          ROUND(AVG(CASE WHEN c.status = 'ativo' THEN c.compa_ratio END), 3) AS compa_ratio_medio,
          SUM(c.status = 'ativo' AND c.ferias_vencidas > 0) AS ferias_vencidas,
          SUM(c.status = 'ativo' AND c.treinamentos_pendentes <> '') AS pendencias_regulatorias,
          ROUND(1.0 * SUM(c.status = 'ativo' AND c.lider = 1 AND c.genero = 'F') / NULLIF(SUM(c.status = 'ativo' AND c.lider = 1), 0), 3) AS mulheres_lideranca,
          ROUND(AVG(CASE WHEN c.status = 'ativo' THEN c.exposicao_ia END), 3) AS exposicao_ia_media
        FROM diretorias d JOIN colaboradores c ON c.diretoria = d.id GROUP BY d.id""",
    "v_tribos_pessoas_negocio": """
        SELECT t.id AS tribo, t.nome, t.diretoria, t.receita_12m_mi, t.custo_operacional_12m_mi, t.okr_atingimento, t.nps_cliente,
          COUNT(c.matricula) AS headcount, ROUND(AVG(c.enps), 2) AS enps_medio, ROUND(AVG(c.risco_saida_12m), 3) AS risco_medio,
          ROUND(AVG(c.he_mes), 1) AS he_media, ROUND(AVG(c.absenteismo_dias), 1) AS absenteismo_medio,
          ROUND(t.receita_12m_mi * 1e6 / COUNT(c.matricula)) AS receita_por_fte
        FROM tribos t LEFT JOIN colaboradores c ON c.tribo = t.id AND c.status = 'ativo' GROUP BY t.id""",
    "v_clima_atual": "SELECT * FROM clima WHERE ciclo = (SELECT MAX(ciclo) FROM clima)",
}

DESCRICOES = {
    "diretorias": "Diretorias atendidas pelo BP, vice-presidência e premissas de mercado/crescimento/automação",
    "tribos": "Tribos (modelo ágil) com contexto de negócio: receita, custo, OKR, NPS de cliente",
    "colaboradores": "Uma linha por pessoa (ativos e desligados nos últimos 12 meses): hierarquia, remuneração, desempenho, clima, jornada, risco de saída",
    "movimentacoes": "Admissões, promoções, méritos, transferências e desligamentos dos últimos 12 meses",
    "vagas": "Requisições abertas no ATS",
    "candidatos": "Candidatos por vaga, fonte e etapa",
    "clima": "Pesquisa de clima: favorabilidade por tribo, dimensão e ciclo",
    "licencas": "Licenças e afastamentos (maternidade, paternidade, INSS) com grupo de CID agregado",
    "orcamento": "Orçamento de pessoal mensal por diretoria (mes = -1: verba de treinamento)",
    "series": "Séries mensais por diretoria: HC, admissões, desligamentos, absenteísmo, HE",
    "competencias": "Competências críticas: oferta interna × demanda",
}


def conectar(somente_leitura: bool = False) -> sqlite3.Connection:
    ARQUIVO.parent.mkdir(exist_ok=True)
    if somente_leitura:
        con = sqlite3.connect(f"file:{ARQUIVO}?mode=ro", uri=True, check_same_thread=False)
    else:
        con = sqlite3.connect(ARQUIVO, check_same_thread=False, timeout=30)
        con.execute("PRAGMA journal_mode=WAL")  # leituras não bloqueiam escritas (várias pessoas usando ao mesmo tempo)
    con.row_factory = sqlite3.Row
    return con


def _tipo(v) -> str:
    if isinstance(v, bool) or isinstance(v, int):
        return "INTEGER"
    if isinstance(v, float):
        return "REAL"
    return "TEXT"


def nome_tabela_seguro(nome: str) -> str:
    n = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode().lower()
    n = re.sub(r"[^a-z0-9_]+", "_", n).strip("_")
    return n if re.match(r"^[a-z]", n or "") else "t_" + (n or "dados")


def gravar_tabela(con: sqlite3.Connection, nome: str, linhas: list[dict], origem: str, descricao: str | None = None) -> int:
    """Substitui a tabela inteira pelas linhas recebidas e registra no catálogo."""
    nome = nome_tabela_seguro(nome)
    colunas: dict[str, str | None] = {}  # chave original -> tipo SQLite (primeiro valor não nulo decide)
    for linha in linhas:
        for k, v in linha.items():
            if colunas.get(k) is None:
                colunas[k] = _tipo(v) if v is not None else None
    chaves = list(colunas)
    nomes_col = [k if re.match(r"^[a-z_][a-z0-9_]*$", k) else nome_tabela_seguro(k) for k in chaves]
    con.execute(f'DROP TABLE IF EXISTS "{nome}"')
    con.execute(f'CREATE TABLE "{nome}" (' + ", ".join(f'"{c}" {colunas[k] or "TEXT"}' for c, k in zip(nomes_col, chaves)) + ")")
    if linhas:
        con.executemany(f'INSERT INTO "{nome}" VALUES (' + ",".join("?" * len(chaves)) + ")",
                        [tuple(json.dumps(l.get(k), ensure_ascii=False) if isinstance(l.get(k), (list, dict)) else l.get(k) for k in chaves) for l in linhas])
    registrar_catalogo(con, nome, origem, descricao or DESCRICOES.get(nome, ""), len(linhas))
    return len(linhas)


def registrar_catalogo(con, tabela: str, origem: str, descricao: str, linhas: int) -> None:
    con.execute("CREATE TABLE IF NOT EXISTS catalogo (tabela TEXT PRIMARY KEY, origem TEXT, descricao TEXT, linhas INTEGER, atualizado_em TEXT)")
    con.execute("INSERT OR REPLACE INTO catalogo VALUES (?,?,?,?,?)", (tabela, origem, descricao, linhas, dt.datetime.now().isoformat(timespec="seconds")))


def criar_auxiliares(con: sqlite3.Connection) -> None:
    con.execute("CREATE TABLE IF NOT EXISTS kv (chave TEXT PRIMARY KEY, valor TEXT)")
    con.execute("""CREATE TABLE IF NOT EXISTS documentos (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, tipo_arquivo TEXT, tipo_documento TEXT,
                   resumo TEXT, pontos_chave TEXT, extraido_json TEXT, tabelas_geradas TEXT, enviado_em TEXT)""")
    for v, sql in VIEWS.items():
        try:
            con.execute(f"DROP VIEW IF EXISTS {v}")
            con.execute(f"CREATE VIEW {v} AS {sql}")
        except sqlite3.OperationalError:
            pass  # tabela-base ainda não carregada


def kv_set(con, chave: str, valor) -> None:
    con.execute("INSERT OR REPLACE INTO kv VALUES (?, ?)", (chave, json.dumps(valor, ensure_ascii=False)))


def kv_get(con, chave: str, padrao=None):
    try:
        r = con.execute("SELECT valor FROM kv WHERE chave = ?", (chave,)).fetchone()
    except sqlite3.OperationalError:
        return padrao
    return json.loads(r[0]) if r else padrao


def tabelas(con) -> list[dict]:
    try:
        return [dict(r) for r in con.execute("SELECT * FROM catalogo ORDER BY tabela")]
    except sqlite3.OperationalError:
        return []


def esquema(con, tabela: str | None = None) -> list[dict]:
    nomes = [tabela] if tabela else [r["tabela"] for r in tabelas(con)] + list(VIEWS)
    out = []
    for n in nomes:
        cols = [(r[1], r[2]) for r in con.execute(f'PRAGMA table_info("{nome_tabela_seguro(n)}")')]
        if cols:
            out.append({"tabela": n, "colunas": [f"{c} {t}".strip() for c, t in cols]})
    return out


def consultar(sql: str, limite: int = 200) -> dict:
    """SQL somente leitura (SELECT/WITH), com limite de linhas e de tempo."""
    texto = sql.strip().rstrip(";")
    if not re.match(r"(?is)^\s*(select|with)\b", texto) or ";" in texto:
        raise ValueError("Apenas uma consulta SELECT/WITH é permitida.")
    con = conectar(somente_leitura=True)
    passos = [0]

    def vigia():
        passos[0] += 1
        return 1 if passos[0] > 2000 else 0  # ~20 mi de instruções da VM

    con.set_progress_handler(vigia, 10000)
    try:
        cur = con.execute(texto)
        colunas = [d[0] for d in cur.description]
        linhas = cur.fetchmany(limite + 1)
    finally:
        con.close()
    return {"colunas": colunas, "linhas": [list(r) for r in linhas[:limite]], "truncado": len(linhas) > limite}


# ------------------------------------------------------- base para o cockpit (JS)
def _b(v):
    return None if v is None else bool(v)


def montar_base_front(con) -> dict:
    q = lambda sql: [dict(r) for r in con.execute(sql)]  # noqa: E731
    meta = kv_get(con, "meta", {})
    dirs = q("SELECT * FROM diretorias")
    hc = {r["diretoria"]: r["n"] for r in q("SELECT diretoria, COUNT(*) n FROM colaboradores WHERE status='ativo' GROUP BY diretoria")}
    areas = [{"id": d["id"], "nome": d["nome"], "diretor": d["vice_presidencia"], "vp": d["vice_presidencia"], "diretorMatricula": d.get("diretor_matricula"),
              "hc": hc.get(d["id"], 0), "aquecimento": d["aquecimento_mercado"], "crescimento": d["crescimento_planejado"],
              "automacao": d["automacao_planejada"], "salarioBase": d["salario_base"]} for d in dirs]

    def pessoa(c):
        return {
            "matricula": c["matricula"], "nome": c["nome"], "genero": c["genero"], "raca": c["raca"], "pcd": _b(c["pcd"]), "idade": c["idade"],
            "area": c["diretoria"], "tribo": c["tribo"], "squad": c["squad"], "cargo": c["cargo"], "nivel": c["nivel"], "camada": c["camada"],
            "lider": _b(c["lider"]), "gestor": c["gestor_matricula"], "uf": c["uf"], "modelo": c["modelo_trabalho"], "dataAdmissao": c["data_admissao"],
            "tempoCasaMeses": c["tempo_casa_meses"], "fonteContratacao": c["fonte_contratacao"], "salario": c["salario"], "compaRatio": c["compa_ratio"],
            "mesesSemAumento": c["meses_sem_aumento"], "mesesSemPromocao": c["meses_sem_promocao"], "promovido12m": _b(c["promovido_12m"]),
            "transferido12m": _b(c["transferido_12m"]), "desempenho": c["desempenho"], "potencial": c["potencial"], "enps": c["enps"],
            "heMes": c["he_mes"], "absenteismo": c["absenteismo_dias"], "feriasVencidas": c["ferias_vencidas"], "trocaGestor12m": _b(c["troca_gestor_12m"]),
            "treinamentosPendentes": [t for t in (c["treinamentos_pendentes"] or "").split("|") if t], "horasTreinamento": c["horas_treinamento_12m"],
            "posicaoChave": _b(c["posicao_chave"]), "sucessorPronto": _b(c["sucessor_pronto"]), "skill": c["skill"], "exposicaoIA": c["exposicao_ia"],
            "status": c["status"], "tipoDesligamento": c["tipo_desligamento"], "motivoDesligamento": c["motivo_desligamento"],
            "mesDesligamento": c["mes_desligamento"], "regretted": _b(c["regretted"]),
        }

    cols = q("SELECT * FROM colaboradores")
    orc: dict = {}
    for o in q("SELECT * FROM orcamento ORDER BY diretoria, mes"):
        a = orc.setdefault(o["diretoria"], {"hcPlano": o["hc_plano"], "meses": [], "treinamento": {"orcado": 0, "realizado": 0}})
        if o["mes"] == -1:
            a["treinamento"] = {"orcado": o["orcado"], "realizado": o["realizado"]}
        else:
            a["meses"].append({"mes": o["mes"], "orcado": o["orcado"], "realizado": o["realizado"], "heCusto": o["he_custo"]})
    series: dict = {}
    for s in q("SELECT * FROM series ORDER BY diretoria, mes_idx"):
        series.setdefault(s["diretoria"], []).append({"label": s["label"], "hc": s["hc"], "admissoes": s["admissoes"], "desligVol": s["deslig_vol"],
                                                      "desligInv": s["deslig_inv"], "absenteismo": s["absenteismo_pct"], "he": s["he_media"]})
    return {
        "geradoEm": meta.get("data_referencia"), "dataReferencia": meta.get("data_referencia"), "sintetico": meta.get("fonte") == "simulador",
        "fontes": kv_get(con, "status_conectores", {}), "meses": meta.get("meses", []), "areas": areas,
        "colaboradores": [pessoa(c) for c in cols if c["status"] == "ativo"],
        "desligados": [pessoa(c) for c in cols if c["status"] == "desligado"],
        "vagas": [{"id": v["id"], "area": v["diretoria"], "tribo": v["tribo"], "cargo": v["cargo"], "nivel": v["nivel"], "motivo": v["motivo"], "abertura": v["abertura"],
                   "diasAberta": v["dias_aberta"], "sla": v["sla"], "etapa": v["etapa"], "candidatos": v["candidatos"], "recrutador": v["recrutador"],
                   "orcada": _b(v["orcada"]), "salarioPrevisto": v["salario_previsto"], "prioridade": v["prioridade"], "diversidade": _b(v["afirmativa"])}
                  for v in q("SELECT * FROM vagas")],
        "candidatos": [{"vaga": c["vaga_id"], "fonte": c["fonte"], "etapa": c["etapa"], "diverso": _b(c["diverso"])} for c in q("SELECT * FROM candidatos")],
        "orcamento": orc, "series": series,
        "competencias": [{"area": c["diretoria"], "skill": c["skill"], "oferta": c["oferta"], "demanda": c["demanda"]} for c in q("SELECT * FROM competencias")],
        "tribos": [{"id": t["id"], "nome": t["nome"], "area": t["diretoria"], "missao": t["missao"], "receita": t["receita_12m_mi"], "custo": t["custo_operacional_12m_mi"],
                    "okr": t["okr_atingimento"], "npsCliente": t["nps_cliente"], "squads": t["squads"]} for t in q("SELECT * FROM tribos")],
        "clima": [{"tribo": c["tribo"], "area": c["diretoria"], "ciclo": c["ciclo"], "dimensao": c["dimensao"], "fav": c["favorabilidade"], "respondentes": c["respondentes"]} for c in q("SELECT * FROM clima")],
        "licencas": [{"matricula": l["matricula"], "area": l["diretoria"], "tribo": l["tribo"], "tipo": l["tipo"], "grupo": l["grupo_cid"], "dias": l["dias"], "inicio": l["inicio"]} for l in q("SELECT * FROM licencas")],
        "movimentacoes": [{"matricula": m["matricula"], "data": m["data"], "tipo": m["tipo"], "area": m["diretoria"], "detalhe": m["detalhe"]} for m in q("SELECT * FROM movimentacoes")],
        "modelo": kv_get(con, "modelo"),
    }
