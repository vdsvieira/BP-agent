"""Conectores de dados de pessoas.

Hoje todos rodam em modo "simulado" (dados do simulador). Para ligar uma fonte
oficial, implemente `extrair_real()` na classe correspondente devolvendo linhas no
esquema canônico de cada tabela (ver server/simulador.py) e mude o modo para
"real" em server/conectores.json. Credenciais vêm de variáveis de ambiente,
nunca do código.
"""
from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path

from . import banco, modelo, simulador

CONFIG = Path(__file__).resolve().parent / "conectores.json"


class Conector:
    id = ""
    nome = ""
    descricao = ""
    tabelas: tuple[str, ...] = ()
    integracao_real = ""  # como será a integração oficial
    variaveis = ()        # variáveis de ambiente esperadas no modo real

    def modo(self) -> str:
        try:
            cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            cfg = {}
        return cfg.get(self.id, {}).get("modo", "simulado")

    def extrair_real(self) -> dict[str, list[dict]]:
        faltando = [v for v in self.variaveis if not os.environ.get(v)]
        raise NotImplementedError(f"Integração real de '{self.nome}' ainda não implementada. {self.integracao_real}"
                                  + (f" Variáveis esperadas: {', '.join(faltando)}." if faltando else ""))

    def extrair(self, sim: dict) -> dict[str, list[dict]]:
        if self.modo() == "real":
            return self.extrair_real()
        return {t: sim[t] for t in self.tabelas}


class SAP(Conector):
    id, nome = "sap", "SAP HCM / SuccessFactors + CO"
    descricao = "Cadastro, hierarquia, cargos, remuneração, desempenho, orçamento de pessoal e competências"
    tabelas = ("diretorias", "colaboradores", "orcamento", "competencias")
    integracao_real = ("SuccessFactors via OData v2 (PerPerson, EmpJob, EmpCompensation, FormHeader) com OAuth2 SAML bearer; "
                       "SAP HCM on-premise via RFC (pyrfc: infotipos PA0001/PA0008/PA0041) ou réplica no HANA/BW (hdbcli); orçamento via CO/BPC.")
    variaveis = ("SAP_ODATA_URL", "SAP_CLIENT_ID", "SAP_PRIVATE_KEY_PATH")


class Movimentacoes(Conector):
    id, nome = "movimentacoes", "Sistema de movimentações"
    descricao = "Admissões, promoções, méritos, transferências e desligamentos"
    tabelas = ("movimentacoes",)
    integracao_real = "API REST ou leitura da base do workflow de movimentações (JDBC/ODBC), filtrando os últimos 24 meses."
    variaveis = ("MOV_API_URL", "MOV_API_TOKEN")


class ATS(Conector):
    id, nome = "ats", "ATS de vagas"
    descricao = "Requisições, etapas, SLA, candidatos e fontes"
    tabelas = ("vagas", "candidatos")
    integracao_real = "API do ATS (ex.: endpoints de jobs e applications) com token de serviço; mapear etapas para Aberta/Triagem/Entrevistas/Proposta/Admissão."
    variaveis = ("ATS_API_URL", "ATS_API_TOKEN")


class Clima(Conector):
    id, nome = "clima", "Pesquisa de clima e engajamento"
    descricao = "Favorabilidade por dimensão, tribo e ciclo; eNPS"
    tabelas = ("clima",)
    integracao_real = "Export agregado da plataforma de pesquisa (API ou CSV), respeitando o corte mínimo de respondentes por grupo (anonimato)."
    variaveis = ("CLIMA_API_URL", "CLIMA_API_TOKEN")


class DataLake(Conector):
    id, nome = "datalake", "Data lake de RH"
    descricao = "Ponto (absenteísmo, horas extras), licenças/afastamentos (eSocial S-2230) e séries históricas"
    tabelas = ("licencas", "series")
    integracao_real = "Consultas SQL no data lake (ex.: databricks-sql-connector ou pyodbc) sobre as camadas curadas (gold) de ponto, afastamentos e LMS."
    variaveis = ("DATALAKE_HOST", "DATALAKE_HTTP_PATH", "DATALAKE_TOKEN")


class Negocio(Conector):
    id, nome = "negocio", "Contexto de negócio (BI)"
    descricao = "Tribos, receita, custo, OKRs e NPS de cliente"
    tabelas = ("tribos",)
    integracao_real = "Base de BI/finanças com receita e custo por tribo e ferramenta de OKRs; chave de ligação = código da tribo."
    variaveis = ("BI_DSN",)


CONECTORES = [SAP(), Movimentacoes(), ATS(), Clima(), DataLake(), Negocio()]
POR_ID = {c.id: c for c in CONECTORES}


def _status(con) -> dict:
    return banco.kv_get(con, "status_conectores", {})


def sincronizar(con, ids: list[str] | None = None) -> dict:
    """Sincroniza os conectores pedidos (todos por padrão) e re-treina o modelo de risco."""
    banco.criar_auxiliares(con)
    sim = simulador.gerar()
    status = _status(con)
    alvo = [POR_ID[i] for i in ids] if ids else CONECTORES
    resultado = {}
    for c in alvo:
        try:
            dados = c.extrair(sim)
            linhas = {t: banco.gravar_tabela(con, t, rows, origem=f"conector:{c.id}") for t, rows in dados.items() if t != "colaboradores"}
            if "colaboradores" in dados:
                diretorias = [dict(r) for r in con.execute("SELECT * FROM diretorias")] if "diretorias" not in dados else dados["diretorias"]
                m = modelo.aplicar(dados["colaboradores"], diretorias)
                banco.kv_set(con, "modelo", m)
                linhas["colaboradores"] = banco.gravar_tabela(con, "colaboradores", dados["colaboradores"], origem=f"conector:{c.id}")
            status[c.id] = {"modo": c.modo(), "ultima_sincronizacao": dt.datetime.now().isoformat(timespec="seconds"), "linhas": linhas, "erro": None}
        except Exception as e:  # um conector com falha não derruba os demais
            status[c.id] = {**status.get(c.id, {}), "modo": c.modo(), "erro": str(e)}
        resultado[c.id] = status[c.id]
    banco.kv_set(con, "status_conectores", status)
    banco.kv_set(con, "meta", sim["meta"] if all(POR_ID[i].modo() == "simulado" for i in POR_ID) else {**sim["meta"], "fonte": "misto"})
    banco.criar_auxiliares(con)
    con.commit()
    return resultado


def retreinar(con) -> dict:
    cols = [dict(r) for r in con.execute("SELECT * FROM colaboradores")]
    dirs = [dict(r) for r in con.execute("SELECT * FROM diretorias")]
    m = modelo.aplicar(cols, dirs)
    banco.kv_set(con, "modelo", m)
    origem = (con.execute("SELECT origem FROM catalogo WHERE tabela='colaboradores'").fetchone() or ["upload"])[0]
    banco.gravar_tabela(con, "colaboradores", cols, origem=origem)
    banco.criar_auxiliares(con)
    con.commit()
    return m


def listar(con) -> list[dict]:
    st = _status(con)
    return [{"id": c.id, "nome": c.nome, "descricao": c.descricao, "tabelas": list(c.tabelas), "modo": c.modo(),
             "integracao_real": c.integracao_real, **st.get(c.id, {})} for c in CONECTORES]
