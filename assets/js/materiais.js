/* =========================================================================
 * Cockpit do BP — Produtor de materiais executivos e comunicações
 * Gera documentos prontos para diretoria (imprimir → PDF) e rascunhos de
 * e-mail para os playbooks de automação, a partir dos dados do cockpit.
 * ========================================================================= */
(function (global) {
  'use strict';
  const A = global.BPAnalytics;
  const { brl, p100, dec } = A.fmt;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hoje = () => global.BPData.HOJE.toLocaleDateString('pt-BR');
  const nomeArea = (base, id) => (id === 'todas' ? 'Todas as áreas atendidas' : (base.areas.find((a) => a.id === id) || {}).nome);
  const sinal = (v) => (v > 0 ? '+' : '') + p100(v, 1);

  const TIPOS = {
    onepager: 'One-page executivo',
    pauta: 'Pauta da reunião mensal com o diretor',
    turnover: 'Relatório de turnover e retenção',
    businesscase: 'Business case de headcount',
    orcamento: 'Nota de acompanhamento orçamentário'
  };

  function kpiBlock(k) {
    const itens = [
      [k.hc.toLocaleString('pt-BR'), 'Headcount'],
      [p100(k.turnover, 1), 'Turnover 12m'],
      [p100(k.turnoverPrevisto, 1), 'Turnover vol. previsto 12m'],
      [String(k.enps), 'eNPS'],
      [k.vagas + ' (' + k.vagasForaSla + ' fora SLA)', 'Vagas abertas'],
      [sinal(k.orc.varForecast), 'Forecast vs orçado'],
      [p100(k.treinamento, 1), 'Treinamentos regulatórios'],
      [p100(k.sucessao), 'Cobertura sucessória']
    ];
    return '<div class="kpis">' + itens.map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('') + '</div>';
  }

  function narrativa(base, areaId, k, ins) {
    const frases = [];
    frases.push(`${nomeArea(base, areaId)} encerra o período com ${k.hc.toLocaleString('pt-BR')} colaboradores e turnover de ${p100(k.turnover, 1)} nos últimos 12 meses (${p100(k.turnoverVol, 1)} voluntário), sendo ${p100(k.regrettedPct)} das saídas voluntárias de alto desempenho.`);
    frases.push(`O modelo preditivo projeta ${Math.round(k.saidasEsperadas)} saídas voluntárias nos próximos 12 meses (${p100(k.turnoverPrevisto, 1)}), com ${k.riscoAlto} pessoas em risco alto — ${k.talentosRisco} delas talentos-chave.`);
    frases.push(`No orçamento de pessoal, o realizado acumulado está ${sinal(k.orc.varYtd)} vs orçado e o forecast do ano aponta ${sinal(k.orc.varForecast)} (${brl(k.orc.forecastAno)}).`);
    const crit = ins.filter((i) => i.sev === 'critico');
    if (crit.length) frases.push(`Há ${crit.length} ponto(s) crítico(s) que exigem decisão, liderados por: ${crit.slice(0, 2).map((i) => i.titulo.toLowerCase()).join('; ')}.`);
    return frases;
  }

  function gerar(base, modelo, tipo, areaId) {
    const k = A.kpis(base, areaId);
    const ins = A.insights(base, areaId);
    const f = A.filtrar(base, areaId);
    const area = nomeArea(base, areaId);
    let corpo = '';
    const topRisco = f.ativos.filter((c) => c.faixaRisco === 'Alto').sort((a, b) => b.risco - a.risco).slice(0, 10);
    const tabelaRisco = topRisco.length ? `<table><thead><tr><th>Matrícula</th><th>Cargo</th><th>Nível</th><th class="num">Risco</th><th>Fatores</th></tr></thead><tbody>${topRisco.map((c) => `<tr><td>${c.matricula}</td><td>${esc(c.cargo)}</td><td>${c.nivel}</td><td class="num">${p100(c.risco)}</td><td>${esc(c.riscoDrivers.join('; '))}</td></tr>`).join('')}</tbody></table>` : '<p>Sem colaboradores em risco alto.</p>';
    const listaInsights = (arr) => '<ul>' + arr.map((i) => `<li><b>${esc(i.titulo)}</b>${areaId === 'todas' ? ' — ' + esc(i.areaNome) : ''}. ${esc(i.acao)}${i.impacto ? ` <i>(exposição ${brl(i.impacto)})</i>` : ''}</li>`).join('') + '</ul>';

    if (tipo === 'onepager') {
      corpo = `<h2>Mensagem principal</h2><p>${narrativa(base, areaId, k, ins).map(esc).join(' ')}</p>
        ${kpiBlock(k)}
        <h2>Prioridades e decisões solicitadas</h2>${listaInsights(ins.filter((i) => i.sev !== 'oportunidade').slice(0, 5))}
        <h2>Oportunidades</h2>${listaInsights(ins.filter((i) => i.sev === 'oportunidade').slice(0, 3)) || '<p>—</p>'}`;
    } else if (tipo === 'pauta') {
      const decisoes = ins.filter((i) => i.sev === 'critico').slice(0, 4);
      corpo = `<h2>Objetivo</h2><p>Alinhar com a diretoria a saúde do capital humano de ${esc(area)}, validar prioridades de pessoas e obter decisões sobre os pontos críticos.</p>
        <h2>Agenda (60 min)</h2><table><thead><tr><th>Tempo</th><th>Tema</th><th>Objetivo</th></tr></thead><tbody>
        <tr><td>10 min</td><td>Indicadores do mês</td><td>Informar — HC, turnover, clima, orçamento</td></tr>
        <tr><td>15 min</td><td>Risco de saída e talentos</td><td>Decidir — ações de retenção para ${k.talentosRisco} talentos em risco</td></tr>
        <tr><td>10 min</td><td>Vagas e WFP</td><td>Priorizar — ${k.vagasForaSla} vagas fora do SLA, gap de competências</td></tr>
        <tr><td>10 min</td><td>Orçamento de pessoal</td><td>Validar — forecast ${sinal(k.orc.varForecast)} vs orçado</td></tr>
        <tr><td>10 min</td><td>Compliance de pessoas</td><td>Cobrar — treinamentos regulatórios e férias vencidas</td></tr>
        <tr><td>5 min</td><td>Encaminhamentos</td><td>Donos e prazos</td></tr></tbody></table>
        ${kpiBlock(k)}
        <h2>Decisões solicitadas ao diretor</h2>${decisoes.length ? '<ol>' + decisoes.map((i) => `<li>${esc(i.titulo)}: ${esc(i.acao)}</li>`).join('') + '</ol>' : '<p>Sem decisões críticas pendentes.</p>'}
        <h2>Perguntas que o diretor pode fazer (prepare-se)</h2><ul>
          <li>Quanto custa reter os talentos em risco versus repô-los? (ver simulador do cockpit)</li>
          <li>Por que o forecast de pessoal está ${k.orc.varForecast > 0 ? 'acima' : 'abaixo'} do orçado?</li>
          <li>Quais vagas estão travando entregas do negócio?</li></ul>`;
    } else if (tipo === 'turnover') {
      const vol = f.desligados.filter((c) => c.tipoDesligamento === 'Voluntário');
      const porNivel = {};
      vol.forEach((c) => { porNivel[c.nivel] = (porNivel[c.nivel] || 0) + 1; });
      const sim = A.simularRetencao(base, modelo, areaId, { merito: 0.08, ferias: true, reducaoHE: 0.3, stay: true, soTalentos: false });
      corpo = `<h2>Sumário</h2><p>${esc(narrativa(base, areaId, k, ins).slice(0, 2).join(' '))}</p>${kpiBlock(k)}
        <h2>Saídas voluntárias por nível (12m)</h2><table><thead><tr><th>Nível</th><th class="num">Saídas</th></tr></thead><tbody>${Object.entries(porNivel).sort((a, b) => b[1] - a[1]).map(([n, q]) => `<tr><td>${n}</td><td class="num">${q}</td></tr>`).join('')}</tbody></table>
        <h2>Principais fatores de saída (modelo preditivo)</h2><ul>${A.FEATURES.map((ft, j) => ({ ft, w: modelo.w[j] })).sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).slice(0, 5).map((x) => `<li>${esc(x.ft.nome)} — ${x.w > 0 ? 'aumenta' : 'reduz'} o risco (peso ${dec(x.w, 2)})</li>`).join('')}</ul>
        <p class="subt">Modelo de regressão logística treinado com ${modelo.n} registros; AUC em validação: ${dec(modelo.aucTeste, 2)}.</p>
        <h2>Colaboradores em risco alto (top 10, anonimizado por matrícula)</h2>${tabelaRisco}
        <h2>Plano de retenção proposto</h2><p>Mérito de 8% + regularização de férias + redução de 30% de HE + stay interviews para os ${sim.n} colaboradores em risco alto evita ~${dec(sim.saidasEvitadas, 1)} saídas, com custo anual de ${brl(sim.custo)} contra ${brl(sim.evitado)} de custo de reposição evitado.</p>`;
    } else if (tipo === 'businesscase') {
      const w = A.wfp(base, areaId);
      corpo = `<h2>Contexto</h2><p>${esc(area)} opera com ${k.hc} pessoas, média de ${dec(k.heMedia, 1)}h extras/mês (custo de HE no ano: ${brl(k.orc.heYtd)}) e ${k.vagasForaSla} vagas fora do SLA. O planejamento de força de trabalho projeta demanda de ${Math.round(w.total.demanda)} posições contra oferta de ${Math.round(w.total.oferta)} em 12 meses.</p>
        <h2>Proposta</h2><p>Aprovar ${Math.round(w.total.contratacoes)} contratações no horizonte de 12 meses (já existem ${Math.round(w.total.pipeline)} em pipeline), priorizando competências críticas.</p>
        <table><thead><tr><th>Área</th><th class="num">HC</th><th class="num">Oferta 12m</th><th class="num">Demanda 12m</th><th class="num">Contratar</th><th class="num">Custo anual</th></tr></thead><tbody>${w.linhas.map((l) => `<tr><td>${esc(l.area.nome)}</td><td class="num">${l.hc}</td><td class="num">${Math.round(l.oferta)}</td><td class="num">${Math.round(l.demanda)}</td><td class="num">${Math.round(l.contratacoes)}</td><td class="num">${brl(l.custoAnualGap)}</td></tr>`).join('')}</tbody></table>
        <h2>Competências críticas</h2><ul>${w.competencias.filter((s) => s.demanda > s.oferta).slice(0, 8).map((s) => `<li>${esc(s.skill)}: oferta ${s.oferta}, demanda ${s.demanda}</li>`).join('')}</ul>
        <h2>Benefícios esperados</h2><ul><li>Redução estimada de 30–40% do custo de HE estrutural (${brl(k.orc.heYtd * 0.35)}/ano)</li><li>Redução de risco de saída por sobrecarga e melhora de clima</li><li>Cumprimento dos prazos de entrega do negócio</li></ul>
        <h2>Riscos</h2><ul><li>Forecast de pessoal ${sinal(k.orc.varForecast)} vs orçado — requer validação da Controladoria</li><li>Tempo médio de preenchimento de ${Math.round(k.diasMedios)} dias</li></ul>`;
    } else if (tipo === 'orcamento') {
      const linhas = f.areas.map((a) => ({ a, k: A.kpis(base, a.id) }));
      corpo = `<h2>Resumo</h2><p>Orçado no ano: ${brl(k.orc.orcadoAno)}. Realizado acumulado: ${brl(k.orc.ytdReal)} (${sinal(k.orc.varYtd)} vs orçado no período). Forecast de fechamento: ${brl(k.orc.forecastAno)} (${sinal(k.orc.varForecast)}).</p>
        <table><thead><tr><th>Área</th><th class="num">Orçado ano</th><th class="num">Realizado YTD</th><th class="num">Var. YTD</th><th class="num">Forecast</th><th class="num">Var. forecast</th></tr></thead><tbody>${linhas.map(({ a, k: x }) => `<tr><td>${esc(a.nome)}</td><td class="num">${brl(x.orc.orcadoAno)}</td><td class="num">${brl(x.orc.ytdReal)}</td><td class="num">${sinal(x.orc.varYtd)}</td><td class="num">${brl(x.orc.forecastAno)}</td><td class="num">${sinal(x.orc.varForecast)}</td></tr>`).join('')}</tbody></table>
        <h2>Drivers do desvio</h2><ul><li>Dissídio da categoria (data-base setembro) acima do percentual orçado</li><li>Horas extras: ${brl(k.orc.heYtd)} no acumulado do ano</li><li>${k.vagas} vagas abertas (${base.vagas.filter((v) => (areaId === 'todas' || v.area === areaId) && v.motivo === 'Aumento de quadro').length} de aumento de quadro) impactam o forecast</li></ul>
        <h2>Treinamento</h2><p>Executado ${brl(k.orc.treinoReal)} de ${brl(k.orc.treinoOrc)} (${p100(k.orc.treinoReal / k.orc.treinoOrc)}).</p>`;
    }

    const html = `<article class="doc"><div class="subt">People | HR Business Partner · ${hoje()} · Uso interno — confidencial</div>
      <h1>${esc(TIPOS[tipo])}</h1><div class="subt">${esc(area)}</div>${corpo}
      <div class="rodape">Gerado pelo Cockpit do BP. ${base.sintetico ? 'ATENÇÃO: base sintética de demonstração.' : 'Fonte: base importada.'} Projeções são estimativas estatísticas e não substituem a avaliação do gestor.</div></article>`;
    return { html, titulo: TIPOS[tipo] + ' — ' + area };
  }

  // ---------- Comunicações dos playbooks ----------
  function comunicacao(playbook, ctx) {
    const area = ctx.areaNome || 'sua área';
    const n = (ctx.alvo || []).length;
    const lista = (ctx.alvo || []).slice(0, 30).join(', ');
    const T = {
      'stay-interview': ['Conversa de desenvolvimento com pessoas-chave da equipe', `Olá, gestor(a),\n\nIdentificamos ${n} pessoa(s) da equipe de ${area} que são fundamentais para os resultados e que gostaríamos de ouvir de forma estruturada nas próximas duas semanas (stay interview).\n\nMatrículas: ${lista}\n\nSugestão de roteiro:\n1. O que te mantém motivado(a) aqui?\n2. O que te faria considerar uma proposta externa?\n3. Que desenvolvimento/projeto você gostaria de ter nos próximos 12 meses?\n\nPosso apoiar na preparação. Vamos agendar 20 minutos?\n\nAbraço,\nHRBP`],
      'ferias': ['Regularização de férias vencidas — ação necessária', `Olá, gestor(a),\n\nHá ${n} colaborador(es) de ${area} com período(s) de férias vencido(s). Férias concedidas fora do período concessivo geram pagamento em dobro (art. 137 da CLT) e impactam saúde e engajamento.\n\nMatrículas: ${lista}\n\nPedimos a programação no sistema em até 10 dias. Estou à disposição para ajudar a organizar a escala.\n\nObrigado(a),\nHRBP`],
      'treinamentos': ['Treinamentos regulatórios pendentes — prazo de 10 dias úteis', `Olá, gestor(a),\n\nOs treinamentos regulatórios (PLD/FT, LGPD, Código de Ética e Segurança da Informação) são obrigatórios e auditados. Em ${area}, ${n} pessoa(s) ainda possuem pendências.\n\nMatrículas: ${lista}\n\nPrazo para conclusão: 10 dias úteis. Após esse prazo, a pendência será reportada ao Compliance e à diretoria.\n\nObrigado(a),\nHRBP`],
      'sla-vagas': ['Comitê de vagas — posições fora do SLA', `Olá, time de R&S e gestores,\n\nTemos ${n} vaga(s) de ${area} acima do SLA de contratação: ${lista}.\n\nProponho um comitê de 30 minutos nesta semana para decidirmos, vaga a vaga: manter, revisar perfil/faixa ou cancelar.\n\nHRBP`],
      'merito': ['Proposta de ajuste salarial — alto desempenho com defasagem', `Prezado comitê de remuneração,\n\nSubmeto para avaliação ${n} caso(s) de ${area} com desempenho alto e compa-ratio abaixo de 0,90, grupo com risco de saída acima da média.\n\nMatrículas: ${lista}\n\nA simulação de custo e o impacto em retenção estão disponíveis no Cockpit do BP.\n\nHRBP`],
      'sucessao': ['Revisão do mapa sucessório', `Olá, diretor(a),\n\n${n} posição(ões)-chave de ${area} não têm sucessor pronto. Proponho uma sessão de calibração em 30 dias para indicarmos sucessores (pronto agora / 1–2 anos) e abrirmos PDIs.\n\nPosições (matrícula do titular): ${lista}\n\nHRBP`]
    };
    const generico = [`Plano de ação: ${(A.PLAYBOOKS[playbook] || {}).nome || playbook}`, `Olá,\n\nCompartilho o plano de ação para ${area}: ${ctx.titulo || ''}.\n\nAção recomendada: ${ctx.acao || ''}\n\nPróximos passos:\n${((A.PLAYBOOKS[playbook] || {}).passos || []).map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\nHRBP`];
    const [assunto, corpo] = T[playbook] || generico;
    return { assunto, corpo };
  }

  global.BPMateriais = { TIPOS, gerar, comunicacao, esc };
})(typeof window !== 'undefined' ? window : globalThis);
