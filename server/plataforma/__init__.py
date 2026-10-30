"""Plataforma integrada de Gente & Gestão (protótipo): ATS, admissão, onboarding, metas e performance.

Os módulos gravam em tabelas próprias (ats_*, adm_*, onb_*, meta_*, perf_*) e publicam seus efeitos
na base de pessoas do cockpit: vagas/candidatos vêm do ATS, contratados viram colaboradores,
notas de performance atualizam desempenho/potencial e OKRs das tribos atualizam o indicador de negócio.
"""
from __future__ import annotations

from .. import auth
from . import admissao, arquivos, ats, metas, onboarding, performance

MODULOS = [arquivos, ats, admissao, onboarding, metas, performance]


def iniciar(con) -> None:
    auth.criar_tabelas(con)
    for m in MODULOS:
        m.criar_tabelas(con)
    con.commit()
    # ordem importa: as contas de demonstração dependem da base e umas das outras
    auth.semear_demo(con)
    ats.semear(con)
    onboarding.semear(con)
    metas.semear(con)
    performance.semear(con)
    con.commit()


def pos_sincronizacao(con) -> None:
    """Reaplica os efeitos da plataforma depois que um conector recria tabelas da base."""
    admissao.reaplicar(con)
    ats.sincronizar_cockpit(con)
    for t in con.execute("SELECT id FROM tribos").fetchall():
        metas.atualizar_okr_tribo(con, t["id"])
    con.commit()
