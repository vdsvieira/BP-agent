"""Admissão — do aceite da proposta ao primeiro dia.

Checklist por responsável (candidato, RH, TI, gestor), documentos enviados pelo candidato e
conferidos pela IA (tipo correto, legibilidade, pendências) antes da validação humana do RH.
A efetivação cria o colaborador na base de pessoas (aparece no cockpit), converte o login do
candidato em login de colaborador e abre o onboarding. Em produção, a efetivação dispararia o
evento S-2200 do eSocial pelo SAP.
"""
from __future__ import annotations

import base64

from .. import conectores, ia
from ..ia import B, S, lista, obj
from ..rotas import Ctx, Erro, agora, hoje, jd, jl, rota
from . import arquivos

CHECKLIST = [
    # (tipo, nome, obrigatório, responsável)
    ("documento", "Documento de identidade (RG ou CNH)", 1, "candidato"),
    ("documento", "CPF", 1, "candidato"),
    ("documento", "Comprovante de residência (últimos 3 meses)", 1, "candidato"),
    ("documento", "Carteira de Trabalho Digital (print da tela de dados)", 1, "candidato"),
    ("documento", "Comprovante de escolaridade", 1, "candidato"),
    ("documento", "Dados bancários (conta salário)", 1, "candidato"),
    ("documento", "Foto para crachá", 0, "candidato"),
    ("exame", "Exame admissional (ASO)", 1, "rh"),
    ("contrato", "Assinatura do contrato de trabalho", 1, "rh"),
    ("acesso", "Criação de usuário, e-mail e acessos", 1, "ti"),
    ("equipamento", "Notebook e kit de trabalho", 1, "ti"),
    ("integracao", "Boas-vindas do gestor agendadas para o 1º dia", 1, "gestor"),
]


def criar_tabelas(con) -> None:
    con.executescript("""
    CREATE TABLE IF NOT EXISTS adm_processos (id INTEGER PRIMARY KEY AUTOINCREMENT, candidatura_id INTEGER, candidato_id INTEGER, vaga_id TEXT, nome TEXT,
      cargo TEXT, nivel TEXT, diretoria TEXT, tribo TEXT, gestor_matricula TEXT, salario REAL, data_inicio TEXT, status TEXT, matricula_gerada TEXT,
      fonte TEXT, criado_em TEXT, efetivado_em TEXT);
    CREATE TABLE IF NOT EXISTS adm_itens (id INTEGER PRIMARY KEY AUTOINCREMENT, processo_id INTEGER, tipo TEXT, nome TEXT, obrigatorio INTEGER,
      responsavel TEXT, status TEXT, arquivo_id INTEGER, parecer_ia TEXT, observacao TEXT, atualizado_em TEXT);
    """)


def criar_processo(con, candidatura: dict, vaga: dict, oferta: dict) -> int:
    cand = con.execute("SELECT * FROM ats_candidatos WHERE id = ?", (candidatura["candidato_id"],)).fetchone()
    pid = con.execute("""INSERT INTO adm_processos (candidatura_id, candidato_id, vaga_id, nome, cargo, nivel, diretoria, tribo, gestor_matricula, salario,
                         data_inicio, status, fonte, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                      (candidatura["id"], cand["id"], vaga["id"], cand["nome"], vaga["titulo"], vaga["nivel"], vaga["diretoria"], vaga["tribo"],
                       vaga["gestor_matricula"], oferta["salario"], oferta["data_inicio"], "documentos", candidatura["fonte"], agora())).lastrowid
    itens = list(CHECKLIST)
    if any(p in (vaga["titulo"] or "") for p in ("Investimentos", "Relacionamento", "Agência")):
        itens.append(("documento", "Certificação CPA-20 / CEA (exigida para o cargo)", 1, "candidato"))
    for t, n, ob, resp in itens:
        con.execute("INSERT INTO adm_itens (processo_id, tipo, nome, obrigatorio, responsavel, status, atualizado_em) VALUES (?,?,?,?,?,?,?)",
                    (pid, t, n, ob, resp, "pendente", agora()))
    return pid


def _processo(ctx: Ctx, pid) -> dict:
    p = ctx.q1("SELECT * FROM adm_processos WHERE id = ?", pid)
    if not p:
        raise Erro(404, "Processo de admissão não encontrado.")
    dono = ctx.u.get("candidato_id") and ctx.u["candidato_id"] == p["candidato_id"]
    ctx.exigir(ctx.staff or dono or (ctx.perfil == "gestor" and p["gestor_matricula"] == ctx.u["matricula"]))
    return p


def _resumo(ctx: Ctx, p: dict) -> dict:
    itens = ctx.q("SELECT * FROM adm_itens WHERE processo_id = ? ORDER BY id", p["id"])
    ob = [i for i in itens if i["obrigatorio"]]
    return {**p, "progresso": sum(i["status"] == "validado" for i in ob) / max(1, len(ob)), "pendencias": sum(i["status"] != "validado" for i in ob)}


@rota("GET", "/api/admissao")
def listar(ctx: Ctx):
    if ctx.staff:
        ps = ctx.q("SELECT * FROM adm_processos ORDER BY criado_em DESC")
    elif ctx.perfil == "gestor":
        ps = ctx.q("SELECT * FROM adm_processos WHERE gestor_matricula = ? ORDER BY criado_em DESC", ctx.u["matricula"])
    elif ctx.u.get("candidato_id"):
        ps = ctx.q("SELECT * FROM adm_processos WHERE candidato_id = ? ORDER BY criado_em DESC", ctx.u["candidato_id"])
    else:
        ps = []
    return [_resumo(ctx, p) for p in ps]


@rota("GET", r"/api/admissao/(?P<pid>\d+)")
def ver(ctx: Ctx, pid: str):
    p = _processo(ctx, pid)
    itens = ctx.q("SELECT * FROM adm_itens WHERE processo_id = ? ORDER BY id", pid)
    if ctx.perfil == "gestor":  # gestor acompanha o andamento, sem ver documentos pessoais
        itens = [{k: i[k] for k in ("id", "tipo", "nome", "obrigatorio", "responsavel", "status")} for i in itens]
    else:
        itens = [{**i, "parecer_ia": jl(i["parecer_ia"])} for i in itens]
    return {"processo": _resumo(ctx, p), "itens": itens}


ESQ_DOC = obj({"tipo_identificado": S, "corresponde_ao_item": B, "legivel": B, "dentro_da_validade": {"type": "string", "enum": ["sim", "não", "não se aplica", "não foi possível verificar"]},
               "nome_no_documento_confere": {"type": "string", "enum": ["sim", "não", "não consta", "não foi possível verificar"]},
               "pendencias": lista(S), "resumo": S})


@rota("POST", r"/api/admissao/itens/(?P<iid>\d+)/enviar", {"candidato", "rh", "bp"})
def enviar_documento(ctx: Ctx, iid: str):
    it = ctx.q1("SELECT * FROM adm_itens WHERE id = ?", iid)
    if not it:
        raise Erro(404, "Item não encontrado.")
    p = _processo(ctx, it["processo_id"])
    ctx.exigir(ctx.staff or it["responsavel"] == "candidato", "Este item é de responsabilidade de outra área.")
    if p["status"] in ("efetivado", "cancelado"):
        raise Erro(409, "Processo encerrado.")
    nome, mime, dados = ctx.campo("nome"), ctx.campo("mime", False, ""), base64.b64decode(ctx.campo("base64"))
    aid = arquivos.salvar(ctx.con, nome, mime, dados, ctx.u["id"], "admissao")
    ctx.con.commit()  # não segura o banco travado durante a chamada à IA
    try:
        parecer = ia.gerar("Confira um documento enviado para admissão. Verifique apenas: se é o documento pedido, se está legível, validade (quando houver) "
                           "e se o nome confere com o do candidato. NÃO transcreva números de documentos, endereço ou outros dados pessoais no resultado.",
                           [arquivos.bloco_ia(nome, mime, dados), {"type": "text", "text": f"Item pedido: {it['nome']}\nNome do candidato: {p['nome']}"}], ESQ_DOC)
    except Erro as e:
        parecer = {"resumo": f"Conferência automática indisponível: {e.msg}", "pendencias": [], "corresponde_ao_item": None, "legivel": None}
    ctx.ex("UPDATE adm_itens SET status = 'enviado', arquivo_id = ?, parecer_ia = ?, atualizado_em = ? WHERE id = ?", aid, jd(parecer), agora(), iid)
    ctx.con.commit()
    return {"ok": True, "parecer": parecer}


@rota("POST", r"/api/admissao/itens/(?P<iid>\d+)/status", {"rh", "bp", "gestor"})
def mudar_status(ctx: Ctx, iid: str):
    it = ctx.q1("SELECT * FROM adm_itens WHERE id = ?", iid)
    if not it:
        raise Erro(404, "Item não encontrado.")
    _processo(ctx, it["processo_id"])
    ctx.exigir(ctx.staff or it["responsavel"] == "gestor", "O gestor só conclui os itens sob sua responsabilidade.")
    st = ctx.campo("status")
    if st not in ("pendente", "validado", "rejeitado"):
        raise Erro(400, "Status inválido.")
    ctx.ex("UPDATE adm_itens SET status = ?, observacao = ?, atualizado_em = ? WHERE id = ?", st, ctx.campo("observacao", False, ""), agora(), iid)
    p = ctx.q1("SELECT * FROM adm_processos WHERE id = ?", it["processo_id"])
    pend = ctx.q("SELECT tipo FROM adm_itens WHERE processo_id = ? AND obrigatorio = 1 AND status != 'validado'", p["id"])
    novo = "pronto" if not pend else ("documentos" if any(x["tipo"] == "documento" for x in pend) else "exame_contrato_acessos")
    if p["status"] not in ("efetivado", "cancelado"):
        ctx.ex("UPDATE adm_processos SET status = ? WHERE id = ?", novo, p["id"])
    ctx.con.commit()
    return {"ok": True, "status_processo": novo}


@rota("POST", r"/api/admissao/(?P<pid>\d+)/efetivar", {"rh", "bp"})
def efetivar(ctx: Ctx, pid: str):
    p = _processo(ctx, pid)
    if p["status"] == "efetivado":
        raise Erro(409, "Admissão já efetivada.")
    pend = ctx.q("SELECT nome FROM adm_itens WHERE processo_id = ? AND obrigatorio = 1 AND status != 'validado'", pid)
    if pend:
        raise Erro(409, "Ainda há itens obrigatórios pendentes: " + "; ".join(x["nome"] for x in pend))
    mat = efetivar_processo(ctx.con, p)
    ctx.con.commit()
    return {"matricula": mat}


def efetivar_processo(con, p: dict) -> str:
    """Cria o colaborador na base, converte o login do candidato e abre o onboarding."""
    mat = _gravar_colaborador(con, p)
    cand = con.execute("SELECT id FROM ats_candidatos WHERE id = ?", (p["candidato_id"],)).fetchone()
    # o login do candidato passa a ser o login do colaborador
    con.execute("UPDATE usuarios SET perfil = 'colaborador', matricula = ? WHERE candidato_id = ?", (mat, cand["id"]))
    con.execute("UPDATE adm_processos SET status = 'efetivado', matricula_gerada = ?, efetivado_em = ? WHERE id = ?", (mat, agora(), p["id"]))
    conectores.retreinar(con)  # recalcula riscos com o novo colaborador
    from . import onboarding
    onboarding.criar_plano(con, mat, p["data_inicio"] or hoje())
    return mat


def reaplicar(con) -> int:
    """Após recriar a base simulada (sincronizar SAP), recoloca os contratados pela plataforma."""
    n = 0
    for p in con.execute("SELECT * FROM adm_processos WHERE status = 'efetivado'").fetchall():
        if not con.execute("SELECT 1 FROM colaboradores WHERE matricula = ?", (p["matricula_gerada"],)).fetchone():
            _gravar_colaborador(con, dict(p))
            n += 1
    if n:
        conectores.retreinar(con)
    return n


def _gravar_colaborador(con, p: dict) -> str:
    cand = con.execute("SELECT * FROM ats_candidatos WHERE id = ?", (p["candidato_id"],)).fetchone()
    g = con.execute("SELECT * FROM colaboradores WHERE matricula = ?", (p["gestor_matricula"],)).fetchone()
    d = con.execute("SELECT * FROM diretorias WHERE id = ?", (p["diretoria"],)).fetchone()
    existente = cand["matricula"] and con.execute("SELECT 1 FROM colaboradores WHERE matricula = ?", (cand["matricula"],)).fetchone()
    if existente:  # mobilidade interna: atualiza o cadastro existente
        mat = cand["matricula"]
        con.execute("UPDATE colaboradores SET diretoria=?, tribo=?, cargo=?, nivel=?, gestor_matricula=?, salario=?, transferido_12m=1 WHERE matricula=?",
                    (p["diretoria"], p["tribo"], p["cargo"], p["nivel"], p["gestor_matricula"], p["salario"], mat))
        con.execute("INSERT INTO movimentacoes (matricula, data, tipo, diretoria, detalhe) VALUES (?,?,?,?,?)", (mat, p["data_inicio"], "Transferência", p["diretoria"], "Mobilidade interna via ATS"))
    else:
        n = con.execute("SELECT MAX(CAST(substr(matricula, 2) AS INTEGER)) FROM colaboradores WHERE matricula LIKE 'F9%'").fetchone()[0] or 900000
        mat = p.get("matricula_gerada") or cand["matricula"] or f"F{n + 1}"
        cols = [r[1] for r in con.execute("PRAGMA table_info(colaboradores)")]
        mult = {"Assistente": 0.55, "Analista Jr": 0.75, "Analista Pl": 1.0, "Analista Sr": 1.35, "Especialista": 1.8, "Coordenador": 2.1, "Gerente": 2.9}.get(p["nivel"], 1.0)
        novo = {c: None for c in cols}
        novo.update(matricula=mat, nome=cand["nome"], genero="N/I", raca="N/I", pcd=0, idade=30, diretoria=p["diretoria"], tribo=p["tribo"], squad=None,
                    cargo=p["cargo"], nivel=p["nivel"], camada=(g["camada"] or 4) + 1 if g else 5, lider=0, gestor_matricula=p["gestor_matricula"],
                    uf="SP", modelo_trabalho="Híbrido", data_admissao=p["data_inicio"], tempo_casa_meses=0, fonte_contratacao=p["fonte"], salario=p["salario"],
                    compa_ratio=round(p["salario"] / (d["salario_base"] * mult), 2) if d else 1.0, meses_sem_aumento=0, meses_sem_promocao=0,
                    promovido_12m=0, transferido_12m=0, desempenho=3, potencial=2, enps=8, he_mes=0, absenteismo_dias=0, ferias_vencidas=0,
                    troca_gestor_12m=0, treinamentos_pendentes="PLD/FT|LGPD|Código de Ética|Segurança da Informação", horas_treinamento_12m=0,
                    posicao_chave=0, sucessor_pronto=None, skill=None, exposicao_ia=0.4, status="ativo", regretted=0)
        con.execute(f"INSERT INTO colaboradores ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", [novo[c] for c in cols])
        con.execute("INSERT INTO movimentacoes (matricula, data, tipo, diretoria, detalhe) VALUES (?,?,?,?,?)", (mat, p["data_inicio"], "Admissão", p["diretoria"], p["fonte"]))
        con.execute("UPDATE ats_candidatos SET matricula = ? WHERE id = ?", (mat, cand["id"]))
    return mat
