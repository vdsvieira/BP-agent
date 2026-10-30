"""Ingestão de arquivos enviados pelo BP: Excel, CSV, PDF, imagens e texto.

- Planilhas reconhecidas como colaboradores ou vagas atualizam a base oficial
  (merge por matrícula / id da vaga) e re-treinam o modelo de risco.
- Qualquer outra planilha vira uma tabela nova (x_...) que o agente pode cruzar.
- PDFs e imagens são lidos pelo Claude, que extrai resumo, indicadores e
  tabelas; o documento fica disponível como contexto para análises e materiais.
"""
from __future__ import annotations

import base64
import csv
import datetime as dt
import io
import json
import re
import unicodedata

from . import banco, conectores, ia

MODELO_IA = "claude-opus-5-5"
LIMITE_BYTES = 25 * 1024 * 1024

SINONIMOS = {
    "matricula": ["matricula", "mat", "chapa", "id_colaborador", "employee_id", "re", "registro"],
    "nome": ["nome", "nome_completo", "colaborador", "funcionario"],
    "diretoria": ["diretoria", "area", "departamento", "unidade", "vp_area"],
    "tribo": ["tribo", "tribe"],
    "squad": ["squad", "time", "equipe"],
    "cargo": ["cargo", "funcao", "posicao", "job_title"],
    "nivel": ["nivel", "grade", "banda", "senioridade"],
    "gestor_matricula": ["gestor_matricula", "matricula_gestor", "gestor", "lider_imediato", "manager_id"],
    "genero": ["genero", "sexo"],
    "raca": ["raca", "raca_cor", "cor"],
    "idade": ["idade"],
    "salario": ["salario", "salario_base", "remuneracao", "salario_mensal"],
    "compa_ratio": ["compa_ratio", "compa", "comparatio"],
    "desempenho": ["desempenho", "nota_desempenho", "performance", "avaliacao", "rating"],
    "potencial": ["potencial", "potential"],
    "enps": ["enps", "nota_clima", "nota_enps"],
    "he_mes": ["he_mes", "horas_extras", "he", "horas_extras_mes"],
    "absenteismo_dias": ["absenteismo_dias", "absenteismo", "faltas_dias", "dias_ausencia"],
    "ferias_vencidas": ["ferias_vencidas", "periodos_vencidos"],
    "tempo_casa_meses": ["tempo_casa_meses", "tempo_de_casa_meses"],
    "data_admissao": ["data_admissao", "admissao", "dt_admissao"],
    "status": ["status", "situacao"],
}
SINONIMOS_VAGAS = {
    "id": ["id", "id_vaga", "requisicao", "codigo_vaga", "vaga"],
    "diretoria": SINONIMOS["diretoria"], "cargo": SINONIMOS["cargo"], "nivel": SINONIMOS["nivel"],
    "etapa": ["etapa", "status_vaga", "fase"], "dias_aberta": ["dias_aberta", "dias_em_aberto", "aging"],
    "sla": ["sla", "sla_dias"], "recrutador": ["recrutador", "recruiter"], "motivo": ["motivo", "tipo_vaga"],
}
NUMERICOS = {"idade", "salario", "compa_ratio", "desempenho", "potencial", "enps", "he_mes", "absenteismo_dias", "ferias_vencidas", "tempo_casa_meses", "dias_aberta", "sla"}


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


def _valor(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, (dt.date, dt.datetime)):
        return v.isoformat()[:10]
    s = str(v).strip()
    if s == "":
        return None
    if re.fullmatch(r"-?\d{1,3}(\.\d{3})+(,\d+)?", s):  # 1.234,56
        return float(s.replace(".", "").replace(",", "."))
    if re.fullmatch(r"-?\d+(,\d+)?", s):
        return float(s.replace(",", ".")) if "," in s else int(s)
    if re.fullmatch(r"-?\d+\.\d+", s):
        return float(s)
    return s


def _mapear(cabecalho: list[str], sinonimos: dict) -> dict[str, str]:
    inv = {sin: canon for canon, lista in sinonimos.items() for sin in lista}
    return {h: inv[_norm(h)] for h in cabecalho if _norm(h) in inv}


# ------------------------------------------------------------------- planilhas
def ler_planilhas(nome: str, dados: bytes) -> list[tuple[str, list[dict]]]:
    if nome.lower().endswith((".xlsx", ".xlsm")):
        import openpyxl  # dependência opcional: pip install openpyxl

        wb = openpyxl.load_workbook(io.BytesIO(dados), read_only=True, data_only=True)
        abas = []
        for ws in wb.worksheets:
            linhas = [r for r in ws.iter_rows(values_only=True) if any(c not in (None, "") for c in r)]
            if len(linhas) < 2:
                continue
            cab = [str(c) if c is not None else f"coluna_{i + 1}" for i, c in enumerate(linhas[0])]
            abas.append((ws.title, [dict(zip(cab, (_valor(v) for v in r))) for r in linhas[1:]]))
        return abas
    try:
        texto = dados.decode("utf-8-sig")
    except UnicodeDecodeError:
        texto = dados.decode("latin-1")
    dialeto = csv.Sniffer().sniff(texto[:5000], delimiters=";,\t|")
    linhas = list(csv.DictReader(io.StringIO(texto), dialect=dialeto))
    return [("dados", [{k: _valor(v) for k, v in l.items() if k is not None} for l in linhas])]


def _merge_colaboradores(con, linhas: list[dict], mapa: dict) -> dict:
    existentes = {r["matricula"]: dict(r) for r in con.execute("SELECT * FROM colaboradores")}
    modelo_vazio = {k: None for k in (next(iter(existentes.values())) if existentes else {})}
    novos = atualizados = 0
    for l in linhas:
        reg = {mapa[k]: v for k, v in l.items() if k in mapa}
        mat = str(reg.get("matricula") or "").strip()
        if not mat:
            continue
        reg["matricula"] = mat
        for k in NUMERICOS & reg.keys():
            if isinstance(reg[k], str):  # texto onde se esperava número: descarta em vez de corromper a base
                reg[k] = None
        if mat in existentes:
            existentes[mat].update({k: v for k, v in reg.items() if v is not None})
            atualizados += 1
        else:
            base = {**modelo_vazio, "status": "ativo", "compa_ratio": 1.0, "meses_sem_aumento": 12, "meses_sem_promocao": 24, "desempenho": 3,
                    "potencial": 2, "enps": 7, "he_mes": 0, "absenteismo_dias": 0, "ferias_vencidas": 0, "troca_gestor_12m": 0, "idade": 35,
                    "tempo_casa_meses": 24, "treinamentos_pendentes": "", "lider": 0, "pcd": 0, "exposicao_ia": 0.4}
            base.update({k: v for k, v in reg.items() if v is not None})
            existentes[mat] = base
            novos += 1
    banco.gravar_tabela(con, "colaboradores", list(existentes.values()), origem="upload")
    conectores.retreinar(con)
    return {"destino": "colaboradores", "novos": novos, "atualizados": atualizados}


def _merge_vagas(con, linhas: list[dict], mapa: dict) -> dict:
    existentes = {r["id"]: dict(r) for r in con.execute("SELECT * FROM vagas")}
    n = 0
    for l in linhas:
        reg = {mapa[k]: v for k, v in l.items() if k in mapa}
        if not reg.get("id"):
            continue
        reg["id"] = str(reg["id"])
        existentes.setdefault(reg["id"], {"orcada": 1, "prioridade": "Média", "afirmativa": 0, "candidatos": 0, "motivo": "Reposição"}).update(reg)
        n += 1
    banco.gravar_tabela(con, "vagas", list(existentes.values()), origem="upload")
    return {"destino": "vagas", "linhas": n}


def ingerir_planilha(con, nome: str, dados: bytes) -> list[dict]:
    resultados = []
    for aba, linhas in ler_planilhas(nome, dados):
        if not linhas:
            continue
        cab = list(linhas[0].keys())
        mapa_c, mapa_v = _mapear(cab, SINONIMOS), _mapear(cab, SINONIMOS_VAGAS)
        if "matricula" in mapa_c.values() and len(mapa_c) >= 4:
            resultados.append({"aba": aba, **_merge_colaboradores(con, linhas, mapa_c)})
        elif "id" in mapa_v.values() and {"etapa", "dias_aberta"} & set(mapa_v.values()):
            resultados.append({"aba": aba, **_merge_vagas(con, linhas, mapa_v)})
        else:
            tabela = banco.nome_tabela_seguro(f"x_{nome.rsplit('.', 1)[0]}_{aba}")[:60]
            norm = [{_norm(k) or f"coluna_{i}": v for i, (k, v) in enumerate(l.items())} for l in linhas]
            banco.gravar_tabela(con, tabela, norm, origem="upload", descricao=f"Planilha enviada: {nome} / aba {aba}. Colunas: {', '.join(_norm(c) for c in cab)[:400]}")
            resultados.append({"aba": aba, "destino": tabela, "linhas": len(norm), "colunas": [_norm(c) for c in cab]})
    con.commit()
    return resultados


# ------------------------------------------------------------ PDFs e imagens
ESQUEMA_DOC = {
    "type": "object",
    "properties": {
        "tipo_documento": {"type": "string", "description": "Ex.: relatório de clima, organograma, apresentação de negócio, política, planilha fotografada, ata"},
        "titulo": {"type": "string"},
        "resumo": {"type": "string", "description": "Resumo executivo em até 8 linhas"},
        "pontos_chave": {"type": "array", "items": {"type": "string"}},
        "areas_mencionadas": {"type": "array", "items": {"type": "string"}},
        "indicadores": {"type": "array", "items": {"type": "object", "properties": {
            "nome": {"type": "string"}, "valor": {"type": "string"}, "unidade": {"type": "string"}, "periodo": {"type": "string"}, "area": {"type": "string"}},
            "required": ["nome", "valor", "unidade", "periodo", "area"], "additionalProperties": False}},
        "tabelas": {"type": "array", "items": {"type": "object", "properties": {
            "titulo": {"type": "string"}, "colunas": {"type": "array", "items": {"type": "string"}},
            "linhas": {"type": "array", "items": {"type": "array", "items": {"type": "string"}}}},
            "required": ["titulo", "colunas", "linhas"], "additionalProperties": False}},
        "texto_relevante": {"type": "string", "description": "Trechos textuais importantes para análises futuras (até ~3.000 caracteres)"},
    },
    "required": ["tipo_documento", "titulo", "resumo", "pontos_chave", "areas_mencionadas", "indicadores", "tabelas", "texto_relevante"],
    "additionalProperties": False,
}
PROMPT_DOC = ("Você apoia um HR Business Partner de banco. Extraia deste arquivo tudo que for útil para análises de pessoas e negócio: "
              "resumo, pontos-chave, indicadores com valor/unidade/período/área e todas as tabelas (transcreva as células como texto). "
              "Não invente valores ilegíveis; deixe-os vazios. Dados pessoais: não transcreva CPF, endereço ou dados de saúde individuais.")


def _extrair_com_ia(nome: str, mime: str, dados: bytes) -> dict:
    b64 = base64.standard_b64encode(dados).decode()
    if mime == "application/pdf":
        bloco = {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64}}
    elif mime.startswith("image/"):
        bloco = {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}}
    else:
        bloco = {"type": "text", "text": f"<arquivo nome='{nome}'>\n{dados.decode('utf-8', 'ignore')[:150000]}\n</arquivo>"}
    resp = ia.cliente().messages.create(
        model=MODELO_IA, max_tokens=16000,
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": ESQUEMA_DOC}},
        messages=[{"role": "user", "content": [bloco, {"type": "text", "text": PROMPT_DOC}]}],
    )
    if resp.stop_reason == "refusal":
        raise RuntimeError("O modelo recusou processar este arquivo.")
    return json.loads(next(b.text for b in resp.content if b.type == "text"))


def ingerir_documento(con, nome: str, mime: str, dados: bytes) -> dict:
    agora = dt.datetime.now().isoformat(timespec="seconds")
    try:
        ext = _extrair_com_ia(nome, mime, dados)
        erro = None
    except Exception as e:  # sem chave de API, sem rede, proxy, arquivo ilegível…
        ia.registrar_erro("leitura de documento", e)
        ext, erro = None, ia.explicar_erro(e)[1]
    if ext is None:
        cur = con.execute("INSERT INTO documentos (nome, tipo_arquivo, tipo_documento, resumo, pontos_chave, extraido_json, tabelas_geradas, enviado_em) VALUES (?,?,?,?,?,?,?,?)",
                          (nome, mime, "não processado", f"Arquivo armazenado sem leitura por IA: {erro}", "[]", "{}", "[]", agora))
        con.commit()
        return {"documento_id": cur.lastrowid, "processado": False, "erro": erro}
    cur = con.execute("INSERT INTO documentos (nome, tipo_arquivo, tipo_documento, resumo, pontos_chave, extraido_json, tabelas_geradas, enviado_em) VALUES (?,?,?,?,?,?,?,?)",
                      (nome, mime, ext["tipo_documento"], ext["resumo"], json.dumps(ext["pontos_chave"], ensure_ascii=False), json.dumps(ext, ensure_ascii=False), "[]", agora))
    doc_id = cur.lastrowid
    geradas = []
    if ext["indicadores"]:
        t = f"x_doc{doc_id}_indicadores"
        banco.gravar_tabela(con, t, [{k: _valor(v) if k == "valor" else v for k, v in i.items()} for i in ext["indicadores"]], origem="documento", descricao=f"Indicadores extraídos de {nome}")
        geradas.append(t)
    for n, tab in enumerate(ext["tabelas"], 1):
        cols = [_norm(c) or f"coluna_{i + 1}" for i, c in enumerate(tab["colunas"])]
        linhas = [dict(zip(cols, (_valor(v) for v in l))) for l in tab["linhas"]]
        if linhas:
            t = f"x_doc{doc_id}_tabela{n}"
            banco.gravar_tabela(con, t, linhas, origem="documento", descricao=f"{tab['titulo']} (de {nome})")
            geradas.append(t)
    con.execute("UPDATE documentos SET tabelas_geradas = ? WHERE id = ?", (json.dumps(geradas), doc_id))
    con.commit()
    return {"documento_id": doc_id, "processado": True, "tipo_documento": ext["tipo_documento"], "titulo": ext["titulo"], "resumo": ext["resumo"], "tabelas_geradas": geradas}


def ingerir(con, nome: str, mime: str, dados: bytes) -> dict:
    if len(dados) > LIMITE_BYTES:
        raise ValueError("Arquivo acima de 25 MB.")
    n = nome.lower()
    if n.endswith((".xlsx", ".xlsm", ".csv", ".tsv")):
        return {"arquivo": nome, "tipo": "planilha", "resultados": ingerir_planilha(con, nome, dados)}
    if n.endswith(".xls"):
        raise ValueError("Formato .xls antigo: salve como .xlsx ou .csv.")
    if n.endswith(".pdf"):
        mime = "application/pdf"
    elif n.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")):
        mime = mime if mime.startswith("image/") else "image/" + ("jpeg" if n.endswith(("jpg", "jpeg")) else n.rsplit(".", 1)[1])
    elif not n.endswith((".txt", ".md", ".json")):
        raise ValueError("Formatos aceitos: .xlsx, .csv, .pdf, .png, .jpg, .webp, .txt, .md, .json")
    return {"arquivo": nome, "tipo": "documento", **ingerir_documento(con, nome, mime, dados)}
