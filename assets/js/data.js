/* =========================================================================
 * Cockpit do BP — Camada de dados
 * Carrega a base do servidor local (/api/dados: conectores + uploads) ou,
 * sem servidor, a base sintética embarcada (data/base_demo.js).
 * Mantém a importação de CSV no navegador para o modo offline.
 * ========================================================================= */
(function (global) {
  'use strict';
  const HOJE = new Date(2026, 9, 30); // ajustado para a data de referência da base ao carregar
  const ETAPAS = ['Aberta', 'Triagem', 'Entrevistas', 'Proposta', 'Admissão'];
  const sigmoid = (z) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

  function carregarScript(src) {
    return new Promise((ok, erro) => {
      const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => erro(new Error('não carregou ' + src));
      document.head.appendChild(s);
    });
  }

  async function carregar() {
    let base = null;
    if (/^https?:/.test(location.protocol)) {
      try {
        const r = await fetch('api/dados', { cache: 'no-store' });
        if (r.status === 401) { location.href = 'login.html#cockpit'; return new Promise(() => {}); } // exige login
        if (r.status === 403) { location.href = 'portal.html'; return new Promise(() => {}); } // cockpit é só para RH/BP
        if (r.ok) { base = await r.json(); base.servidor = true; }
      } catch (e) { /* sem servidor: modo offline */ }
    }
    if (!base) {
      if (!global.BP_BASE_DEMO) await carregarScript('data/base_demo.js');
      base = JSON.parse(JSON.stringify(global.BP_BASE_DEMO));
      base.servidor = false;
    }
    if (base.dataReferencia) { const [y, m, d] = base.dataReferencia.split('-').map(Number); HOJE.setFullYear(y, m - 1, d); }
    ['tribos', 'clima', 'licencas', 'movimentacoes', 'candidatos', 'competencias', 'vagas'].forEach((k) => { base[k] = base[k] || []; });
    base.orcamento = base.orcamento || {}; base.series = base.series || {};
    return base;
  }

  // ---------- Séries mensais a partir dos colaboradores (usado na importação offline) ----------
  function calcularSeries(base) {
    const series = {};
    for (const area of base.areas) {
      const ativos = base.colaboradores.filter((c) => c.area === area.id);
      const sairam = base.desligados.filter((c) => c.area === area.id);
      if (!ativos.length) continue;
      const abs = ativos.reduce((s, c) => s + c.absenteismo, 0) / ativos.length / 220 * 100;
      const he = ativos.reduce((s, c) => s + c.heMes, 0) / ativos.length;
      series[area.id] = base.meses.map((m, i) => {
        const saidas = sairam.filter((c) => c.mesDesligamento === i);
        return {
          label: m.label, hc: ativos.filter((c) => c.tempoCasaMeses > 11 - i).length + sairam.filter((c) => c.mesDesligamento >= i).length,
          admissoes: ativos.filter((c) => c.tempoCasaMeses === 11 - i).length,
          desligVol: saidas.filter((c) => c.tipoDesligamento === 'Voluntário').length, desligInv: saidas.filter((c) => c.tipoDesligamento === 'Involuntário').length,
          absenteismo: abs, he
        };
      });
    }
    return series;
  }

  // ---------- Importação CSV no navegador (modo offline) ----------
  function parseCSV(texto) {
    const linhas = texto.replace(/\r/g, '').split('\n').filter((l) => l.trim());
    const sep = (linhas[0].match(/;/g) || []).length > (linhas[0].match(/,/g) || []).length ? ';' : ',';
    const cab = linhas[0].split(sep).map((h) => h.trim());
    return linhas.slice(1).map((l) => { const v = l.split(sep); const o = {}; cab.forEach((h, i) => { o[h] = (v[i] || '').trim(); }); return o; });
  }
  const num = (x, d) => { const n = parseFloat(String(x).replace(',', '.')); return isNaN(n) ? d : n; };
  const bool = (x) => /^(1|s|sim|true|y|yes)$/i.test(String(x).trim());

  function importarColaboradores(base, texto) {
    const ativos = [], deslig = [];
    parseCSV(texto).forEach((r, i) => {
      const c = {
        matricula: r.matricula || 'IMP' + i, nome: r.nome || r.matricula, genero: r.genero || 'N/I', raca: r.raca || 'N/I', pcd: bool(r.pcd), idade: num(r.idade, 35),
        area: r.area || r.diretoria, tribo: r.tribo || null, cargo: r.cargo || '', nivel: r.nivel || 'Analista Pl', lider: bool(r.lider), gestor: r.gestor_matricula || null,
        tempoCasaMeses: num(r.tempo_casa_meses, 24), salario: num(r.salario, 0), compaRatio: num(r.compa_ratio, 1), mesesSemAumento: num(r.meses_sem_aumento, 12),
        mesesSemPromocao: num(r.meses_sem_promocao, 24), desempenho: num(r.desempenho, 3), potencial: num(r.potencial, 2), enps: num(r.enps, 7), heMes: num(r.he_mes, 0),
        absenteismo: num(r.absenteismo_dias, 0), feriasVencidas: num(r.ferias_vencidas, 0), trocaGestor12m: bool(r.troca_gestor_12m),
        treinamentosPendentes: (r.treinamentos_pendentes || '').split('|').filter(Boolean), modelo: r.modelo || 'Híbrido', posicaoChave: bool(r.posicao_chave),
        sucessorPronto: r.sucessor_pronto === '' ? null : bool(r.sucessor_pronto), skill: r.skill || null, exposicaoIA: num(r.exposicao_ia, 0.4), status: (r.status || 'ativo').toLowerCase()
      };
      if (c.status === 'desligado') {
        c.tipoDesligamento = r.tipo_desligamento || 'Voluntário'; c.mesDesligamento = num(r.mes_desligamento_idx, 11);
        c.regretted = c.tipoDesligamento === 'Voluntário' && c.desempenho >= 4; deslig.push(c);
      } else ativos.push(c);
    });
    const novas = [...new Set(ativos.concat(deslig).map((c) => c.area))].filter((a) => !base.areas.find((x) => x.id === a));
    novas.forEach((a) => base.areas.push({ id: a, nome: a, diretor: 'Diretoria ' + a, hc: 0, aquecimento: 0.5, crescimento: 0.03, automacao: 0.03, salarioBase: 10000 }));
    base.colaboradores = ativos; base.desligados = deslig; base.sintetico = false; base.modelo = null;
    base.areas.forEach((a) => { a.hc = ativos.filter((c) => c.area === a.id).length; });
    base.series = calcularSeries(base);
    return { ativos: ativos.length, desligados: deslig.length, areasNovas: novas };
  }

  function importarVagas(base, texto) {
    base.vagas = parseCSV(texto).map((r, i) => ({
      id: r.id || 'REQ-IMP' + i, area: r.area || r.diretoria, cargo: r.cargo, nivel: r.nivel, motivo: r.motivo || 'Reposição', abertura: r.abertura,
      diasAberta: num(r.dias_aberta, 0), sla: num(r.sla, 45), etapa: r.etapa || 'Aberta', candidatos: num(r.candidatos, 0), recrutador: r.recrutador || '',
      orcada: bool(r.orcada), salarioPrevisto: num(r.salario_previsto, 0), prioridade: r.prioridade || 'Média', diversidade: bool(r.diversidade)
    }));
    return base.vagas.length;
  }

  global.BPData = { carregar, importarColaboradores, importarVagas, parseCSV, calcularSeries, HOJE, ETAPAS, sigmoid };
})(typeof window !== 'undefined' ? window : globalThis);
