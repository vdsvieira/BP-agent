"""Agente Claude do Cockpit do BP — modos Analista, Materiais e Coach.

O agente enxerga toda a base de pessoas via SQL somente leitura (tabelas oficiais,
planilhas e documentos enviados), os insights calculados pelo cockpit e a caixa de
ferramentas do BP. Gráficos e materiais voltam estruturados para o cockpit renderizar.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import threading
from pathlib import Path

import anthropic

from . import banco

MODELO = "claude-opus-5-5"
RAIZ = Path(__file__).resolve().parent.parent
SAIDAS = Path(__file__).resolve().parent / "saidas"

BASE = """Você trabalha com um HR Business Partner ESTRATÉGICO do Bradesco, que atende várias diretorias (organizadas em tribos e squads).
Data de referência dos dados: {data_ref}. {aviso_base}

Dados disponíveis (use as ferramentas; nunca invente números):
- SQL somente leitura (SQLite) sobre todas as tabelas do catálogo: oficiais (colaboradores, hierarquia via gestor_matricula, vagas, candidatos,
  clima, licencas, movimentacoes, orcamento, series, competencias, tribos com receita/OKR/NPS de cliente) e tabelas x_* vindas de planilhas e documentos enviados.
  Views prontas: v_ativos, v_spans, v_indicadores_diretoria, v_tribos_pessoas_negocio, v_clima_atual. Consulte o esquema antes de escrever SQL.
- Insights calculados pelo cockpit (alertas que cruzam subsistemas) e documentos enviados pelo BP (PDFs, imagens, textos) com resumo e indicadores.

Princípios:
- Pense como BP estratégico: conecte pessoas a resultado de negócio (receita/FTE, OKR, NPS de cliente, custo), explique causa → efeito → impacto → decisão.
- Use indicadores modernos quando agregarem: regretted attrition, talent density, internal fill rate, spans & layers, manager effectiveness,
  burnout index, pay equity ajustado, HC ROI, exposição à IA generativa, segurança psicológica.
- Diga a confiança e as limitações (amostra pequena, correlação ≠ causalidade, base sintética).
- Formatação brasileira (R$ 1,2 mi; 12,5%). Responda em Markdown enxuto.
- Para gráficos, chame criar_grafico e insira o marcador [[grafico:ID]] no texto onde ele deve aparecer. No máximo 4 séries por gráfico; nunca eixo duplo.
- LGPD: pessoas só por matrícula; dados de saúde apenas agregados (nunca CID individual); grupos com menos de 5 pessoas não devem ser expostos.
  Scores de risco são probabilidades e nunca critério isolado para desligar, promover ou remunerar."""

MODOS = {
    "analista": """MODO ANALISTA. Faça análises cruzando quaisquer tabelas e o contexto que o BP trouxer. Planeje as consultas, execute,
valide os números (totais batem?), e entregue: 1) resposta direta, 2) evidências com números e gráfico quando ajudar, 3) "e daí?" para o negócio,
4) próximos passos recomendados. Se a pergunta for ambígua, assuma a interpretação mais útil e declare a premissa.""",
    "materiais": """MODO MATERIAIS EXECUTIVOS. Produza o material pedido (one-page, apresentação, memo, pauta, e-mail, business case, relatório),
pronto para diretoria, a partir da base completa. Estrutura: título; mensagem principal (3 linhas); seções com números verificados por SQL;
gráficos via criar_grafico + [[grafico:ID]]; recomendações/decisões solicitadas com dono e prazo; nota de fonte e data.
Para apresentações, use '## Slide N — título' em cada seção. Sempre chame salvar_material com o Markdown final.""",
    "coach": """MODO COACH DO BP. Você é um coach executivo e consultor de organização experiente. Ajude o BP a decidir e a aplicar a ferramenta
certa para o problema. Método: 1) entenda o problema e o objetivo (faça no máximo 2 perguntas de clarificação se faltar algo essencial);
2) traga evidências dos dados; 3) gere hipóteses de causa-raiz; 4) recomende 1–3 ferramentas da caixa (use ferramentas_bp) explicando por quê,
e alternativas descartadas; 5) monte o plano de aplicação (stakeholders, roteiro, perguntas, cronograma, riscos, como medir sucesso);
6) desafie vieses e proponha como o BP pode posicionar o tema com o diretor. Seja direto, humano e prático.""",
}


def _ferramentas_bp() -> list[dict]:
    texto = (RAIZ / "assets" / "js" / "ferramentas.js").read_text(encoding="utf-8")
    inicio = re.search(r"^window\.BP_FERRAMENTAS = ", texto, re.M).end()
    return json.loads(texto[inicio:].strip().rstrip(";"))


def _tool(nome: str, desc: str, props: dict) -> dict:
    return {"name": nome, "description": desc, "strict": True,
            "input_schema": {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}}


TOOLS = [
    _tool("catalogo_dados", "Lista tabelas e views disponíveis (origem, descrição, nº de linhas) e documentos enviados.", {}),
    _tool("esquema", "Colunas e tipos de uma tabela ou view (use '*' para todas).", {"tabela": {"type": "string"}}),
    _tool("consultar_sql", "Executa UMA consulta SELECT/WITH (SQLite) somente leitura. Até 200 linhas. Prefira agregar no SQL.",
          {"sql": {"type": "string"}, "objetivo": {"type": "string", "description": "O que esta consulta pretende responder"}}),
    _tool("insights_cockpit", "Alertas e KPIs calculados pelo cockpit (cruzam subsistemas). Área = id da diretoria ou 'todas'.", {"area": {"type": "string"}}),
    _tool("ler_documento", "Lê um documento enviado pelo BP (resumo, pontos-chave, indicadores, texto relevante, tabelas geradas).", {"documento_id": {"type": "integer"}}),
    _tool("ferramentas_bp", "Caixa de ferramentas do BP (skip level, team building, diagnóstico, redesign etc.). Sem termo, lista todas; com termo, detalha as que casarem.",
          {"termo": {"type": "string", "description": "Nome, categoria ou sinal; vazio para listar"}}),
    _tool("criar_grafico", "Cria um gráfico para o cockpit renderizar. Retorna o ID para usar como [[grafico:ID]].",
          {"titulo": {"type": "string"}, "tipo": {"type": "string", "enum": ["barra", "barra_horizontal", "linha", "dispersao"]},
           "rotulos": {"type": "array", "items": {"type": "string"}, "description": "Categorias do eixo (vazio para dispersão)"},
           "series": {"type": "array", "items": {"type": "object", "properties": {"nome": {"type": "string"}, "valores": {"type": "array", "items": {"type": "number"}},
                                                                                     "pontos": {"type": "array", "items": {"type": "object", "properties": {"x": {"type": "number"}, "y": {"type": "number"}, "rotulo": {"type": "string"}}, "required": ["x", "y", "rotulo"], "additionalProperties": False}}},
                                                  "required": ["nome", "valores", "pontos"], "additionalProperties": False}},
           "unidade": {"type": "string", "description": "Ex.: %, pessoas, R$ mil"}}),
    _tool("salvar_material", "Salva o material executivo final (Markdown, pode conter [[grafico:ID]]).", {"titulo": {"type": "string"}, "markdown": {"type": "string"}}),
]


class Sessao:
    def __init__(self, modo: str):
        self.modo = modo if modo in MODOS else "analista"
        self.mensagens: list = []
        self.lock = threading.Lock()


class Agente:
    def __init__(self, effort: str = "medium"):
        self.cliente = anthropic.Anthropic()
        self.effort = effort
        self.sessoes: dict[str, Sessao] = {}

    def _system(self, modo: str) -> str:
        con = banco.conectar()
        try:
            meta = banco.kv_get(con, "meta", {})
        finally:
            con.close()
        aviso = "ATENÇÃO: base SINTÉTICA de demonstração — mencione isso uma vez em materiais." if meta.get("fonte") == "simulador" else ""
        return BASE.format(data_ref=meta.get("data_referencia", "?"), aviso_base=aviso) + "\n\n" + MODOS[modo]

    def _executar(self, nome: str, e: dict, saida: dict) -> object:
        con = banco.conectar()
        try:
            if nome == "catalogo_dados":
                docs = [dict(r) for r in con.execute("SELECT id, nome, tipo_documento, resumo, tabelas_geradas, enviado_em FROM documentos ORDER BY id DESC LIMIT 50")]
                return {"tabelas": banco.tabelas(con), "views": list(banco.VIEWS), "documentos": docs}
            if nome == "esquema":
                return banco.esquema(con, None if e["tabela"] in ("", "*") else e["tabela"])
            if nome == "consultar_sql":
                return banco.consultar(e["sql"])
            if nome == "insights_cockpit":
                snap = banco.kv_get(con, "snapshot_cockpit") or {}
                ins = snap.get("insights", [])
                if e["area"] not in ("", "todas"):
                    ins = [i for i in ins if i.get("area_id") == e["area"] or i.get("area") == e["area"]]
                return {"insights": ins[:40], "kpis": (snap.get("kpis") or {}).get(e["area"] or "todas"), "atualizado_em": snap.get("gerado_em")} if snap else \
                    {"aviso": "O cockpit ainda não enviou insights. Abra o cockpit no navegador com o servidor ligado."}
            if nome == "ler_documento":
                r = con.execute("SELECT * FROM documentos WHERE id = ?", (e["documento_id"],)).fetchone()
                if not r:
                    raise ValueError("Documento inexistente.")
                d = dict(r)
                d["extraido_json"] = json.loads(d["extraido_json"] or "{}")
                return d
            if nome == "ferramentas_bp":
                fs = _ferramentas_bp()
                t = e["termo"].strip().lower()
                if not t:
                    return [{"id": f["id"], "nome": f["nome"], "categoria": f["categoria"], "quando_usar": f["quando_usar"]} for f in fs]
                achou = [f for f in fs if t in json.dumps(f, ensure_ascii=False).lower()]
                return achou[:4] or {"aviso": "Nenhuma ferramenta encontrada; liste sem termo."}
            if nome == "criar_grafico":
                gid = f"g{len(saida['graficos']) + 1}"
                saida["graficos"].append({"id": gid, **e})
                return {"id": gid, "uso": f"[[grafico:{gid}]]"}
            if nome == "salvar_material":
                SAIDAS.mkdir(exist_ok=True)
                slug = re.sub(r"[^a-z0-9]+", "-", e["titulo"].lower()).strip("-")[:60] or "material"
                caminho = SAIDAS / f"{dt.date.today():%Y-%m-%d}-{slug}.md"
                caminho.write_text(f"# {e['titulo']}\n\n{e['markdown']}\n", encoding="utf-8")
                saida["materiais"].append({"titulo": e["titulo"], "markdown": e["markdown"], "arquivo": str(caminho.relative_to(RAIZ))})
                return {"salvo_em": str(caminho.relative_to(RAIZ))}
            raise ValueError(f"Ferramenta desconhecida: {nome}")
        finally:
            con.close()

    def conversar(self, sessao_id: str, modo: str, texto: str, contexto: str = "", max_iter: int = 16) -> dict:
        s = self.sessoes.setdefault(f"{sessao_id}:{modo}", Sessao(modo))
        saida = {"graficos": [], "materiais": []}
        with s.lock:
            s.mensagens.append({"role": "user", "content": (f"[Contexto do cockpit: {contexto}]\n" if contexto else "") + texto})
            for _ in range(max_iter):
                resp = self.cliente.beta.messages.create(
                    model=MODELO, max_tokens=16000, system=self._system(s.modo), tools=TOOLS,
                    thinking={"type": "adaptive"}, output_config={"effort": self.effort}, cache_control={"type": "ephemeral"},
                    betas=["server-side-fallback-2026-07-01"], fallbacks="default", messages=s.mensagens,
                )
                s.mensagens.append({"role": "assistant", "content": resp.content})  # histórico append-only
                if resp.stop_reason == "refusal":
                    return {**saida, "resposta": "O modelo recusou esta solicitação. Reformule com foco em gestão de pessoas."}
                if resp.stop_reason == "pause_turn":
                    continue
                if resp.stop_reason != "tool_use":
                    txt = "".join(b.text for b in resp.content if b.type == "text").strip()
                    if resp.stop_reason == "max_tokens":
                        txt += "\n\n_[Resposta truncada pelo limite de tokens.]_"
                    return {**saida, "resposta": txt}
                resultados = []
                for b in resp.content:
                    if b.type != "tool_use":
                        continue
                    try:
                        r = self._executar(b.name, b.input, saida)
                        resultados.append({"type": "tool_result", "tool_use_id": b.id, "content": json.dumps(r, ensure_ascii=False, default=str)[:60000]})
                    except Exception as ex:  # o modelo vê o erro e corrige (ex.: SQL inválido)
                        resultados.append({"type": "tool_result", "tool_use_id": b.id, "content": f"Erro: {ex}", "is_error": True})
                s.mensagens.append({"role": "user", "content": resultados})
        return {**saida, "resposta": "Limite de etapas atingido sem resposta final. Tente dividir o pedido."}


ROTINAS = {
    "briefing": ("analista", "Prepare o briefing semanal do BP: mensagem principal, 5 alertas mais críticos com dono e prazo, talentos em risco por diretoria, "
                             "vagas mais atrasadas, orçamento e um tema de negócio × pessoas para levar aos diretores. Salve como 'Briefing semanal do BP' usando salvar_material."),
    "pautas": ("materiais", "Monte a pauta da reunião mensal com cada diretor atendido (uma seção por diretoria) com indicadores, decisões solicitadas e perguntas prováveis."),
    "retencao": ("materiais", "Plano de retenção de talentos: talentos em risco alto por diretoria agrupados por fator predominante, ações e custo estimado."),
    "org-health": ("analista", "Avalie a saúde organizacional de cada diretoria (spans & layers, manager effectiveness, clima, burnout, talent density, pessoas × negócio) "
                               "e salve um relatório 'Org Health trimestral' com salvar_material."),
}
