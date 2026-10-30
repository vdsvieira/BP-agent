/* Portal — Início: "o que eu preciso fazer agora", por perfil.
 * Princípio: uma lista curta de próximos passos, cada um com uma única ação (toque → tela certa). */
(function () {
  'use strict';
  const { esc, api, vazio } = P;
  const nada = () => Promise.resolve(null);
  const seguro = (p) => p.catch(() => null);

  /** Linha de ação no estilo "lista agrupada": ícone, título, subtítulo e seta. */
  const linha = (a) => `<button class="acao-linha ${a.urgente ? 'urgente' : ''}" data-r="${a.rota}">
      <span class="acao-ico" aria-hidden="true">${a.icone}</span>
      <span class="acao-txt"><b>${esc(a.titulo)}</b>${a.sub ? `<span>${esc(a.sub)}</span>` : ''}</span>
      ${a.badge ? `<span class="acao-badge">${a.badge}</span>` : ''}<span class="acao-seta" aria-hidden="true">›</span></button>`;
  const grupo = (titulo, acoes) => (acoes.length ? `<section class="grupo"><h2 class="grupo-titulo">${titulo}</h2><div class="grupo-lista">${acoes.map(linha).join('')}</div></section>` : '');

  async function dadosPorPerfil(u) {
    const p = u.perfil, staff = p === 'rh' || p === 'bp';
    const [vagas, adm, onb, perf, metas, cands, time, ciclos, mural, entrevistas] = await Promise.all([
      staff || p === 'gestor' ? seguro(api('ats/vagas')) : nada(),
      p !== 'colaborador' ? seguro(api('admissao')) : nada(),
      p !== 'candidato' ? seguro(api('onboarding')) : nada(),
      p !== 'candidato' && u.matricula ? seguro(api('performance/minhas')) : nada(),
      p !== 'candidato' ? seguro(api('metas')) : nada(),
      p === 'candidato' || p === 'colaborador' ? seguro(api('ats/minhas-candidaturas')) : nada(),
      p === 'gestor' ? seguro(api('performance/meu-time')) : nada(),
      staff ? seguro(api('performance/ciclos')) : nada(),
      p === 'candidato' ? seguro(api('ats/vagas?escopo=mural')) : nada(),
      staff || p === 'gestor' ? seguro(api('ats/minhas-entrevistas')) : nada()
    ]);
    return { vagas, adm, onb, perf, metas, cands, time, ciclos, mural, entrevistas };
  }

  function acoesDe(u, d) {
    const fazer = [], acompanhar = [];
    const p = u.perfil, staff = p === 'rh' || p === 'bp';
    // candidatura e admissão
    (d.cands || []).forEach((c) => {
      if (c.oferta && c.oferta.status === 'enviada') fazer.push({ icone: '🎉', titulo: 'Você recebeu uma proposta', sub: c.titulo + ' — responda quando estiver pronto(a)', rota: 'candidaturas', urgente: true });
      else if (c.etapa_publica !== 'Encerrada' && c.etapa !== 'Contratado') acompanhar.push({ icone: '📨', titulo: c.titulo, sub: 'Etapa atual: ' + c.etapa_publica, rota: 'candidaturas' });
    });
    (d.adm || []).forEach((a) => {
      if (p === 'candidato' && a.status !== 'efetivado') fazer.push({ icone: '📄', titulo: 'Envie seus documentos de admissão', sub: `${a.pendencias} item(ns) pendente(s) · início em ${P.data(a.data_inicio)}`, rota: 'admissao/' + a.id, urgente: true });
      if (staff && a.status === 'pronto') fazer.push({ icone: '✅', titulo: `Efetivar admissão de ${a.nome}`, sub: 'Tudo validado — gere a matrícula', rota: 'admissao/' + a.id, urgente: true });
      if (staff && ['documentos', 'exame_contrato_acessos'].includes(a.status)) acompanhar.push({ icone: '📄', titulo: `Admissão de ${a.nome}`, sub: `${a.pendencias} pendência(s)`, rota: 'admissao/' + a.id });
      if (p === 'gestor' && a.status !== 'efetivado') acompanhar.push({ icone: '🧳', titulo: `${a.nome} está chegando`, sub: 'Início em ' + P.data(a.data_inicio), rota: 'admissao/' + a.id });
    });
    if (p === 'candidato') {
      if (!(d.cands || []).length) fazer.push({ icone: '🔎', titulo: 'Encontre sua vaga', sub: `${(d.mural || []).length} vagas abertas agora`, rota: 'mural' });
      fazer.push({ icone: '🪪', titulo: 'Seu perfil profissional', sub: 'Envie o currículo: a IA preenche para você', rota: 'perfil' });
    }
    // vagas
    if (d.vagas) {
      const aprov = d.vagas.filter((v) => v.status === 'aprovacao');
      if (staff && aprov.length) fazer.push({ icone: '📝', titulo: 'Aprovar requisições de vaga', sub: aprov.slice(0, 2).map((v) => v.titulo).join(', '), rota: 'vagas', badge: aprov.length, urgente: true });
      (d.entrevistas || []).slice(0, 3).forEach((e) => fazer.push({ icone: '🗣️', titulo: `Entrevistar ${e.candidato}`, sub: `${e.vaga} · ${e.tipo} · ${P.data(e.data)} — roteiro e scorecard prontos`, rota: 'candidatura/' + e.candidatura_id, urgente: true }));
      const novos = d.vagas.filter((v) => v.status === 'aberta' && ((v.pipeline || {}).Inscrito || 0) > 0);
      if (novos.length) acompanhar.push({ icone: '👥', titulo: 'Candidatos aguardando triagem', sub: `${novos.length} vaga(s) com inscritos novos — a IA pode triar`, rota: 'vagas', badge: novos.reduce((s, v) => s + v.pipeline.Inscrito, 0) });
      const sla = d.vagas.filter((v) => v.status === 'aberta' && v.dias_aberta > v.sla);
      if (sla.length && (staff || p === 'gestor')) acompanhar.push({ icone: '⏱️', titulo: 'Vagas fora do prazo', sub: 'Abertas há mais tempo que o SLA', rota: 'vagas', badge: sla.length });
    }
    // onboarding
    (d.onb || []).forEach((o) => {
      if (o.matricula === u.matricula) fazer.push({ icone: '👋', titulo: 'Seu onboarding', sub: `${P.pct(o.progresso)} concluído · ${Math.max(0, o.dias_de_casa)} dias de casa`, rota: 'onb/' + o.id, urgente: o.atrasadas > 0 });
      else if (o.risco === 'alto') fazer.push({ icone: '⚠️', titulo: `${o.pessoa.nome} pode estar desmotivado(a)`, sub: 'Check-in de onboarding sinalizou risco alto — converse', rota: 'onb/' + o.id, urgente: true });
      else if (o.atrasadas && (staff || p === 'gestor')) acompanhar.push({ icone: '🧭', titulo: `Onboarding de ${o.pessoa.nome}`, sub: `${o.atrasadas} tarefa(s) atrasada(s)`, rota: 'onb/' + o.id });
    });
    // performance
    if (d.perf) {
      const pend = d.perf.a_fazer.filter((a) => a.status !== 'enviada');
      const auto = pend.find((a) => a.tipo === 'auto'), time = pend.filter((a) => a.tipo === 'gestor');
      if (d.perf.ciclo_atual && d.perf.ciclo_atual.status === 'avaliacoes') {
        if (auto) fazer.push({ icone: '🪞', titulo: 'Faça sua autoavaliação', sub: d.perf.ciclo_atual.nome, rota: 'avaliacao/' + auto.id });
        if (time.length) fazer.push({ icone: '⭐', titulo: 'Avalie seu time', sub: `${time.length} avaliação(ões) pendente(s)`, rota: 'avaliacoes', badge: time.length });
      }
      const recebidos = d.perf.feedbacks.filter((f) => f.para_matricula === u.matricula);
      if (recebidos.length) acompanhar.push({ icone: '💬', titulo: 'Feedbacks recebidos', sub: recebidos[0].texto.slice(0, 70) + '…', rota: 'feedbacks', badge: recebidos.length });
    }
    if (d.ciclos) {
      const c = d.ciclos.find((x) => x.status !== 'encerrado');
      if (c && c.adesao && c.adesao.gestores) acompanhar.push({ icone: '📊', titulo: c.nome, sub: `Gestores: ${P.pct(c.adesao.gestores_ok / c.adesao.gestores)} · autoavaliações: ${P.pct(c.adesao.autos_ok / c.adesao.autos)}`, rota: 'ciclos' });
    }
    // metas
    if (d.metas && u.matricula) {
      const minhas = d.metas.objetivos.filter((o) => o.nivel === 'individual' && o.dono === u.matricula);
      if (!minhas.length) fazer.push({ icone: '🎯', titulo: 'Defina suas metas', sub: 'A IA sugere OKRs alinhados à sua tribo', rota: 'metas' });
      else acompanhar.push({ icone: '🎯', titulo: 'Minhas metas', sub: `${P.pct(minhas.reduce((s, o) => s + o.progresso, 0) / minhas.length)} de progresso médio — atualize os resultados`, rota: 'metas' });
    }
    if (d.time) {
      const risco = d.time.filter((x) => x.faixa_risco === 'Alto');
      if (risco.length) fazer.push({ icone: '🤝', titulo: 'Converse com quem pode sair', sub: risco.slice(0, 2).map((x) => x.nome.split(' ')[0]).join(', ') + ' — risco alto de saída', rota: 'time', badge: risco.length });
    }
    return { fazer: fazer.slice(0, 6), acompanhar: acompanhar.slice(0, 6) };
  }

  P.tela('inicio', {
    titulo: 'Início',
    async render(el) {
      const u = P.U;
      const d = await dadosPorPerfil(u);
      const { fazer, acompanhar } = acoesDe(u, d);
      const h = new Date().getHours();
      const saudacao = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
      el.innerHTML = `<header class="hero"><p class="hero-data">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 class="hero-titulo">${saudacao}, ${esc(u.nome.split(' ')[0])}.</h1>
          <p class="hero-sub">${fazer.length ? `Você tem ${fazer.length} ${fazer.length === 1 ? 'coisa' : 'coisas'} para fazer.` : 'Tudo em dia por aqui.'}</p></header>
        ${grupo('Para fazer agora', fazer)}${grupo('Acompanhar', acompanhar)}
        ${!fazer.length && !acompanhar.length ? vazio('Nada pendente. Aproveite o dia!') : ''}
        ${u.perfil === 'rh' || u.perfil === 'bp' ? `<section class="grupo"><h2 class="grupo-titulo">Atalhos</h2><div class="grupo-lista">${linha({ icone: '📈', titulo: 'Cockpit do BP', sub: 'Indicadores, People Analytics e assistente de IA', rota: '@cockpit' })}</div></section>` : ''}`;
      el.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => (b.dataset.r === '@cockpit' ? (location.href = 'index.html') : P.ir(b.dataset.r))));
    }
  });
})();
