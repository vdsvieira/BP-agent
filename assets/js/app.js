/* =========================================================================
 * Cockpit do BP — Orquestração: estado, navegação, gráficos, tarefas,
 * copiloto (local ou agente Claude), importação/exportação.
 * ========================================================================= */
(function () {
  'use strict';
  const A = window.BPAnalytics, V = window.BPViews, M = window.BPMateriais, D = window.BPData;
  const { brl, p100, dec } = A.fmt;
  const $ = (s) => document.querySelector(s);
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* armazenamento indisponível */ } }
  };

  const NAV = [
    ['Cockpit', [['visao', 'Visão geral'], ['estrategicos', 'Indicadores estratégicos'], ['telemetria', 'Telemetria'], ['insights', 'Insights inteligentes']]],
    ['Análises', [['preditivo', 'People Analytics'], ['org', 'Org design & tribos'], ['clima', 'Clima & bem-estar'], ['wfp', 'WFP · Força de trabalho'], ['orcamento', 'Orçamento'], ['vagas', 'Vagas · R&S'], ['subsistemas', 'Subsistemas de RH']]],
    ['IA & execução', [['assistente', '✦ Assistente IA'], ['ferramentas', 'Caixa de ferramentas'], ['automacao', 'Automação & tarefas'], ['materiais', 'Materiais executivos']]],
    ['Configuração', [['dados', 'Dados & integrações']]]
  ];
  const TITULOS = Object.fromEntries(NAV.flatMap(([, it]) => it));

  // ---------------------------------------------------------------- Estado
  const S = {
    base: null, modelo: null, area: LS.get('bp-area', 'todas'), view: 'visao',
    tarefas: LS.get('bp-tarefas', []), anon: LS.get('bp-anon', false),
    tribo: 'todas', agente: false, chat: { analista: [], materiais: [], coach: [] }, anexos: [], catalogo: null,
    sessoes: { analista: 'web-' + Math.random().toString(36).slice(2, 9), materiais: 'web-' + Math.random().toString(36).slice(2, 9), coach: 'web-' + Math.random().toString(36).slice(2, 9), copiloto: 'cop-' + Math.random().toString(36).slice(2, 9) },
    ui: { sim: { merito: 0.08, reducaoHE: 0.3, ferias: true, stay: true, soTalentos: false }, cenario: { crescimento: 0, automacao: 0, retencao: 0 } }
  };
  const charts = {};

  async function carregarBase() {
    S.base = await D.carregar();
    S.modelo = A.preparar(S.base);
    S.agente = S.base.servidor;
    if (!S.base.areas.some((a) => a.id === S.area)) S.area = 'todas';
  }
  async function api(caminho, corpo) {
    const r = await fetch('api/' + caminho, corpo === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
    const j = await r.json().catch(() => ({ erro: 'Resposta inválida do servidor' }));
    if (!r.ok) throw new Error(j.erro || 'Erro ' + r.status);
    return j;
  }
  async function recarregarDoServidor(msg) {
    await carregarBase();
    S.catalogo = await api('catalogo').catch(() => S.catalogo);
    enviarSnapshotServidor();
    if (msg) toast(msg);
    render();
  }

  // ------------------------------------------------------------- Gráficos
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function ds(label, data, slot, kind) {
    const cor = cssVar('--s' + (slot + 1));
    if (kind === 'line') return { label, data, borderColor: cor, backgroundColor: cor, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.25, fill: false };
    if (kind === 'forecast') return { label, data, backgroundColor: cor + '55', borderColor: cor, borderWidth: { top: 2, left: 0, right: 0, bottom: 0 }, borderDash: [4, 3], borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28 };
    return { label, data, backgroundColor: cor, borderColor: cssVar('--surface'), borderWidth: 1, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28 };
  }
  function opts(o) {
    const muted = cssVar('--muted'), grid = cssVar('--grid'), ink2 = cssVar('--ink-2');
    const horiz = o.indexAxis === 'y';
    const valor = (v) => (o.unidade === 'R$ mil' ? 'R$ ' + Number(v).toLocaleString('pt-BR') + ' mil' : Number(v).toLocaleString('pt-BR'));
    const eixoValor = { stacked: !!o.stacked, grid: { color: grid }, border: { display: false }, ticks: { color: muted, callback: (v) => Number(v).toLocaleString('pt-BR') } };
    const eixoCat = { stacked: !!o.stacked, grid: { display: false }, border: { color: cssVar('--axis') }, ticks: { color: muted } };
    return {
      responsive: true, maintainAspectRatio: false, indexAxis: o.indexAxis || 'x',
      interaction: { mode: 'index', intersect: false, axis: horiz ? 'y' : 'x' },
      plugins: {
        legend: { display: o.legend !== false, position: 'top', align: 'start', labels: { color: ink2, usePointStyle: true, boxWidth: 8, boxHeight: 8 } },
        tooltip: { callbacks: { label: (c) => (c.raw === null ? null : `${c.dataset.label}: ${valor(c.raw)}`) }, filter: (i) => i.raw !== null }
      },
      scales: horiz ? { x: eixoValor, y: eixoCat } : { x: eixoCat, y: eixoValor }
    };
  }
  function chart(id, cfg) {
    const el = document.getElementById(id);
    if (!el) return;
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
    if (!window.Chart) { el.parentElement.innerHTML = '<div class="empty small">Gráficos indisponíveis offline (Chart.js não carregou). Os números nas tabelas continuam válidos.</div>'; return; }
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    charts[id] = new Chart(el, cfg);
    el.setAttribute('aria-label', cfg.data.datasets.map((d) => d.label).join(', '));
  }

  // ---------------------------------------------------------- Utilidades
  function toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  function baixar(nome, conteudo, tipo) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([conteudo], { type: (tipo || 'text/plain') + ';charset=utf-8' }));
    a.download = nome; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function baixarCSV(nome, linhas) {
    if (!linhas.length) return toast('Nada para exportar');
    const cols = Object.keys(linhas[0]);
    const q = (v) => { const s = Array.isArray(v) ? v.join('|') : v === null || v === undefined ? '' : String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    baixar(nome, '﻿' + [cols.join(';')].concat(linhas.map((l) => cols.map((c) => q(l[c])).join(';'))).join('\n'), 'text/csv');
  }
  function modal(titulo, corpo, botoes) {
    const dlg = $('#modal');
    $('#modalTitle').textContent = titulo; $('#modalBody').innerHTML = corpo; $('#modalFoot').innerHTML = '';
    (botoes || []).forEach(([txt, fn, primary]) => {
      const b = document.createElement('button'); b.className = 'btn' + (primary ? ' primary' : ''); b.textContent = txt;
      b.addEventListener('click', () => fn(dlg)); $('#modalFoot').appendChild(b);
    });
    if (!dlg.open) dlg.showModal();
  }
  $('#modal').addEventListener('click', (e) => { if (e.target.hasAttribute('data-close') || e.target.id === 'modal') $('#modal').close(); });

  // --------------------------------------------------------------- Tarefas
  function salvarTarefas() { LS.set('bp-tarefas', S.tarefas); }
  function criarTarefa(ins, silencioso) {
    if (!ins) return false;
    if (S.tarefas.some((t) => t.origem === ins.id && t.status !== 'feito')) { if (!silencioso) toast('Já existe tarefa aberta para este alerta'); return false; }
    const pb = A.PLAYBOOKS[ins.playbook] || { nome: 'Plano de ação', prazo: 15, passos: ['Analisar', 'Executar', 'Reportar'] };
    const prazo = new Date(D.HOJE); prazo.setDate(prazo.getDate() + pb.prazo);
    S.tarefas.unshift({
      id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), origem: ins.id, titulo: ins.titulo, acao: ins.acao,
      area: ins.area || S.area, areaNome: ins.areaNome, playbook: ins.playbook, alvo: ins.alvo || [], status: 'afazer',
      prazo: prazo.toISOString(), passos: (ins.passos || pb.passos).map((t) => ({ t, ok: false })), criadaEm: new Date().toISOString(),
      playbookNome: A.PLAYBOOKS[ins.playbook] ? pb.nome : ((window.BP_FERRAMENTAS || []).find((f) => f.id === ins.playbook) || {}).nome
    });
    salvarTarefas();
    if (!silencioso) { toast('Tarefa criada em Automação & tarefas'); renderNav(); }
    return true;
  }
  function abrirComunicacao(item) {
    if (!item) return;
    const c = M.comunicacao(item.playbook, item);
    modal('Comunicação — ' + c.assunto, `<label class="field">Assunto<input type="text" id="cAss" value="${M.esc(c.assunto)}"></label>
      <label class="field" style="margin-top:10px">Mensagem<textarea id="cCorpo" rows="16">${M.esc(c.corpo)}</textarea></label>
      <p class="small muted">Revise antes de enviar. ${S.agente ? 'Use "Reescrever com IA" para ajustar o tom.' : ''}</p>`, [
      ['Copiar', () => navigator.clipboard.writeText($('#cAss').value + '\n\n' + $('#cCorpo').value).then(() => toast('Copiado'))],
      ['Abrir no e-mail', () => { window.location.href = 'mailto:?subject=' + encodeURIComponent($('#cAss').value) + '&body=' + encodeURIComponent($('#cCorpo').value); }, true]
    ].concat(S.agente ? [['Reescrever com IA', (dlg) => { dlg.close(); perguntarAgente('Reescreva este e-mail para gestores em tom claro, empático e objetivo, mantendo os dados:\n\n' + $('#cCorpo').value); }]] : []));
  }
  function executarRotina(id) {
    const f = A.filtrar(S.base, S.area);
    const areaNome = S.area === 'todas' ? 'Todas as áreas' : S.base.areas.find((a) => a.id === S.area).nome;
    const mk = (playbook, alvo, titulo, acao) => ({ id: 'rot-' + playbook + '-' + S.area + '-' + D.HOJE.toISOString().slice(0, 10), area: S.area, areaNome, playbook, alvo, titulo, acao });
    let ins = null;
    if (id === 'fechamento') { S.ui.tipoMaterial = 'onepager'; return go('materiais'); }
    if (id === 'snapshot') return exportarSnapshot(true);
    if (id === 'ferias') { const al = f.ativos.filter((c) => c.feriasVencidas); ins = mk('ferias', al.map((c) => c.matricula), `Férias vencidas: ${al.length} pessoas`, 'Notificar gestores e programar férias em 60 dias.'); }
    if (id === 'regulatorio') { const al = f.ativos.filter((c) => c.treinamentosPendentes.length); ins = mk('treinamentos', al.map((c) => c.matricula), `Regulatórios pendentes: ${al.length} pessoas`, 'Cobrança formal com escalonamento.'); }
    if (id === 'risco') { const al = f.ativos.filter((c) => c.talento && c.faixaRisco === 'Alto'); ins = mk('stay-interview', al.map((c) => c.matricula), `Talentos em risco: ${al.length} stay interviews`, 'Conduzir stay interviews em 15 dias.'); }
    if (id === 'vagas') { const al = f.vagas.filter((v) => v.diasAberta > v.sla); ins = mk('sla-vagas', al.map((v) => v.id), `Comitê de vagas: ${al.length} fora do SLA`, 'Decidir manter, revisar ou cancelar.'); }
    if (ins && ins.alvo.length) { if (criarTarefa(ins, true)) toast('Rotina executada: tarefa criada'); else toast('Rotina já executada hoje'); render(); abrirComunicacao(ins); }
    else toast('Nada encontrado nesta varredura ✓');
  }
  function visao360(mat) {
    const c = S.base.colaboradores.find((x) => x.matricula === mat);
    if (!c) return;
    modal('Visão 360° do colaborador', V.html360(S, c), [
      ['Criar stay interview', (dlg) => { criarTarefa({ id: 'pessoa-' + c.matricula, area: c.area, areaNome: S.base.areas.find((a) => a.id === c.area).nome, playbook: 'stay-interview', alvo: [c.matricula], titulo: 'Stay interview — ' + c.matricula, acao: 'Conversa 1:1 sobre motivadores e riscos.' }); dlg.close(); }, true]
    ]);
  }

  // -------------------------------------------------- Importar / exportar
  function importar(arquivo, tipo) {
    if (!arquivo) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        if (tipo === 'colaboradores') {
          const res = D.importarColaboradores(S.base, r.result);
          S.modelo = A.preparar(S.base);
          toast(`${res.ativos} ativos e ${res.desligados} desligados importados${res.areasNovas.length ? ' · novas áreas: ' + res.areasNovas.join(', ') : ''}`);
        } else toast(D.importarVagas(S.base, r.result) + ' vagas importadas');
        render();
      } catch (e) { toast('Erro ao importar: ' + e.message); }
    };
    r.readAsText(arquivo, 'utf-8');
  }
  async function resetBase() { delete window.BP_BASE_DEMO; await carregarBase(); toast('Base restaurada'); render(); }

  function snapshot(anon) {
    const b = S.base, m = S.modelo;
    const resumo = (k) => ({
      headcount: k.hc, admissoes_12m: k.admissoes, desligamentos_12m: k.desligamentos, turnover_12m: +k.turnover.toFixed(4), turnover_voluntario_12m: +k.turnoverVol.toFixed(4),
      saidas_regretted: k.regretted, turnover_voluntario_previsto_12m: +k.turnoverPrevisto.toFixed(4), saidas_voluntarias_previstas_12m: +k.saidasEsperadas.toFixed(1),
      pessoas_risco_alto: k.riscoAlto, talentos_risco_alto: k.talentosRisco, enps: k.enps, absenteismo_pct_mes: +k.absenteismo.toFixed(2), tendencia_absenteismo_tri: +k.tendAbs.toFixed(3),
      horas_extras_media_mes: +k.heMedia.toFixed(1), compa_ratio_medio: +k.compaMedio.toFixed(3), pessoas_compa_abaixo_090: k.abaixo90,
      vagas_abertas: k.vagas, vagas_fora_sla: k.vagasForaSla, dias_medios_vaga: Math.round(k.diasMedios), treinamentos_regulatorios_em_dia: +k.treinamento.toFixed(4),
      ferias_vencidas: k.feriasVencidas, ferias_em_dobro: k.feriasDobra, cobertura_sucessoria: +k.sucessao.toFixed(3), posicoes_chave: k.posicoesChave,
      mulheres_lideranca: +k.mulheresLideranca.toFixed(3), negros: +k.negros.toFixed(3), pcd: +k.pcd.toFixed(3), folha_mensal_com_encargos: Math.round(k.folhaMensal),
      orcamento: {
        orcado_ano: Math.round(k.orc.orcadoAno), realizado_ytd: Math.round(k.orc.ytdReal), orcado_ytd: Math.round(k.orc.ytdOrc), variacao_ytd: +k.orc.varYtd.toFixed(4),
        forecast_ano: Math.round(k.orc.forecastAno), variacao_forecast: +k.orc.varForecast.toFixed(4), horas_extras_ytd: Math.round(k.orc.heYtd),
        treinamento_orcado: k.orc.treinoOrc, treinamento_realizado: k.orc.treinoReal
      },
      serie_mensal: k.serie.map((s) => ({ mes: s.label, hc: s.hc, admissoes: s.admissoes, deslig_vol: s.desligVol, deslig_inv: s.desligInv, absenteismo_pct: +s.absenteismo.toFixed(2), he_media: +s.he.toFixed(1) }))
    });
    const wfpT = A.wfp(b, 'todas');
    return {
      meta: {
        gerado_em: new Date().toISOString(), data_referencia: D.HOJE.toISOString().slice(0, 10), base_sintetica: b.sintetico, anonimizado: anon,
        modelo_preditivo: { tipo: 'regressão logística', auc_validacao: +m.aucTeste.toFixed(3), registros: m.n, taxa_base: +m.taxaBase.toFixed(3), pesos_padronizados: Object.fromEntries(A.FEATURES.map((f, j) => [f.nome, +m.w[j].toFixed(3)])) },
        limiares: A.CONFIG
      },
      consolidado: resumo(A.kpis(b, 'todas')),
      areas: b.areas.filter((a) => b.colaboradores.some((c) => c.area === a.id)).map((a) => {
        const w = wfpT.linhas.find((l) => l.area.id === a.id);
        return {
          id: a.id, nome: a.nome, diretoria: a.diretor, premissas: { crescimento: a.crescimento, automacao: a.automacao, aquecimento_mercado: a.aquecimento },
          indicadores: resumo(A.kpis(b, a.id)),
          wfp: { oferta_12m: Math.round(w.oferta), demanda_12m: Math.round(w.demanda), contratacoes_necessarias: Math.round(w.contratacoes), pipeline: Math.round(w.pipeline), excedente: Math.round(w.excedente), custo_anual_gap: Math.round(w.custoAnualGap) }
        };
      }),
      insights: A.insights(b, 'todas').map((i) => ({ id: i.id, severidade: i.sev, area: i.areaNome, titulo: i.titulo, detalhe: i.detalhe, acao: i.acao, exposicao_brl: Math.round(i.impacto), subsistemas: i.subsistemas, playbook: i.playbook, qtd_alvo: (i.alvo || []).length })),
      colaboradores_risco: b.colaboradores.filter((c) => c.faixaRisco !== 'Baixo').sort((x, y) => y.risco - x.risco).slice(0, 300).map((c) => Object.assign(anon ? {} : { nome: c.nome }, {
        matricula: c.matricula, area: c.area, cargo: c.cargo, nivel: c.nivel, desempenho: c.desempenho, potencial: c.potencial, talento: c.talento,
        compa_ratio: c.compaRatio, meses_sem_aumento: c.mesesSemAumento, he_mes: c.heMes, ferias_vencidas: c.feriasVencidas, enps: c.enps,
        risco_saida_12m: +c.risco.toFixed(3), faixa: c.faixaRisco, fatores: c.riscoDrivers, posicao_chave: c.posicaoChave
      })),
      vagas: b.vagas.map((v) => ({ id: v.id, area: v.area, cargo: v.cargo, nivel: v.nivel, motivo: v.motivo, etapa: v.etapa, dias_aberta: v.diasAberta, sla: v.sla, fora_sla: v.diasAberta > v.sla, prioridade: v.prioridade, orcada: v.orcada, recrutador: v.recrutador, salario_previsto: v.salarioPrevisto })),
      competencias: b.competencias,
      tarefas: S.tarefas.map((t) => ({ titulo: t.titulo, area: t.areaNome, playbook: t.playbook, status: t.status, prazo: t.prazo.slice(0, 10), progresso: t.passos.filter((p) => p.ok).length + '/' + t.passos.length }))
    };
  }
  function exportarSnapshot(anon) { baixar('snapshot.json', JSON.stringify(snapshot(anon), null, 1), 'application/json'); toast('snapshot.json exportado'); }

  // ------------------------------------------------- Servidor / IA
  function enviarSnapshotServidor() {
    if (!S.base.servidor) return;
    const kpis = { todas: A.kpis(S.base, 'todas') };
    S.base.areas.forEach((a) => { if (S.base.colaboradores.some((c) => c.area === a.id)) kpis[a.id] = A.kpis(S.base, a.id); });
    const enxuto = (k) => { const { serie, orc, ...r } = k; return Object.assign(r, { orcamento_var_forecast: orc.varForecast, orcamento_forecast: orc.forecastAno, he_ytd: orc.heYtd }); };
    api('snapshot', {
      gerado_em: new Date().toISOString(),
      insights: A.insights(S.base, 'todas').map((i) => ({ id: i.id, severidade: i.sev, area_id: i.area, area: i.areaNome, titulo: i.titulo, detalhe: i.detalhe, acao: i.acao, exposicao_brl: Math.round(i.impacto), subsistemas: i.subsistemas, ferramentas: i.ferramentas })),
      kpis: Object.fromEntries(Object.entries(kpis).map(([k, v]) => [k, enxuto(v)]))
    }).catch(() => { /* agente segue com SQL */ });
  }
  function contextoAtual() {
    const area = S.area === 'todas' ? 'todas as diretorias' : S.base.areas.find((a) => a.id === S.area).nome;
    return `diretoria em foco: ${area} (id ${S.area}); tribo: ${S.tribo}` + (S.anexos.length ? `; arquivos enviados nesta conversa: ${S.anexos.map((a) => a.descricao).join(' | ')}` : '');
  }
  async function chatEnviar(modo, texto) {
    const lista = S.chat[modo];
    lista.push({ quem: 'user', texto });
    if (!S.base.servidor) {
      lista.push({ quem: 'bot', texto: modo === 'analista' ? responderLocal(texto) : 'Este modo precisa do servidor local com a IA configurada. Rode `python -m server` e acesse http://localhost:8765.' });
      if (S.view === 'assistente') render();
      return;
    }
    const msg = { quem: 'bot', pendente: true, texto: '' };
    lista.push(msg);
    if (S.view === 'assistente') render();
    try {
      const r = await api('chat', { sessao: S.sessoes[modo], modo, mensagem: texto, contexto: contextoAtual() });
      Object.assign(msg, { pendente: false, texto: r.resposta, graficos: r.graficos, materiais: r.materiais });
    } catch (e) {
      Object.assign(msg, { pendente: false, texto: '⚠️ ' + e.message + (modo === 'analista' ? '\n\nResposta em modo local:\n\n' + responderLocal(texto) : '') });
    }
    if (S.view === 'assistente') render(); else toast('Assistente respondeu — abra "Assistente IA"');
  }
  function lerBase64(arquivo) {
    return new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = erro; r.readAsDataURL(arquivo); });
  }
  async function enviarArquivos(arquivos, alvo) {
    if (!arquivos.length) return;
    if (!S.base.servidor) {
      const csv = arquivos.find((a) => /\.csv$/i.test(a.name));
      if (csv) return importar(csv, /vaga/i.test(csv.name) ? 'vagas' : 'colaboradores');
      return toast('Sem servidor: só CSV pode ser importado. Rode python -m server para Excel, PDF e imagens.');
    }
    for (const arq of arquivos) {
      const aviso = (t) => { if (alvo) alvo.innerHTML += `<div>${M.esc(t)}</div>`; else S.chat[S.ui.modoIA || 'analista'].push({ quem: 'sys', texto: t }); if (!alvo && S.view === 'assistente') render(); };
      aviso(`Enviando ${arq.name}…`);
      try {
        const r = await api('upload', { nome: arq.name, mime: arq.type, base64: await lerBase64(arq) });
        let desc;
        if (r.tipo === 'planilha') desc = `${arq.name} → ` + r.resultados.map((x) => x.destino === 'colaboradores' ? `colaboradores (${x.novos} novos, ${x.atualizados} atualizados)` : x.destino === 'vagas' ? `vagas (${x.linhas})` : `tabela ${x.destino} (${x.linhas} linhas)`).join('; ');
        else desc = r.processado ? `${arq.name} → documento #${r.documento_id} (${r.tipo_documento}): ${r.resumo}` + (r.tabelas_geradas.length ? ` Tabelas: ${r.tabelas_geradas.join(', ')}` : '') : `${arq.name} armazenado sem leitura por IA (${r.erro})`;
        S.anexos.push({ nome: arq.name, descricao: desc });
        aviso('✓ ' + desc);
      } catch (e) { aviso(`✗ ${arq.name}: ${e.message}`); }
    }
    await recarregarDoServidor();
  }
  async function sincronizar(id, botao) {
    if (botao) { botao.disabled = true; botao.textContent = 'Sincronizando…'; }
    try { await api(`conectores/${id}/sincronizar`, {}); await recarregarDoServidor('Sincronização concluída'); } catch (e) { toast(e.message); render(); }
  }
  function perguntarAgente(texto) { S.ui.modoIA = 'analista'; go('assistente'); chatEnviar('analista', texto); }
  function testarAgente() { toast(S.base.servidor ? 'Servidor conectado' : 'Rode python -m server e acesse http://localhost:8765'); }
  function abrirFerramenta(id, ins) {
    const t = (window.BP_FERRAMENTAS || []).find((x) => x.id === id);
    if (!t) return;
    modal(t.nome, V.htmlFerramenta(t, ins), [
      ['Criar tarefa com o roteiro', (dlg) => {
        criarTarefa({ id: 'ferr-' + id + '-' + (ins ? ins.id : S.area), area: ins ? ins.area : S.area, areaNome: ins ? ins.areaNome : (S.area === 'todas' ? 'Todas as áreas' : S.base.areas.find((a) => a.id === S.area).nome), playbook: id, alvo: ins ? ins.alvo || [] : [], titulo: `${t.nome}${ins ? ' — ' + ins.titulo : ''}`, acao: t.objetivo, passos: t.passos });
        dlg.close();
      }],
      ['✦ Aplicar com o coach', (dlg) => { dlg.close(); aplicarComCoach(id, ins); }, true]
    ]);
  }
  function aplicarComCoach(id, ins) {
    const t = (window.BP_FERRAMENTAS || []).find((x) => x.id === id);
    S.ui.modoIA = 'coach'; go('assistente');
    chatEnviar('coach', `Quero aplicar "${t.nome}"${ins ? ` em ${ins.areaNome}, por causa do alerta: ${ins.titulo} (${ins.detalhe})` : ''}. Me ajude a decidir se é a ferramenta certa, quem envolver, o roteiro adaptado ao nosso contexto e como apresentar ao diretor.`);
  }
  function abrirMaterialIA(mat, graficos) {
    const corpo = `<article class="doc md" id="matDoc"><div class="subt">Bradesco · Gente & Gestão · HR Business Partner · ${D.HOJE.toLocaleDateString('pt-BR')} · Uso interno — confidencial</div>${V._md.md(mat.markdown, graficos, 'mg')}</article>`;
    modal(mat.titulo, corpo, [
      ['Copiar Markdown', () => navigator.clipboard.writeText(mat.markdown).then(() => toast('Copiado'))],
      ['⎙ Imprimir / PDF', () => imprimirDoc(mat.titulo), true]
    ]);
    V._md.renderGraficos($('#modalBody'), graficos, 'mg', ui);
  }
  function imprimirDoc(titulo) {
    const doc = $('#matDoc').cloneNode(true);
    doc.querySelectorAll('canvas').forEach((cv) => { const orig = document.getElementById(cv.id); const img = document.createElement('img'); img.src = orig.toDataURL('image/png'); img.style.maxWidth = '100%'; cv.parentElement.replaceWith(img); });
    const w = window.open('', '_blank');
    if (!w) return toast('Permita pop-ups para imprimir');
    w.document.write(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${M.esc(titulo)}</title><style>body{font-family:"Bradesco Sans",system-ui,sans-serif;margin:32px;color:#111}h1,h2,h3{color:#8f0621}h2{border-bottom:2px solid #cc092f;padding-bottom:4px}table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border-bottom:1px solid #e5e5e5;padding:6px 8px;text-align:left}th{background:#fbe9ec}.subt{color:#666;font-size:12px}img{margin:8px 0}</style>${doc.outerHTML}<script>setTimeout(()=>print(),300)<\/script></html>`);
    w.document.close();
  }

  // ------------------------------------------------- Copiloto (modo local)
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  function responderLocal(txt) {
    const q = norm(txt);
    const area = S.base.areas.find((a) => q.includes(norm(a.nome)) || q.includes(a.id) || q.includes(norm(a.nome.split(' ')[0])) && a.nome.split(' ')[0].length > 5);
    const aid = area ? area.id : S.area;
    const nome = area ? area.nome : (S.area === 'todas' ? 'todas as áreas' : S.base.areas.find((a) => a.id === S.area).nome);
    const k = A.kpis(S.base, aid);
    const f = A.filtrar(S.base, aid);
    const has = (...w) => w.some((x) => q.includes(x));
    if (has('pauta', 'material', 'apresenta', 'one-page', 'onepage', 'relatorio', 'business case')) {
      S.ui.tipoMaterial = has('pauta') ? 'pauta' : has('turnover') ? 'turnover' : has('business', 'case') ? 'businesscase' : has('orcament') ? 'orcamento' : 'onepager';
      if (area) setArea(area.id, true);
      go('materiais');
      return `Gerei "${M.TIPOS[S.ui.tipoMaterial]}" para ${nome}. Está aberto em Materiais executivos — use Imprimir/PDF.`;
    }
    if (has('risco', 'saida', 'reter', 'retencao', 'turnover', 'perder')) {
      const top = f.ativos.filter((c) => c.faixaRisco === 'Alto').sort((a, b) => b.risco - a.risco).slice(0, 5);
      return `${nome}: turnover 12m de ${p100(k.turnover, 1)} (vol. ${p100(k.turnoverVol, 1)}). O modelo prevê ~${Math.round(k.saidasEsperadas)} saídas voluntárias em 12 meses (${p100(k.turnoverPrevisto, 1)}). ${k.riscoAlto} pessoas em risco alto, ${k.talentosRisco} talentos.\n\nTop 5:\n` +
        top.map((c) => `• ${S.anon ? c.matricula : c.nome} (${c.cargo}) — ${p100(c.risco)}: ${c.riscoDrivers.join('; ')}`).join('\n') + '\n\nSugestão: rode o simulador em People Analytics e crie stay interviews.';
    }
    if (has('orcament', 'budget', 'forecast', 'custo', 'folha')) return `${nome}: orçado ${brl(k.orc.orcadoAno)}; realizado YTD ${brl(k.orc.ytdReal)} (${p100(k.orc.varYtd, 1)} vs orçado no período); forecast ${brl(k.orc.forecastAno)} (${p100(k.orc.varForecast, 1)}). HE no ano: ${brl(k.orc.heYtd)}.`;
    if (has('vaga', 'sla', 'recrut', 'contrata')) {
      const fora = f.vagas.filter((v) => v.diasAberta > v.sla).sort((a, b) => b.diasAberta - a.diasAberta).slice(0, 5);
      return `${nome}: ${k.vagas} vagas abertas, ${k.vagasForaSla} fora do SLA, ${Math.round(k.diasMedios)} dias em média.\nMais atrasadas:\n` + fora.map((v) => `• ${v.id} ${v.cargo} — ${v.diasAberta} dias (SLA ${v.sla}), etapa ${v.etapa}`).join('\n');
    }
    if (has('wfp', 'quadro', 'headcount', 'planejamento', 'forca de trabalho', 'competencia', 'skill')) {
      const w = A.wfp(S.base, aid);
      return `${nome}: HC ${w.total.hc}. Em 12 meses, oferta ${Math.round(w.total.oferta)} × demanda ${Math.round(w.total.demanda)} → ${Math.round(w.total.contratacoes)} contratações necessárias (${Math.round(w.total.pipeline)} em pipeline). Custo anual do gap: ${brl(w.total.custoAnualGap)}.\nGaps de competência: ${w.competencias.filter((s) => s.demanda > s.oferta * 1.2).map((s) => s.skill).join(', ') || 'nenhum relevante'}.`;
    }
    if (has('ferias')) return `${nome}: ${k.feriasVencidas} pessoas com férias vencidas, ${k.feriasDobra} com 2 períodos (pagamento em dobro). Rode a rotina "Varredura de férias" em Automação para gerar o e-mail aos gestores.`;
    if (has('trein', 'regulat', 'pld', 'lgpd', 'compliance')) return `${nome}: ${p100(k.treinamento, 1)} em dia com regulatórios (meta ${p100(A.CONFIG.metaTreinamento)}). ${f.ativos.filter((c) => c.treinamentosPendentes.length).length} pessoas com pendência.`;
    if (has('clima', 'enps', 'engaj')) return `${nome}: eNPS ${k.enps}. ${f.ativos.filter((c) => c.enps <= 6).length} detratores; ${f.ativos.filter((c) => c.trocaGestor12m).length} pessoas trocaram de gestor em 12m.`;
    if (has('divers', 'mulher', 'negro', 'pcd', 'inclus')) return `${nome}: mulheres na liderança ${p100(k.mulheresLideranca)}, negros ${p100(k.negros)}, PcD ${p100(k.pcd, 1)}.`;
    if (has('sucess')) return `${nome}: ${k.posicoesChave} posições-chave; ${p100(k.sucessao)} com sucessor pronto.`;
    if (has('insight', 'prioridade', 'alerta', 'foco', 'atencao', 'urgente', 'fazer')) {
      const ins = A.insights(S.base, aid).slice(0, 5);
      return `Prioridades para ${nome}:\n` + ins.map((i, n) => `${n + 1}. [${i.sev}] ${i.titulo}${S.area === 'todas' && !area ? ' — ' + i.areaNome : ''}\n   → ${i.acao}`).join('\n');
    }
    if (has('resumo', 'status', 'como esta', 'visao', 'panorama', 'geral')) {
      return `${nome}: ${k.hc} pessoas · turnover ${p100(k.turnover, 1)} · previsto ${p100(k.turnoverPrevisto, 1)} · eNPS ${k.enps} · ${k.vagas} vagas (${k.vagasForaSla} fora SLA) · forecast ${p100(k.orc.varForecast, 1)} vs orçado · regulatórios ${p100(k.treinamento, 1)}.`;
    }
    return 'Posso responder sobre: risco de saída, orçamento, vagas, WFP, férias, treinamentos, clima, diversidade, sucessão, prioridades — ou gerar pauta/one-page/business case. Mencione a área (ex.: "risco em Tecnologia").\n\nPara análises livres, materiais por prompt e o coach, ligue o servidor com IA (python -m server).';
  }

  function addMsg(quem, txt) {
    const d = document.createElement('div'); d.className = 'msg ' + quem; d.textContent = txt;
    $('#copilotMsgs').appendChild(d); $('#copilotMsgs').scrollTop = 1e9; return d;
  }
  function abrirCopiloto() { $('#copilot').classList.add('open'); $('#copilotInput').focus(); }
  $('#copilotFab').addEventListener('click', () => { $('#copilot').classList.toggle('open'); if ($('#copilot').classList.contains('open')) $('#copilotInput').focus(); });
  $('#copilotClose').addEventListener('click', () => $('#copilot').classList.remove('open'));
  $('#copilotForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = $('#copilotInput').value.trim(); if (!t) return;
    $('#copilotInput').value = '';
    addMsg('user', t);
    if (!S.base.servidor) { addMsg('bot', responderLocal(t)); return; }
    const espera = addMsg('bot', 'Consultando a base…');
    api('chat', { sessao: S.sessoes.copiloto, modo: 'analista', mensagem: t, contexto: contextoAtual() })
      .then((r) => { espera.innerHTML = V._md.md(r.resposta, r.graficos, 'cp' + Date.now()) + (r.graficos && r.graficos.length ? '<p class="small muted">Gráficos completos no Assistente IA.</p>' : ''); })
      .catch((e) => { espera.textContent = '⚠️ ' + e.message + '\n\n' + responderLocal(t); });
  });
  ['Quais minhas prioridades?', 'Risco de saída em Tecnologia', 'Como está o orçamento?', 'Gerar pauta com o diretor'].forEach((s) => {
    const b = document.createElement('button'); b.className = 'chip'; b.textContent = s;
    b.addEventListener('click', () => { $('#copilotInput').value = s; $('#copilotForm').requestSubmit(); });
    $('#copilotSuggest').appendChild(b);
  });
  addMsg('bot', 'Olá! Sou o copiloto do BP. Pergunte sobre suas áreas, peça prioridades ou um material executivo.');

  // ---------------------------------------------------- Navegação/render
  function renderNav() {
    const crit = A.insights(S.base, S.area).filter((i) => i.sev === 'critico').length;
    const abertas = S.tarefas.filter((t) => t.status !== 'feito' && (S.area === 'todas' || t.area === S.area)).length;
    $('#nav').innerHTML = NAV.map(([g, itens]) => `<div class="nav-group">${g}</div>` + itens.map(([id, n]) =>
      `<button data-view="${id}" ${S.view === id ? 'aria-current="page"' : ''}><span>${n}</span>${id === 'insights' && crit ? `<span class="badge">${crit}</span>` : ''}${id === 'automacao' && abertas ? `<span class="pill">${abertas}</span>` : ''}</button>`).join('')).join('');
    $('#nav').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
  }
  function renderAreaSel() {
    $('#areaSel').innerHTML = '<option value="todas">Todas as diretorias</option>' + S.base.areas.filter((a) => S.base.colaboradores.some((c) => c.area === a.id))
      .map((a) => `<option value="${a.id}" ${S.area === a.id ? 'selected' : ''}>${a.nome}</option>`).join('');
    $('#areaSel').value = S.area;
  }
  function renderTriboSel() {
    const tribos = (S.base.tribos || []).filter((t) => S.area === 'todas' || t.area === S.area);
    if (S.tribo !== 'todas' && !tribos.some((t) => t.id === S.tribo)) S.tribo = 'todas';
    $('#triboSel').innerHTML = '<option value="todas">Todas as tribos</option>' + tribos.map((t) => `<option value="${t.id}">${M.esc(t.nome)}</option>`).join('');
    $('#triboSel').value = S.tribo;
    $('#triboSel').hidden = !tribos.length;
    A.setTribo(S.tribo);
  }
  function render() {
    Object.keys(charts).forEach((id) => { charts[id].destroy(); delete charts[id]; });
    if (!S.base.areas.some((a) => a.id === S.area)) S.area = 'todas';
    renderAreaSel(); renderTriboSel(); renderNav();
    $('#fontePill').textContent = S.base.servidor ? (S.base.sintetico ? '● Servidor · ambiente simulado' : '● Servidor · dados conectados') : '○ Offline · base de demonstração';
    if (S.view === 'dados' && S.base.servidor && !S.catalogo) { api('catalogo').then((c) => { S.catalogo = c; render(); }).catch((e) => toast(e.message)); }
    $('#viewTitle').textContent = TITULOS[S.view];
    $('#copilotFab').hidden = S.view === 'assistente';
    if (S.view === 'assistente') $('#copilot').classList.remove('open');
    $('#dataBadge').textContent = `${S.base.sintetico ? 'Base sintética de demonstração' : 'Base importada'} · referência ${D.HOJE.toLocaleDateString('pt-BR')} · ${S.base.colaboradores.length.toLocaleString('pt-BR')} colaboradores`;
    const v = V[S.view](S, ui);
    const root = $('#view');
    root.innerHTML = v.html;
    root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.tipo) S.ui.tipoMaterial = b.dataset.tipo; go(b.dataset.go); }));
    v.mount(root);
  }
  function go(view) {
    S.view = TITULOS[view] ? view : 'visao';
    if (location.hash !== '#' + S.view) history.replaceState(null, '', '#' + S.view);
    $('#sidebar').classList.remove('open');
    render(); window.scrollTo(0, 0);
  }
  function setArea(id, silencioso) { S.area = id; S.tribo = 'todas'; LS.set('bp-area', id); S.ui.ninebox = null; if (!silencioso) render(); }
  function setTribo(id) { S.tribo = id; render(); }

  $('#areaSel').addEventListener('change', (e) => setArea(e.target.value));
  $('#triboSel').addEventListener('change', (e) => setTribo(e.target.value));
  $('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#themeBtn').addEventListener('click', () => {
    const atual = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = atual === 'dark' ? 'light' : 'dark';
    LS.set('bp-tema', document.documentElement.dataset.theme); render();
  });
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h && h !== S.view) go(h); });

  const ui = {
    chart, ds, opts, render, go, setArea, toast, baixar, baixarCSV, modal, criarTarefa, abrirComunicacao, salvarTarefas, executarRotina, visao360,
    importar, resetBase, exportarSnapshot, testarAgente, perguntarAgente, setTribo, chatEnviar, enviarArquivos, sincronizar, abrirFerramenta,
    aplicarComCoach, abrirMaterialIA, responderLocal, api
  };

  // ------------------------------------------------------------- Início
  const tema = LS.get('bp-tema', null); if (tema) document.documentElement.dataset.theme = tema;
  S.view = TITULOS[location.hash.slice(1)] ? location.hash.slice(1) : 'visao';
  carregarBase().then(() => {
    render();
    enviarSnapshotServidor();
    $('#copilotMode').textContent = S.base.servidor ? 'Conectado à base · IA no servidor' : 'Modo local (offline)';
  }).catch((e) => { $('#view').innerHTML = `<div class="empty">Não foi possível carregar a base: ${M.esc(e.message)}</div>`; });
  window.BPCockpit = { S, ui, snapshot };
})();
