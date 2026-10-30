/* =========================================================================
 * Cockpit do BP — Telas estratégicas e de IA:
 * Indicadores estratégicos, Org design & tribos, Clima & bem-estar,
 * Assistente IA (analista / materiais / coach), Caixa de ferramentas,
 * Dados & integrações (conectores, uploads, catálogo).
 * ========================================================================= */
(function (global) {
  'use strict';
  const A = global.BPAnalytics, V = global.BPViews;
  const { tile, card, st, canvas, LIMIAR, areaNome, int, sinal, esc } = V._h;
  const { brl, p100, dec } = A.fmt;
  const { sum, avg } = A.util;
  const FERR = () => global.BP_FERRAMENTAS || [];

  // ------------------------------------------------------------- Markdown
  function inline(t) {
    return t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>');
  }
  /** Markdown enxuto → HTML. Marcadores [[grafico:ID]] viram <canvas> para renderGraficos. */
  function md(texto, graficos, prefixo) {
    const linhas = esc(texto || '').split('\n');
    let html = '', lista = null, tabela = [];
    const fechaLista = () => { if (lista) { html += `</${lista}>`; lista = null; } };
    const fechaTabela = () => {
      if (!tabela.length) return;
      const rows = tabela.filter((l) => !/^\|\s*:?-{2,}/.test(l)).map((l) => l.replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim())));
      html += '<div class="table-wrap"><table><thead><tr>' + rows[0].map((c) => `<th>${c}</th>`).join('') + '</tr></thead><tbody>' +
        rows.slice(1).map((r) => '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>';
      tabela = [];
    };
    for (const l of linhas) {
      const g = l.match(/\[\[grafico:(\w+)\]\]/);
      if (l.trim().startsWith('|')) { fechaLista(); tabela.push(l.trim()); continue; }
      fechaTabela();
      if (g) {
        fechaLista();
        const gr = (graficos || []).find((x) => x.id === g[1]);
        html += gr ? `<div class="grafico"><h4>${esc(gr.titulo)}</h4><div class="chart-box"><canvas id="${prefixo}-${gr.id}" data-graf="${gr.id}"></canvas></div></div>` : '';
        continue;
      }
      const h = l.match(/^(#{1,4})\s+(.*)/);
      if (h) { fechaLista(); html += `<h${Math.min(4, h[1].length + 1)}>${inline(h[2])}</h${Math.min(4, h[1].length + 1)}>`; continue; }
      const li = l.match(/^\s*([-*]|\d+[.)])\s+(.*)/);
      if (li) { const tipo = /\d/.test(li[1]) ? 'ol' : 'ul'; if (lista !== tipo) { fechaLista(); html += `<${tipo}>`; lista = tipo; } html += `<li>${inline(li[2])}</li>`; continue; }
      fechaLista();
      if (/^-{3,}$/.test(l.trim())) html += '<hr>';
      else if (l.trim()) html += `<p>${inline(l)}</p>`;
    }
    fechaLista(); fechaTabela();
    // gráficos não referenciados no texto aparecem ao final
    (graficos || []).filter((gr) => !(texto || '').includes(`[[grafico:${gr.id}]]`)).forEach((gr) => {
      html += `<div class="grafico"><h4>${esc(gr.titulo)}</h4><div class="chart-box"><canvas id="${prefixo}-${gr.id}" data-graf="${gr.id}"></canvas></div></div>`;
    });
    return html;
  }
  function renderGraficos(root, graficos, prefixo, ui) {
    (graficos || []).forEach((g) => {
      const id = `${prefixo}-${g.id}`;
      if (!root.querySelector('#' + CSS.escape(id))) return;
      const series = g.series.slice(0, 4);
      if (g.tipo === 'dispersao') {
        ui.chart(id, {
          type: 'scatter', data: { datasets: series.map((s, i) => Object.assign(ui.ds(s.nome, s.pontos.map((p) => ({ x: p.x, y: p.y, rotulo: p.rotulo })), i), { pointRadius: 5 })) },
          options: Object.assign(ui.opts({ legend: series.length > 1 }), { interaction: { mode: 'nearest', intersect: true }, plugins: { legend: { display: series.length > 1 }, tooltip: { callbacks: { label: (c) => `${c.raw.rotulo}: (${c.raw.x}; ${c.raw.y})` } } } })
        });
        return;
      }
      ui.chart(id, {
        type: g.tipo === 'linha' ? 'line' : 'bar',
        data: { labels: g.rotulos, datasets: series.map((s, i) => ui.ds(s.nome, s.valores, i, g.tipo === 'linha' ? 'line' : undefined)) },
        options: ui.opts({ indexAxis: g.tipo === 'barra_horizontal' ? 'y' : 'x', legend: series.length > 1, unidade: g.unidade })
      });
    });
  }

  // ------------------------------------------------ Indicadores estratégicos
  V.estrategicos = function (S, ui) {
    const e = A.estrategicos(S.base, S.area);
    const f = A.filtrar(S.base, S.area);
    const ohiSt = e.ohi < 55 ? 'critico' : e.ohi < 68 ? 'atencao' : 'ok';
    const tribos = f.tribos.filter((t) => e.porTribo[t.id]);
    const html = `
      <div class="grid g-2-1">
        ${card('Org Health Index', 'Índice composto 0–100: engajamento, retenção, talent density, sucessão, liderança e bem-estar', `
          <div class="ohi"><div class="big">${dec(e.ohi, 0)}</div><div>${st(ohiSt, ohiSt === 'ok' ? 'Saudável' : ohiSt === 'atencao' ? 'Em atenção' : 'Crítico')}<div class="small muted" style="margin-top:4px">Use para conversar com o diretor sobre a saúde da organização, não só sobre headcount.</div></div></div>
          ${canvas('chOhi')}`)}
        ${card('Pessoas × negócio', 'Receita, custo e produtividade das tribos com receita atribuída', `<table>
          <tr><td class="muted">Receita 12m (tribos)</td><td class="num"><b>${e.receita ? brl(e.receita) : '—'}</b></td></tr>
          <tr><td class="muted">Receita por FTE</td><td class="num"><b>${e.receitaFTE ? brl(e.receitaFTE) : '—'}</b></td></tr>
          <tr><td class="muted">HC ROI</td><td class="num"><b>${e.hcRoi ? dec(e.hcRoi, 2) + 'x' : '—'}</b></td></tr>
          <tr><td class="muted">Custo de pessoas / receita</td><td class="num"><b>${e.custoPessoasReceita ? p100(e.custoPessoasReceita, 1) : '—'}</b></td></tr>
          <tr><td class="muted">Folha anual (c/ encargos e 13º)</td><td class="num"><b>${brl(e.folhaAnual)}</b></td></tr></table>
          <p class="small muted">HC ROI = (receita − custos não ligados a pessoas) ÷ custo de pessoas.</p>`)}
      </div>
      <div class="tiles">
        ${tile('Talent density', p100(e.talentDensity), '% com desempenho 4–5', e.talentDensity < 0.25 ? 'atencao' : 'ok')}
        ${tile('Regretted attrition', p100(e.regrettedRate, 1), 'saídas voluntárias de alto desempenho / HC', e.regrettedRate > 0.05 ? 'critico' : e.regrettedRate > 0.03 ? 'atencao' : 'ok')}
        ${tile('Internal fill rate', p100(e.mobilidade.internalFill), `${e.mobilidade.transferencias} internas × ${e.mobilidade.admissoes} externas`, e.mobilidade.internalFill < 0.2 ? 'atencao' : 'ok')}
        ${tile('Quality of hire', e.qualityOfHire === null ? '—' : p100(e.qualityOfHire), 'contratados 12m com desempenho 4–5')}
        ${tile('Early attrition', p100(e.earlyAttrition), 'saídas no 1º ano / contratados', e.earlyAttrition > 0.15 ? 'atencao' : 'ok')}
        ${tile('Taxa de promoção', p100(e.promocao, 1), 'promovidos nos últimos 12m')}
        ${tile('Manager Effectiveness', dec(e.managerIndex, 0), 'índice médio dos gestores (0–100)', e.managerIndex < 55 ? 'atencao' : 'ok')}
        ${tile('Span médio · camadas', `${dec(e.spans.medio, 1)} · ${e.spans.camadas}`, `${p100(e.spans.pctEstreito)} dos gestores com span < 4`, LIMIAR.sucessao(1 - e.spans.pctEstreito))}
        ${tile('Burnout risk index', p100(e.burnout), 'HE > 20h ou absenteísmo alto + clima detrator', e.burnout > 0.12 ? 'critico' : e.burnout > 0.08 ? 'atencao' : 'ok')}
        ${tile('Gap salarial ajustado (F/M)', sinal(e.equidade.gapAjustado), 'compa-ratio no mesmo nível', Math.abs(e.equidade.gapAjustado) > 0.03 ? 'atencao' : 'ok')}
        ${tile('Exposição à IA generativa', p100(e.ia.pctAlta), `${int(e.ia.alta)} pessoas em cargos de alta exposição`, e.ia.pctAlta > 0.3 ? 'atencao' : 'ok')}
        ${tile('Horas de treinamento', dec(e.horasTreino, 0) + 'h', 'média por pessoa em 12m')}
      </div>
      <div class="grid g2">
        ${card('Representatividade por nível', 'Funil de diversidade: onde o pipeline afunila', canvas('chFunilDei'))}
        ${card('Engajamento × resultado por tribo', 'Cada ponto é uma tribo: eNPS (x) × atingimento de OKR (y)', canvas('chTriboScatter'))}
      </div>
      ${card('Scorecard das tribos', 'Pessoas e negócio lado a lado', `<div class="table-wrap"><table><thead><tr><th>Tribo</th><th class="num">HC</th><th class="num">Receita/FTE</th><th class="num">OKR</th><th class="num">NPS cliente</th><th class="num">eNPS</th><th class="num">Clima</th><th class="num">Risco médio</th><th class="num">HE/mês</th></tr></thead><tbody>
        ${tribos.map((t) => { const x = e.porTribo[t.id]; return `<tr class="clickable" data-tribo="${t.id}" data-area="${t.area}"><td><b>${esc(t.nome)}</b><div class="small muted">${esc(areaNome(S, t.area))} · ${t.squads} squads</div></td><td class="num">${x.hc}</td><td class="num">${x.receitaFTE ? brl(x.receitaFTE) : '—'}</td><td class="num">${st(t.okr < 0.7 ? 'critico' : t.okr < 0.85 ? 'atencao' : 'ok', p100(t.okr))}</td><td class="num">${t.npsCliente}</td><td class="num">${st(LIMIAR.enps(x.enps), x.enps)}</td><td class="num">${x.fav ? dec(x.fav, 0) + '%' : '—'}</td><td class="num">${p100(x.risco, 1)}</td><td class="num">${dec(x.he, 1)}h</td></tr>`; }).join('')}
      </tbody></table></div>`)}`;
    return {
      html, mount(root) {
        const partes = Object.entries(e.ohiPartes);
        ui.chart('chOhi', { type: 'bar', data: { labels: partes.map((p) => p[0]), datasets: [ui.ds('Pontuação', partes.map((p) => Math.round(p[1])), 0)] }, options: Object.assign(ui.opts({ indexAxis: 'y', legend: false }), {}) });
        ui.chart('chFunilDei', { type: 'line', data: { labels: e.funil.map((x) => x.nivel), datasets: [ui.ds('Mulheres %', e.funil.map((x) => Math.round(x.mulheres * 100)), 0, 'line'), ui.ds('Negros %', e.funil.map((x) => Math.round(x.negros * 100)), 1, 'line')] }, options: ui.opts({}) });
        ui.chart('chTriboScatter', {
          type: 'scatter', data: { datasets: [Object.assign(ui.ds('Tribos', tribos.map((t) => ({ x: e.porTribo[t.id].enps, y: Math.round(t.okr * 100), rotulo: t.nome })), 0), { pointRadius: 6 })] },
          options: Object.assign(ui.opts({ legend: false }), { interaction: { mode: 'nearest', intersect: true }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.raw.rotulo}: eNPS ${c.raw.x}, OKR ${c.raw.y}%` } } } })
        });
        root.querySelectorAll('tr[data-tribo]').forEach((tr) => tr.addEventListener('click', () => { ui.setArea(tr.dataset.area, true); ui.setTribo(tr.dataset.tribo); }));
      }
    };
  };

  // ------------------------------------------------------- Org design
  V.org = function (S, ui) {
    const o = A.orgDesign(S.base, S.area);
    const piores = o.gestores.filter((g) => g.span >= 3).sort((a, b) => a.mei - b.mei).slice(0, 25);
    const html = `
      <div class="tiles">
        ${tile('Gestores', int(o.gestoresN), `${int(sum(o.gestores, (g) => g.span))} liderados diretos`)}
        ${tile('Span médio', dec(o.medio, 1), 'referência de mercado: 6–10', o.medio < 5 ? 'atencao' : 'ok')}
        ${tile('Span estreito (< 4)', p100(o.pctEstreito), `custo anual desses gestores: ${brl(o.custoEstreitos)}`, o.pctEstreito > 0.25 ? 'atencao' : 'ok')}
        ${tile('Span largo (> 12)', p100(o.pctLargo), 'risco de gestão rasa', o.pctLargo > 0.15 ? 'atencao' : 'ok')}
        ${tile('Camadas até o diretor', o.camadas, 'inclui o diretor', o.camadas > 6 ? 'atencao' : 'ok')}
        ${tile('Manager Effectiveness', dec(avg(o.gestores, (g) => g.mei), 0), 'média 0–100')}
      </div>
      <div class="grid g2">
        ${card('Distribuição de spans', 'Quantidade de gestores por faixa de liderados diretos', canvas('chSpan'))}
        ${card('Pessoas por camada', 'Do diretor (1) às camadas operacionais', canvas('chCamada'))}
      </div>
      <div class="grid g2">
        ${card('Gestores com menor efetividade', 'Índice combina clima do time, turnover, risco de saída e desempenho. Clique para a visão 360°.', `<div class="table-wrap" style="max-height:460px;overflow:auto"><table><thead><tr><th>Gestor</th><th class="num">Span</th><th class="num">eNPS time</th><th class="num">Turnover</th><th class="num">Risco</th><th class="num">MEI</th></tr></thead><tbody>
          ${piores.map((g) => `<tr class="clickable" data-mat="${g.matricula}"><td><b>${esc(S.anon ? g.matricula : g.nome || g.matricula)}</b><div class="small muted">${g.nivel} · ${esc(A.nomeTribo(S.base, g.tribo))}</div></td><td class="num">${g.span}</td><td class="num">${st(LIMIAR.enps(g.enps), g.enps)}</td><td class="num">${p100(g.turnover)}</td><td class="num">${p100(g.risco)}</td><td class="num"><b>${dec(g.mei, 0)}</b></td></tr>`).join('')}
        </tbody></table></div>`, '<button class="btn sm" data-ferr-open="skip-level">Skip level</button>')}
        ${card('Organograma', S.area === 'todas' ? 'Selecione uma diretoria no topo para navegar pela hierarquia' : 'Clique para expandir · span entre parênteses', S.area === 'todas' ? '<div class="empty">Escolha uma diretoria.</div>' : `<div class="tree" style="max-height:520px;overflow:auto">${arvore(S)}</div>`, '<button class="btn sm" data-ferr-open="galbraith">Redesign (Galbraith)</button>')}
      </div>`;
    return {
      html, mount(root) {
        ui.chart('chSpan', { type: 'bar', data: { labels: o.histograma.map((h) => h.l), datasets: [ui.ds('Gestores', o.histograma.map((h) => h.n), 0)] }, options: ui.opts({ legend: false }) });
        ui.chart('chCamada', { type: 'bar', data: { labels: o.porCamada.map((c) => 'Camada ' + c.camada), datasets: [ui.ds('Pessoas', o.porCamada.map((c) => c.n), 0)] }, options: ui.opts({ legend: false }) });
        root.querySelectorAll('tr[data-mat]').forEach((tr) => tr.addEventListener('click', () => ui.visao360(tr.dataset.mat)));
        root.querySelectorAll('.tree [data-mat]').forEach((el) => el.addEventListener('dblclick', () => ui.visao360(el.dataset.mat)));
        root.querySelectorAll('[data-ferr-open]').forEach((b) => b.addEventListener('click', () => ui.abrirFerramenta(b.dataset.ferrOpen)));
      }
    };
  };
  function arvore(S) {
    const area = S.base.areas.find((a) => a.id === S.area);
    const ativos = S.base.colaboradores.filter((c) => c.area === S.area);
    const filhos = {};
    ativos.forEach((c) => { if (c.gestor) (filhos[c.gestor] = filhos[c.gestor] || []).push(c); });
    const raiz = ativos.find((c) => c.matricula === (area && area.diretorMatricula)) || ativos.find((c) => !c.gestor || c.camada === 1);
    if (!raiz) return '<div class="empty">Hierarquia indisponível nesta base.</div>';
    const rot = (c) => `<span data-mat="${c.matricula}"><b>${esc(S.anon ? c.matricula : c.nome)}</b> · ${esc(c.nivel)}${c.tribo ? ' · ' + esc(A.nomeTribo(S.base, c.tribo)) : ''} ${filhos[c.matricula] ? `<span class="muted">(${filhos[c.matricula].length})</span>` : ''} ${c.faixaRisco === 'Alto' ? st('critico', 'risco') : ''}</span>`;
    const no = (c, prof) => {
      const fs = (filhos[c.matricula] || []).sort((a, b) => (b.lider - a.lider) || a.nivel.localeCompare(b.nivel));
      if (!fs.length) return `<div class="leaf">${rot(c)}</div>`;
      const lideres = fs.filter((x) => x.lider), outros = fs.filter((x) => !x.lider);
      return `<details ${prof < 1 ? 'open' : ''}><summary>${rot(c)}</summary>${lideres.map((x) => no(x, prof + 1)).join('')}${outros.slice(0, 40).map((x) => `<div class="leaf">${rot(x)}</div>`).join('')}${outros.length > 40 ? `<div class="leaf muted">+ ${outros.length - 40} pessoas</div>` : ''}</details>`;
    };
    return no(raiz, 0);
  }

  // ------------------------------------------------------- Clima & bem-estar
  V.clima = function (S, ui) {
    const e = A.estrategicos(S.base, S.area);
    const k = A.kpis(S.base, S.area);
    const f = A.filtrar(S.base, S.area);
    const dims = e.clima.dims.map((d) => d.dimensao);
    const tribos = [...new Set(f.clima.map((c) => c.tribo))];
    const favT = (t, d) => { const x = f.clima.find((c) => c.tribo === t && c.dimensao === d && c.ciclo === e.clima.cicloAtual); return x ? x.fav : null; };
    const stFav = (v) => (v === null ? 'ok' : v < 60 ? 'critico' : v < 70 ? 'atencao' : 'ok');
    const html = `
      <div class="tiles">
        ${tile('Favorabilidade geral', e.clima.favAtual ? dec(e.clima.favAtual, 0) + '%' : '—', e.clima.favAnterior ? `ciclo ${e.clima.cicloAnt}: ${dec(e.clima.favAnterior, 0)}%` : '', stFav(e.clima.favAtual))}
        ${tile('eNPS', k.enps, 'promotores − detratores', LIMIAR.enps(k.enps))}
        ${tile('Dimensão mais crítica', e.clima.dims[0] ? esc(e.clima.dims[0].dimensao) : '—', e.clima.dims[0] ? dec(e.clima.dims[0].atual, 0) + '% favorável' : '', 'atencao')}
        ${tile('Afastamentos INSS (B31)', int(e.saude.b31), `${int(e.saude.diasPerdidos)} dias perdidos`, e.saude.b31 > 10 ? 'atencao' : 'ok')}
        ${tile('Saúde mental nos afastamentos', p100(e.saude.pctMental), 'grupo CID F (agregado)', e.saude.pctMental > 0.4 ? 'critico' : 'ok')}
        ${tile('Burnout risk index', p100(e.burnout), 'HE alta ou absenteísmo + clima detrator', e.burnout > 0.12 ? 'critico' : 'ok')}
      </div>
      <div class="grid g2">
        ${card('Dimensões do clima', `Ciclo ${e.clima.cicloAtual || '—'} × ${e.clima.cicloAnt || '—'} (% favorável)`, canvas('chDims', true))}
        ${card('Licenças e afastamentos', 'Agregado — sem dados individuais de saúde', `<table><thead><tr><th>Tipo</th><th class="num">Casos</th><th class="num">Dias</th></tr></thead><tbody>${e.saude.porTipo.map((t) => `<tr><td>${esc(t.tipo)}</td><td class="num">${t.n}</td><td class="num">${int(t.dias)}</td></tr>`).join('')}</tbody></table>
          <h3 style="font-size:13px;margin:14px 0 6px">Afastamentos B31 por grupo de CID</h3>${canvas('chCid')}`)}
      </div>
      ${card('Mapa de calor do clima por tribo', 'Favorabilidade (%) por dimensão — abaixo de 60% crítico, 60–70% atenção', `<div class="table-wrap"><table><thead><tr><th>Tribo</th>${dims.map((d) => `<th class="num">${esc(d)}</th>`).join('')}</tr></thead><tbody>
        ${tribos.map((t) => `<tr><td><b>${esc(A.nomeTribo(S.base, t))}</b></td>${dims.map((d) => { const v = favT(t, d); return `<td class="num">${v === null ? '—' : st(stFav(v), dec(v, 0))}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div>`, '<button class="btn sm" data-ferr-open="seguranca-psicologica">Segurança psicológica</button> <button class="btn sm" data-ferr-open="carga-burnout">Diagnóstico de carga</button>')}`;
    return {
      html, mount(root) {
        const d = e.clima.dims.slice().reverse();
        ui.chart('chDims', { type: 'bar', data: { labels: d.map((x) => x.dimensao), datasets: [ui.ds('Ciclo ' + e.clima.cicloAtual, d.map((x) => Math.round(x.atual)), 0), ui.ds('Ciclo ' + e.clima.cicloAnt, d.map((x) => (x.anterior === null ? null : Math.round(x.anterior))), 1)] }, options: ui.opts({ indexAxis: 'y' }) });
        ui.chart('chCid', { type: 'bar', data: { labels: e.saude.porGrupo.map((g) => g.grupo), datasets: [ui.ds('Afastamentos', e.saude.porGrupo.map((g) => g.n), 0)] }, options: ui.opts({ legend: false, indexAxis: 'y' }) });
        root.querySelectorAll('[data-ferr-open]').forEach((b) => b.addEventListener('click', () => ui.abrirFerramenta(b.dataset.ferrOpen)));
      }
    };
  };

  // ------------------------------------------------------------ Assistente
  const SUGESTOES = {
    analista: ['Cruze clima, HE e afastamentos por tribo e diga onde há risco de burnout', 'Quais gestores concentram saídas de talentos nos últimos 12 meses?', 'Existe relação entre eNPS das tribos e atingimento de OKR?', 'Compare o gap salarial por gênero dentro de cada nível e diretoria', 'Cruze a planilha que enviei com a base de colaboradores'],
    materiais: ['Apresentação de 5 slides para o diretor de Tecnologia sobre retenção e WFP 2027', 'One-page de saúde organizacional de todas as diretorias para o VP', 'Business case para converter HE estrutural de Operações em headcount', 'E-mail para gestores de Varejo PF sobre férias vencidas e treinamentos regulatórios'],
    coach: ['A tribo de Cibersegurança tem clima ruim e saídas: que ferramenta aplico e como?', 'Vou propor redesign organizacional em Operações por causa da IA. Como estruturo?', 'Um gestor com span 2 e time insatisfeito: skip level ou conversa de feedback primeiro?', 'Como preparo a conversa com o diretor que resiste a investir em retenção?']
  };
  const NOMES_MODO = { analista: 'Analista', materiais: 'Materiais', coach: 'Coach do BP' };
  const DESC_MODO = {
    analista: 'Novas análises cruzando qualquer dado da base, planilhas e documentos enviados.',
    materiais: 'Gera materiais executivos a partir de um prompt, usando a base completa de pessoas.',
    coach: 'Apoia suas decisões e indica a ferramenta certa (skip level, diagnóstico, redesign…) com plano de aplicação.'
  };

  V.assistente = function (S, ui) {
    const modo = S.ui.modoIA || 'analista';
    const msgs = S.chat[modo];
    const iaOk = S.base.servidor;
    const html = `
      <section class="chat" id="chatBox">
        <div class="chat-head">
          <div class="modos">${Object.keys(NOMES_MODO).map((m) => `<button data-modo="${m}" aria-pressed="${m === modo}">${NOMES_MODO[m]}</button>`).join('')}</div>
          <span class="small muted" style="flex:1;min-width:200px">${DESC_MODO[modo]}</span>
          ${iaOk ? '' : st('atencao', 'Servidor desligado: modo local')}
          <button class="btn sm" id="novaConversa">Nova conversa</button>
        </div>
        <div class="chat-msgs" id="chatMsgs">
          ${msgs.length ? '' : `<div class="chat-msg sys">Sugestões para começar:</div><div class="chips" style="justify-content:center">${SUGESTOES[modo].map((s) => `<button class="chip" data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div>`}
          ${msgs.map((m, i) => m.quem === 'user' ? `<div class="chat-msg user">${esc(m.texto)}</div>`
            : m.quem === 'sys' ? `<div class="chat-msg sys">${esc(m.texto)}</div>`
              : `<div class="chat-msg bot md">${m.pendente ? '<span class="dots">Analisando a base</span>' : md(m.texto, m.graficos, 'cg' + i)}
                ${(m.materiais || []).map((mt, j) => `<div class="material-card"><b>📄 ${esc(mt.titulo)}</b><span class="small muted">${esc(mt.arquivo || '')}</span><span class="spacer"></span><button class="btn sm primary" data-mat-open="${i}|${j}">Abrir / imprimir</button></div>`).join('')}</div>`).join('')}
        </div>
        ${S.anexos.length ? `<div class="anexos">${S.anexos.map((a) => `<span class="pill">📎 ${esc(a.nome)}</span>`).join('')}</div>` : ''}
        <form class="chat-input" id="chatForm">
          <button type="button" class="btn" id="anexar" title="Anexar Excel, CSV, PDF ou imagem">📎</button>
          <input type="file" id="arquivo" multiple accept=".xlsx,.xlsm,.csv,.pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.json" hidden>
          <textarea id="chatTxt" rows="2" placeholder="${modo === 'coach' ? 'Descreva a situação e o que você quer decidir…' : modo === 'materiais' ? 'Descreva o material: público, objetivo, formato…' : 'Peça uma análise — pode cruzar qualquer dado ou arquivo enviado…'}"></textarea>
          <button class="btn primary" type="submit">Enviar</button>
        </form>
      </section>
      <p class="small muted">Arraste arquivos para o chat ou cole imagens (Ctrl+V). Excel/CSV viram tabelas cruzáveis; PDFs e imagens são lidos pela IA. A IA pode errar: valide números antes de levar à diretoria.</p>`;
    return {
      html, mount(root) {
        const box = root.querySelector('#chatMsgs');
        box.scrollTop = box.scrollHeight;
        msgs.forEach((m, i) => { if (m.graficos) renderGraficos(root, m.graficos, 'cg' + i, ui); });
        root.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => { S.ui.modoIA = b.dataset.modo; ui.render(); }));
        root.querySelector('#novaConversa').addEventListener('click', () => { S.chat[modo] = []; S.sessoes[modo] = 'web-' + Math.random().toString(36).slice(2, 9); S.anexos = []; ui.render(); });
        root.querySelectorAll('[data-sug]').forEach((b) => b.addEventListener('click', () => ui.chatEnviar(modo, b.dataset.sug)));
        root.querySelectorAll('[data-mat-open]').forEach((b) => b.addEventListener('click', () => { const [i, j] = b.dataset.matOpen.split('|').map(Number); ui.abrirMaterialIA(msgs[i].materiais[j], msgs[i].graficos); }));
        const txt = root.querySelector('#chatTxt');
        txt.focus();
        txt.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); root.querySelector('#chatForm').requestSubmit(); } });
        root.querySelector('#chatForm').addEventListener('submit', (ev) => { ev.preventDefault(); const t = txt.value.trim(); if (t) ui.chatEnviar(modo, t); });
        const inp = root.querySelector('#arquivo');
        root.querySelector('#anexar').addEventListener('click', () => inp.click());
        inp.addEventListener('change', () => ui.enviarArquivos([...inp.files]));
        const chat = root.querySelector('#chatBox');
        chat.addEventListener('dragover', (ev) => { ev.preventDefault(); chat.classList.add('drag'); });
        chat.addEventListener('dragleave', () => chat.classList.remove('drag'));
        chat.addEventListener('drop', (ev) => { ev.preventDefault(); chat.classList.remove('drag'); ui.enviarArquivos([...ev.dataTransfer.files]); });
        txt.addEventListener('paste', (ev) => { const fs = [...(ev.clipboardData || {}).files || []]; if (fs.length) { ev.preventDefault(); ui.enviarArquivos(fs); } });
      }
    };
  };

  // ------------------------------------------------- Caixa de ferramentas
  V.ferramentas = function (S, ui) {
    const ins = A.insights(S.base, S.area);
    const rec = {};
    ins.forEach((i) => (i.ferramentas || []).forEach((id) => { (rec[id] = rec[id] || []).push(i); }));
    const cat = S.ui.catFerr || 'Todas';
    const q = (S.ui.buscaFerr || '').toLowerCase();
    const cats = ['Todas', ...new Set(FERR().map((t) => t.categoria))];
    const lista = FERR().filter((t) => (cat === 'Todas' || t.categoria === cat) && (!q || JSON.stringify(t).toLowerCase().includes(q)));
    const recomendadas = Object.entries(rec).sort((a, b) => b[1].filter((i) => i.sev === 'critico').length - a[1].filter((i) => i.sev === 'critico').length || b[1].length - a[1].length).slice(0, 6);
    const cardF = (t, motivos) => `<div class="tool ${motivos ? 'rec' : ''}"><div class="cat">${esc(t.categoria)}</div><h3>${esc(t.nome)}</h3><p>${esc(t.quando_usar)}</p>
      ${motivos ? `<p class="small"><b>Por que agora:</b> ${esc(motivos.slice(0, 2).map((i) => `${i.areaNome}: ${i.titulo}`).join(' · '))}${motivos.length > 2 ? ` (+${motivos.length - 2})` : ''}</p>` : ''}
      <div class="actions"><button class="btn sm" data-ver="${t.id}">Ver roteiro</button><button class="btn sm primary" data-coach="${t.id}">✦ Aplicar com o coach</button></div></div>`;
    const html = `
      ${card('Recomendadas pelos dados', 'Ferramentas ligadas aos alertas atuais das suas áreas', `<div class="grid g3">${recomendadas.map(([id, m]) => { const t = FERR().find((x) => x.id === id); return t ? cardF(t, m) : ''; }).join('') || '<div class="empty">Sem recomendações.</div>'}</div>`)}
      ${card('Caixa de ferramentas do BP estratégico', `${FERR().length} ferramentas de diagnóstico, liderança, times, organização, talentos, mudança e conversas`, `
        <div class="row" style="margin-bottom:12px"><div class="chips">${cats.map((c) => `<button class="chip" data-cat="${esc(c)}" aria-pressed="${c === cat}">${esc(c)}</button>`).join('')}</div><span class="spacer"></span><input type="search" id="buscaFerr" placeholder="Buscar ferramenta" value="${esc(S.ui.buscaFerr || '')}"></div>
        <div class="grid g3">${lista.map((t) => cardF(t, null)).join('')}</div>`)}`;
    return {
      html, mount(root) {
        root.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => { S.ui.catFerr = b.dataset.cat; ui.render(); }));
        root.querySelector('#buscaFerr').addEventListener('change', (ev) => { S.ui.buscaFerr = ev.target.value; ui.render(); });
        root.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => ui.abrirFerramenta(b.dataset.ver, (rec[b.dataset.ver] || [])[0])));
        root.querySelectorAll('[data-coach]').forEach((b) => b.addEventListener('click', () => ui.aplicarComCoach(b.dataset.coach, (rec[b.dataset.coach] || [])[0])));
      }
    };
  };
  V.htmlFerramenta = function (t, ins) {
    const lst = (titulo, arr, ordenada) => arr && arr.length ? `<h3 style="font-size:13px;margin:14px 0 6px">${titulo}</h3><${ordenada ? 'ol' : 'ul'}>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</${ordenada ? 'ol' : 'ul'}>` : '';
    return `<div class="cat" style="color:var(--brand);font-weight:700;font-size:11px;text-transform:uppercase">${esc(t.categoria)}</div>
      ${ins ? `<p class="small" style="background:var(--brand-soft);padding:8px 10px;border-radius:8px"><b>Contexto:</b> ${esc(ins.areaNome)} — ${esc(ins.titulo)}</p>` : ''}
      <p><b>Quando usar:</b> ${esc(t.quando_usar)}</p><p><b>Objetivo:</b> ${esc(t.objetivo)}</p>
      <p class="small"><b>Duração:</b> ${esc(t.duracao)} · <b>Participantes:</b> ${esc(t.participantes)}</p>
      ${lst('Passo a passo', t.passos, true)}${lst('Perguntas-chave', t.perguntas)}${lst('Entregáveis', t.entregaveis)}${lst('Armadilhas', t.armadilhas)}${lst('Como medir sucesso', t.indicadores)}`;
  };

  // ------------------------------------------------- Dados & integrações
  const dadosOffline = V.dados;
  V.dados = function (S, ui) {
    if (!S.base.servidor) {
      const off = dadosOffline(S, ui);
      return {
        html: card('Modo offline', 'Você abriu o cockpit sem o servidor local', `<p>Os conectores (SAP, movimentações, ATS, clima, data lake), o envio de Excel/PDF/imagens e o assistente de IA precisam do servidor.
          Na pasta do projeto, rode <span class="mono">python -m server</span> (ou dê duplo clique em <span class="mono">iniciar.bat</span>) e acesse <span class="mono">http://localhost:8765</span>.</p>`) + off.html,
        mount: off.mount
      };
    }
    const cat = S.catalogo || { tabelas: [], documentos: [], conectores: [] };
    const html = `
      <div class="grid g2">
        ${card('Conectores de dados', 'Hoje em modo simulado. Cada um tem a interface pronta para a fonte oficial (ver README → Integrações).', `
          ${cat.conectores.map((c) => `<div class="conector"><div><b>${esc(c.nome)}</b> <span class="pill">${c.modo}</span><div class="small muted">${esc(c.descricao)} · tabelas: ${c.tabelas.join(', ')}</div>
            <div class="small">${c.erro ? st('critico', esc(c.erro)) : c.ultima_sincronizacao ? st('ok', 'sincronizado em ' + new Date(c.ultima_sincronizacao).toLocaleString('pt-BR')) : st('atencao', 'nunca sincronizado')}</div>
            <details class="small muted"><summary>Integração oficial</summary>${esc(c.integracao_real)}</details></div>
            <div><button class="btn sm" data-sync="${c.id}">↻ Sincronizar</button></div></div>`).join('')}
          <div class="row" style="margin-top:10px"><button class="btn primary" data-sync="todos">↻ Sincronizar todos</button></div>`)}
        ${card('Enviar arquivos', 'Excel/CSV: colaboradores e vagas atualizam a base; outras planilhas viram tabelas cruzáveis. PDFs e imagens são lidos pela IA.', `
          <div class="dropzone" id="drop">Arraste aqui ou clique para escolher<br><span class="small muted">.xlsx · .csv · .pdf · .png · .jpg · .txt — até 25 MB</span></div>
          <input type="file" id="fUp" multiple hidden accept=".xlsx,.xlsm,.csv,.pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.json">
          <div id="upRes" class="small" style="margin-top:10px"></div>
          <div class="row small" style="margin-top:8px"><a href="data/modelo_colaboradores.csv" download>Modelo de colaboradores</a> · <a href="data/modelo_vagas.csv" download>Modelo de vagas</a></div>`)}
      </div>
      <div class="grid g2">
        ${card('Catálogo de dados', 'Tudo que o assistente de IA pode cruzar', `<div class="table-wrap" style="max-height:420px;overflow:auto"><table><thead><tr><th>Tabela</th><th>Origem</th><th class="num">Linhas</th><th>Atualizada</th></tr></thead><tbody>
          ${cat.tabelas.map((t) => `<tr><td class="mono">${esc(t.tabela)}<div class="small muted" style="font-family:inherit">${esc(t.descricao || '')}</div></td><td>${esc(t.origem)}</td><td class="num">${int(t.linhas)}</td><td class="small">${new Date(t.atualizado_em).toLocaleString('pt-BR')}</td></tr>`).join('')}
        </tbody></table></div>`)}
        ${card('Documentos enviados', 'Contexto adicional disponível para análises e materiais', cat.documentos.length ? `<div class="table-wrap" style="max-height:420px;overflow:auto"><table><tbody>${cat.documentos.map((d) => `<tr><td><b>${esc(d.nome)}</b><div class="small muted">${esc(d.tipo_documento || '')} · ${new Date(d.enviado_em).toLocaleString('pt-BR')}</div><div class="small">${esc((d.resumo || '').slice(0, 260))}</div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nenhum documento ainda.</div>')}
      </div>
      ${card('Privacidade e governança (LGPD)', '', `<ul class="small">
        <li>O servidor roda só no seu computador (127.0.0.1) e grava a base em <span class="mono">server/dados/bp.db</span>.</li>
        <li>Somente o que o assistente consulta é enviado à API do Claude — as respostas às consultas, não a base inteira. Valide com o DPO e Segurança da Informação antes de usar dados reais.</li>
        <li>Dados de saúde aparecem apenas agregados; scores de risco nunca devem ser critério isolado de decisão sobre pessoas.</li>
        <li>Exibir nomes nas telas: <label><input type="checkbox" id="showNames" ${S.anon ? '' : 'checked'}> sim</label></li></ul>`)}`;
    return {
      html, mount(root) {
        root.querySelectorAll('[data-sync]').forEach((b) => b.addEventListener('click', () => ui.sincronizar(b.dataset.sync, b)));
        const drop = root.querySelector('#drop'), inp = root.querySelector('#fUp');
        drop.addEventListener('click', () => inp.click());
        inp.addEventListener('change', () => ui.enviarArquivos([...inp.files], root.querySelector('#upRes')));
        drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
        drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drag'); ui.enviarArquivos([...e.dataTransfer.files], root.querySelector('#upRes')); });
        root.querySelector('#showNames').addEventListener('change', (e) => { S.anon = !e.target.checked; ui.render(); });
      }
    };
  };

  // ------------------------------------------- Materiais: geração por prompt
  const materiaisTemplates = V.materiais;
  V.materiais = function (S, ui) {
    const base = materiaisTemplates(S, ui);
    const topo = `<section class="card no-print"><div class="card-head"><div><h2>✦ Gerar material com IA a partir de um prompt</h2><p class="hint">Usa a base completa (clima, performance, hierarquia, tribos, vagas, WFP, orçamento, absenteísmo, licenças, negócio) e os documentos enviados.</p></div></div>
      <div class="row"><textarea id="promptMat" rows="2" style="flex:1;min-width:260px" placeholder="Ex.: apresentação de 6 slides para o VP de Varejo sobre riscos de pessoas e plano 2027, com gráficos"></textarea>
      <select id="fmtMat"><option>Apresentação (slides)</option><option>One-page</option><option>Memo executivo</option><option>Pauta de reunião</option><option>Business case</option><option>E-mail</option></select>
      <button class="btn primary" id="gerarIA">Gerar</button></div>
      ${S.base.servidor ? '' : `<p class="small">${st('atencao', 'Requer o servidor local com a IA configurada (ver README).')}</p>`}</section>
      <h2 style="font-size:15px;margin:8px 0 0" class="no-print">Modelos prontos (sem IA)</h2>`;
    return {
      html: topo + base.html, mount(root) {
        base.mount(root);
        root.querySelector('#gerarIA').addEventListener('click', () => {
          const p = root.querySelector('#promptMat').value.trim(); if (!p) return ui.toast('Descreva o material');
          S.ui.modoIA = 'materiais'; ui.go('assistente');
          ui.chatEnviar('materiais', `Formato: ${root.querySelector('#fmtMat').value}. ${p}`);
        });
      }
    };
  };

  V._md = { md, renderGraficos };
})(window);
