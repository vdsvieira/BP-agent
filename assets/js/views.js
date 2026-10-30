/* =========================================================================
 * Cockpit do BP — Telas (cada view devolve { html, mount })
 * ========================================================================= */
(function (global) {
  'use strict';
  const A = global.BPAnalytics;
  const M = global.BPMateriais;
  const { brl, p100, dec } = A.fmt;
  const { sum, avg } = A.util;
  const esc = M.esc;
  const int = (n) => Math.round(n).toLocaleString('pt-BR');
  const sinal = (v, d = 1) => (v > 0 ? '+' : '') + p100(v, d);
  const ST_LABEL = { critico: 'Crítico', atencao: 'Atenção', oportunidade: 'Oportunidade', ok: 'Ok' };

  function tile(lbl, val, delta, status) {
    return `<div class="tile ${status ? 'status-' + status : ''}"><div class="lbl">${lbl}</div><div class="val">${val}</div>${delta ? `<div class="delta">${delta}</div>` : ''}</div>`;
  }
  const st = (s, txt) => `<span class="st ${s}">${txt || ST_LABEL[s]}</span>`;
  const card = (titulo, hint, body, extra) => `<section class="card"><div class="card-head"><div><h2>${titulo}</h2>${hint ? `<p class="hint">${hint}</p>` : ''}</div>${extra || ''}</div>${body}</section>`;
  const canvas = (id, tall) => `<div class="chart-box ${tall ? 'tall' : ''}"><canvas id="${id}" role="img"></canvas></div>`;

  // Status por indicador (limiares configuráveis)
  const LIMIAR = {
    turnover: (v) => (v > 0.18 ? 'critico' : v > 0.13 ? 'atencao' : 'ok'),
    turnoverPrevisto: (v) => (v > 0.14 ? 'critico' : v > 0.10 ? 'atencao' : 'ok'),
    enps: (v) => (v < 0 ? 'critico' : v < 20 ? 'atencao' : 'ok'),
    absenteismo: (v) => (v > 3 ? 'critico' : v > 2.2 ? 'atencao' : 'ok'),
    heMedia: (v) => (v > 14 ? 'critico' : v > 10 ? 'atencao' : 'ok'),
    pctForaSla: (v) => (v > 0.4 ? 'critico' : v > 0.25 ? 'atencao' : 'ok'),
    treinamento: (v) => (v < 0.95 ? 'critico' : v < 0.98 ? 'atencao' : 'ok'),
    sucessao: (v) => (v < 0.4 ? 'critico' : v < 0.6 ? 'atencao' : 'ok'),
    varForecast: (v) => (v > 0.02 ? 'critico' : v > 0 ? 'atencao' : 'ok'),
    mulheresLideranca: (v) => (v < 0.3 ? 'critico' : v < 0.4 ? 'atencao' : 'ok'),
    compaMedio: (v) => (v < 0.92 ? 'critico' : v < 0.96 ? 'atencao' : 'ok'),
    feriasPct: (v) => (v > 0.08 ? 'critico' : v > 0.04 ? 'atencao' : 'ok')
  };

  function insightItem(i, mostrarArea) {
    return `<div class="insight">
      <div class="t">${esc(i.titulo)}</div>
      <div>${st(i.sev)}</div>
      <div class="d">${esc(i.detalhe)}</div>
      <div class="acao"><b>Ação:</b> ${esc(i.acao)}</div>
      <div class="meta">${mostrarArea ? `<span class="pill">${esc(i.areaNome)}</span>` : ''}${i.subsistemas.map((s) => `<span class="pill">${esc(s)}</span>`).join('')}
        ${i.impacto ? `<span class="small muted">Exposição: ${brl(i.impacto)}</span>` : ''}<span class="spacer"></span>
        <button class="btn sm" data-comm="${i.id}">✉ Comunicação</button>
        <button class="btn sm primary" data-task="${i.id}">＋ Criar tarefa</button></div>
    </div>`;
  }
  function bindInsightButtons(root, lista, ui) {
    root.querySelectorAll('[data-task]').forEach((b) => b.addEventListener('click', () => ui.criarTarefa(lista.find((i) => i.id === b.dataset.task))));
    root.querySelectorAll('[data-comm]').forEach((b) => b.addEventListener('click', () => ui.abrirComunicacao(lista.find((i) => i.id === b.dataset.comm))));
  }

  // ======================================================================
  const V = {};

  // ---------------------------------------------------------------- Visão
  V.visao = function (S, ui) {
    const k = A.kpis(S.base, S.area);
    const ins = A.insights(S.base, S.area);
    const multi = S.area === 'todas';
    const html = `
      <div class="tiles">
        ${tile('Headcount', int(k.hc), `${int(k.admissoes)} admissões · ${int(k.desligamentos)} saídas (12m)`)}
        ${tile('Turnover 12m', p100(k.turnover, 1), `voluntário ${p100(k.turnoverVol, 1)} · regretted ${p100(k.regrettedPct)}`, LIMIAR.turnover(k.turnover))}
        ${tile('Turnover vol. previsto', p100(k.turnoverPrevisto, 1), `≈ ${int(k.saidasEsperadas)} saídas em 12m (modelo)`, LIMIAR.turnoverPrevisto(k.turnoverPrevisto))}
        ${tile('Talentos em risco alto', int(k.talentosRisco), `${int(k.riscoAlto)} pessoas em risco alto no total`, k.talentosRisco ? 'critico' : 'ok')}
        ${tile('eNPS', k.enps, 'promotores − detratores', LIMIAR.enps(k.enps))}
        ${tile('Vagas abertas', int(k.vagas), `${k.vagasForaSla} fora do SLA · ${Math.round(k.diasMedios)} dias em média`, LIMIAR.pctForaSla(k.pctForaSla))}
        ${tile('Forecast pessoal vs orçado', sinal(k.orc.varForecast), `${brl(k.orc.forecastAno)} de ${brl(k.orc.orcadoAno)}`, LIMIAR.varForecast(k.orc.varForecast))}
        ${tile('Treinamentos regulatórios', p100(k.treinamento, 1), `${int(k.feriasVencidas)} com férias vencidas`, LIMIAR.treinamento(k.treinamento))}
      </div>
      <div class="grid g2">
        ${card('Headcount mensal', 'Últimos 12 meses', canvas('chHc'))}
        ${card('Movimentação mensal', 'Admissões e desligamentos', canvas('chMov'))}
      </div>
      <div class="grid g-2-1">
        ${card('Insights prioritários', 'Cruzamento automático entre subsistemas', `<div id="insTop">${ins.slice(0, 6).map((i) => insightItem(i, multi)).join('') || '<div class="empty">Nenhum alerta.</div>'}</div>`, `<button class="btn sm" data-go="insights">Ver todos (${ins.length})</button>`)}
        ${card('Agenda do BP', 'Gerada a partir dos alertas e tarefas', agendaBP(S, k, ins))}
      </div>
      ${multi ? card('Telemetria por área', 'Clique em uma área para focar o cockpit', matriz(S)) : ''}`;
    return {
      html, mount(root) {
        const s = k.serie;
        ui.chart('chHc', { type: 'line', data: { labels: s.map((x) => x.label), datasets: [ui.ds('Headcount', s.map((x) => x.hc), 0, 'line')] }, options: ui.opts({ legend: false }) });
        ui.chart('chMov', {
          type: 'bar', data: {
            labels: s.map((x) => x.label), datasets: [ui.ds('Admissões', s.map((x) => x.admissoes), 0), ui.ds('Deslig. voluntários', s.map((x) => x.desligVol), 1), ui.ds('Deslig. involuntários', s.map((x) => x.desligInv), 2)]
          }, options: ui.opts({})
        });
        bindInsightButtons(root, ins, ui);
        bindMatriz(root, ui);
      }
    };
  };

  function agendaBP(S, k, ins) {
    const abertas = S.tarefas.filter((t) => t.status !== 'feito');
    const atrasadas = abertas.filter((t) => new Date(t.prazo) < global.BPData.HOJE);
    const itens = [
      ['Reunião mensal com diretoria', 'Gerar pauta automática', 'materiais'],
      [`${ins.filter((i) => i.sev === 'critico').length} alertas críticos`, 'Transformar em plano de ação', 'insights'],
      [`${abertas.length} tarefas abertas`, atrasadas.length ? `${atrasadas.length} atrasada(s)` : 'Nenhuma atrasada', 'automacao'],
      [`${k.vagasForaSla} vagas fora do SLA`, 'Preparar comitê de vagas', 'vagas'],
      ['Ciclo de mérito', `${int(k.abaixo90)} pessoas com compa < 0,90`, 'preditivo']
    ];
    return '<div>' + itens.map(([t, d, v]) => `<div class="insight"><div class="t">${t}</div><div><button class="btn sm" data-go="${v}">Abrir</button></div><div class="d">${d}</div></div>`).join('') + '</div>';
  }

  function matriz(S) {
    const cols = [
      ['HC', (k) => int(k.hc)], ['Turnover', (k) => p100(k.turnover, 1), (k) => LIMIAR.turnover(k.turnover)],
      ['Previsto', (k) => p100(k.turnoverPrevisto, 1), (k) => LIMIAR.turnoverPrevisto(k.turnoverPrevisto)],
      ['Talentos risco', (k) => k.talentosRisco, (k) => (k.talentosRisco > 4 ? 'critico' : k.talentosRisco ? 'atencao' : 'ok')],
      ['eNPS', (k) => k.enps, (k) => LIMIAR.enps(k.enps)], ['Absent.', (k) => p100(k.absenteismo / 100, 1), (k) => LIMIAR.absenteismo(k.absenteismo)],
      ['HE/mês', (k) => dec(k.heMedia, 1) + 'h', (k) => LIMIAR.heMedia(k.heMedia)], ['Compa', (k) => dec(k.compaMedio, 2), (k) => LIMIAR.compaMedio(k.compaMedio)],
      ['Vagas (fora SLA)', (k) => `${k.vagas} (${k.vagasForaSla})`, (k) => LIMIAR.pctForaSla(k.pctForaSla)],
      ['Trein. reg.', (k) => p100(k.treinamento, 1), (k) => LIMIAR.treinamento(k.treinamento)],
      ['Férias venc.', (k) => k.feriasVencidas, (k) => LIMIAR.feriasPct(k.feriasVencidas / k.hc)],
      ['Sucessão', (k) => p100(k.sucessao), (k) => LIMIAR.sucessao(k.sucessao)],
      ['Mulheres lider.', (k) => p100(k.mulheresLideranca), (k) => LIMIAR.mulheresLideranca(k.mulheresLideranca)],
      ['Forecast orç.', (k) => sinal(k.orc.varForecast), (k) => LIMIAR.varForecast(k.orc.varForecast)]
    ];
    const rows = S.base.areas.filter((a) => S.base.colaboradores.some((c) => c.area === a.id)).map((a) => {
      const k = A.kpis(S.base, a.id);
      return `<tr class="clickable" data-area="${a.id}"><td><b>${esc(a.nome)}</b></td>${cols.map(([, f, s]) => `<td class="num">${s ? st(s(k), f(k)) : f(k)}</td>`).join('')}</tr>`;
    }).join('');
    return `<div class="table-wrap"><table><thead><tr><th>Área</th>${cols.map(([c]) => `<th class="num">${c}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function bindMatriz(root, ui) { root.querySelectorAll('tr[data-area]').forEach((tr) => tr.addEventListener('click', () => ui.setArea(tr.dataset.area))); }

  // ----------------------------------------------------------- Telemetria
  V.telemetria = function (S, ui) {
    const k = A.kpis(S.base, S.area);
    const html = `
      <div class="tiles">
        ${tile('Absenteísmo (mês)', p100(k.absenteismo / 100, 2), `tendência trimestral ${sinal(k.tendAbs)}`, LIMIAR.absenteismo(k.absenteismo))}
        ${tile('Horas extras / pessoa', dec(k.heMedia, 1) + 'h', `tendência ${sinal(k.tendHE)} · custo ano ${brl(k.orc.heYtd)}`, LIMIAR.heMedia(k.heMedia))}
        ${tile('Compa-ratio médio', dec(k.compaMedio, 2), `${int(k.abaixo90)} pessoas abaixo de 0,90`, LIMIAR.compaMedio(k.compaMedio))}
        ${tile('Folha mensal (c/ encargos)', brl(k.folhaMensal), 'base ativa atual')}
        ${tile('Férias vencidas', int(k.feriasVencidas), `${k.feriasDobra} com 2 períodos (pagamento em dobro)`, LIMIAR.feriasPct(k.feriasVencidas / Math.max(1, k.hc)))}
        ${tile('Diversidade', p100(k.mulheresLideranca), `mulheres na liderança · negros ${p100(k.negros)} · PcD ${p100(k.pcd, 1)}`, LIMIAR.mulheresLideranca(k.mulheresLideranca))}
      </div>
      <div class="grid g2">
        ${card('Absenteísmo mensal', '% de horas perdidas', canvas('chAbs'))}
        ${card('Horas extras por pessoa', 'Média mensal (horas)', canvas('chHe'))}
      </div>
      ${card('Matriz de telemetria', 'Status por área e indicador — clique para focar', matriz(S))}`;
    return {
      html, mount(root) {
        const s = k.serie;
        ui.chart('chAbs', { type: 'line', data: { labels: s.map((x) => x.label), datasets: [ui.ds('Absenteísmo %', s.map((x) => +x.absenteismo.toFixed(2)), 0, 'line')] }, options: ui.opts({ legend: false }) });
        ui.chart('chHe', { type: 'line', data: { labels: s.map((x) => x.label), datasets: [ui.ds('HE/pessoa', s.map((x) => +x.he.toFixed(1)), 1, 'line')] }, options: ui.opts({ legend: false }) });
        bindMatriz(root, ui);
      }
    };
  };

  // ------------------------------------------------------------ Preditivo
  V.preditivo = function (S, ui) {
    const m = S.modelo;
    const f = A.filtrar(S.base, S.area);
    const sel = S.ui.ninebox; // {d,p} ou null
    let lista = f.ativos.slice();
    if (S.ui.soTalentos) lista = lista.filter((c) => c.talento);
    if (sel) lista = lista.filter((c) => { const b = A.caixa9(c); return b.d === sel.d && b.p === sel.p; });
    if (S.ui.busca) { const q = S.ui.busca.toLowerCase(); lista = lista.filter((c) => (c.nome + c.matricula + c.cargo).toLowerCase().includes(q)); }
    lista.sort((a, b) => b.risco - a.risco);
    const nb = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ n: 0, alto: 0 })));
    f.ativos.forEach((c) => { const b = A.caixa9(c); nb[b.p][b.d].n++; if (c.faixaRisco === 'Alto') nb[b.p][b.d].alto++; });
    const sc = S.ui.sim;
    const sim = A.simularRetencao(S.base, m, S.area, sc);

    const html = `
      <div class="tiles">
        ${tile('Saídas voluntárias previstas (12m)', int(sum(f.ativos, (c) => c.risco)), `turnover vol. previsto ${p100(avg(f.ativos, (c) => c.risco), 1)}`)}
        ${tile('Risco alto (≥ ' + p100(A.CONFIG.riscoAlto) + ')', int(f.ativos.filter((c) => c.faixaRisco === 'Alto').length), `${int(f.ativos.filter((c) => c.faixaRisco === 'Médio').length)} em risco médio`, 'critico')}
        ${tile('Exposição financeira', brl(sum(f.ativos, (c) => c.risco * A.custoReposicao(c))), `custo de reposição esperado (${A.CONFIG.mesesCustoReposicao} salários/saída)`)}
        ${tile('Qualidade do modelo (AUC)', dec(m.aucTeste, 2), `validação holdout · ${int(m.n)} registros · taxa base ${p100(m.taxaBase, 1)}`, m.aucTeste >= 0.7 ? 'ok' : 'atencao')}
      </div>
      <div class="grid g2">
        ${card('O que explica a saída voluntária', 'Pesos padronizados da regressão logística (reaprendidos dos dados)', canvas('chFeat', true))}
        ${card('Matriz 9-box × risco de saída', 'Clique em um quadrante para filtrar a lista. Número em destaque = pessoas; abaixo, quantas em risco alto.', ninebox(nb, sel))}
      </div>
      <div class="grid g-2-1">
        ${card('Colaboradores por risco de saída', `${lista.length} pessoas${sel ? ' no quadrante selecionado' : ''}`, `
          <div class="row" style="margin-bottom:10px">
            <input type="search" id="busca" placeholder="Buscar nome, matrícula ou cargo" value="${esc(S.ui.busca || '')}">
            <label class="row small"><input type="checkbox" id="soTal" ${S.ui.soTalentos ? 'checked' : ''}> só talentos</label>
            ${sel ? '<button class="btn sm" id="limpaNb">Limpar 9-box</button>' : ''}
            <span class="spacer"></span><button class="btn sm" id="expRisco">⇩ CSV</button>
          </div>
          <div class="table-wrap" style="max-height:520px;overflow:auto"><table><thead><tr><th>Colaborador</th><th>Área / cargo</th><th class="num">Desemp.</th><th class="num">Compa</th><th class="num">Risco 12m</th><th>Principais fatores</th></tr></thead><tbody>
          ${lista.slice(0, 150).map((c) => `<tr class="clickable" data-mat="${c.matricula}"><td><b>${esc(S.anon ? c.matricula : c.nome)}</b><div class="small muted">${c.matricula} · ${c.nivel}${c.talento ? ' · <b>talento</b>' : ''}</div></td>
            <td>${esc(areaNome(S, c.area))}<div class="small muted">${esc(c.cargo)}</div></td><td class="num">${c.desempenho}/${c.potencial}</td><td class="num">${dec(c.compaRatio, 2)}</td>
            <td class="num">${st(c.faixaRisco === 'Alto' ? 'critico' : c.faixaRisco === 'Médio' ? 'atencao' : 'ok', p100(c.risco))}</td><td class="small">${esc(c.riscoDrivers.join(' · ') || '—')}</td></tr>`).join('')}
          </tbody></table></div>`)}
        ${card('Simulador de retenção', 'Efeito estimado de ações sobre o grupo em risco alto', `
          <label class="field">Mérito / ajuste salarial: <b id="vMer">${p100(sc.merito)}</b><input type="range" id="sMer" min="0" max="0.2" step="0.01" value="${sc.merito}"></label>
          <label class="field" style="margin-top:8px">Redução de horas extras: <b id="vHe">${p100(sc.reducaoHE)}</b><input type="range" id="sHe" min="0" max="1" step="0.05" value="${sc.reducaoHE}"></label>
          <div class="row small" style="margin:10px 0">
            <label><input type="checkbox" id="sFer" ${sc.ferias ? 'checked' : ''}> Regularizar férias</label>
            <label><input type="checkbox" id="sStay" ${sc.stay ? 'checked' : ''}> Stay interview</label>
            <label><input type="checkbox" id="sTal" ${sc.soTalentos ? 'checked' : ''}> Só talentos</label>
          </div>
          <div class="tiles" style="grid-template-columns:1fr 1fr">
            ${tile('Pessoas no grupo', int(sim.n))}
            ${tile('Saídas evitadas', dec(sim.saidasEvitadas, 1), `${dec(sim.antes, 1)} → ${dec(sim.depois, 1)}`, 'ok')}
            ${tile('Custo anual da ação', brl(sim.custo))}
            ${tile('Reposição evitada', brl(sim.evitado), `ROI ${sinal(sim.roi, 0)}`, sim.roi >= 0 ? 'ok' : 'atencao')}
          </div>
          <p class="small muted">Estimativa baseada no modelo; não considera ganhos de produtividade nem efeito em equipe. Use como apoio ao comitê de remuneração.</p>
          <button class="btn primary" id="simTask">＋ Criar plano de retenção</button>`)}
      </div>`;
    return {
      html, mount(root) {
        const feats = A.FEATURES.map((ft, j) => ({ nome: ft.nome, w: m.w[j] })).sort((a, b) => b.w - a.w);
        ui.chart('chFeat', {
          type: 'bar', data: {
            labels: feats.map((x) => x.nome), datasets: [
              ui.ds('Aumenta o risco', feats.map((x) => (x.w > 0 ? +x.w.toFixed(3) : null)), 1),
              ui.ds('Reduz o risco', feats.map((x) => (x.w < 0 ? +x.w.toFixed(3) : null)), 0)]
          }, options: ui.opts({ indexAxis: 'y', stacked: true })
        });
        root.querySelectorAll('[data-nb]').forEach((el) => el.addEventListener('click', () => {
          const [d, p] = el.dataset.nb.split(',').map(Number);
          S.ui.ninebox = sel && sel.d === d && sel.p === p ? null : { d, p }; ui.render();
        }));
        const lim = root.querySelector('#limpaNb'); if (lim) lim.addEventListener('click', () => { S.ui.ninebox = null; ui.render(); });
        const busca = root.querySelector('#busca');
        busca.addEventListener('change', () => { S.ui.busca = busca.value; ui.render(); });
        root.querySelector('#soTal').addEventListener('change', (e) => { S.ui.soTalentos = e.target.checked; ui.render(); });
        root.querySelector('#expRisco').addEventListener('click', () => ui.baixarCSV('risco_saida.csv', lista.map((c) => ({
          matricula: c.matricula, nome: S.anon ? '' : c.nome, area: c.area, cargo: c.cargo, nivel: c.nivel, desempenho: c.desempenho, potencial: c.potencial,
          compa_ratio: c.compaRatio, risco_12m: dec(c.risco, 3), faixa: c.faixaRisco, fatores: c.riscoDrivers.join(' | ')
        }))));
        root.querySelectorAll('tr[data-mat]').forEach((tr) => tr.addEventListener('click', () => ui.visao360(tr.dataset.mat)));
        const upd = (k, v) => { S.ui.sim[k] = v; ui.render(); };
        root.querySelector('#sMer').addEventListener('change', (e) => upd('merito', +e.target.value));
        root.querySelector('#sMer').addEventListener('input', (e) => { root.querySelector('#vMer').textContent = p100(+e.target.value); });
        root.querySelector('#sHe').addEventListener('change', (e) => upd('reducaoHE', +e.target.value));
        root.querySelector('#sHe').addEventListener('input', (e) => { root.querySelector('#vHe').textContent = p100(+e.target.value); });
        root.querySelector('#sFer').addEventListener('change', (e) => upd('ferias', e.target.checked));
        root.querySelector('#sStay').addEventListener('change', (e) => upd('stay', e.target.checked));
        root.querySelector('#sTal').addEventListener('change', (e) => upd('soTalentos', e.target.checked));
        root.querySelector('#simTask').addEventListener('click', () => {
          const grupo = f.ativos.filter((c) => c.faixaRisco === 'Alto' && (!sc.soTalentos || c.talento));
          ui.criarTarefa({
            id: 'sim-' + Date.now(), area: S.area, areaNome: areaNome(S, S.area), playbook: 'stay-interview', alvo: grupo.map((c) => c.matricula),
            titulo: `Plano de retenção: ${grupo.length} pessoas (mérito ${p100(sc.merito)})`, acao: `Evitar ~${dec(sim.saidasEvitadas, 1)} saídas; custo ${brl(sim.custo)}/ano.`
          });
        });
      }
    };
  };

  function ninebox(nb, sel) {
    let cells = '';
    for (let p = 2; p >= 0; p--) {
      if (p === 1) cells += '<div class="axis-y">Potencial →</div>'; else cells += '<div></div>';
      for (let d = 0; d < 3; d++) {
        const c = nb[p][d];
        const isSel = sel && sel.d === d && sel.p === p;
        cells += `<div class="cell ${isSel ? 'sel' : ''}" data-nb="${d},${p}" tabindex="0"><small>${A.NOMES_9BOX[p][d]}</small><b>${c.n}</b>${c.alto ? st('critico', c.alto + ' risco alto') : '<span class="small muted">—</span>'}</div>`;
      }
    }
    return `<div class="ninebox">${cells}<div class="axis-x">Desempenho →</div></div>`;
  }
  const areaNome = (S, id) => (id === 'todas' ? 'Todas as áreas' : (S.base.areas.find((a) => a.id === id) || { nome: id }).nome);

  // ----------------------------------------------------------- Orçamento
  V.orcamento = function (S, ui) {
    const k = A.kpis(S.base, S.area);
    const o = k.orc;
    const f = A.filtrar(S.base, S.area);
    const NM = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const html = `
      <div class="tiles">
        ${tile('Orçado no ano', brl(o.orcadoAno), 'pessoal c/ encargos, 13º e HE')}
        ${tile('Realizado acumulado', brl(o.ytdReal), `${sinal(o.varYtd)} vs orçado no período`, LIMIAR.varForecast(o.varYtd))}
        ${tile('Forecast de fechamento', brl(o.forecastAno), `${sinal(o.varForecast)} vs orçado`, LIMIAR.varForecast(o.varForecast))}
        ${tile('Horas extras no ano', brl(o.heYtd), `${p100(o.heYtd / Math.max(1, o.ytdReal), 1)} do realizado`, LIMIAR.heMedia(k.heMedia))}
        ${tile('Treinamento', p100(o.treinoReal / Math.max(1, o.treinoOrc)), `${brl(o.treinoReal)} de ${brl(o.treinoOrc)}`)}
      </div>
      ${card('Orçado × realizado × forecast', 'Mensal, ano corrente. Dezembro inclui 13º salário.', canvas('chOrc', true))}
      ${card('Por área', '', `<div class="table-wrap"><table><thead><tr><th>Área</th><th class="num">HC atual</th><th class="num">HC plano</th><th class="num">Orçado ano</th><th class="num">Realizado YTD</th><th class="num">Var. YTD</th><th class="num">Forecast</th><th class="num">Var. forecast</th><th>Status</th></tr></thead><tbody>
        ${f.areas.map((a) => { const x = A.kpis(S.base, a.id); const ob = S.base.orcamento[a.id] || {}; return `<tr class="clickable" data-area="${a.id}"><td><b>${esc(a.nome)}</b></td><td class="num">${x.hc}</td><td class="num">${ob.hcPlano || '—'}</td><td class="num">${brl(x.orc.orcadoAno)}</td><td class="num">${brl(x.orc.ytdReal)}</td><td class="num">${sinal(x.orc.varYtd)}</td><td class="num">${brl(x.orc.forecastAno)}</td><td class="num">${sinal(x.orc.varForecast)}</td><td>${st(LIMIAR.varForecast(x.orc.varForecast))}</td></tr>`; }).join('')}
      </tbody></table></div>`, '<button class="btn sm" data-go="materiais" data-tipo="orcamento">Gerar nota orçamentária</button>')}`;
    return {
      html, mount(root) {
        const mes = global.BPData.HOJE.getMonth();
        ui.chart('chOrc', {
          type: 'bar', data: {
            labels: NM, datasets: [
              Object.assign(ui.ds('Orçado', o.meses.map((x) => Math.round(x.orcado / 1e3)), 3, 'line'), { type: 'line' }),
              ui.ds('Realizado', o.meses.map((x, i) => (i <= mes ? Math.round(x.realizado / 1e3) : null)), 0),
              ui.ds('Forecast', o.meses.map((x, i) => (i > mes ? Math.round(x.forecast / 1e3) : null)), 0, 'forecast')]
          }, options: ui.opts({ unidade: 'R$ mil', stacked: true })
        });
        bindMatriz(root, ui);
      }
    };
  };

  // ---------------------------------------------------------------- Vagas
  V.vagas = function (S, ui) {
    const f = A.filtrar(S.base, S.area);
    const filtro = S.ui.filtroVagas || 'todas';
    const FILTROS = { todas: 'Todas', fora: 'Fora do SLA', alta: 'Prioridade alta', naoOrcada: 'Não orçadas', aumento: 'Aumento de quadro' };
    const lista = f.vagas.filter((v) => filtro === 'todas' || (filtro === 'fora' && v.diasAberta > v.sla) || (filtro === 'alta' && v.prioridade === 'Alta') ||
      (filtro === 'naoOrcada' && !v.orcada) || (filtro === 'aumento' && v.motivo === 'Aumento de quadro')).sort((a, b) => (b.diasAberta - b.sla) - (a.diasAberta - a.sla));
    const fora = f.vagas.filter((v) => v.diasAberta > v.sla);
    const etapas = global.BPData.ETAPAS;
    const buckets = [['0–30', 0, 30], ['31–60', 31, 60], ['61–90', 61, 90], ['91–120', 91, 120], ['> 120', 121, 9999]];
    const porRec = {};
    f.vagas.forEach((v) => { const r = porRec[v.recrutador] = porRec[v.recrutador] || { n: 0, fora: 0, dias: 0 }; r.n++; r.dias += v.diasAberta; if (v.diasAberta > v.sla) r.fora++; });
    const html = `
      <div class="tiles">
        ${tile('Vagas abertas', int(f.vagas.length), `${f.vagas.filter((v) => v.motivo === 'Aumento de quadro').length} aumento de quadro`)}
        ${tile('Fora do SLA', int(fora.length), p100(fora.length / Math.max(1, f.vagas.length)), LIMIAR.pctForaSla(fora.length / Math.max(1, f.vagas.length)))}
        ${tile('Dias em aberto (média)', Math.round(avg(f.vagas, (v) => v.diasAberta)))}
        ${tile('Em proposta/admissão', int(f.vagas.filter((v) => v.etapa === 'Proposta' || v.etapa === 'Admissão').length), 'entradas nas próximas semanas')}
        ${tile('Não orçadas', int(f.vagas.filter((v) => !v.orcada).length), 'exigem aprovação de budget', f.vagas.some((v) => !v.orcada) ? 'atencao' : 'ok')}
        ${tile('Vagas afirmativas', int(f.vagas.filter((v) => v.diversidade).length), 'D&I')}
      </div>
      <div class="grid g3">
        ${card('Funil por etapa', '', canvas('chFunil'))}
        ${card('Aging das vagas', 'Dias em aberto', canvas('chAging'))}
        ${card('Por recrutador', '', `<table><thead><tr><th>Recrutador</th><th class="num">Vagas</th><th class="num">Fora SLA</th><th class="num">Dias méd.</th></tr></thead><tbody>${Object.entries(porRec).sort().map(([r, x]) => `<tr><td>${esc(r)}</td><td class="num">${x.n}</td><td class="num">${x.fora}</td><td class="num">${Math.round(x.dias / x.n)}</td></tr>`).join('')}</tbody></table>`)}
      </div>
      ${card('Requisições', `${lista.length} vagas`, `
        <div class="chips" style="margin-bottom:10px">${Object.entries(FILTROS).map(([id, n]) => `<button class="chip" data-fv="${id}" aria-pressed="${filtro === id}">${n}</button>`).join('')}</div>
        <div class="table-wrap" style="max-height:480px;overflow:auto"><table><thead><tr><th>Requisição</th><th>Área / cargo</th><th>Nível</th><th>Motivo</th><th>Etapa</th><th class="num">Dias</th><th class="num">SLA</th><th class="num">Candidatos</th><th>Prioridade</th><th>Recrutador</th></tr></thead><tbody>
        ${lista.map((v) => `<tr><td class="mono">${v.id}${v.orcada ? '' : ' <span class="pill">não orçada</span>'}</td><td>${esc(areaNome(S, v.area))}<div class="small muted">${esc(v.cargo)}</div></td><td>${v.nivel}</td><td>${v.motivo}</td><td>${v.etapa}</td>
          <td class="num">${v.diasAberta > v.sla ? st('critico', v.diasAberta) : v.diasAberta}</td><td class="num">${v.sla}</td><td class="num">${v.candidatos}</td><td>${v.prioridade}</td><td>${esc(v.recrutador)}</td></tr>`).join('')}
        </tbody></table></div>`, `<div class="row"><button class="btn sm" id="expVagas">⇩ CSV</button><button class="btn sm primary" id="comiteVagas">＋ Comitê de vagas</button></div>`)}`;
    return {
      html, mount(root) {
        ui.chart('chFunil', { type: 'bar', data: { labels: etapas, datasets: [ui.ds('Vagas', etapas.map((e) => f.vagas.filter((v) => v.etapa === e).length), 0)] }, options: ui.opts({ indexAxis: 'y', legend: false }) });
        ui.chart('chAging', { type: 'bar', data: { labels: buckets.map((b) => b[0]), datasets: [ui.ds('Vagas', buckets.map(([, a, b]) => f.vagas.filter((v) => v.diasAberta >= a && v.diasAberta <= b).length), 0)] }, options: ui.opts({ legend: false }) });
        root.querySelectorAll('[data-fv]').forEach((b) => b.addEventListener('click', () => { S.ui.filtroVagas = b.dataset.fv; ui.render(); }));
        root.querySelector('#expVagas').addEventListener('click', () => ui.baixarCSV('vagas.csv', lista));
        root.querySelector('#comiteVagas').addEventListener('click', () => ui.criarTarefa({
          id: 'sla-manual-' + Date.now(), area: S.area, areaNome: areaNome(S, S.area), playbook: 'sla-vagas', alvo: fora.map((v) => v.id),
          titulo: `Comitê de vagas: ${fora.length} fora do SLA`, acao: 'Decidir manter, revisar perfil ou cancelar.'
        }));
      }
    };
  };

  // ------------------------------------------------------------------ WFP
  V.wfp = function (S, ui) {
    const sc = S.ui.cenario;
    const w = A.wfp(S.base, S.area, sc);
    const html = `
      ${card('Cenário', 'Ajuste as premissas e veja o efeito sobre oferta, demanda e contratações (horizonte 12 meses)', `
        <div class="grid g3">
          <label class="field">Crescimento adicional do negócio: <b>${sinal(sc.crescimento, 0)}</b><input type="range" data-sc="crescimento" min="-0.1" max="0.2" step="0.01" value="${sc.crescimento}"></label>
          <label class="field">Ganho adicional de automação/IA: <b>${p100(sc.automacao)}</b><input type="range" data-sc="automacao" min="0" max="0.15" step="0.01" value="${sc.automacao}"></label>
          <label class="field">Redução de saídas por retenção: <b>${p100(sc.retencao)}</b><input type="range" data-sc="retencao" min="0" max="0.5" step="0.05" value="${sc.retencao}"></label>
        </div>`)}
      <div class="tiles">
        ${tile('HC atual', int(w.total.hc))}
        ${tile('Oferta projetada (12m)', int(w.total.oferta), `− ${int(w.total.volEsperado)} saídas vol. previstas`)}
        ${tile('Demanda projetada (12m)', int(w.total.demanda), 'crescimento − automação')}
        ${tile('Contratações necessárias', int(w.total.contratacoes), `${int(w.total.pipeline)} já em pipeline`, w.total.contratacoes - w.total.pipeline > w.total.hc * 0.1 ? 'atencao' : 'ok')}
        ${tile('Excedente potencial', int(w.total.excedente), 'realocação / requalificação', w.total.excedente > 0 ? 'atencao' : 'ok')}
        ${tile('Custo anual do gap', brl(w.total.custoAnualGap), 'c/ encargos e 13º')}
      </div>
      <div class="grid g2">
        ${card('Projeção de oferta × demanda', 'Headcount nos próximos 12 meses', canvas('chWfp'))}
        ${card('Competências críticas', 'Oferta interna × demanda — decidir build × buy', `<div class="table-wrap"><table><thead><tr><th>Competência</th><th>Área</th><th class="num">Oferta</th><th class="num">Demanda</th><th class="num">Gap</th><th>Cobertura</th></tr></thead><tbody>
          ${w.competencias.slice().sort((a, b) => (b.demanda - b.oferta) - (a.demanda - a.oferta)).map((s) => { const cob = s.oferta / Math.max(1, s.demanda); return `<tr><td>${esc(s.skill)}</td><td class="small">${esc(areaNome(S, s.area))}</td><td class="num">${s.oferta}</td><td class="num">${s.demanda}</td><td class="num">${s.demanda - s.oferta}</td><td><div class="bar-inline"><span style="width:${Math.min(100, cob * 100)}%"></span></div><span class="small muted">${p100(Math.min(1, cob))}</span></td></tr>`; }).join('')}
        </tbody></table></div>`)}
      </div>
      ${card('Plano por área', '', `<div class="table-wrap"><table><thead><tr><th>Área</th><th class="num">HC</th><th class="num">Saídas vol. prev.</th><th class="num">Saídas inv.</th><th class="num">Oferta</th><th class="num">Demanda</th><th class="num">Contratar</th><th class="num">Pipeline</th><th class="num">Excedente</th><th class="num">Custo anual</th></tr></thead><tbody>
        ${w.linhas.map((l) => `<tr class="clickable" data-area="${l.area.id}"><td><b>${esc(l.area.nome)}</b><div class="small muted">cresc. ${sinal(l.area.crescimento, 0)} · autom. ${p100(l.area.automacao)}</div></td><td class="num">${l.hc}</td><td class="num">${dec(l.volEsperado, 0)}</td><td class="num">${l.invEsperado}</td><td class="num">${Math.round(l.oferta)}</td><td class="num">${Math.round(l.demanda)}</td><td class="num"><b>${Math.round(l.contratacoes)}</b></td><td class="num">${Math.round(l.pipeline)}</td><td class="num">${Math.round(l.excedente)}</td><td class="num">${brl(l.custoAnualGap)}</td></tr>`).join('')}
      </tbody></table></div>`, '<button class="btn sm" data-go="materiais" data-tipo="businesscase">Gerar business case</button>')}`;
    return {
      html, mount(root) {
        const p = w.projecao;
        ui.chart('chWfp', {
          type: 'line', data: {
            labels: p.map((x) => (x.mes === 0 ? 'hoje' : '+' + x.mes + 'm')), datasets: [
              ui.ds('Demanda', p.map((x) => Math.round(x.demanda)), 0, 'line'), ui.ds('Oferta sem contratar', p.map((x) => Math.round(x.oferta)), 1, 'line'),
              ui.ds('Oferta + pipeline de vagas', p.map((x) => Math.round(x.comPipeline)), 2, 'line')]
          }, options: ui.opts({})
        });
        root.querySelectorAll('[data-sc]').forEach((r) => r.addEventListener('change', () => { S.ui.cenario[r.dataset.sc] = +r.value; ui.render(); }));
        bindMatriz(root, ui);
      }
    };
  };

  // ---------------------------------------------------------- Subsistemas
  V.subsistemas = function (S, ui) {
    const k = A.kpis(S.base, S.area);
    const f = A.filtrar(S.base, S.area);
    const ins = A.insights(S.base, S.area);
    const subs = [
      ['R&S', [['Vagas abertas', k.vagas], ['Fora do SLA', p100(k.pctForaSla)], ['Dias médios', Math.round(k.diasMedios)]], LIMIAR.pctForaSla(k.pctForaSla), 'vagas'],
      ['Remuneração', [['Compa-ratio médio', dec(k.compaMedio, 2)], ['Abaixo de 0,90', k.abaixo90], ['Folha/mês', brl(k.folhaMensal)]], LIMIAR.compaMedio(k.compaMedio), 'preditivo'],
      ['Desempenho', [['Notas 4–5', p100(f.ativos.filter((c) => c.desempenho >= 4).length / Math.max(1, k.hc))], ['Notas 1–2', p100(f.ativos.filter((c) => c.desempenho <= 2).length / Math.max(1, k.hc))], ['Talentos', f.ativos.filter((c) => c.talento).length]], 'ok', 'preditivo'],
      ['T&D', [['Regulatórios em dia', p100(k.treinamento, 1)], ['Pendências', f.ativos.filter((c) => c.treinamentosPendentes.length).length], ['Budget executado', p100(k.orc.treinoReal / Math.max(1, k.orc.treinoOrc))]], LIMIAR.treinamento(k.treinamento), 'insights'],
      ['Clima & Engajamento', [['eNPS', k.enps], ['Detratores', f.ativos.filter((c) => c.enps <= 6).length], ['Troca de gestor 12m', f.ativos.filter((c) => c.trocaGestor12m).length]], LIMIAR.enps(k.enps), 'insights'],
      ['Saúde Ocupacional', [['Absenteísmo', p100(k.absenteismo / 100, 2)], ['Tendência', sinal(k.tendAbs)], ['> 15 dias ausência', f.ativos.filter((c) => c.absenteismo > 15).length]], LIMIAR.absenteismo(k.absenteismo), 'telemetria'],
      ['DP / Relações Trabalhistas', [['HE/pessoa', dec(k.heMedia, 1) + 'h'], ['Férias vencidas', k.feriasVencidas], ['Em dobro', k.feriasDobra]], k.feriasDobra ? 'critico' : LIMIAR.heMedia(k.heMedia), 'automacao'],
      ['Sucessão & Liderança', [['Posições-chave', k.posicoesChave], ['Com sucessor pronto', p100(k.sucessao)], ['Líderes', f.ativos.filter((c) => c.lider).length]], LIMIAR.sucessao(k.sucessao), 'preditivo'],
      ['Diversidade & Inclusão', [['Mulheres na liderança', p100(k.mulheresLideranca)], ['Negros', p100(k.negros)], ['PcD', p100(k.pcd, 1)]], LIMIAR.mulheresLideranca(k.mulheresLideranca), 'telemetria'],
      ['WFP', [['Contratações 12m', int(A.wfp(S.base, S.area).total.contratacoes)], ['Gaps de skills', f.competencias.filter((s) => s.demanda > s.oferta * 1.2).length], ['Pipeline', int(A.wfp(S.base, S.area).total.pipeline)]], 'atencao', 'wfp'],
      ['Orçamento', [['Forecast vs orçado', sinal(k.orc.varForecast)], ['YTD', sinal(k.orc.varYtd)], ['HE no ano', brl(k.orc.heYtd)]], LIMIAR.varForecast(k.orc.varForecast), 'orcamento'],
      ['People Analytics', [['AUC do modelo', dec(S.modelo.aucTeste, 2)], ['Risco alto', k.riscoAlto], ['Saídas previstas', int(k.saidasEsperadas)]], k.talentosRisco ? 'critico' : 'ok', 'preditivo']
    ];
    // conexões: quantos insights envolvem cada par de subsistemas
    const conex = {};
    ins.forEach((i) => i.subsistemas.forEach((a, x) => i.subsistemas.slice(x + 1).forEach((b) => { const key = [a, b].sort().join(' ↔ '); conex[key] = (conex[key] || 0) + 1; })));
    const html = `
      <div class="grid g3">${subs.map(([nome, ms, s, go]) => `<section class="card"><div class="card-head"><h2>${nome}</h2>${st(s)}</div>
        <table>${ms.map(([l, v]) => `<tr><td class="muted">${l}</td><td class="num"><b>${v}</b></td></tr>`).join('')}</table>
        <div style="margin-top:8px"><button class="btn sm" data-go="${go}">Detalhar →</button></div></section>`).join('')}</div>
      <div class="grid g2">
        ${card('Interligações ativas entre subsistemas', 'Pares de subsistemas que aparecem juntos nos alertas atuais — onde um problema em uma frente está gerando efeito em outra', `<table><thead><tr><th>Conexão</th><th class="num">Alertas</th><th></th></tr></thead><tbody>${Object.entries(conex).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c, n]) => `<tr><td>${c}</td><td class="num">${n}</td><td style="width:40%"><div class="bar-inline"><span style="width:${n / Math.max(...Object.values(conex)) * 100}%"></span></div></td></tr>`).join('')}</tbody></table>`)}
        ${card('Visão 360° do colaborador', 'Todos os subsistemas de uma pessoa em uma tela', `<div class="row"><input type="search" id="b360" placeholder="Matrícula ou nome" list="dl360" style="flex:1"><button class="btn primary" id="go360">Abrir</button></div>
          <datalist id="dl360">${f.ativos.slice(0, 400).map((c) => `<option value="${c.matricula}">${esc(S.anon ? c.cargo : c.nome)}</option>`).join('')}</datalist>
          <p class="small muted">Dica: clique em qualquer pessoa na lista de risco (People Analytics) para abrir a visão 360°.</p>`)}
      </div>`;
    return {
      html, mount(root) {
        const go = () => {
          const q = root.querySelector('#b360').value.trim().toLowerCase();
          const c = S.base.colaboradores.find((x) => x.matricula.toLowerCase() === q) || S.base.colaboradores.find((x) => x.nome.toLowerCase().includes(q));
          if (c) ui.visao360(c.matricula); else ui.toast('Colaborador não encontrado');
        };
        root.querySelector('#go360').addEventListener('click', go);
        root.querySelector('#b360').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      }
    };
  };

  V.html360 = function (S, c) {
    const box = A.NOMES_9BOX[A.caixa9(c).p][A.caixa9(c).d];
    const sec = (t, rows) => `<h3 style="font-size:13px;margin:14px 0 6px">${t}</h3><table>${rows.map(([l, v]) => `<tr><td class="muted" style="width:45%">${l}</td><td>${v}</td></tr>`).join('')}</table>`;
    return `<div class="row"><div><b style="font-size:16px">${esc(S.anon ? c.matricula : c.nome)}</b><div class="muted small">${c.matricula} · ${esc(c.cargo)} · ${c.nivel} · ${esc(areaNome(S, c.area))}</div></div><span class="spacer"></span>${st(c.faixaRisco === 'Alto' ? 'critico' : c.faixaRisco === 'Médio' ? 'atencao' : 'ok', 'Risco de saída ' + p100(c.risco))}</div>
      ${sec('People Analytics', [['Fatores de risco', esc(c.riscoDrivers.join(' · ') || '—')], ['9-box', `${box} (desempenho ${c.desempenho}, potencial ${c.potencial})`], ['Talento-chave', c.talento ? 'Sim' : 'Não']])}
      ${sec('Remuneração', [['Salário base', 'R$ ' + int(c.salario)], ['Compa-ratio', dec(c.compaRatio, 2)], ['Meses sem aumento / promoção', `${c.mesesSemAumento} / ${c.mesesSemPromocao}`]])}
      ${sec('Jornada & DP', [['Tempo de casa', (c.tempoCasaMeses / 12).toFixed(1) + ' anos'], ['Horas extras/mês', c.heMes + 'h'], ['Férias vencidas', c.feriasVencidas ? st('critico', c.feriasVencidas + ' período(s)') : 'Nenhuma'], ['Modelo de trabalho', c.modelo]])}
      ${sec('Saúde & Clima', [['Absenteísmo 12m', c.absenteismo + ' dias'], ['Nota de clima', c.enps + '/10'], ['Troca de gestor 12m', c.trocaGestor12m ? 'Sim' : 'Não']])}
      ${sec('T&D, Sucessão e D&I', [['Regulatórios pendentes', c.treinamentosPendentes.length ? st('critico', c.treinamentosPendentes.join(', ')) : st('ok', 'Em dia')], ['Competência crítica', c.skill || '—'], ['Posição-chave', c.posicaoChave ? (c.sucessorPronto ? 'Sim, com sucessor pronto' : 'Sim, sem sucessor pronto') : 'Não'], ['Gênero / raça / PcD', `${c.genero} / ${c.raca} / ${c.pcd ? 'Sim' : 'Não'}`]])}`;
  };

  // ------------------------------------------------------------- Insights
  V.insights = function (S, ui) {
    const todos = A.insights(S.base, S.area);
    const fs = S.ui.filtroSev || 'todos';
    const lista = todos.filter((i) => fs === 'todos' || i.sev === fs);
    const cont = (s) => todos.filter((i) => i.sev === s).length;
    const html = `
      <div class="tiles">
        ${tile('Críticos', cont('critico'), 'exigem decisão', cont('critico') ? 'critico' : 'ok')}
        ${tile('Atenção', cont('atencao'), 'monitorar / agir no mês', cont('atencao') ? 'atencao' : 'ok')}
        ${tile('Oportunidades', cont('oportunidade'), 'ganhos possíveis')}
        ${tile('Exposição total mapeada', brl(sum(todos, (i) => Math.max(0, i.impacto))), 'soma das estimativas')}
      </div>
      ${card('Insights inteligentes', 'Regras que cruzam People Analytics, DP, Remuneração, T&D, Clima, R&S, WFP e Orçamento', `
        <div class="chips" style="margin-bottom:6px">${[['todos', 'Todos'], ['critico', 'Críticos'], ['atencao', 'Atenção'], ['oportunidade', 'Oportunidades']].map(([id, n]) => `<button class="chip" data-fs="${id}" aria-pressed="${fs === id}">${n}</button>`).join('')}</div>
        ${lista.map((i) => insightItem(i, S.area === 'todas')).join('') || '<div class="empty">Nada por aqui.</div>'}`, '<button class="btn sm primary" id="autoTasks">⚡ Gerar tarefas dos críticos</button>')}`;
    return {
      html, mount(root) {
        bindInsightButtons(root, todos, ui);
        root.querySelectorAll('[data-fs]').forEach((b) => b.addEventListener('click', () => { S.ui.filtroSev = b.dataset.fs; ui.render(); }));
        root.querySelector('#autoTasks').addEventListener('click', () => {
          const n = todos.filter((i) => i.sev === 'critico').filter((i) => ui.criarTarefa(i, true)).length;
          ui.toast(n ? `${n} tarefa(s) criada(s) em Automação` : 'Tarefas já existentes para todos os críticos');
        });
      }
    };
  };

  // ------------------------------------------------------------ Automação
  V.automacao = function (S, ui) {
    const cols = [['afazer', 'A fazer'], ['andamento', 'Em andamento'], ['feito', 'Concluído']];
    const tarefas = S.tarefas.filter((t) => S.area === 'todas' || t.area === S.area || t.area === 'todas');
    const hoje = global.BPData.HOJE;
    const ROTINAS = [
      ['fechamento', 'Fechamento mensal de indicadores', 'Mensal · dia 5', 'Gera o one-page executivo do mês'],
      ['ferias', 'Varredura de férias vencidas', 'Semanal · segunda', 'Cria tarefa e e-mail para gestores'],
      ['regulatorio', 'Varredura de treinamentos regulatórios', 'Semanal · quarta', 'Cria cobrança com escalonamento'],
      ['risco', 'Monitor de risco de saída de talentos', 'Semanal · sexta', 'Cria stay interviews para novos talentos em risco'],
      ['vagas', 'Comitê de vagas fora do SLA', 'Semanal · terça', 'Cria pauta do comitê com R&S'],
      ['snapshot', 'Exportar snapshot para o agente de IA', 'Sob demanda', 'Baixa JSON anonimizado para o agente Claude']
    ];
    const taskCard = (t) => {
      const feitos = t.passos.filter((p) => p.ok).length;
      const atrasada = t.status !== 'feito' && new Date(t.prazo) < hoje;
      return `<div class="task"><div class="tt">${esc(t.titulo)}</div>
        <div class="tm">${esc(t.areaNome || '')} · ${esc((A.PLAYBOOKS[t.playbook] || {}).nome || t.playbook)} · prazo ${new Date(t.prazo).toLocaleDateString('pt-BR')} ${atrasada ? st('critico', 'atrasada') : ''}</div>
        ${t.alvo && t.alvo.length ? `<div class="small muted">${t.alvo.length} item(ns) na lista</div>` : ''}
        <ul>${t.passos.map((p, i) => `<li><label><input type="checkbox" data-step="${t.id}|${i}" ${p.ok ? 'checked' : ''}> ${esc(p.t)}</label></li>`).join('')}</ul>
        <div class="bar-inline"><span style="width:${feitos / t.passos.length * 100}%"></span></div>
        <div class="actions">
          ${t.status !== 'feito' ? `<button class="btn sm" data-mv="${t.id}">${t.status === 'afazer' ? 'Iniciar →' : 'Concluir ✓'}</button>` : ''}
          <button class="btn sm" data-tcomm="${t.id}">✉ Comunicação</button>
          ${t.alvo && t.alvo.length ? `<button class="btn sm" data-tcsv="${t.id}">⇩ Lista</button>` : ''}
          <button class="btn sm ghost" data-del="${t.id}" aria-label="Excluir">🗑</button></div></div>`;
    };
    const html = `
      <div class="tiles">
        ${tile('Tarefas abertas', tarefas.filter((t) => t.status !== 'feito').length)}
        ${tile('Atrasadas', tarefas.filter((t) => t.status !== 'feito' && new Date(t.prazo) < hoje).length, '', tarefas.some((t) => t.status !== 'feito' && new Date(t.prazo) < hoje) ? 'critico' : 'ok')}
        ${tile('Concluídas', tarefas.filter((t) => t.status === 'feito').length)}
      </div>
      ${card('Quadro de tarefas operacionais', 'Criadas automaticamente a partir dos insights ou manualmente. Salvas neste navegador.', `<div class="kanban">${cols.map(([id, n]) => `<div class="col"><h3>${n}<span class="pill">${tarefas.filter((t) => t.status === id).length}</span></h3>${tarefas.filter((t) => t.status === id).map(taskCard).join('') || '<div class="empty small">—</div>'}</div>`).join('')}</div>`,
      '<div class="row"><button class="btn sm" id="expTasks">⇩ Exportar</button><button class="btn sm primary" id="autoAll">⚡ Gerar dos alertas críticos</button></div>')}
      ${card('Rotinas automatizadas', 'Playbooks recorrentes do BP — execute agora ou agende no agente de IA (ver README)', `<div class="table-wrap"><table><thead><tr><th>Rotina</th><th>Frequência sugerida</th><th>O que faz</th><th></th></tr></thead><tbody>${ROTINAS.map(([id, n, fq, d]) => `<tr><td><b>${n}</b></td><td>${fq}</td><td class="small">${d}</td><td><button class="btn sm primary" data-rot="${id}">▶ Executar</button></td></tr>`).join('')}</tbody></table></div>`)}`;
    return {
      html, mount(root) {
        const byId = (id) => S.tarefas.find((t) => t.id === id);
        root.querySelectorAll('[data-step]').forEach((c) => c.addEventListener('change', () => {
          const [id, i] = c.dataset.step.split('|'); const t = byId(id); t.passos[+i].ok = c.checked;
          if (t.passos.every((p) => p.ok)) t.status = 'feito'; else if (t.status === 'afazer') t.status = 'andamento';
          ui.salvarTarefas(); ui.render();
        }));
        root.querySelectorAll('[data-mv]').forEach((b) => b.addEventListener('click', () => { const t = byId(b.dataset.mv); t.status = t.status === 'afazer' ? 'andamento' : 'feito'; ui.salvarTarefas(); ui.render(); }));
        root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { S.tarefas = S.tarefas.filter((t) => t.id !== b.dataset.del); ui.salvarTarefas(); ui.render(); }));
        root.querySelectorAll('[data-tcomm]').forEach((b) => b.addEventListener('click', () => ui.abrirComunicacao(byId(b.dataset.tcomm))));
        root.querySelectorAll('[data-tcsv]').forEach((b) => b.addEventListener('click', () => {
          const t = byId(b.dataset.tcsv);
          const rows = t.alvo.map((id) => S.base.colaboradores.find((c) => c.matricula === id) || S.base.vagas.find((v) => v.id === id)).filter(Boolean)
            .map((x) => (x.matricula ? { matricula: x.matricula, nome: S.anon ? '' : x.nome, area: x.area, cargo: x.cargo, nivel: x.nivel, risco_12m: dec(x.risco, 3), ferias_vencidas: x.feriasVencidas, treinamentos_pendentes: x.treinamentosPendentes.join('|') } : x));
          ui.baixarCSV(t.playbook + '_lista.csv', rows);
        }));
        root.querySelector('#expTasks').addEventListener('click', () => ui.baixarCSV('tarefas_bp.csv', S.tarefas.map((t) => ({ titulo: t.titulo, area: t.areaNome, playbook: t.playbook, status: t.status, prazo: t.prazo.slice(0, 10), progresso: t.passos.filter((p) => p.ok).length + '/' + t.passos.length }))));
        root.querySelector('#autoAll').addEventListener('click', () => {
          const n = A.insights(S.base, S.area).filter((i) => i.sev === 'critico').filter((i) => ui.criarTarefa(i, true)).length;
          ui.toast(n ? `${n} tarefa(s) criada(s)` : 'Tarefas já existentes'); ui.render();
        });
        root.querySelectorAll('[data-rot]').forEach((b) => b.addEventListener('click', () => ui.executarRotina(b.dataset.rot)));
      }
    };
  };

  // ------------------------------------------------------------ Materiais
  V.materiais = function (S, ui) {
    const tipo = S.ui.tipoMaterial || 'onepager';
    const doc = M.gerar(S.base, S.modelo, tipo, S.area);
    const html = `
      <section class="card no-print"><div class="row">
        <label class="field">Tipo de material<select id="tipoMat">${Object.entries(M.TIPOS).map(([id, n]) => `<option value="${id}" ${id === tipo ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <span class="spacer"></span>
        <button class="btn" id="copyMat">⧉ Copiar texto</button>
        <button class="btn" id="dlMat">⇩ HTML</button>
        <button class="btn primary" id="printMat">⎙ Imprimir / PDF</button>
        ${S.agente ? '<button class="btn primary" id="iaMat">✦ Refinar com agente IA</button>' : ''}
      </div><p class="hint" style="margin-top:8px">A área do material segue o filtro do topo. Os indivíduos aparecem apenas por matrícula. ${S.agente ? '' : 'Conecte o agente Claude (ver README) para narrativas redigidas por IA.'}</p></section>
      <div id="docMat">${doc.html}</div>`;
    return {
      html, mount(root) {
        root.querySelector('#tipoMat').addEventListener('change', (e) => { S.ui.tipoMaterial = e.target.value; ui.render(); });
        root.querySelector('#printMat').addEventListener('click', () => global.print());
        root.querySelector('#copyMat').addEventListener('click', () => { navigator.clipboard.writeText(root.querySelector('#docMat').innerText).then(() => ui.toast('Texto copiado')); });
        root.querySelector('#dlMat').addEventListener('click', () => ui.baixar(doc.titulo.replace(/[^\w\- ]+/g, '').trim() + '.html',
          `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${esc(doc.titulo)}</title><style>body{font-family:system-ui,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{padding:6px 8px;border-bottom:1px solid #e5e5e5;text-align:left}.num{text-align:right}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.kpis div{background:#f3f6fb;padding:10px;border-radius:6px}.kpis b{display:block;font-size:20px}h2{border-bottom:2px solid #2a78d6}</style>${doc.html}</html>`, 'text/html'));
        const ia = root.querySelector('#iaMat');
        if (ia) ia.addEventListener('click', () => ui.perguntarAgente(`Redija o material "${M.TIPOS[tipo]}" para ${areaNome(S, S.area)} em tom executivo, com mensagem principal, 3 prioridades e decisões solicitadas ao diretor. Use as ferramentas para buscar os números.`));
      }
    };
  };

  // ---------------------------------------------------------------- Dados
  V.dados = function (S, ui) {
    const b = S.base;
    const html = `
      <div class="grid g2">
        ${card('Fonte de dados', b.sintetico ? 'Base sintética de demonstração (determinística)' : 'Base importada', `
          <table>
            <tr><td class="muted">Colaboradores ativos</td><td class="num">${int(b.colaboradores.length)}</td></tr>
            <tr><td class="muted">Desligamentos (12m)</td><td class="num">${int(b.desligados.length)}</td></tr>
            <tr><td class="muted">Vagas</td><td class="num">${int(b.vagas.length)}</td></tr>
            <tr><td class="muted">Áreas</td><td class="num">${b.areas.length}</td></tr>
            <tr><td class="muted">Data de referência</td><td class="num">${global.BPData.HOJE.toLocaleDateString('pt-BR')}</td></tr>
          </table>
          <div class="row" style="margin-top:12px"><button class="btn" id="resetBase">↺ Voltar à base sintética</button></div>`)}
        ${card('Importar dados reais', 'CSV com separador ; ou , — o processamento acontece 100% no navegador, nada é enviado', `
          <label class="field">Colaboradores (ativos + desligados 12m)<input type="file" id="fColab" accept=".csv,text/csv"></label>
          <div class="row small" style="margin:6px 0 12px"><a href="data/modelo_colaboradores.csv" download>Baixar modelo de colaboradores</a></div>
          <label class="field">Vagas<input type="file" id="fVagas" accept=".csv,text/csv"></label>
          <div class="row small" style="margin-top:6px"><a href="data/modelo_vagas.csv" download>Baixar modelo de vagas</a></div>`)}
        ${card('Integração com o agente de IA', 'O agente Claude (Python) lê um snapshot agregado e anonimizado', `
          <label class="row small"><input type="checkbox" id="anonSnap" checked> Anonimizar (remover nomes; manter só matrícula)</label>
          <div class="row" style="margin-top:10px"><button class="btn primary" id="expSnap">⇩ Exportar snapshot.json</button></div>
          <p class="small muted">Salve em <span class="mono">agent/snapshot.json</span> e rode <span class="mono">python agent/bp_agent.py</span>. Com <span class="mono">--serve</span>, o Copiloto deste cockpit passa a usar o agente.</p>
          <p class="small">Status do agente: ${S.agente ? st('ok', 'conectado em ' + esc(S.agenteUrl)) : st('atencao', 'não conectado (copiloto em modo local)')}</p>
          <div class="row"><input type="text" id="agUrl" value="${esc(S.agenteUrl)}" style="flex:1"><button class="btn" id="agTest">Testar conexão</button></div>`)}
        ${card('Privacidade e governança (LGPD)', '', `<ul class="small">
          <li>Dados pessoais e sensíveis (raça, PcD, saúde) exigem base legal e finalidade definida — use o cockpit apenas para gestão de pessoas.</li>
          <li>Scores de risco são <b>estatísticos</b>: nunca usar como critério isolado para decisões de desligamento, promoção ou remuneração.</li>
          <li>Materiais executivos exibem indivíduos apenas por matrícula.</li>
          <li>O snapshot para IA é agregado; ative a anonimização e valide com o DPO antes de usar dados reais em serviços externos.</li>
          <li>Exibir nomes nesta tela: <label><input type="checkbox" id="showNames" ${S.anon ? '' : 'checked'}> sim</label></li></ul>`)}
      </div>`;
    return {
      html, mount(root) {
        root.querySelector('#resetBase').addEventListener('click', () => ui.resetBase());
        root.querySelector('#fColab').addEventListener('change', (e) => ui.importar(e.target.files[0], 'colaboradores'));
        root.querySelector('#fVagas').addEventListener('change', (e) => ui.importar(e.target.files[0], 'vagas'));
        root.querySelector('#expSnap').addEventListener('click', () => ui.exportarSnapshot(root.querySelector('#anonSnap').checked));
        root.querySelector('#agTest').addEventListener('click', () => { S.agenteUrl = root.querySelector('#agUrl').value.trim(); ui.testarAgente(true); });
        root.querySelector('#showNames').addEventListener('change', (e) => { S.anon = !e.target.checked; ui.render(); });
      }
    };
  };

  global.BPViews = V;
})(window);
