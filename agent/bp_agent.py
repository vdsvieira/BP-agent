#!/usr/bin/env python3
"""Agente Claude do Cockpit do BP.

Lê o snapshot exportado pelo cockpit (Dados & integrações → Exportar
snapshot.json) e responde perguntas, produz materiais executivos e roda
rotinas, sempre consultando os números por ferramentas.

Modos:
  python agent/bp_agent.py                         # chat no terminal
  python agent/bp_agent.py --pergunta "..."        # pergunta única
  python agent/bp_agent.py --rotina briefing       # rotina agendável (salva em agent/saidas/)
  python agent/bp_agent.py --serve                 # API local p/ o Copiloto do cockpit
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import anthropic

MODELO = "claude-opus-5-5"
AQUI = Path(__file__).resolve().parent
SAIDAS = AQUI / "saidas"

SYSTEM = """Você é o copiloto de um HR Business Partner (HRBP) de um grande banco brasileiro.
O BP atende várias diretorias e precisa de telemetria, people analytics, orçamento de pessoal,
vagas, planejamento de força de trabalho (WFP) e dos subsistemas de RH interligados.

Como trabalhar:
- Todo número vem das ferramentas. Consulte-as antes de afirmar qualquer indicador; nunca estime de cabeça.
  Se o dado não existe no snapshot, diga isso e sugira onde obtê-lo.
- Conecte os subsistemas: explique causas e efeitos (ex.: HE alta → absenteísmo → risco de saída → custo de reposição).
- Seja executivo: comece pela mensagem principal, depois evidências, depois recomendação com dono e prazo.
- Formatação brasileira: R$ 1,2 mi, 12,5%, datas dd/mm/aaaa.
- LGPD: refira-se a pessoas só por matrícula. Scores de risco são probabilidades estatísticas e nunca
  devem ser usados como critério isolado de desligamento, promoção ou remuneração — lembre isso quando relevante.
- Legislação/contexto: data-base dos bancários em setembro; férias fora do período concessivo são pagas em
  dobro (art. 137 CLT); treinamentos regulatórios (PLD/FT, LGPD) são auditáveis.
- Quando pedirem um material (one-page, pauta, business case, e-mail), entregue o texto pronto e salve-o com
  a ferramenta salvar_material.
- Se o snapshot for de base sintética, mencione isso uma vez ao entregar materiais."""


# --------------------------------------------------------------------------- dados
class Snapshot:
    def __init__(self, caminho: Path):
        self.caminho = caminho
        self.lock = threading.Lock()
        self.dados = json.loads(caminho.read_text(encoding="utf-8"))

    def atualizar(self, dados: dict) -> None:
        with self.lock:
            self.dados = dados
            self.caminho = AQUI / "snapshot.json"  # nunca sobrescreve o exemplo versionado
            self.caminho.write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")

    def area(self, area_id: str) -> dict:
        if area_id in ("", "todas"):
            return {"id": "todas", "nome": "Todas as áreas", "indicadores": self.dados["consolidado"]}
        for a in self.dados["areas"]:
            if area_id.lower() in (a["id"].lower(), a["nome"].lower()):
                return a
        ids = ", ".join(a["id"] for a in self.dados["areas"])
        raise ValueError(f"Área '{area_id}' não encontrada. Use 'todas' ou um destes ids: {ids}")


def _filtra_area(itens: list[dict], area: dict, campo: str = "area") -> list[dict]:
    if area["id"] == "todas":
        return itens
    return [i for i in itens if i.get(campo) in (area["id"], area["nome"])]


# ---------------------------------------------------------------------- ferramentas
def _tool(nome: str, descricao: str, props: dict) -> dict:
    return {
        "name": nome,
        "description": descricao,
        "strict": True,
        "input_schema": {"type": "object", "properties": props, "required": list(props), "additionalProperties": False},
    }


AREA = {"type": "string", "description": "Id da área (ex.: 'tecnologia') ou 'todas' para o consolidado."}
TOOLS = [
    _tool("listar_areas", "Lista as áreas atendidas pelo BP com headcount, turnover e alertas críticos, e os metadados do snapshot.", {}),
    _tool("indicadores", "Indicadores de uma área: headcount, turnover real e previsto, eNPS, absenteísmo, HE, compa-ratio, vagas, treinamentos, férias, sucessão, diversidade e orçamento.",
          {"area": AREA, "incluir_serie_mensal": {"type": "boolean", "description": "Inclui a série dos últimos 12 meses."}}),
    _tool("insights", "Alertas que cruzam subsistemas de RH, com severidade, ação recomendada, exposição financeira e playbook.",
          {"area": AREA, "severidade": {"type": "string", "enum": ["todos", "critico", "atencao", "oportunidade"]}}),
    _tool("colaboradores_em_risco", "Colaboradores com risco médio/alto de saída voluntária em 12 meses (modelo preditivo), com fatores explicativos.",
          {"area": AREA, "apenas_talentos": {"type": "boolean"}, "limite": {"type": "integer", "description": "Máximo de registros (1-50)."}}),
    _tool("vagas", "Requisições de vagas abertas com etapa, dias em aberto, SLA, prioridade e se estão orçadas.",
          {"area": AREA, "apenas_fora_sla": {"type": "boolean"}}),
    _tool("wfp_e_competencias", "Planejamento de força de trabalho (oferta x demanda em 12 meses, contratações, custo) e gaps de competências críticas.", {"area": AREA}),
    _tool("modelo_preditivo", "Ficha técnica do modelo de risco de saída: AUC, registros, taxa base e pesos de cada fator.", {}),
    _tool("tarefas", "Tarefas operacionais em andamento no cockpit (playbooks de automação) com status e prazo.", {}),
    _tool("salvar_material", "Salva um material executivo em Markdown na pasta agent/saidas e devolve o caminho.",
          {"titulo": {"type": "string"}, "conteudo_markdown": {"type": "string"}}),
]


def executar_ferramenta(snap: Snapshot, nome: str, entrada: dict) -> object:
    d = snap.dados
    if nome == "listar_areas":
        crit = {}
        for i in d["insights"]:
            if i["severidade"] == "critico":
                crit[i["area"]] = crit.get(i["area"], 0) + 1
        return {
            "meta": {k: v for k, v in d["meta"].items() if k != "modelo_preditivo"},
            "areas": [{"id": a["id"], "nome": a["nome"], "diretoria": a["diretoria"], "headcount": a["indicadores"]["headcount"],
                       "turnover_12m": a["indicadores"]["turnover_12m"], "alertas_criticos": crit.get(a["nome"], 0)} for a in d["areas"]],
        }
    if nome == "indicadores":
        a = snap.area(entrada["area"])
        ind = dict(a["indicadores"])
        if not entrada.get("incluir_serie_mensal"):
            ind.pop("serie_mensal", None)
        out = {"area": a["nome"], "indicadores": ind}
        for k in ("premissas", "wfp"):
            if k in a:
                out[k] = a[k]
        return out
    if nome == "insights":
        a = snap.area(entrada["area"])
        itens = _filtra_area(d["insights"], a)
        if entrada["severidade"] != "todos":
            itens = [i for i in itens if i["severidade"] == entrada["severidade"]]
        return itens
    if nome == "colaboradores_em_risco":
        a = snap.area(entrada["area"])
        itens = _filtra_area(d["colaboradores_risco"], a)
        if entrada["apenas_talentos"]:
            itens = [c for c in itens if c["talento"]]
        limite = max(1, min(50, entrada["limite"]))
        return {"total": len(itens), "colaboradores": [{k: v for k, v in c.items() if k != "nome"} for c in itens[:limite]]}
    if nome == "vagas":
        a = snap.area(entrada["area"])
        itens = _filtra_area(d["vagas"], a)
        if entrada["apenas_fora_sla"]:
            itens = [v for v in itens if v["fora_sla"]]
        return {"total": len(itens), "vagas": sorted(itens, key=lambda v: v["dias_aberta"] - v["sla"], reverse=True)[:60]}
    if nome == "wfp_e_competencias":
        a = snap.area(entrada["area"])
        areas = d["areas"] if a["id"] == "todas" else [a]
        return {"wfp": [{"area": x["nome"], **x["wfp"], "premissas": x["premissas"]} for x in areas],
                "competencias": _filtra_area(d["competencias"], a)}
    if nome == "modelo_preditivo":
        return d["meta"]["modelo_preditivo"]
    if nome == "tarefas":
        return d.get("tarefas", [])
    if nome == "salvar_material":
        SAIDAS.mkdir(exist_ok=True)
        slug = re.sub(r"[^a-z0-9]+", "-", entrada["titulo"].lower()).strip("-")[:60] or "material"
        caminho = SAIDAS / f"{dt.date.today():%Y-%m-%d}-{slug}.md"
        caminho.write_text(f"# {entrada['titulo']}\n\n{entrada['conteudo_markdown']}\n", encoding="utf-8")
        return {"salvo_em": str(caminho)}
    raise ValueError(f"Ferramenta desconhecida: {nome}")


# --------------------------------------------------------------------------- agente
class Conversa:
    """Loop agêntico com histórico append-only (o conteúdo da resposta é reenviado intacto)."""

    def __init__(self, cliente: anthropic.Anthropic, snap: Snapshot, effort: str = "medium"):
        self.cliente = cliente
        self.snap = snap
        self.effort = effort
        self.mensagens: list = []
        self.lock = threading.Lock()

    def perguntar(self, texto: str, max_iteracoes: int = 12) -> str:
        with self.lock:
            self.mensagens.append({"role": "user", "content": texto})
            for _ in range(max_iteracoes):
                resp = self.cliente.beta.messages.create(
                    model=MODELO,
                    max_tokens=16000,
                    system=SYSTEM,
                    tools=TOOLS,
                    thinking={"type": "adaptive"},
                    output_config={"effort": self.effort},
                    cache_control={"type": "ephemeral"},
                    betas=["server-side-fallback-2026-07-01"],
                    fallbacks="default",
                    messages=self.mensagens,
                )
                self.mensagens.append({"role": "assistant", "content": resp.content})

                if resp.stop_reason == "refusal":
                    return "O modelo recusou esta solicitação. Reformule o pedido com foco em gestão de pessoas."
                if resp.stop_reason == "pause_turn":
                    continue
                if resp.stop_reason != "tool_use":
                    texto_final = "".join(b.text for b in resp.content if b.type == "text").strip()
                    if resp.stop_reason == "max_tokens":
                        texto_final += "\n\n[Resposta truncada pelo limite de tokens.]"
                    return texto_final

                resultados = []
                for bloco in resp.content:
                    if bloco.type != "tool_use":
                        continue
                    try:
                        saida = executar_ferramenta(self.snap, bloco.name, bloco.input)
                        resultados.append({"type": "tool_result", "tool_use_id": bloco.id,
                                           "content": json.dumps(saida, ensure_ascii=False)})
                    except Exception as e:  # erro devolvido ao modelo para que ele corrija a chamada
                        resultados.append({"type": "tool_result", "tool_use_id": bloco.id, "content": str(e), "is_error": True})
                self.mensagens.append({"role": "user", "content": resultados})
            return "Limite de iterações atingido sem resposta final."


ROTINAS = {
    "briefing": "Prepare o briefing semanal do BP: (1) mensagem principal em 3 linhas, (2) os 5 alertas mais críticos "
                "com dono e prazo, (3) talentos em risco por área, (4) vagas mais atrasadas, (5) situação orçamentária. "
                "Salve como 'Briefing semanal do BP'.",
    "pauta": "Monte a pauta da reunião mensal com cada diretor atendido (uma seção por área), com indicadores, "
             "decisões solicitadas e perguntas que o diretor provavelmente fará. Salve como 'Pautas mensais com diretores'.",
    "retencao": "Liste os talentos em risco alto em todas as áreas, agrupe por fator de risco predominante e proponha "
                "um plano de retenção com custo estimado. Salve como 'Plano de retenção de talentos'.",
}


# ------------------------------------------------------------------------- servidor
def servir(cliente: anthropic.Anthropic, snap: Snapshot, porta: int, effort: str) -> None:
    sessoes: dict[str, Conversa] = {}

    class Handler(BaseHTTPRequestHandler):
        def _cors(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

        def _json(self, codigo: int, obj: dict):
            corpo = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(codigo)
            self._cors()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(corpo)))
            self.end_headers()
            self.wfile.write(corpo)

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_GET(self):
            if self.path == "/health":
                return self._json(200, {"ok": True, "modelo": MODELO, "snapshot": snap.dados["meta"]["gerado_em"]})
            self._json(404, {"erro": "rota inexistente"})

        def do_POST(self):
            tamanho = int(self.headers.get("Content-Length", 0))
            try:
                corpo = json.loads(self.rfile.read(tamanho) or b"{}")
            except json.JSONDecodeError:
                return self._json(400, {"erro": "JSON inválido"})
            if self.path == "/snapshot":
                snap.atualizar(corpo)
                return self._json(200, {"ok": True})
            if self.path == "/chat":
                sid = str(corpo.get("sessao", "padrao"))
                conv = sessoes.setdefault(sid, Conversa(cliente, snap, effort))
                foco = corpo.get("area_em_foco", "todas")
                msg = f"[Área em foco no cockpit: {foco}]\n{corpo.get('mensagem', '')}"
                try:
                    return self._json(200, {"resposta": conv.perguntar(msg)})
                except anthropic.APIError as e:
                    return self._json(502, {"erro": f"Falha na API do Claude: {e}"})
            self._json(404, {"erro": "rota inexistente"})

        def log_message(self, fmt, *args):
            sys.stderr.write("[agente] " + (fmt % args) + "\n")

    # apenas localhost: o snapshot contém dados de pessoas
    srv = ThreadingHTTPServer(("127.0.0.1", porta), Handler)
    print(f"Agente do BP ouvindo em http://localhost:{porta} — abra o cockpit e use o Copiloto.")
    srv.serve_forever()


# ------------------------------------------------------------------------------ main
def main() -> None:
    ap = argparse.ArgumentParser(description="Agente Claude do Cockpit do BP")
    ap.add_argument("--snapshot", type=Path, default=None, help="Caminho do snapshot.json exportado pelo cockpit")
    ap.add_argument("--pergunta", help="Faz uma pergunta e sai")
    ap.add_argument("--rotina", choices=sorted(ROTINAS), help="Executa uma rotina e salva o material em agent/saidas")
    ap.add_argument("--serve", action="store_true", help="Sobe a API local usada pelo Copiloto do cockpit")
    ap.add_argument("--porta", type=int, default=8765)
    ap.add_argument("--effort", default="medium", choices=["low", "medium", "high", "xhigh", "max"],
                    help="Profundidade de raciocínio (maior = mais caro e mais lento)")
    args = ap.parse_args()

    caminho = args.snapshot or (AQUI / "snapshot.json")
    if not caminho.exists():
        caminho = AQUI / "snapshot_exemplo.json"
        print(f"snapshot.json não encontrado; usando base de demonstração ({caminho.name}).", file=sys.stderr)
    snap = Snapshot(caminho)
    cliente = anthropic.Anthropic()

    if args.serve:
        return servir(cliente, snap, args.porta, args.effort)
    conv = Conversa(cliente, snap, args.effort)
    if args.rotina:
        print(conv.perguntar(ROTINAS[args.rotina]))
        return
    if args.pergunta:
        print(conv.perguntar(args.pergunta))
        return
    print("Copiloto do BP — digite sua pergunta (Ctrl+C para sair).")
    while True:
        try:
            texto = input("\nVocê: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if texto:
            print("\nCopiloto:", conv.perguntar(texto))


if __name__ == "__main__":
    main()
