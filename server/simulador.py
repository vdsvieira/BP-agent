"""Ambiente simulado de dados de pessoas de um grande banco.

Gera, de forma determinística, as mesmas tabelas que os conectores reais
(SAP, sistema de movimentações, ATS, pesquisa de clima, data lake de RH e
contexto de negócio) entregarão no futuro. Todos os nomes são fictícios.
"""
from __future__ import annotations

import datetime as dt
import math
import random

HOJE = dt.date(2026, 10, 30)
NOMES_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]


def meses_janela() -> list[dict]:
    out = []
    for i in range(11, -1, -1):
        m = HOJE.month - 1 - i
        ano = HOJE.year + m // 12
        m %= 12
        out.append({"ano": ano, "mes": m, "label": f"{NOMES_MES[m]}/{str(ano)[2:]}"})
    return out


DIRETORIAS = [
    # id, nome, vice-presidência, hc, aquecimento de mercado, crescimento, automação, salário base
    ("varejo-pf", "Varejo PF", "VP Varejo", 560, 0.35, 0.02, 0.06, 7800),
    ("varejo-pj", "Varejo PJ", "VP Varejo", 340, 0.40, 0.05, 0.03, 9200),
    ("atacado", "Atacado & IB", "VP Atacado", 180, 0.65, 0.06, 0.01, 21000),
    ("tecnologia", "Tecnologia", "VP Tecnologia & Operações", 520, 0.90, 0.10, 0.02, 16500),
    ("riscos", "Riscos & Compliance", "VP Riscos", 210, 0.55, 0.04, 0.03, 15200),
    ("operacoes", "Operações", "VP Tecnologia & Operações", 430, 0.20, -0.03, 0.12, 6400),
    ("credito", "Crédito & Cobrança", "VP Varejo", 260, 0.45, 0.03, 0.07, 10800),
    ("digital", "Canais Digitais", "VP Tecnologia & Operações", 240, 0.85, 0.12, 0.01, 17800),
]
TRIBOS = {
    "varejo-pf": [("investimentos-pf", "Tribo Investimentos PF", "Assessoria e produtos de investimento", 2100), ("contas-cartoes", "Tribo Contas & Cartões", "Abertura de contas, cartões e pacotes", 3400), ("rede-agencias", "Tribo Rede de Agências", "Atendimento presencial e relacionamento", 1800)],
    "varejo-pj": [("pme", "Tribo PME", "Crédito e serviços para pequenas e médias empresas", 1900), ("cash-management", "Tribo Cash Management", "Cobrança, folha e pagamentos PJ", 1200)],
    "atacado": [("corporate", "Tribo Corporate", "Relacionamento com grandes empresas", 2600), ("investment-banking", "Tribo Investment Banking", "M&A, DCM e mercado de capitais", 1500)],
    "tecnologia": [("plataformas-cloud", "Tribo Plataformas Cloud", "Infraestrutura, cloud e FinOps", 0), ("dados-ia", "Tribo Dados & IA", "Plataforma de dados, modelos e IA generativa", 0), ("ciberseguranca", "Tribo Cibersegurança", "Segurança da informação e fraude", 0)],
    "riscos": [("pld-compliance", "Tribo PLD & Compliance", "Prevenção à lavagem de dinheiro e conformidade", 0), ("riscos-mercado-credito", "Tribo Riscos de Mercado & Crédito", "Modelagem e gestão de riscos", 0)],
    "operacoes": [("backoffice-digital", "Tribo Backoffice Digital", "Esteiras operacionais e automação", 0), ("pix-pagamentos", "Tribo Pix & Pagamentos", "Pix, TED, boletos e Open Finance", 650)],
    "credito": [("concessao", "Tribo Concessão", "Políticas e esteira de concessão", 1400), ("cobranca", "Tribo Cobrança & Recuperação", "Cobrança e recuperação de crédito", 900)],
    "digital": [("app-mobile", "Tribo App & Mobile", "Aplicativo e jornadas digitais", 1100), ("growth-open-finance", "Tribo Growth & Open Finance", "Aquisição digital e Open Finance", 700)],
}
NIVEIS = [  # nome, multiplicador salarial, peso, SLA de vaga (dias), líder
    ("Assistente", 0.55, 0.13, 30, False), ("Analista Jr", 0.75, 0.18, 30, False), ("Analista Pl", 1.0, 0.24, 40, False),
    ("Analista Sr", 1.35, 0.20, 45, False), ("Especialista", 1.8, 0.12, 60, False), ("Coordenador", 2.1, 0.06, 60, True),
    ("Gerente", 2.9, 0.045, 75, True), ("Superintendente", 4.8, 0.015, 90, True),
]
NIVEL_IDX = {n[0]: i for i, n in enumerate(NIVEIS)}
CARGOS = {
    "varejo-pf": ["Gerente de Relacionamento", "Assistente de Atendimento", "Gerente de Agência", "Especialista de Investimentos"],
    "varejo-pj": ["Gerente PJ", "Analista de Crédito PJ", "Assistente Comercial PJ", "Especialista Cash Management"],
    "atacado": ["Banker Corporate", "Analista de M&A", "Trader", "Especialista de Produtos Estruturados"],
    "tecnologia": ["Engenheiro de Software", "Engenheiro de Dados", "Especialista Cloud", "Analista de Cibersegurança", "Scrum Master"],
    "riscos": ["Analista de Risco de Mercado", "Analista de PLD/FT", "Especialista de Compliance", "Modelador de Risco"],
    "operacoes": ["Analista de Operações", "Assistente de Backoffice", "Analista de Processos", "Especialista de Câmbio"],
    "credito": ["Analista de Crédito", "Analista de Cobrança", "Cientista de Dados de Crédito", "Especialista de Recuperação"],
    "digital": ["Product Manager", "UX Designer", "Engenheiro Mobile", "Analista de Growth"],
}
# exposição do cargo à IA generativa (0 = baixa, 1 = alta) — base para reskilling
EXPOSICAO_IA = {
    "Assistente de Atendimento": 0.8, "Assistente de Backoffice": 0.85, "Analista de Operações": 0.7, "Analista de Processos": 0.6,
    "Analista de Cobrança": 0.75, "Assistente Comercial PJ": 0.7, "Analista de Crédito": 0.65, "Analista de Crédito PJ": 0.6,
    "Analista de PLD/FT": 0.55, "Especialista de Câmbio": 0.45, "Analista de Growth": 0.5, "Engenheiro de Software": 0.5,
    "Engenheiro de Dados": 0.45, "Engenheiro Mobile": 0.45, "Analista de M&A": 0.5, "Analista de Risco de Mercado": 0.5,
}
SKILLS = {
    "varejo-pf": ["Certificação CPA-20/CEA", "Consultoria de Investimentos", "Venda Consultiva Digital"],
    "varejo-pj": ["Crédito PJ", "Cash Management", "Câmbio PME"],
    "atacado": ["M&A / DCM", "Estruturação de Derivativos", "ESG Finance"],
    "tecnologia": ["Cloud & FinOps", "Engenharia de Dados", "Cibersegurança", "IA Generativa"],
    "riscos": ["PLD/FT", "Modelagem Basileia", "Risco Climático"],
    "operacoes": ["Automação RPA", "Gestão de Processos", "Pix / Open Finance"],
    "credito": ["Ciência de Dados", "Recuperação Judicial", "Política de Crédito"],
    "digital": ["Product Management", "UX Research", "Engenharia Mobile"],
}
NOMES_F = ["Ana", "Beatriz", "Camila", "Daniela", "Fernanda", "Gabriela", "Juliana", "Larissa", "Mariana", "Patrícia", "Renata", "Tatiane", "Vanessa", "Aline", "Bruna", "Carla", "Débora", "Elaine", "Luana", "Priscila"]
NOMES_M = ["André", "Bruno", "Carlos", "Diego", "Eduardo", "Felipe", "Gustavo", "Henrique", "Igor", "João", "Lucas", "Marcelo", "Rafael", "Rodrigo", "Thiago", "Vinícius", "Leandro", "Fábio", "Paulo", "Ricardo"]
SOBRENOMES = ["Silva", "Souza", "Oliveira", "Santos", "Pereira", "Costa", "Rodrigues", "Almeida", "Nascimento", "Lima", "Araújo", "Fernandes", "Carvalho", "Gomes", "Martins", "Rocha", "Ribeiro", "Alves", "Monteiro", "Mendes", "Barros", "Freitas", "Barbosa", "Pinto", "Moura", "Cavalcanti", "Dias", "Castro", "Campos", "Cardoso"]
UFS = [("SP", 0.58), ("RJ", 0.09), ("MG", 0.08), ("PR", 0.05), ("RS", 0.05), ("BA", 0.05), ("PE", 0.04), ("DF", 0.03), ("CE", 0.03)]
ETAPAS = ["Aberta", "Triagem", "Entrevistas", "Proposta", "Admissão"]
FONTES = [("Site de carreiras/ATS", 0.34), ("LinkedIn", 0.26), ("Indicação", 0.18), ("Hunting", 0.08), ("Mobilidade interna", 0.14)]
DIMENSOES_CLIMA = [("Liderança", 4), ("Reconhecimento", -6), ("Carreira & desenvolvimento", -8), ("Bem-estar", -3), ("Segurança psicológica", 0),
                   ("Colaboração", 6), ("Propósito", 10), ("Carga de trabalho", -10), ("Remuneração & benefícios", -9)]
REGULATORIOS = ["PLD/FT", "LGPD", "Código de Ética", "Segurança da Informação"]
MOTIVOS_VOL = [("Proposta de mercado", 0.36), ("Carreira", 0.22), ("Liderança", 0.14), ("Remuneração", 0.14), ("Pessoal", 0.09), ("Carga de trabalho", 0.05)]
MOTIVOS_INV = [("Performance", 0.55), ("Reestruturação", 0.3), ("Conduta", 0.15)]
FATOR_ENCARGOS = 1.86
DISSIDIO_REAL, DISSIDIO_ORCADO, MES_DISSIDIO = 0.052, 0.045, 8

# Pesos que GERAM o desligamento na simulação. O modelo preditivo não os vê: reaprende dos dados.
PESOS_REAIS = dict(compa=-3.2, sem_aumento=0.035, desempenho=0.18, enps=-0.28, anos=-0.06, he=0.03, ferias=0.35,
                   troca_gestor=0.55, aquecimento=1.6, idade=-0.035, absent=0.04, sem_promocao=0.012)


class Gerador:
    def __init__(self, seed: int = 20261030):
        self.r = random.Random(seed)

    def pick(self, seq):
        return seq[int(self.r.random() * len(seq))]

    def pesado(self, pares):
        x, acc = self.r.random(), 0.0
        for v, p in pares:
            acc += p
            if x <= acc:
                return v
        return pares[-1][0]

    def normal(self, mu, sd):
        return self.r.gauss(mu, sd)

    def entre(self, a, b):
        return a + (b - a) * self.r.random()

    def inteiro(self, a, b):
        return self.r.randint(a, b)


def _clamp(x, a, b):
    return max(a, min(b, x))


def _sig(z):
    return 1 / (1 + math.exp(-z))


def _logit_real(c: dict, aquecimento: float) -> float:
    w = PESOS_REAIS
    return (w["compa"] * (c["compa_ratio"] - 1) + w["sem_aumento"] * c["meses_sem_aumento"] + w["desempenho"] * (c["desempenho"] - 3)
            + w["enps"] * (c["enps"] - 7) + w["anos"] * (c["tempo_casa_meses"] / 12) + w["he"] * c["he_mes"] + w["ferias"] * c["ferias_vencidas"]
            + w["troca_gestor"] * c["troca_gestor_12m"] + w["aquecimento"] * aquecimento + w["idade"] * (c["idade"] - 35)
            + w["absent"] * c["absenteismo_dias"] + w["sem_promocao"] * c["meses_sem_promocao"])


def gerar(seed: int = 20261030) -> dict:
    g = Gerador(seed)
    meses = meses_janela()
    seq = [100000]

    def nova_pessoa(d, nivel_idx=None, forcado=None):
        did, _, _, _, aq, _, _, sal_base = d
        if nivel_idx is None:
            nivel_idx = NIVEL_IDX[g.pesado([(n[0], n[2]) for n in NIVEIS])]
        nome_nivel, mult, _, _, lider = forcado or NIVEIS[nivel_idx]
        seq[0] += 1
        genero = "F" if g.r.random() < (0.3 if did == "tecnologia" else 0.52) else "M"
        nome = f"{g.pick(NOMES_F if genero == 'F' else NOMES_M)} {g.pick(SOBRENOMES)} {g.pick(SOBRENOMES)}"
        idade = round(_clamp(g.normal(24 + nivel_idx * 3.2, 6), 19, 64))
        tempo = g.inteiro(0, 11) if g.r.random() < 0.16 else round(_clamp(abs(g.normal(12 * (2 + nivel_idx * 1.2), 40)), 12, (idade - 18) * 12))
        compa = round(_clamp(g.normal(0.98 - aq * 0.06, 0.1) - (0.025 if genero == "F" and did in ("atacado", "tecnologia", "riscos") else 0), 0.7, 1.3), 2)
        desempenho = int(_clamp(round(g.normal(3.2, 0.9)), 1, 5))
        potencial = int(_clamp(round(g.normal(1.9 + (desempenho - 3) * 0.25, 0.7)), 1, 3))
        enps = int(_clamp(round(g.normal(8.1 - aq * 1.2, 1.8)), 0, 10))
        he = round(_clamp(abs(g.normal(14 if did in ("operacoes", "tecnologia") else 8, 7)), 0, 50), 1)
        absent = round(_clamp(abs(g.normal(7 if did == "operacoes" else 4.5, 3.5)) + (2 if he > 20 else 0), 0, 40), 1)
        ferias = (2 if g.r.random() < 0.25 else 1) if g.r.random() < 0.07 else 0
        pend = [t for t in REGULATORIOS if g.r.random() < 0.008 + (0.02 if did == "operacoes" else 0)]
        chave = (lider and g.r.random() < 0.55) or (nome_nivel == "Especialista" and g.r.random() < 0.2)
        cargo = f"{nome_nivel} — {d[1]}" if lider else g.pick(CARGOS[did])
        sem_aumento = g.inteiro(1, 30)
        admissao = HOJE - dt.timedelta(days=int(tempo * 30.4) + g.inteiro(0, 25))
        return {
            "matricula": f"F{seq[0]}", "nome": nome, "genero": genero,
            "raca": "Negra" if g.r.random() < 0.31 else ("Branca" if g.r.random() < 0.95 else "Amarela/Indígena"),
            "pcd": int(g.r.random() < 0.035), "idade": idade, "diretoria": did, "tribo": None, "squad": None,
            "cargo": cargo, "nivel": nome_nivel, "camada": None, "lider": int(lider), "gestor_matricula": None,
            "uf": g.pesado(UFS), "modelo_trabalho": g.pick(["Presencial", "Híbrido", "Híbrido", "Remoto"]),
            "data_admissao": admissao.isoformat(), "tempo_casa_meses": tempo,
            "fonte_contratacao": g.pesado([f for f in FONTES if f[0] != "Mobilidade interna"]) if tempo < 12 else None,
            "salario": round(sal_base * mult * compa / 10) * 10, "compa_ratio": compa,
            "meses_sem_aumento": sem_aumento, "meses_sem_promocao": g.inteiro(3, 60),
            "promovido_12m": 0, "transferido_12m": int(g.r.random() < 0.06),
            "desempenho": desempenho, "potencial": potencial, "enps": enps, "he_mes": he, "absenteismo_dias": absent,
            "ferias_vencidas": ferias, "troca_gestor_12m": int(g.r.random() < 0.22), "treinamentos_pendentes": "|".join(pend),
            "horas_treinamento_12m": round(_clamp(g.normal(32, 14), 0, 120)), "posicao_chave": int(chave),
            "sucessor_pronto": (int(g.r.random() < 0.45) if chave else None),
            "skill": g.pick(SKILLS[did]) if g.r.random() < 0.35 else None,
            "exposicao_ia": EXPOSICAO_IA.get(cargo, round(g.entre(0.2, 0.45), 2)),
            "status": "ativo", "data_desligamento": None, "mes_desligamento": None, "tipo_desligamento": None,
            "motivo_desligamento": None, "regretted": 0, "risco_saida_12m": None, "faixa_risco": None, "fatores_risco": None,
        }

    pessoas, diretorias, tribos = [], [], []
    for d in DIRETORIAS:
        did, nome, vp, hc, aq, cresc, autom, sal = d
        pop = [nova_pessoa(d) for _ in range(round(hc * 1.13))]
        for p in pop:
            if p["meses_sem_promocao"] <= 11 and p["nivel"] != "Superintendente":
                p["promovido_12m"] = 1
        # desligamentos calibrados ao turnover voluntário-alvo da área
        alvo = 0.05 + aq * 0.10
        lo, hi = -12.0, 6.0
        for _ in range(40):
            mid = (lo + hi) / 2
            m = sum(_sig(mid + _logit_real(c, aq)) for c in pop) / len(pop)
            lo, hi = (lo, mid) if m > alvo else (mid, hi)
        b0 = (lo + hi) / 2
        for c in pop:
            if g.r.random() < _sig(b0 + _logit_real(c, aq)):
                c.update(status="desligado", tipo_desligamento="Voluntário", motivo_desligamento=g.pesado(MOTIVOS_VOL))
            elif g.r.random() < 0.03 + (0.06 if c["desempenho"] <= 2 else 0):
                c.update(status="desligado", tipo_desligamento="Involuntário", motivo_desligamento=g.pesado(MOTIVOS_INV))
            if c["status"] == "desligado":
                mi = g.inteiro(0, 11)
                mm = meses[mi]
                c.update(mes_desligamento=mi, data_desligamento=dt.date(mm["ano"], mm["mes"] + 1, g.inteiro(1, 28)).isoformat(),
                         regretted=int(c["tipo_desligamento"] == "Voluntário" and c["desempenho"] >= 4))
        # diretor da área + hierarquia (spans & layers) + tribos/squads
        diretor = nova_pessoa(d, 7, ("Diretor", 7.0, 0, 120, True))
        diretor.update(camada=1, posicao_chave=1, sucessor_pronto=int(g.r.random() < 0.5), tempo_casa_meses=max(diretor["tempo_casa_meses"], 96), idade=max(diretor["idade"], 45))
        pop.append(diretor)
        tribs = TRIBOS[did]
        for c in pop:
            if c is not diretor:
                c["tribo"] = g.pick(tribs)[0]
                c["squad"] = f"Squad {g.inteiro(1, 6):02d}" if c["nivel"] not in ("Gerente", "Superintendente") else None
        diretor["tribo"] = None
        por = lambda nivel: [c for c in pop if c["nivel"] == nivel]  # noqa: E731
        sups, gers, coords = por("Superintendente"), por("Gerente"), por("Coordenador")
        for s in sups:
            s.update(gestor_matricula=diretor["matricula"], camada=2)
        for gr in gers:
            gr.update(gestor_matricula=g.pick(sups)["matricula"] if sups else diretor["matricula"], camada=3)
        for co in coords:
            mesmos = [x for x in gers if x["tribo"] == co["tribo"]] or gers
            co.update(gestor_matricula=g.pick(mesmos)["matricula"], camada=4)
        for c in pop:
            if c["gestor_matricula"] or c is diretor:
                continue
            cs = [x for x in coords if x["tribo"] == c["tribo"]]
            gs = [x for x in gers if x["tribo"] == c["tribo"]] or gers
            chefe = g.pick(cs) if cs and g.r.random() < 0.72 else g.pick(gs)
            c.update(gestor_matricula=chefe["matricula"], camada=(chefe["camada"] or 3) + 1)
        pessoas += pop
        diretorias.append({"id": did, "nome": nome, "vice_presidencia": vp, "diretor_matricula": diretor["matricula"],
                           "aquecimento_mercado": aq, "crescimento_planejado": cresc, "automacao_planejada": autom, "salario_base": sal})
        for tid, tnome, missao, receita in tribs:
            membros = [c for c in pop if c["tribo"] == tid and c["status"] == "ativo"]
            enps_med = sum(c["enps"] for c in membros) / max(1, len(membros))
            tribos.append({
                "id": tid, "nome": tnome, "diretoria": did, "missao": missao,
                "receita_12m_mi": round(receita / 8 * g.entre(0.85, 1.15), 1) if receita else None,
                "custo_operacional_12m_mi": round(sum(c["salario"] for c in membros) * 13.33 * FATOR_ENCARGOS / 1e6 * g.entre(1.4, 1.9), 1),
                "okr_atingimento": round(_clamp(0.55 + (enps_med - 6) * 0.08 + g.normal(0, 0.08), 0.4, 1.15), 2),
                "nps_cliente": round(_clamp(35 + (enps_med - 6.5) * 9 + g.normal(0, 8), -10, 85)),
                "squads": len({c["squad"] for c in membros if c["squad"]}),
            })

    ativos = [c for c in pessoas if c["status"] == "ativo"]

    # ------------------------------------------------------------- movimentações
    movs = []
    for c in pessoas:
        if c["tempo_casa_meses"] < 12:
            movs.append({"matricula": c["matricula"], "data": c["data_admissao"], "tipo": "Admissão", "diretoria": c["diretoria"], "detalhe": c["fonte_contratacao"]})
        if c["promovido_12m"]:
            movs.append({"matricula": c["matricula"], "data": (HOJE - dt.timedelta(days=c["meses_sem_promocao"] * 30)).isoformat(), "tipo": "Promoção", "diretoria": c["diretoria"], "detalhe": c["nivel"]})
        if c["meses_sem_aumento"] <= 11:
            movs.append({"matricula": c["matricula"], "data": (HOJE - dt.timedelta(days=c["meses_sem_aumento"] * 30)).isoformat(), "tipo": "Mérito", "diretoria": c["diretoria"], "detalhe": None})
        if c["transferido_12m"]:
            movs.append({"matricula": c["matricula"], "data": (HOJE - dt.timedelta(days=g.inteiro(10, 360))).isoformat(), "tipo": "Transferência", "diretoria": c["diretoria"], "detalhe": "Mobilidade interna"})
        if c["status"] == "desligado":
            movs.append({"matricula": c["matricula"], "data": c["data_desligamento"], "tipo": "Desligamento", "diretoria": c["diretoria"], "detalhe": f"{c['tipo_desligamento']} — {c['motivo_desligamento']}"})

    # ---------------------------------------------------------------- vagas (ATS)
    vagas, candidatos = [], []
    vseq = 26000
    for did, nome, vp, hc, aq, cresc, autom, sal in DIRETORIAS:
        for _ in range(round(hc * (0.035 + cresc * 0.25 + aq * 0.02))):
            vseq += 1
            ni = min(len(NIVEIS) - 1, int(abs(g.normal(1.6, 1.4))))
            nivel = NIVEIS[ni]
            dias = round(_clamp(abs(g.normal(nivel[3] * (0.45 + aq * 0.5), nivel[3] * 0.5)), 1, 210))
            prog = int(_clamp(math.floor(dias / nivel[3] * 2.2 + g.r.random() * 1.5), 0, 4))
            vid = f"REQ-{vseq}"
            vagas.append({
                "id": vid, "diretoria": did, "tribo": g.pick(TRIBOS[did])[0], "cargo": g.pick(CARGOS[did]), "nivel": nivel[0],
                "motivo": "Reposição" if g.r.random() < 0.62 else "Aumento de quadro", "abertura": (HOJE - dt.timedelta(days=dias)).isoformat(),
                "dias_aberta": dias, "sla": nivel[3], "etapa": ETAPAS[prog], "recrutador": f"Recrutador {g.pick('ABCDE')}",
                "orcada": int(g.r.random() < 0.86), "salario_previsto": round(sal * nivel[1] / 10) * 10,
                "prioridade": "Alta" if g.r.random() < 0.25 else ("Média" if g.r.random() < 0.6 else "Baixa"),
                "afirmativa": int(g.r.random() < 0.3), "candidatos": 0,
            })
            n = g.inteiro(0, 30) + prog * 6
            vagas[-1]["candidatos"] = n
            for _ in range(n):
                candidatos.append({"vaga_id": vid, "fonte": g.pesado(FONTES), "etapa": ETAPAS[min(prog, int(abs(g.normal(0.6, 1.0))))],
                                   "diverso": int(g.r.random() < 0.38), "dias_no_processo": g.inteiro(1, dias)})

    # ------------------------------------------------------------ pesquisa de clima
    clima = []
    for t in tribos:
        membros = [c for c in ativos if c["tribo"] == t["id"]]
        if not membros:
            continue
        base = sum(c["enps"] for c in membros) / len(membros) * 9.5
        he = sum(c["he_mes"] for c in membros) / len(membros)
        for ciclo, delta in (("2025", 3), ("2026", 0)):
            for dim, off in DIMENSOES_CLIMA:
                ajuste = -(he - 10) * 1.2 if dim in ("Carga de trabalho", "Bem-estar") else 0
                clima.append({"tribo": t["id"], "diretoria": t["diretoria"], "ciclo": ciclo, "dimensao": dim,
                              "favorabilidade": round(_clamp(base + off + ajuste + delta + g.normal(0, 4), 25, 95), 1),
                              "respondentes": round(len(membros) * g.entre(0.72, 0.93))})

    # ----------------------------------------------------- licenças e afastamentos
    licencas = []
    for c in ativos:
        if c["genero"] == "F" and 24 <= c["idade"] <= 40 and g.r.random() < 0.035:
            licencas.append({"matricula": c["matricula"], "diretoria": c["diretoria"], "tribo": c["tribo"], "tipo": "Licença-maternidade", "grupo_cid": None, "dias": 180})
        if c["genero"] == "M" and 24 <= c["idade"] <= 42 and g.r.random() < 0.03:
            licencas.append({"matricula": c["matricula"], "diretoria": c["diretoria"], "tribo": c["tribo"], "tipo": "Licença-paternidade", "grupo_cid": None, "dias": 20})
        p_doenca = 0.02 + (0.03 if c["he_mes"] > 20 else 0) + (0.03 if c["enps"] <= 4 else 0)
        if g.r.random() < p_doenca:
            mental = 0.35 + (0.2 if c["enps"] <= 4 or c["he_mes"] > 20 else 0)
            grupo = g.pesado([("Saúde mental (F)", mental), ("Osteomuscular (M)", 0.3), ("Outros", 1)])
            licencas.append({"matricula": c["matricula"], "diretoria": c["diretoria"], "tribo": c["tribo"], "tipo": "Auxílio-doença (B31)", "grupo_cid": grupo, "dias": g.inteiro(16, 120)})
        if g.r.random() < 0.003:
            licencas.append({"matricula": c["matricula"], "diretoria": c["diretoria"], "tribo": c["tribo"], "tipo": "Acidentário (B91)", "grupo_cid": "Osteomuscular (M)", "dias": g.inteiro(16, 90)})
    for i, lic in enumerate(licencas):
        lic["id"] = i + 1
        lic["inicio"] = (HOJE - dt.timedelta(days=g.inteiro(0, 330))).isoformat()

    # --------------------------------------------------------------- orçamento
    orcamento, series, competencias = [], [], []
    for did, nome, vp, hc, aq, cresc, autom, sal in DIRETORIAS:
        at = [c for c in ativos if c["diretoria"] == did]
        sa = [c for c in pessoas if c["diretoria"] == did and c["status"] == "desligado"]
        sal_medio = sum(c["salario"] for c in at) / len(at)
        hc_plano = round(hc * (1 + cresc * 0.6))
        desvio = g.entre(1.0, 1.12)
        for m in range(12):
            decimo = 1.95 if m == 11 else 1
            he_custo = sum(c["he_mes"] * c["salario"] / 220 * 1.5 for c in at) * (0.85 + g.r.random() * 0.3)
            orcado = (hc_plano * sal_medio / (1 + DISSIDIO_REAL) * desvio * (1 + DISSIDIO_ORCADO if m >= MES_DISSIDIO else 1) * FATOR_ENCARGOS + he_custo * 0.55) * decimo
            hc_real = len(at) + sum(1 for c in sa if c["mes_desligamento"] >= m - 1)
            realizado = None
            if m <= HOJE.month - 1:
                realizado = (hc_real * sal_medio / (1 + DISSIDIO_REAL) * (1 + DISSIDIO_REAL if m >= MES_DISSIDIO else 1) * FATOR_ENCARGOS * (0.98 + g.r.random() * 0.04) + he_custo) * decimo
            orcamento.append({"diretoria": did, "ano": HOJE.year, "mes": m, "hc_plano": hc_plano, "orcado": round(orcado),
                              "realizado": round(realizado) if realizado is not None else None, "he_custo": round(he_custo)})
        treino_orc = round(hc * 2600)
        orcamento.append({"diretoria": did, "ano": HOJE.year, "mes": -1, "hc_plano": hc_plano, "orcado": treino_orc,
                          "realizado": round(treino_orc * (0.55 + g.r.random() * 0.45) * HOJE.month / 12 * 1.1), "he_custo": 0})  # mes -1 = verba de treinamento
        abs_base = sum(c["absenteismo_dias"] for c in at) / len(at) / 220 * 100
        he_base = sum(c["he_mes"] for c in at) / len(at)
        for i, mm in enumerate(meses):
            saidas = [c for c in sa if c["mes_desligamento"] == i]
            tend = (i - 6) * (0.03 if did in ("operacoes", "tecnologia") else 0.005)
            series.append({
                "diretoria": did, "mes_idx": i, "label": mm["label"],
                "hc": sum(1 for c in at if c["tempo_casa_meses"] > 11 - i) + sum(1 for c in sa if c["mes_desligamento"] >= i),
                "admissoes": sum(1 for c in at if c["tempo_casa_meses"] == 11 - i),
                "deslig_vol": sum(1 for c in saidas if c["tipo_desligamento"] == "Voluntário"),
                "deslig_inv": sum(1 for c in saidas if c["tipo_desligamento"] == "Involuntário"),
                "absenteismo_pct": round(abs_base * (1 + tend + g.normal(0, 0.06)), 2),
                "he_media": round(he_base * (1 + tend * 1.5 + g.normal(0, 0.05)), 1),
            })
        for s in SKILLS[did]:
            oferta = sum(1 for c in at if c["skill"] == s)
            competencias.append({"diretoria": did, "skill": s, "oferta": oferta,
                                 "demanda": round(oferta * (1 + cresc * 3 + g.entre(-0.05, 0.4)) + (25 if s == "IA Generativa" else 0))})

    return {
        "meta": {"data_referencia": HOJE.isoformat(), "fonte": "simulador", "seed": seed, "meses": meses},
        "diretorias": diretorias, "tribos": tribos, "colaboradores": pessoas, "movimentacoes": movs, "vagas": vagas,
        "candidatos": candidatos, "clima": clima, "licencas": licencas, "orcamento": orcamento, "series": series, "competencias": competencias,
    }


if __name__ == "__main__":
    import collections
    d = gerar()
    for k, v in d.items():
        if isinstance(v, list):
            print(k, len(v))
    at = [c for c in d["colaboradores"] if c["status"] == "ativo"]
    spans = collections.Counter(c["gestor_matricula"] for c in at if c["gestor_matricula"])
    print("ativos", len(at), "gestores", len(spans), "span médio", round(sum(spans.values()) / len(spans), 1), "camadas", collections.Counter(c["camada"] for c in at))
