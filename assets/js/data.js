/* =========================================================================
 * Cockpit do BP — Camada de dados
 * Gera uma base SINTÉTICA e determinística (semente fixa) que imita a
 * realidade de um grande banco: áreas, colaboradores, desligamentos,
 * vagas, orçamento e competências críticas. Substitua por dados reais via
 * importação CSV (ver README) — nada sai do navegador.
 * ========================================================================= */
(function (global) {
  'use strict';

  // ---------- RNG determinístico ----------
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let rnd = mulberry32(20261030);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const between = (a, b) => a + (b - a) * rnd();
  const int = (a, b) => Math.floor(between(a, b + 1));
  const normal = (mu, sd) => {
    const u = 1 - rnd(), v = rnd();
    return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const sigmoid = (z) => 1 / (1 + Math.exp(-z));

  // ---------- Calendário de referência ----------
  const HOJE = new Date(2026, 9, 30); // 30/out/2026
  const NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const MESES = []; // últimos 12 meses (nov/25 .. out/26)
  for (let i = 11; i >= 0; i--) {
    const d = new Date(HOJE.getFullYear(), HOJE.getMonth() - i, 1);
    MESES.push({ ano: d.getFullYear(), mes: d.getMonth(), label: NOMES_MES[d.getMonth()] + '/' + String(d.getFullYear()).slice(2) });
  }

  // ---------- Áreas atendidas pelo BP ----------
  // aquecimento: pressão do mercado externo sobre a área (0..1)
  const AREAS = [
    { id: 'varejo-pf', nome: 'Varejo PF', diretor: 'Diretoria Varejo PF', hc: 560, aquecimento: 0.35, crescimento: 0.02, automacao: 0.06, salarioBase: 7800 },
    { id: 'varejo-pj', nome: 'Varejo PJ', diretor: 'Diretoria Varejo PJ', hc: 340, aquecimento: 0.40, crescimento: 0.05, automacao: 0.03, salarioBase: 9200 },
    { id: 'atacado', nome: 'Atacado & IB', diretor: 'Diretoria Atacado', hc: 180, aquecimento: 0.65, crescimento: 0.06, automacao: 0.01, salarioBase: 21000 },
    { id: 'tecnologia', nome: 'Tecnologia', diretor: 'Diretoria de TI', hc: 520, aquecimento: 0.90, crescimento: 0.10, automacao: 0.02, salarioBase: 16500 },
    { id: 'riscos', nome: 'Riscos & Compliance', diretor: 'Diretoria de Riscos', hc: 210, aquecimento: 0.55, crescimento: 0.04, automacao: 0.03, salarioBase: 15200 },
    { id: 'operacoes', nome: 'Operações', diretor: 'Diretoria de Operações', hc: 430, aquecimento: 0.20, crescimento: -0.03, automacao: 0.12, salarioBase: 6400 },
    { id: 'credito', nome: 'Crédito & Cobrança', diretor: 'Diretoria de Crédito', hc: 260, aquecimento: 0.45, crescimento: 0.03, automacao: 0.07, salarioBase: 10800 },
    { id: 'digital', nome: 'Canais Digitais', diretor: 'Diretoria Digital', hc: 240, aquecimento: 0.85, crescimento: 0.12, automacao: 0.01, salarioBase: 17800 }
  ];

  const NIVEIS = [
    { id: 'Assistente', mult: 0.55, peso: 0.12, sla: 30 },
    { id: 'Analista Jr', mult: 0.75, peso: 0.18, sla: 30 },
    { id: 'Analista Pl', mult: 1.0, peso: 0.22, sla: 40 },
    { id: 'Analista Sr', mult: 1.35, peso: 0.18, sla: 45 },
    { id: 'Especialista', mult: 1.8, peso: 0.12, sla: 60 },
    { id: 'Coordenador', mult: 2.1, peso: 0.08, sla: 60, lider: true },
    { id: 'Gerente', mult: 2.9, peso: 0.07, sla: 75, lider: true },
    { id: 'Superintendente', mult: 4.8, peso: 0.03, sla: 90, lider: true }
  ];
  const CARGOS = {
    'varejo-pf': ['Gerente de Relacionamento', 'Assistente de Atendimento', 'Gerente de Agência', 'Especialista de Investimentos'],
    'varejo-pj': ['Gerente PJ', 'Analista de Crédito PJ', 'Assistente Comercial PJ', 'Especialista Cash Management'],
    'atacado': ['Banker Corporate', 'Analista de M&A', 'Trader', 'Especialista de Produtos Estruturados'],
    'tecnologia': ['Engenheiro de Software', 'Engenheiro de Dados', 'Especialista Cloud', 'Analista de Cibersegurança', 'Scrum Master'],
    'riscos': ['Analista de Risco de Mercado', 'Analista de PLD/FT', 'Especialista de Compliance', 'Modelador de Risco'],
    'operacoes': ['Analista de Operações', 'Assistente de Backoffice', 'Analista de Processos', 'Especialista de Câmbio'],
    'credito': ['Analista de Crédito', 'Analista de Cobrança', 'Cientista de Dados de Crédito', 'Especialista de Recuperação'],
    'digital': ['Product Manager', 'UX Designer', 'Engenheiro Mobile', 'Analista de Growth']
  };
  const SKILLS = {
    'varejo-pf': ['Certificação CPA-20/CEA', 'Consultoria de Investimentos', 'Venda Consultiva Digital'],
    'varejo-pj': ['Crédito PJ', 'Cash Management', 'Câmbio PME'],
    'atacado': ['M&A / DCM', 'Estruturação de Derivativos', 'ESG Finance'],
    'tecnologia': ['Cloud & FinOps', 'Engenharia de Dados', 'Cibersegurança', 'IA Generativa'],
    'riscos': ['PLD/FT', 'Modelagem Basileia', 'Risco Climático'],
    'operacoes': ['Automação RPA', 'Gestão de Processos', 'Pix / Open Finance'],
    'credito': ['Ciência de Dados', 'Recuperação Judicial', 'Política de Crédito'],
    'digital': ['Product Management', 'UX Research', 'Engenharia Mobile']
  };

  const NOMES_F = ['Ana', 'Beatriz', 'Camila', 'Daniela', 'Fernanda', 'Gabriela', 'Juliana', 'Larissa', 'Mariana', 'Patrícia', 'Renata', 'Tatiane', 'Vanessa', 'Aline', 'Bruna', 'Carla', 'Débora', 'Elaine', 'Luana', 'Priscila'];
  const NOMES_M = ['André', 'Bruno', 'Carlos', 'Diego', 'Eduardo', 'Felipe', 'Gustavo', 'Henrique', 'Igor', 'João', 'Lucas', 'Marcelo', 'Rafael', 'Rodrigo', 'Thiago', 'Vinícius', 'Leandro', 'Fábio', 'Paulo', 'Ricardo'];
  const SOBRENOMES = ['Silva', 'Souza', 'Oliveira', 'Santos', 'Pereira', 'Costa', 'Rodrigues', 'Almeida', 'Nascimento', 'Lima', 'Araújo', 'Fernandes', 'Carvalho', 'Gomes', 'Martins', 'Rocha', 'Ribeiro', 'Alves', 'Monteiro', 'Mendes', 'Barros', 'Freitas', 'Barbosa', 'Pinto', 'Moura', 'Cavalcanti', 'Dias', 'Castro', 'Campos', 'Cardoso'];
  const RECRUTADORES = ['Recrutador A', 'Recrutador B', 'Recrutador C', 'Recrutador D', 'Recrutador E'];
  const ETAPAS = ['Aberta', 'Triagem', 'Entrevistas', 'Proposta', 'Admissão'];

  // Fatores "verdadeiros" que geram o desligamento voluntário na simulação.
  // O modelo preditivo NÃO conhece estes pesos: ele os reaprende dos dados.
  const PESOS_REAIS = {
    compaRatio: -3.2, mesesSemAumento: 0.035, desempenho: 0.18, enps: -0.28,
    tempoCasaAnos: -0.06, heMes: 0.03, feriasVencidas: 0.35, trocaGestor12m: 0.55,
    aquecimento: 1.6, idade: -0.035, absenteismo: 0.04, mesesSemPromocao: 0.012
  };

  function gerarColaborador(area, seq) {
    const r = rnd();
    let acc = 0, nivel = NIVEIS[0];
    for (const n of NIVEIS) { acc += n.peso; if (r <= acc) { nivel = n; break; } }
    const genero = rnd() < (area.id === 'tecnologia' ? 0.3 : 0.52) ? 'F' : 'M';
    const nome = (genero === 'F' ? pick(NOMES_F) : pick(NOMES_M)) + ' ' + pick(SOBRENOMES) + ' ' + pick(SOBRENOMES);
    const idade = Math.round(clamp(normal(24 + NIVEIS.indexOf(nivel) * 3.2, 6), 19, 64));
    const tempoCasaMeses = rnd() < 0.16 ? int(0, 11)
      : Math.round(clamp(Math.abs(normal(12 * (2 + NIVEIS.indexOf(nivel) * 1.2), 40)), 12, (idade - 18) * 12));
    const compaRatio = +clamp(normal(0.98 - area.aquecimento * 0.06, 0.1), 0.7, 1.3).toFixed(2);
    const salario = Math.round(area.salarioBase * nivel.mult * compaRatio / 10) * 10;
    const desempenho = clamp(Math.round(normal(3.2, 0.9)), 1, 5);
    const potencial = clamp(Math.round(normal(1.9 + (desempenho - 3) * 0.25, 0.7)), 1, 3);
    const enps = clamp(Math.round(normal(8.1 - area.aquecimento * 1.2, 1.8)), 0, 10);
    const heMes = +clamp(Math.abs(normal(area.id === 'operacoes' || area.id === 'tecnologia' ? 14 : 8, 7)), 0, 50).toFixed(1);
    const absenteismo = +clamp(Math.abs(normal(area.id === 'operacoes' ? 7 : 4.5, 3.5)), 0, 40).toFixed(1); // dias/12m
    const ferias = rnd() < 0.07 ? (rnd() < 0.25 ? 2 : 1) : 0;
    const raca = rnd() < 0.31 ? 'Negra' : (rnd() < 0.95 ? 'Branca' : 'Amarela/Indígena');
    const pcd = rnd() < 0.035;
    const regulatorios = ['PLD/FT', 'LGPD', 'Código de Ética', 'Segurança da Informação'];
    const pendentes = regulatorios.filter(() => rnd() < 0.008 + (area.id === 'operacoes' ? 0.02 : 0));
    const posicaoChave = !!nivel.lider && rnd() < 0.55 || (nivel.id === 'Especialista' && rnd() < 0.2);
    return {
      matricula: 'F' + String(100000 + seq),
      nome, genero, raca, pcd, idade,
      area: area.id, cargo: pick(CARGOS[area.id]), nivel: nivel.id, lider: !!nivel.lider,
      tempoCasaMeses, salario, compaRatio,
      mesesSemAumento: int(1, 30), mesesSemPromocao: int(3, 60),
      desempenho, potencial, enps, heMes, absenteismo,
      feriasVencidas: ferias,
      trocaGestor12m: rnd() < 0.22,
      treinamentosPendentes: pendentes,
      modelo: pick(['Presencial', 'Híbrido', 'Híbrido', 'Remoto']),
      posicaoChave, sucessorPronto: posicaoChave ? rnd() < 0.45 : null,
      skill: rnd() < 0.35 ? pick(SKILLS[area.id]) : null,
      status: 'ativo'
    };
  }

  function logitReal(c, area) {
    const w = PESOS_REAIS;
    return w.compaRatio * (c.compaRatio - 1) + w.mesesSemAumento * c.mesesSemAumento + w.desempenho * (c.desempenho - 3) +
      w.enps * (c.enps - 7) + w.tempoCasaAnos * (c.tempoCasaMeses / 12) + w.heMes * c.heMes + w.feriasVencidas * c.feriasVencidas +
      w.trocaGestor12m * (c.trocaGestor12m ? 1 : 0) + w.aquecimento * area.aquecimento + w.idade * (c.idade - 35) +
      w.absenteismo * c.absenteismo + w.mesesSemPromocao * c.mesesSemPromocao;
  }

  // ---------- Séries de telemetria (12 meses) ----------
  function calcularSeries(areas, colaboradores, desligados) {
    const series = {};
    for (const area of areas) {
      const ativos = colaboradores.filter((c) => c.area === area.id);
      const sairam = desligados.filter((c) => c.area === area.id);
      if (!ativos.length) continue;
      const absBase = ativos.reduce((s, c) => s + c.absenteismo, 0) / ativos.length / 220 * 100;
      const heBase = ativos.reduce((s, c) => s + c.heMes, 0) / ativos.length;
      series[area.id] = MESES.map((m, i) => {
        const admitidos = ativos.filter((c) => c.tempoCasaMeses === 11 - i).length;
        const saidas = sairam.filter((c) => c.mesDesligamento === i);
        const hc = ativos.filter((c) => c.tempoCasaMeses > 11 - i).length + sairam.filter((c) => c.mesDesligamento >= i).length;
        const tendencia = (i - 6) * (area.id === 'operacoes' || area.id === 'tecnologia' ? 0.03 : 0.005);
        return {
          label: m.label, hc, admissoes: admitidos,
          desligVol: saidas.filter((c) => c.tipoDesligamento === 'Voluntário').length,
          desligInv: saidas.filter((c) => c.tipoDesligamento === 'Involuntário').length,
          absenteismo: +(absBase * (1 + tendencia + normal(0, 0.06))).toFixed(2),
          he: +(heBase * (1 + tendencia * 1.5 + normal(0, 0.05))).toFixed(1)
        };
      });
    }
    return series;
  }

  function gerarBase(seed) {
    rnd = mulberry32(seed || 20261030);
    let seq = 0;
    const colaboradores = [];
    const desligados = [];
    for (const area of AREAS) {
      // população no início da janela = HC atual + quem saiu nos 12m
      const pop = [];
      const n = Math.round(area.hc * 1.13);
      for (let i = 0; i < n; i++) pop.push(gerarColaborador(area, seq++));
      // intercepto calibrado para ~ turnover voluntário-alvo da área
      const alvo = 0.05 + area.aquecimento * 0.10;
      let lo = -12, hi = 6;
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2;
        const m = pop.reduce((s, c) => s + sigmoid(mid + logitReal(c, area)), 0) / pop.length;
        if (m > alvo) hi = mid; else lo = mid;
      }
      const b0 = (lo + hi) / 2;
      for (const c of pop) {
        const p = sigmoid(b0 + logitReal(c, area));
        if (rnd() < p) {
          c.status = 'desligado'; c.tipoDesligamento = 'Voluntário';
        } else if (rnd() < 0.03 + (c.desempenho <= 2 ? 0.06 : 0)) {
          c.status = 'desligado'; c.tipoDesligamento = 'Involuntário';
        }
        if (c.status === 'desligado') {
          c.mesDesligamento = int(0, 11); // índice em MESES
          c.regretted = c.tipoDesligamento === 'Voluntário' && c.desempenho >= 4;
          desligados.push(c);
        } else colaboradores.push(c);
      }
    }

    // ---------- Vagas ----------
    const vagas = [];
    let vseq = 1;
    for (const area of AREAS) {
      const qtd = Math.round(area.hc * (0.035 + area.crescimento * 0.25 + area.aquecimento * 0.02));
      for (let i = 0; i < qtd; i++) {
        const nivel = NIVEIS[Math.min(NIVEIS.length - 1, Math.floor(Math.abs(normal(1.6, 1.4))))];
        const dias = Math.round(clamp(Math.abs(normal(nivel.sla * (0.45 + area.aquecimento * 0.5), nivel.sla * 0.5)), 1, 210));
        const prog = clamp(Math.floor(dias / nivel.sla * 2.2 + rnd() * 1.5), 0, 4);
        const abertura = new Date(HOJE); abertura.setDate(abertura.getDate() - dias);
        vagas.push({
          id: 'REQ-' + String(26000 + vseq++), area: area.id, cargo: pick(CARGOS[area.id]), nivel: nivel.id,
          motivo: rnd() < 0.62 ? 'Reposição' : 'Aumento de quadro',
          abertura: abertura.toISOString().slice(0, 10), diasAberta: dias, sla: nivel.sla,
          etapa: ETAPAS[prog], candidatos: int(0, 40) + prog * 6,
          recrutador: pick(RECRUTADORES), orcada: rnd() < 0.86,
          salarioPrevisto: Math.round(area.salarioBase * nivel.mult / 10) * 10,
          prioridade: rnd() < 0.25 ? 'Alta' : (rnd() < 0.6 ? 'Média' : 'Baixa'),
          diversidade: rnd() < 0.3
        });
      }
    }

    // ---------- Orçamento de pessoal (ano corrente) ----------
    const FATOR_ENCARGOS = 1.86; // encargos + benefícios sobre salário base
    const DISSIDIO_REAL = 0.052, DISSIDIO_ORCADO = 0.045, MES_DISSIDIO = 8; // setembro (data-base bancários)
    const orcamento = {};
    for (const area of AREAS) {
      const ativos = colaboradores.filter((c) => c.area === area.id);
      const sairam = desligados.filter((c) => c.area === area.id);
      const folhaAtual = ativos.reduce((s, c) => s + c.salario, 0);
      const salMedio = folhaAtual / ativos.length;
      const hcPlano = Math.round(area.hc * (1 + area.crescimento * 0.6));
      const desvioPlano = between(1.0, 1.12); // qualidade da premissa orçamentária da área
      const meses = [];
      for (let m = 0; m < 12; m++) {
        const decimoTerceiro = m === 11 ? 1.95 : 1;
        const heCusto = ativos.reduce((s, c) => s + c.heMes * (c.salario / 220) * 1.5, 0) * (0.85 + rnd() * 0.3);
        const orcado = (hcPlano * salMedio / (1 + DISSIDIO_REAL) * desvioPlano * (m >= MES_DISSIDIO ? 1 + DISSIDIO_ORCADO : 1) * FATOR_ENCARGOS + heCusto * 0.55) * decimoTerceiro;
        const hcReal = ativos.length + sairam.filter((c) => c.mesDesligamento >= m - 1).length;
        const realizado = m <= HOJE.getMonth()
          ? (hcReal * salMedio / (1 + DISSIDIO_REAL) * (m >= MES_DISSIDIO ? 1 + DISSIDIO_REAL : 1) * FATOR_ENCARGOS * (0.98 + rnd() * 0.04) + heCusto) * decimoTerceiro
          : null;
        meses.push({ mes: m, orcado: Math.round(orcado), realizado: realizado === null ? null : Math.round(realizado), heCusto: Math.round(heCusto) });
      }
      orcamento[area.id] = {
        hcPlano, folhaMensalAtual: Math.round(folhaAtual * FATOR_ENCARGOS), meses,
        treinamento: { orcado: Math.round(area.hc * 2600), realizado: Math.round(area.hc * 2600 * (0.55 + rnd() * 0.45) * (HOJE.getMonth() + 1) / 12 * 1.1) },
        dissidio: { orcado: DISSIDIO_ORCADO, real: DISSIDIO_REAL }
      };
    }

    const series = calcularSeries(AREAS, colaboradores, desligados);

    // ---------- Competências críticas (WFP) ----------
    const competencias = [];
    for (const area of AREAS) {
      for (const s of SKILLS[area.id]) {
        const oferta = colaboradores.filter((c) => c.area === area.id && c.skill === s).length;
        const demanda = Math.round(oferta * (1 + area.crescimento * 3 + between(-0.05, 0.4)) + (s === 'IA Generativa' ? 25 : 0));
        competencias.push({ area: area.id, skill: s, oferta, demanda });
      }
    }

    return { geradoEm: HOJE.toISOString(), sintetico: true, areas: AREAS, niveis: NIVEIS, meses: MESES, colaboradores, desligados, vagas, orcamento, series, competencias };
  }

  // ---------- Importação CSV (dados reais) ----------
  function parseCSV(texto) {
    const linhas = texto.replace(/\r/g, '').split('\n').filter((l) => l.trim());
    const sep = (linhas[0].match(/;/g) || []).length > (linhas[0].match(/,/g) || []).length ? ';' : ',';
    const cab = linhas[0].split(sep).map((h) => h.trim());
    return linhas.slice(1).map((l) => {
      const v = l.split(sep); const o = {};
      cab.forEach((h, i) => { o[h] = (v[i] || '').trim(); });
      return o;
    });
  }
  const num = (x, d) => { const n = parseFloat(String(x).replace(',', '.')); return isNaN(n) ? d : n; };
  const bool = (x) => /^(1|s|sim|true|y|yes)$/i.test(String(x).trim());

  /** Substitui colaboradores/desligados da base por um CSV no layout de data/modelo_colaboradores.csv */
  function importarColaboradores(base, texto) {
    const rows = parseCSV(texto);
    const ativos = [], deslig = [];
    rows.forEach((r, i) => {
      const c = {
        matricula: r.matricula || 'IMP' + i, nome: r.nome || r.matricula, genero: r.genero || 'N/I', raca: r.raca || 'N/I',
        pcd: bool(r.pcd), idade: num(r.idade, 35), area: r.area, cargo: r.cargo || '', nivel: r.nivel || 'Analista Pl',
        lider: bool(r.lider), tempoCasaMeses: num(r.tempo_casa_meses, 24), salario: num(r.salario, 0), compaRatio: num(r.compa_ratio, 1),
        mesesSemAumento: num(r.meses_sem_aumento, 12), mesesSemPromocao: num(r.meses_sem_promocao, 24), desempenho: num(r.desempenho, 3),
        potencial: num(r.potencial, 2), enps: num(r.enps, 7), heMes: num(r.he_mes, 0), absenteismo: num(r.absenteismo_dias, 0),
        feriasVencidas: num(r.ferias_vencidas, 0), trocaGestor12m: bool(r.troca_gestor_12m),
        treinamentosPendentes: (r.treinamentos_pendentes || '').split('|').filter(Boolean), modelo: r.modelo || 'Híbrido',
        posicaoChave: bool(r.posicao_chave), sucessorPronto: r.sucessor_pronto === '' ? null : bool(r.sucessor_pronto),
        skill: r.skill || null, status: (r.status || 'ativo').toLowerCase()
      };
      if (c.status === 'desligado') {
        c.tipoDesligamento = r.tipo_desligamento || 'Voluntário';
        c.mesDesligamento = num(r.mes_desligamento_idx, 11);
        c.regretted = c.tipoDesligamento === 'Voluntário' && c.desempenho >= 4;
        deslig.push(c);
      } else ativos.push(c);
    });
    const areasCsv = [...new Set(rows.map((r) => r.area))];
    const faltantes = areasCsv.filter((a) => !base.areas.find((x) => x.id === a));
    faltantes.forEach((a) => base.areas.push({ id: a, nome: a, diretor: 'Diretoria ' + a, hc: 0, aquecimento: 0.5, crescimento: 0.03, automacao: 0.03, salarioBase: 10000 }));
    base.colaboradores = ativos; base.desligados = deslig; base.sintetico = false;
    base.areas.forEach((a) => { a.hc = ativos.filter((c) => c.area === a.id).length; });
    base.series = calcularSeries(base.areas, ativos, deslig);
    return { ativos: ativos.length, desligados: deslig.length, areasNovas: faltantes };
  }

  function importarVagas(base, texto) {
    base.vagas = parseCSV(texto).map((r, i) => ({
      id: r.id || 'REQ-IMP' + i, area: r.area, cargo: r.cargo, nivel: r.nivel, motivo: r.motivo || 'Reposição',
      abertura: r.abertura, diasAberta: num(r.dias_aberta, 0), sla: num(r.sla, 45), etapa: r.etapa || 'Aberta',
      candidatos: num(r.candidatos, 0), recrutador: r.recrutador || '', orcada: bool(r.orcada), salarioPrevisto: num(r.salario_previsto, 0),
      prioridade: r.prioridade || 'Média', diversidade: bool(r.diversidade)
    }));
    return base.vagas.length;
  }

  global.BPData = { gerarBase, importarColaboradores, importarVagas, parseCSV, HOJE, ETAPAS, sigmoid };
})(typeof window !== 'undefined' ? window : globalThis);
