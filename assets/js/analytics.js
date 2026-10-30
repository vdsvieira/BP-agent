/* =========================================================================
 * Cockpit do BP — Motor analítico
 *  - KPIs e telemetria por área
 *  - Modelo preditivo de saída voluntária (regressão logística treinada
 *    no próprio navegador, com validação holdout e explicabilidade)
 *  - Projeções de WFP, forecast orçamentário
 *  - Motor de insights que cruza os subsistemas de RH
 * ========================================================================= */
(function (global) {
  'use strict';
  const { sigmoid, HOJE } = global.BPData;

  const FATOR_ENCARGOS = 1.86;
  const CONFIG = {
    riscoAlto: 0.30,          // prob. de saída voluntária em 12m
    riscoMedio: 0.15,
    mesesCustoReposicao: 6,   // custo de substituição ≈ 6 salários (R&S, ramp-up, produtividade)
    metaTreinamento: 0.95,
    metaMulheresLideranca: 0.40,
    metaNegros: 0.30,
    limiteHE: 14
  };

  const sum = (a, f) => a.reduce((s, x) => s + (f ? f(x) : x), 0);
  const avg = (a, f) => (a.length ? sum(a, f) / a.length : 0);
  const pct = (n, d) => (d ? n / d : 0);

  // ---------------------------------------------------------------------
  // Modelo preditivo
  // ---------------------------------------------------------------------
  const FEATURES = [
    { id: 'compaRatio', nome: 'Compa-ratio', f: (c) => c.compaRatio, texto: (c) => `compa-ratio baixo (${c.compaRatio.toFixed(2).replace('.', ',')})` },
    { id: 'mesesSemAumento', nome: 'Meses sem aumento', f: (c) => c.mesesSemAumento, texto: (c) => `${c.mesesSemAumento} meses sem aumento` },
    { id: 'mesesSemPromocao', nome: 'Meses sem promoção', f: (c) => c.mesesSemPromocao, texto: (c) => `${c.mesesSemPromocao} meses sem promoção` },
    { id: 'desempenho', nome: 'Desempenho', f: (c) => c.desempenho, texto: (c) => `alto desempenho (${c.desempenho}/5), visado pelo mercado` },
    { id: 'enps', nome: 'eNPS individual', f: (c) => c.enps, texto: (c) => `clima baixo (nota ${c.enps}/10)` },
    { id: 'tempoCasa', nome: 'Tempo de casa (anos)', f: (c) => c.tempoCasaMeses / 12, texto: (c) => `pouco tempo de casa (${(c.tempoCasaMeses / 12).toFixed(1).replace('.', ',')} anos)` },
    { id: 'heMes', nome: 'Horas extras/mês', f: (c) => c.heMes, texto: (c) => `${c.heMes}h extras/mês` },
    { id: 'feriasVencidas', nome: 'Férias vencidas', f: (c) => c.feriasVencidas, texto: (c) => `${c.feriasVencidas} período(s) de férias vencido(s)` },
    { id: 'trocaGestor', nome: 'Troca de gestor 12m', f: (c) => (c.trocaGestor12m ? 1 : 0), texto: () => 'troca de gestor recente' },
    { id: 'aquecimento', nome: 'Aquecimento do mercado', f: (c, a) => (a ? a.aquecimento : 0.5), texto: () => 'mercado aquecido para o perfil' },
    { id: 'idade', nome: 'Idade', f: (c) => c.idade, texto: (c) => `perfil em início de carreira (${c.idade} anos)` },
    { id: 'absenteismo', nome: 'Absenteísmo (dias)', f: (c) => c.absenteismo, texto: (c) => `${c.absenteismo} dias de ausência/12m` }
  ];

  function auc(scores, labels) {
    const idx = scores.map((s, i) => i).sort((a, b) => scores[a] - scores[b]);
    let rank = 0, somaPos = 0, nPos = 0;
    idx.forEach((i) => { rank++; if (labels[i]) { somaPos += rank; nPos++; } });
    const nNeg = labels.length - nPos;
    return nPos && nNeg ? (somaPos - nPos * (nPos + 1) / 2) / (nPos * nNeg) : 0.5;
  }

  function treinarModelo(base) {
    const areaById = Object.fromEntries(base.areas.map((a) => [a.id, a]));
    // população = ativos (0) + desligados voluntários (1). Involuntários não entram.
    const pop = base.colaboradores.map((c) => [c, 0]).concat(base.desligados.filter((c) => c.tipoDesligamento === 'Voluntário').map((c) => [c, 1]));
    const X = pop.map(([c]) => FEATURES.map((f) => f.f(c, areaById[c.area])));
    const y = pop.map(([, l]) => l);
    const k = FEATURES.length;
    const media = Array(k).fill(0), dp = Array(k).fill(0);
    X.forEach((r) => r.forEach((v, j) => { media[j] += v / X.length; }));
    X.forEach((r) => r.forEach((v, j) => { dp[j] += (v - media[j]) ** 2 / X.length; }));
    for (let j = 0; j < k; j++) dp[j] = Math.sqrt(dp[j]) || 1;
    const Z = X.map((r) => r.map((v, j) => (v - media[j]) / dp[j]));

    // split determinístico 75/25
    const treino = [], teste = [];
    Z.forEach((z, i) => ((i * 7919) % 4 === 0 ? teste : treino).push(i));

    let w = Array(k).fill(0), b = 0;
    const lr = 0.3, l2 = 0.01, iters = 500;
    for (let it = 0; it < iters; it++) {
      const gw = Array(k).fill(0); let gb = 0;
      for (const i of treino) {
        const p = sigmoid(b + Z[i].reduce((s, v, j) => s + v * w[j], 0));
        const e = p - y[i];
        gb += e; for (let j = 0; j < k; j++) gw[j] += e * Z[i][j];
      }
      b -= lr * gb / treino.length;
      for (let j = 0; j < k; j++) w[j] -= lr * (gw[j] / treino.length + l2 * w[j]);
    }
    const prever = (i) => sigmoid(b + Z[i].reduce((s, v, j) => s + v * w[j], 0));
    const aucTeste = auc(teste.map(prever), teste.map((i) => y[i]));
    const aucTreino = auc(treino.map(prever), treino.map((i) => y[i]));
    const taxaBase = avg(y);
    return { w, b, media, dp, aucTeste, aucTreino, n: pop.length, nPos: sum(y), taxaBase, areaById };
  }

  function pontuar(modelo, c, ajuste) {
    const a = modelo.areaById[c.area];
    const cc = ajuste ? Object.assign({}, c, ajuste) : c;
    const z = FEATURES.map((f, j) => (f.f(cc, a) - modelo.media[j]) / modelo.dp[j]);
    const contrib = z.map((v, j) => v * modelo.w[j]);
    const prob = sigmoid(modelo.b + sum(contrib));
    const drivers = contrib.map((v, j) => ({ j, v })).filter((d) => d.v > 0.12).sort((x, y) => y.v - x.v).slice(0, 3)
      .map((d) => FEATURES[d.j].texto(cc, a));
    return { prob, drivers };
  }

  function faixaRisco(p) { return p >= CONFIG.riscoAlto ? 'Alto' : p >= CONFIG.riscoMedio ? 'Médio' : 'Baixo'; }
  function caixa9(c) {
    const d = c.desempenho >= 4 ? 2 : c.desempenho === 3 ? 1 : 0;
    return { d, p: c.potencial - 1 };
  }
  const NOMES_9BOX = [
    ['Insuficiente', 'Eficaz', 'Comprometido'],
    ['Questionável', 'Mantenedor', 'Forte desempenho'],
    ['Enigma', 'Crescimento', 'Alto potencial']
  ]; // [potencial][desempenho]
  const custoReposicao = (c) => c.salario * CONFIG.mesesCustoReposicao;

  // ---------------------------------------------------------------------
  // Preparação: pontua todos os ativos uma única vez
  // ---------------------------------------------------------------------
  function preparar(base) {
    const modelo = treinarModelo(base);
    base.colaboradores.forEach((c) => {
      const r = pontuar(modelo, c);
      c.risco = r.prob; c.riscoDrivers = r.drivers; c.faixaRisco = faixaRisco(r.prob);
      c.talento = c.desempenho >= 4 && c.potencial >= 2;
    });
    return modelo;
  }

  function filtrar(base, areaId) {
    const ok = (x) => !areaId || areaId === 'todas' || x.area === areaId;
    const areas = base.areas.filter((a) => ok({ area: a.id }));
    return {
      areas, ativos: base.colaboradores.filter(ok), desligados: base.desligados.filter(ok), vagas: base.vagas.filter(ok),
      competencias: base.competencias.filter(ok)
    };
  }

  // ---------------------------------------------------------------------
  // Séries agregadas e orçamento
  // ---------------------------------------------------------------------
  function serieAgregada(base, areas) {
    const ids = areas.map((a) => a.id).filter((id) => base.series[id]);
    return base.meses.map((m, i) => {
      const pts = ids.map((id) => base.series[id][i]);
      const hc = sum(pts, (p) => p.hc);
      return {
        label: m.label, hc, admissoes: sum(pts, (p) => p.admissoes), desligVol: sum(pts, (p) => p.desligVol), desligInv: sum(pts, (p) => p.desligInv),
        absenteismo: hc ? sum(pts, (p) => p.absenteismo * p.hc) / hc : 0, he: hc ? sum(pts, (p) => p.he * p.hc) / hc : 0
      };
    });
  }

  function orcamento(base, areas, vagas) {
    const mesAtual = HOJE.getMonth();
    const meses = Array.from({ length: 12 }, (_, m) => ({ mes: m, orcado: 0, realizado: 0, forecast: 0 }));
    let orcadoAno = 0, treinoOrc = 0, treinoReal = 0;
    for (const a of areas) {
      const o = base.orcamento[a.id]; if (!o) continue;
      const ultimo = o.meses[mesAtual].realizado || o.meses[mesAtual].orcado;
      const vagasAumento = vagas.filter((v) => v.area === a.id && v.motivo === 'Aumento de quadro');
      const custoNovas = sum(vagasAumento, (v) => v.salarioPrevisto * FATOR_ENCARGOS) * 0.5; // ~50% preenchidas no horizonte
      o.meses.forEach((x, m) => {
        meses[m].orcado += x.orcado;
        if (m <= mesAtual) { meses[m].realizado += x.realizado; meses[m].forecast += x.realizado; }
        else meses[m].forecast += (ultimo + custoNovas) * (m === 11 ? 1.95 : 1);
        orcadoAno += x.orcado;
      });
      treinoOrc += o.treinamento.orcado; treinoReal += o.treinamento.realizado;
    }
    const ytdOrc = sum(meses.slice(0, mesAtual + 1), (m) => m.orcado);
    const ytdReal = sum(meses.slice(0, mesAtual + 1), (m) => m.realizado);
    const forecastAno = sum(meses, (m) => m.forecast);
    return {
      meses, orcadoAno, ytdOrc, ytdReal, varYtd: pct(ytdReal - ytdOrc, ytdOrc), forecastAno, varForecast: pct(forecastAno - orcadoAno, orcadoAno),
      treinoOrc, treinoReal, heYtd: sum(areas, (a) => (base.orcamento[a.id] ? sum(base.orcamento[a.id].meses.slice(0, mesAtual + 1), (x) => x.heCusto) : 0))
    };
  }

  // ---------------------------------------------------------------------
  // KPIs consolidados (telemetria)
  // ---------------------------------------------------------------------
  function kpis(base, areaId) {
    const f = filtrar(base, areaId);
    const { ativos, desligados, vagas } = f;
    const serie = serieAgregada(base, f.areas);
    const hcMedio = avg(serie, (s) => s.hc) || ativos.length;
    const vol = desligados.filter((c) => c.tipoDesligamento === 'Voluntário');
    const lideres = ativos.filter((c) => c.lider);
    const chave = ativos.filter((c) => c.posicaoChave);
    const promotores = ativos.filter((c) => c.enps >= 9).length, detratores = ativos.filter((c) => c.enps <= 6).length;
    const foraSla = vagas.filter((v) => v.diasAberta > v.sla);
    const orc = orcamento(base, f.areas, vagas);
    const ult3 = serie.slice(-3), pri3 = serie.slice(0, 3);
    const tendAbs = pct(avg(ult3, (s) => s.absenteismo) - avg(pri3, (s) => s.absenteismo), avg(pri3, (s) => s.absenteismo));
    const tendHE = pct(avg(ult3, (s) => s.he) - avg(pri3, (s) => s.he), avg(pri3, (s) => s.he));
    const saidasEsperadas = sum(ativos, (c) => c.risco || 0);
    return {
      hc: ativos.length, hcMedio, admissoes: sum(serie, (s) => s.admissoes), desligamentos: desligados.length,
      turnover: pct(desligados.length, hcMedio), turnoverVol: pct(vol.length, hcMedio),
      regretted: vol.filter((c) => c.regretted).length, regrettedPct: pct(vol.filter((c) => c.regretted).length, vol.length),
      absenteismo: serie.length ? serie[serie.length - 1].absenteismo : 0, tendAbs,
      heMedia: avg(ativos, (c) => c.heMes), tendHE,
      enps: Math.round(pct(promotores - detratores, ativos.length) * 100),
      compaMedio: avg(ativos, (c) => c.compaRatio), abaixo90: ativos.filter((c) => c.compaRatio < 0.9).length,
      vagas: vagas.length, vagasForaSla: foraSla.length, pctForaSla: pct(foraSla.length, vagas.length), diasMedios: avg(vagas, (v) => v.diasAberta),
      riscoAlto: ativos.filter((c) => c.faixaRisco === 'Alto').length, talentosRisco: ativos.filter((c) => c.talento && c.faixaRisco === 'Alto').length,
      saidasEsperadas, turnoverPrevisto: pct(saidasEsperadas, ativos.length),
      treinamento: pct(ativos.filter((c) => !c.treinamentosPendentes.length).length, ativos.length),
      feriasVencidas: ativos.filter((c) => c.feriasVencidas > 0).length, feriasDobra: ativos.filter((c) => c.feriasVencidas >= 2).length,
      sucessao: pct(chave.filter((c) => c.sucessorPronto).length, chave.length), posicoesChave: chave.length,
      mulheresLideranca: pct(lideres.filter((c) => c.genero === 'F').length, lideres.length),
      negros: pct(ativos.filter((c) => c.raca === 'Negra').length, ativos.length), pcd: pct(ativos.filter((c) => c.pcd).length, ativos.length),
      folhaMensal: sum(ativos, (c) => c.salario) * FATOR_ENCARGOS,
      orc, serie
    };
  }

  // ---------------------------------------------------------------------
  // WFP — projeção de oferta x demanda de headcount (12 meses)
  // ---------------------------------------------------------------------
  function wfp(base, areaId, cenario) {
    const sc = Object.assign({ crescimento: 0, automacao: 0, retencao: 0 }, cenario || {});
    const f = filtrar(base, areaId);
    const linhas = f.areas.map((a) => {
      const ativos = f.ativos.filter((c) => c.area === a.id);
      const deslig = f.desligados.filter((c) => c.area === a.id);
      const hc = ativos.length;
      const volEsperado = sum(ativos, (c) => c.risco || 0) * (1 - sc.retencao);
      const invEsperado = deslig.filter((c) => c.tipoDesligamento === 'Involuntário').length;
      const pipeline = sum(f.vagas.filter((v) => v.area === a.id), (v) => (v.etapa === 'Proposta' || v.etapa === 'Admissão' ? 0.9 : 0.55));
      const oferta = hc - volEsperado - invEsperado;
      const demanda = hc * (1 + a.crescimento + sc.crescimento) * (1 - a.automacao - sc.automacao);
      const gap = demanda - oferta;
      const salMedio = avg(ativos, (c) => c.salario);
      return {
        area: a, hc, volEsperado, invEsperado, pipeline, oferta, demanda, gap, contratacoes: Math.max(0, gap),
        excedente: Math.max(0, -gap), gapAposPipeline: gap - pipeline, salMedio,
        custoAnualGap: Math.max(0, gap) * salMedio * 13.33 * FATOR_ENCARGOS
      };
    });
    const total = {
      hc: sum(linhas, (l) => l.hc), oferta: sum(linhas, (l) => l.oferta), demanda: sum(linhas, (l) => l.demanda),
      contratacoes: sum(linhas, (l) => l.contratacoes), excedente: sum(linhas, (l) => l.excedente), pipeline: sum(linhas, (l) => l.pipeline),
      volEsperado: sum(linhas, (l) => l.volEsperado), custoAnualGap: sum(linhas, (l) => l.custoAnualGap)
    };
    const projecao = Array.from({ length: 13 }, (_, m) => ({
      mes: m,
      oferta: total.hc - (total.hc - total.oferta) * m / 12,
      demanda: total.hc + (total.demanda - total.hc) * m / 12,
      comPipeline: total.hc - (total.hc - total.oferta) * m / 12 + total.pipeline * Math.min(1, m / 4)
    }));
    return { linhas, total, projecao, competencias: f.competencias, cenario: sc };
  }

  // Simulação de retenção: aplica mérito/promoção ao grupo de risco alto
  function simularRetencao(base, modelo, areaId, opts) {
    const f = filtrar(base, areaId);
    const grupo = f.ativos.filter((c) => c.faixaRisco === 'Alto' && (!opts.soTalentos || c.talento));
    let antes = 0, depois = 0, custo = 0, evitado = 0;
    grupo.forEach((c) => {
      const novoCompa = Math.min(1.25, c.compaRatio * (1 + opts.merito));
      const r = pontuar(modelo, c, {
        compaRatio: novoCompa, mesesSemAumento: opts.merito > 0 ? 0 : c.mesesSemAumento,
        feriasVencidas: opts.ferias ? 0 : c.feriasVencidas, heMes: c.heMes * (1 - opts.reducaoHE),
        enps: Math.min(10, c.enps + (opts.stay ? 1 : 0))
      });
      antes += c.risco; depois += r.prob;
      custo += c.salario * opts.merito * 13.33 * FATOR_ENCARGOS;
      evitado += (c.risco - r.prob) * custoReposicao(c);
    });
    return { n: grupo.length, antes, depois, saidasEvitadas: antes - depois, custo, evitado, roi: custo ? (evitado - custo) / custo : 0 };
  }

  // ---------------------------------------------------------------------
  // Motor de insights — regras que cruzam subsistemas
  // ---------------------------------------------------------------------
  const dec = (v, d) => Number(v).toFixed(d).replace('.', ',');
  const brl = (v) => 'R$ ' + (Math.abs(v) >= 1e9 ? dec(v / 1e9, 2) + ' bi' : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1).replace('.', ',') + ' mi' : Math.round(v / 1e3).toLocaleString('pt-BR') + ' mil');
  const p100 = (v, d = 0) => (v * 100).toFixed(d).replace('.', ',') + '%';

  function insights(base, areaId) {
    const out = [];
    const areas = filtrar(base, areaId).areas;
    for (const a of areas) {
      const k = kpis(base, a.id);
      const f = filtrar(base, a.id);
      const add = (o) => out.push(Object.assign({ area: a.id, areaNome: a.nome }, o));

      const talentos = f.ativos.filter((c) => c.talento && c.faixaRisco === 'Alto');
      if (talentos.length) add({
        sev: 'critico', id: 'talentos-' + a.id, titulo: `${talentos.length} talento(s) com alto risco de saída`,
        detalhe: `Alta performance e potencial com probabilidade ≥ ${p100(CONFIG.riscoAlto)} de saída em 12m. Principais fatores: ${[...new Set(talentos.flatMap((c) => c.riscoDrivers))].slice(0, 3).join('; ')}.`,
        impacto: sum(talentos, (c) => c.risco * custoReposicao(c)), subsistemas: ['People Analytics', 'Desempenho', 'Remuneração'],
        acao: 'Conduzir stay interviews em até 15 dias e avaliar ajuste salarial/movimentação.', playbook: 'stay-interview', alvo: talentos.map((c) => c.matricula)
      });

      if (k.heMedia > CONFIG.limiteHE && k.tendAbs > 0.08) add({
        sev: 'critico', id: 'burnout-' + a.id, titulo: 'Sinal de sobrecarga: HE alta e absenteísmo em alta',
        detalhe: `Média de ${dec(k.heMedia, 1)}h extras/mês e absenteísmo +${p100(k.tendAbs)} no trimestre. Correlação típica com afastamentos (saúde mental) e queda de clima.`,
        impacto: k.orc.heYtd * 0.3, subsistemas: ['DP', 'Saúde Ocupacional', 'Clima'],
        acao: 'Mapear equipes críticas, revisar dimensionamento e acionar programa de saúde emocional.', playbook: 'burnout'
      });
      else if (k.heMedia > CONFIG.limiteHE) add({
        sev: 'atencao', id: 'he-' + a.id, titulo: `Horas extras acima do limite (${dec(k.heMedia, 1)}h/mês)`,
        detalhe: `Custo de HE no ano: ${brl(k.orc.heYtd)}. Avaliar se a demanda é estrutural (abrir vagas) ou pontual.`,
        impacto: k.orc.heYtd * 0.25, subsistemas: ['DP', 'WFP', 'Orçamento'], acao: 'Converter HE estrutural em headcount via business case.', playbook: 'burnout'
      });

      const defasados = f.ativos.filter((c) => c.desempenho >= 4 && c.compaRatio < 0.9);
      if (defasados.length >= 3) add({
        sev: 'atencao', id: 'compa-' + a.id, titulo: `${defasados.length} alto(s) desempenho(s) com compa-ratio < 0,90`,
        detalhe: `Custo anual para levar ao compa 0,95: ${brl(sum(defasados, (c) => c.salario * (0.95 / c.compaRatio - 1) * 13.33 * FATOR_ENCARGOS))}. Risco de saída médio do grupo: ${p100(avg(defasados, (c) => c.risco))}.`,
        impacto: sum(defasados, (c) => c.risco * custoReposicao(c)), subsistemas: ['Remuneração', 'Desempenho'],
        acao: 'Priorizar no ciclo de mérito e submeter ao comitê de remuneração.', playbook: 'merito', alvo: defasados.map((c) => c.matricula)
      });

      if (k.feriasVencidas) add({
        sev: k.feriasDobra ? 'critico' : 'atencao', id: 'ferias-' + a.id,
        titulo: `${k.feriasVencidas} colaborador(es) com férias vencidas${k.feriasDobra ? ` (${k.feriasDobra} com 2 períodos)` : ''}`,
        detalhe: 'Férias concedidas fora do período concessivo são pagas em dobro (art. 137 CLT) e elevam risco de saída e afastamento.',
        impacto: sum(f.ativos.filter((c) => c.feriasVencidas >= 2), (c) => c.salario * 4 / 3), subsistemas: ['DP', 'Jurídico Trabalhista', 'Saúde'],
        acao: 'Notificar gestores e programar férias nos próximos 60 dias.', playbook: 'ferias', alvo: f.ativos.filter((c) => c.feriasVencidas).map((c) => c.matricula)
      });

      if (k.treinamento < CONFIG.metaTreinamento) add({
        sev: 'critico', id: 'trein-' + a.id, titulo: `Treinamentos regulatórios em ${p100(k.treinamento, 1)} (meta ${p100(CONFIG.metaTreinamento)})`,
        detalhe: `${f.ativos.filter((c) => c.treinamentosPendentes.length).length} pessoas com pendência (PLD/FT, LGPD, Ética, SI). Exposição em auditoria interna/regulador.`,
        impacto: 0, subsistemas: ['T&D', 'Compliance'], acao: 'Cobrança formal via gestor com prazo de 10 dias úteis.', playbook: 'treinamentos',
        alvo: f.ativos.filter((c) => c.treinamentosPendentes.length).map((c) => c.matricula)
      });

      if (k.pctForaSla > 0.3) add({
        sev: 'atencao', id: 'sla-' + a.id, titulo: `${k.vagasForaSla} vaga(s) fora do SLA (${p100(k.pctForaSla)})`,
        detalhe: `Tempo médio em aberto: ${Math.round(k.diasMedios)} dias. Vacância prolongada pressiona HE e clima da equipe.`,
        impacto: sum(f.vagas.filter((v) => v.diasAberta > v.sla), (v) => v.salarioPrevisto * (v.diasAberta - v.sla) / 30 * 0.5),
        subsistemas: ['R&S', 'WFP', 'DP'], acao: 'Rodar comitê de vagas com R&S e revisar perfil/faixa das críticas.', playbook: 'sla-vagas',
        alvo: f.vagas.filter((v) => v.diasAberta > v.sla).map((v) => v.id)
      });

      if (k.orc.varForecast > 0.02) add({
        sev: 'critico', id: 'orc-' + a.id, titulo: `Forecast de pessoal ${p100(k.orc.varForecast, 1)} acima do orçado`,
        detalhe: `Projeção ${brl(k.orc.forecastAno)} vs orçado ${brl(k.orc.orcadoAno)}. Dissídio real acima do orçado e HE explicam parte do desvio.`,
        impacto: k.orc.forecastAno - k.orc.orcadoAno, subsistemas: ['Orçamento', 'DP', 'R&S'],
        acao: 'Congelar aumentos de quadro não críticos e apresentar plano de recuperação ao diretor.', playbook: 'orcamento'
      });
      else if (k.orc.varForecast < -0.03) add({
        sev: 'oportunidade', id: 'orc-' + a.id, titulo: `Espaço orçamentário de ${brl(k.orc.orcadoAno - k.orc.forecastAno)}`,
        detalhe: `Forecast ${p100(-k.orc.varForecast, 1)} abaixo do orçado. Pode financiar vagas críticas ou ações de retenção.`,
        impacto: k.orc.orcadoAno - k.orc.forecastAno, subsistemas: ['Orçamento', 'WFP', 'Remuneração'],
        acao: 'Propor realocação para retenção de talentos e vagas de competências críticas.', playbook: 'orcamento'
      });

      if (k.posicoesChave && k.sucessao < 0.5) add({
        sev: 'atencao', id: 'suc-' + a.id, titulo: `Sucessão descoberta: ${p100(1 - k.sucessao)} das posições-chave sem sucessor pronto`,
        detalhe: `${k.posicoesChave} posições-chave mapeadas. Cruzar com risco de saída dos titulares.`,
        impacto: 0, subsistemas: ['Sucessão', 'T&D', 'People Analytics'], acao: 'Calibrar mapa sucessório e PDIs de sucessores em 90 dias.', playbook: 'sucessao',
        alvo: f.ativos.filter((c) => c.posicaoChave && !c.sucessorPronto).map((c) => c.matricula)
      });

      if (k.mulheresLideranca < CONFIG.metaMulheresLideranca) add({
        sev: 'oportunidade', id: 'dei-' + a.id, titulo: `Mulheres na liderança: ${p100(k.mulheresLideranca)} (meta ${p100(CONFIG.metaMulheresLideranca)})`,
        detalhe: `${f.vagas.filter((v) => v.diversidade).length} vaga(s) com marcação afirmativa abertas. Negros: ${p100(k.negros)} do quadro.`,
        impacto: 0, subsistemas: ['D&I', 'R&S', 'Sucessão'], acao: 'Garantir shortlist diversa nas vagas de liderança e sucessoras no pipeline.', playbook: 'diversidade'
      });

      const gaps = f.competencias.filter((s) => s.demanda > s.oferta * 1.2);
      if (gaps.length) add({
        sev: 'atencao', id: 'skills-' + a.id, titulo: `Gap em competências críticas: ${gaps.map((g) => g.skill).join(', ')}`,
        detalhe: gaps.map((g) => `${g.skill}: oferta ${g.oferta} × demanda ${g.demanda}`).join(' · '),
        impacto: 0, subsistemas: ['WFP', 'T&D', 'R&S'], acao: 'Decidir build × buy: trilha de upskilling interna e contratações direcionadas.', playbook: 'upskilling'
      });

      const gestorClima = f.ativos.filter((c) => c.trocaGestor12m && c.enps <= 6);
      if (gestorClima.length > a.hc * 0.06) add({
        sev: 'atencao', id: 'gestor-' + a.id, titulo: `${gestorClima.length} pessoas com troca de gestor e clima detrator`,
        detalhe: 'Transições de liderança sem onboarding do gestor costumam derrubar o engajamento por 2–3 trimestres.',
        impacto: sum(gestorClima, (c) => c.risco * custoReposicao(c)) * 0.3, subsistemas: ['Clima', 'Liderança', 'People Analytics'],
        acao: 'Rodar assimilação de liderança (new leader assimilation) nas equipes afetadas.', playbook: 'stay-interview', alvo: gestorClima.map((c) => c.matricula)
      });
    }
    const ordem = { critico: 0, atencao: 1, oportunidade: 2 };
    return out.sort((x, y) => ordem[x.sev] - ordem[y.sev] || y.impacto - x.impacto);
  }

  // ---------------------------------------------------------------------
  // Playbooks de automação operacional
  // ---------------------------------------------------------------------
  const PLAYBOOKS = {
    'stay-interview': { nome: 'Stay interviews', prazo: 15, passos: ['Validar lista com gestores', 'Agendar conversas 1:1', 'Registrar motivadores e riscos', 'Definir ação individual (salário, carreira, projeto)', 'Reavaliar risco em 30 dias'] },
    'burnout': { nome: 'Plano de sobrecarga', prazo: 30, passos: ['Extrair HE por equipe/gestor', 'Cruzar com afastamentos e clima', 'Reunião com diretor e gestores', 'Acionar programa de apoio emocional', 'Business case de headcount se estrutural'] },
    'merito': { nome: 'Ajuste salarial', prazo: 45, passos: ['Validar enquadramento e pesquisa salarial', 'Simular custo no orçamento', 'Submeter ao comitê de remuneração', 'Comunicar decisões aos gestores'] },
    'ferias': { nome: 'Regularização de férias', prazo: 10, passos: ['Enviar lista aos gestores', 'Coletar programação', 'Lançar no sistema de ponto/folha', 'Monitorar até gozo'] },
    'treinamentos': { nome: 'Cobrança regulatória', prazo: 10, passos: ['Enviar pendências aos gestores', 'Lembrete automático D+5', 'Escalar para diretor em D+10', 'Reportar ao Compliance'] },
    'sla-vagas': { nome: 'Comitê de vagas', prazo: 7, passos: ['Listar vagas fora do SLA', 'Diagnóstico com R&S (perfil, faixa, fonte)', 'Decidir: manter, reabrir perfil ou cancelar', 'Atualizar gestor solicitante'] },
    'orcamento': { nome: 'Gestão orçamentária', prazo: 20, passos: ['Conciliar realizado x orçado com Controladoria', 'Explicar desvios por driver (HC, dissídio, HE)', 'Propor plano de ação', 'Apresentar ao diretor'] },
    'sucessao': { nome: 'Mapa sucessório', prazo: 90, passos: ['Revisar posições-chave', 'Indicar sucessores (pronto agora / 1-2 anos)', 'Calibrar com diretoria', 'Abrir PDIs de sucessores'] },
    'diversidade': { nome: 'Pipeline diverso', prazo: 30, passos: ['Marcar vagas de liderança como afirmativas', 'Exigir shortlist diversa', 'Mentoria para sucessoras', 'Acompanhar indicador mensal'] },
    'upskilling': { nome: 'Build × Buy de competências', prazo: 60, passos: ['Validar demanda com a área', 'Mapear potenciais internos', 'Desenhar trilha com Universidade Corporativa', 'Abrir vagas para o gap residual'] }
  };

  global.BPAnalytics = {
    CONFIG, FEATURES, FATOR_ENCARGOS, NOMES_9BOX, PLAYBOOKS,
    preparar, treinarModelo, pontuar, filtrar, kpis, wfp, simularRetencao, insights, caixa9, faixaRisco, custoReposicao,
    fmt: { brl, p100, dec }, util: { sum, avg, pct }
  };
})(typeof window !== 'undefined' ? window : globalThis);
