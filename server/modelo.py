"""Modelo preditivo de saída voluntária em 12 meses (regressão logística, Python puro).

As features e a ordem são as mesmas de FEATURES em assets/js/analytics.js: o cockpit
recebe os pesos e usa-os no simulador de retenção.
"""
from __future__ import annotations

import math

FEATURES = [
    ("compaRatio", "Compa-ratio", lambda c, a: c["compa_ratio"], lambda c: f"compa-ratio baixo ({c['compa_ratio']:.2f})".replace(".", ",")),
    ("mesesSemAumento", "Meses sem aumento", lambda c, a: c["meses_sem_aumento"], lambda c: f"{c['meses_sem_aumento']} meses sem aumento"),
    ("mesesSemPromocao", "Meses sem promoção", lambda c, a: c["meses_sem_promocao"], lambda c: f"{c['meses_sem_promocao']} meses sem promoção"),
    ("desempenho", "Desempenho", lambda c, a: c["desempenho"], lambda c: f"alto desempenho ({c['desempenho']}/5), visado pelo mercado"),
    ("enps", "eNPS individual", lambda c, a: c["enps"], lambda c: f"clima baixo (nota {c['enps']}/10)"),
    ("tempoCasa", "Tempo de casa (anos)", lambda c, a: c["tempo_casa_meses"] / 12, lambda c: f"pouco tempo de casa ({c['tempo_casa_meses'] / 12:.1f} anos)".replace(".", ",")),
    ("heMes", "Horas extras/mês", lambda c, a: c["he_mes"], lambda c: f"{c['he_mes']}h extras/mês"),
    ("feriasVencidas", "Férias vencidas", lambda c, a: c["ferias_vencidas"], lambda c: f"{c['ferias_vencidas']} período(s) de férias vencido(s)"),
    ("trocaGestor", "Troca de gestor 12m", lambda c, a: c["troca_gestor_12m"], lambda c: "troca de gestor recente"),
    ("aquecimento", "Aquecimento do mercado", lambda c, a: a, lambda c: "mercado aquecido para o perfil"),
    ("idade", "Idade", lambda c, a: c["idade"], lambda c: f"perfil em início de carreira ({c['idade']} anos)"),
    ("absenteismo", "Absenteísmo (dias)", lambda c, a: c["absenteismo_dias"], lambda c: f"{c['absenteismo_dias']} dias de ausência/12m"),
]
RISCO_ALTO, RISCO_MEDIO = 0.30, 0.15


def _sig(z: float) -> float:
    return 1 / (1 + math.exp(-max(-30.0, min(30.0, z))))


def _auc(scores: list[float], labels: list[int]) -> float:
    ordem = sorted(range(len(scores)), key=lambda i: scores[i])
    soma, npos = 0, 0
    for rank, i in enumerate(ordem, 1):
        if labels[i]:
            soma += rank
            npos += 1
    nneg = len(labels) - npos
    return (soma - npos * (npos + 1) / 2) / (npos * nneg) if npos and nneg else 0.5


def treinar(colaboradores: list[dict], aquecimento: dict[str, float], iteracoes: int = 300) -> dict:
    """Treina com ativos (0) + desligados voluntários (1); involuntários ficam de fora."""
    pop = [c for c in colaboradores if c["status"] == "ativo" or c.get("tipo_desligamento") == "Voluntário"]
    X = [[f(c, aquecimento.get(c["diretoria"], 0.5)) for _, _, f, _ in FEATURES] for c in pop]
    y = [0 if c["status"] == "ativo" else 1 for c in pop]
    k, n = len(FEATURES), len(X)
    media = [sum(r[j] for r in X) / n for j in range(k)]
    dp = [math.sqrt(sum((r[j] - media[j]) ** 2 for r in X) / n) or 1.0 for j in range(k)]
    Z = [[(r[j] - media[j]) / dp[j] for j in range(k)] for r in X]
    teste = [i for i in range(n) if (i * 7919) % 4 == 0]
    treino = [i for i in range(n) if (i * 7919) % 4 != 0]
    w, b, lr, l2 = [0.0] * k, 0.0, 0.3, 0.01
    for _ in range(iteracoes):
        gw, gb = [0.0] * k, 0.0
        for i in treino:
            zi = Z[i]
            e = _sig(b + sum(zi[j] * w[j] for j in range(k))) - y[i]
            gb += e
            for j in range(k):
                gw[j] += e * zi[j]
        b -= lr * gb / len(treino)
        w = [w[j] - lr * (gw[j] / len(treino) + l2 * w[j]) for j in range(k)]
    prever = lambda i: _sig(b + sum(Z[i][j] * w[j] for j in range(k)))  # noqa: E731
    return {
        "tipo": "regressão logística", "features": [fid for fid, *_ in FEATURES], "nomes": [nome for _, nome, *_ in FEATURES],
        "w": w, "b": b, "media": media, "dp": dp, "n": n, "nPos": sum(y), "taxaBase": sum(y) / n,
        "aucTeste": _auc([prever(i) for i in teste], [y[i] for i in teste]),
        "aucTreino": _auc([prever(i) for i in treino], [y[i] for i in treino]),
    }


def pontuar(modelo: dict, c: dict, aquecimento: float) -> tuple[float, list[str]]:
    z = [(f(c, aquecimento) - modelo["media"][j]) / modelo["dp"][j] for j, (_, _, f, _) in enumerate(FEATURES)]
    contrib = [z[j] * modelo["w"][j] for j in range(len(z))]
    prob = _sig(modelo["b"] + sum(contrib))
    top = sorted((j for j in range(len(z)) if contrib[j] > 0.12), key=lambda j: -contrib[j])[:3]
    return prob, [FEATURES[j][3](c) for j in top]


def aplicar(colaboradores: list[dict], diretorias: list[dict]) -> dict:
    aquecimento = {d["id"]: d["aquecimento_mercado"] for d in diretorias}
    modelo = treinar(colaboradores, aquecimento)
    for c in colaboradores:
        if c["status"] != "ativo":
            continue
        p, fatores = pontuar(modelo, c, aquecimento.get(c["diretoria"], 0.5))
        c["risco_saida_12m"] = round(p, 4)
        c["faixa_risco"] = "Alto" if p >= RISCO_ALTO else "Médio" if p >= RISCO_MEDIO else "Baixo"
        c["fatores_risco"] = " | ".join(fatores)
    return modelo
