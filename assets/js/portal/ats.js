/* Portal — ATS: requisições, pipeline, candidatura, mural de vagas, perfil e candidaturas */
(function () {
  'use strict';
  const { esc, api, acao, card, tile, st, vazio, modal, md } = P;
  const ETAPAS = ['Inscrito', 'Triagem', 'Entrevista RH', 'Entrevista Gestor', 'Proposta', 'Contratado'];
  const STATUS_VAGA = { aberta: ['ok', 'Aberta'], aprovacao: ['atencao', 'Aguardando aprovação do RH'], pausada: ['atencao', 'Pausada'], fechada: ['oportunidade', 'Fechada'], cancelada: ['critico', 'Cancelada'], rascunho: ['atencao', 'Rascunho'] };
  const NIVEIS = ['Assistente', 'Analista Jr', 'Analista Pl', 'Analista Sr', 'Especialista', 'Coordenador', 'Gerente'];
  const stVaga = (s) => P.st(...(STATUS_VAGA[s] || ['atencao', s]));

  // ------------------------------------------------------------ lista (RH/gestor)
  P.tela('vagas', {
    titulo: (u) => (u.perfil === 'gestor' ? 'Vagas do meu time' : 'Recrutamento (ATS)'),
    async render(el) {
      const vs = await api('ats/vagas');
      const f = P.filtroVagas || 'ativas';
      const lista = vs.filter((v) => f === 'todas' || (f === 'ativas' ? ['aberta', 'aprovacao', 'pausada'].includes(v.status) : v.status === f));
      const total = (v) => Object.values(v.pipeline || {}).reduce((a, b) => a + b, 0);
      el.innerHTML = `<div class="tiles">
          ${tile('Vagas abertas', vs.filter((v) => v.status === 'aberta').length)}
          ${tile('Aguardando aprovação', vs.filter((v) => v.status === 'aprovacao').length, 'requisições de gestores', vs.some((v) => v.status === 'aprovacao') ? 'atencao' : '')}
          ${tile('Fora do SLA', vs.filter((v) => v.status === 'aberta' && v.dias_aberta > v.sla).length, '', 'critico')}
          ${tile('Candidaturas ativas', vs.reduce((s, v) => s + ETAPAS.slice(0, 5).reduce((a, e) => a + ((v.pipeline || {})[e] || 0), 0), 0))}
        </div>
        ${card('Requisições', `${lista.length} vagas`, `
          <div class="chips" style="margin-bottom:10px">${[['ativas', 'Ativas'], ['aprovacao', 'Aguardando aprovação'], ['aberta', 'Abertas'], ['fechada', 'Fechadas'], ['todas', 'Todas']].map(([k, n]) => `<button class="chip" data-f="${k}" aria-pressed="${f === k}">${n}</button>`).join('')}</div>
          <div class="table-wrap"><table><thead><tr><th>Vaga</th><th>Status</th><th class="num">Dias</th><th class="num">SLA</th><th class="num">Candidatos</th><th>Pipeline</th></tr></thead><tbody>
          ${lista.slice(0, 200).map((v) => `<tr class="clickable" data-v="${v.id}"><td><b>${esc(v.titulo)}</b><div class="small muted">${v.id} · ${esc(v.nivel)} · ${esc(v.tribo_nome || v.diretoria)}</div></td><td>${stVaga(v.status)}</td>
            <td class="num">${v.dias_aberta > v.sla && v.status === 'aberta' ? st('critico', v.dias_aberta) : v.dias_aberta}</td><td class="num">${v.sla}</td><td class="num">${total(v)}</td>
            <td class="small">${ETAPAS.filter((e) => (v.pipeline || {})[e]).map((e) => `${e.replace('Entrevista ', 'Ent. ')}: ${v.pipeline[e]}`).join(' · ') || '—'}</td></tr>`).join('') || '<tr><td colspan="6">' + vazio('Nenhuma vaga') + '</td></tr>'}
          </tbody></table></div>`, '<button class="btn primary" id="novaVaga">＋ Nova requisição</button>')}`;
      el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { P.filtroVagas = b.dataset.f; P.recarregar(); }));
      el.querySelectorAll('tr[data-v]').forEach((tr) => tr.addEventListener('click', () => P.ir('vagagestao/' + tr.dataset.v)));
      el.querySelector('#novaVaga').addEventListener('click', novaVaga);
    }
  });

  function novaVaga() {
    modal('Nova requisição de vaga', `<div class="form">
      <label class="field">Título do cargo<input id="nvTitulo" placeholder="Ex.: Engenheiro(a) de Dados"></label>
      <div class="grid g2"><label class="field">Nível<select id="nvNivel">${NIVEIS.map((n) => `<option ${n === 'Analista Pl' ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="field">Motivo<select id="nvMotivo"><option>Reposição</option><option>Aumento de quadro</option></select></label></div>
      <div class="grid g2"><label class="field">Salário mínimo (R$)<input id="nvMin" type="number"></label><label class="field">Salário máximo (R$)<input id="nvMax" type="number"></label></div>
      <label class="field">Modelo de trabalho<select id="nvModelo"><option>Híbrido</option><option>Presencial</option><option>Remoto</option></select></label>
      <label class="row small"><input type="checkbox" id="nvAfirm"> Vaga afirmativa (D&I)</label>
      <label class="field">Briefing para a IA — o que a pessoa vai fazer, desafios, o que é imprescindível<textarea id="nvBrief" rows="5"></textarea></label>
      ${P.U.perfil === 'gestor' ? '<p class="small muted">A requisição vai para aprovação do RH antes de ser publicada.</p>' : ''}</div>`, [
      ['Criar e gerar descrição com IA', async (dlg, b) => {
        const v = { titulo: P.$('#nvTitulo').value, nivel: P.$('#nvNivel').value, motivo: P.$('#nvMotivo').value, salario_min: +P.$('#nvMin').value || null, salario_max: +P.$('#nvMax').value || null,
          modelo_trabalho: P.$('#nvModelo').value, afirmativa: P.$('#nvAfirm').checked, briefing: P.$('#nvBrief').value };
        const r = await acao(b, () => api('ats/vagas', v));
        dlg.close(); P.ir('vagagestao/' + r.id);
        if (v.briefing) setTimeout(() => gerarDescricao(r.id, v.briefing), 50);
      }, true]]);
  }

  async function gerarDescricao(id, briefing, botao) {
    P.toast('✦ A IA está redigindo a vaga…', 8000);
    const r = await acao(botao, () => api(`ats/vagas/${id}/ia-descricao`, { briefing }), 'Descrição gerada — revise antes de publicar');
    if (r.alertas_de_vies && r.alertas_de_vies.length) modal('Alertas de viés no briefing', P.lista(r.alertas_de_vies) + '<p class="small muted">A descrição gerada já evita esses termos.</p>', [['Entendi', (d) => d.close(), true]]);
    P.recarregar();
  }

  // ------------------------------------------------------------ vaga (gestão)
  P.tela('vagagestao', {
    titulo: 'Vaga', sub: 'vagas',
    async render(el, [id]) {
      const { vaga: v, candidaturas: cs } = await api('ats/vagas/' + id);
      if (!cs) { el.innerHTML = vazio('Você não gere esta vaga.'); return; }
      const staff = ['rh', 'bp'].includes(P.U.perfil);
      const req = v.requisitos || {};
      const acoes = [];
      if (staff && ['aprovacao', 'pausada', 'rascunho'].includes(v.status)) acoes.push(['publicar', v.status === 'aprovacao' ? '✓ Aprovar e publicar' : 'Publicar']);
      if (staff && v.status === 'aberta') acoes.push(['pausar', 'Pausar'], ['fechar', 'Fechar']);
      if (!['fechada', 'cancelada'].includes(v.status)) acoes.push(['cancelar', 'Cancelar']);
      const semTriagem = cs.filter((c) => c.score_ia == null && ['Inscrito', 'Triagem'].includes(c.etapa)).length;
      el.innerHTML = `<div class="row"><button class="btn sm" onclick="history.back()">← Voltar</button>${stVaga(v.status)}<span class="pill">${v.id}</span><span class="spacer"></span>
          ${acoes.map(([a, n]) => `<button class="btn ${a === 'publicar' ? 'primary' : ''}" data-acao="${a}">${n}</button>`).join('')}</div>
        <div class="grid g-2-1">
          ${card(esc(v.titulo), `${esc(v.nivel)} · ${esc(v.tribo_nome || v.diretoria)} · ${esc(v.modelo_trabalho || '')}${v.afirmativa ? ' · vaga afirmativa' : ''}`,
            (v.descricao ? md(v.descricao) : vazio('Sem descrição. Gere com a IA a partir do briefing.')) +
            `<div class="grid g2"><div><h3 style="font-size:13px">Requisitos obrigatórios</h3>${P.lista(req.obrigatorios)}</div><div><h3 style="font-size:13px">Desejáveis</h3>${P.lista(req.desejaveis)}</div></div>
             <p class="small"><b>Competências avaliadas:</b> ${(v.competencias || []).map(esc).join(' · ')}</p>`,
            '<button class="btn sm" id="iaDesc">✦ Gerar/refazer com IA</button>')}
          ${card('Resumo', '', `<table><tr><td class="muted">Faixa salarial</td><td class="num">${P.brl(v.salario_min)} – ${P.brl(v.salario_max)}</td></tr>
            <tr><td class="muted">SLA</td><td class="num">${v.sla} dias</td></tr><tr><td class="muted">Candidaturas</td><td class="num">${cs.length}</td></tr>
            <tr><td class="muted">Sem triagem</td><td class="num">${semTriagem}</td></tr></table>
            <p class="small muted">A triagem por IA compara requisito a requisito com o perfil anonimizado (sem nome, gênero, idade ou endereço). A decisão é sempre de uma pessoa.</p>
            <button class="btn primary" id="triarTodos" ${semTriagem ? '' : 'disabled'}>✦ Triar pendentes com IA</button>`)}
        </div>
        ${card('Pipeline', 'Clique em um(a) candidato(a) para ver o perfil, a análise da IA e as entrevistas', `<div class="pipeline">${ETAPAS.concat(['Reprovado']).map((e) => {
          const lista = cs.filter((c) => c.etapa === e || (e === 'Reprovado' && c.etapa === 'Desistiu'));
          return `<div class="col"><h3>${e}<span class="pill">${lista.length}</span></h3>${lista.map((c) => `<div class="cand-card" data-c="${c.id}"><div class="row"><span class="nome">${esc(c.nome)}</span><span class="spacer"></span>${P.score(c.score_ia)}</div>
            <div class="small muted">${esc(c.cargo_atual || '')}${c.matricula ? ' · <b>interno</b>' : ''}</div><div class="small muted">${esc(c.fonte || '')}</div></div>`).join('') || '<div class="empty small">—</div>'}</div>`;
        }).join('')}</div>`)}`;
      el.querySelectorAll('[data-acao]').forEach((b) => b.addEventListener('click', async () => {
        if (b.dataset.acao === 'cancelar' && !confirm('Cancelar esta vaga?')) return;
        await acao(b, () => api(`ats/vagas/${id}/acao`, { acao: b.dataset.acao }), 'Vaga atualizada'); P.recarregar();
      }));
      el.querySelector('#iaDesc').addEventListener('click', () => modal('Briefing para a IA', `<textarea id="brief" rows="7" style="width:100%">${esc(v.briefing || '')}</textarea>`,
        [['✦ Gerar descrição', async (d, b) => { await gerarDescricao(id, P.$('#brief').value, b); d.close(); }, true]]));
      el.querySelector('#triarTodos').addEventListener('click', async (ev) => {
        const r = await acao(ev.target, () => api(`ats/vagas/${id}/triar-todos`, {}));
        P.toast(`${r.triados} triados${r.restantes ? ` · ${r.restantes} restantes (clique de novo)` : ''}`); P.recarregar();
      });
      el.querySelectorAll('[data-c]').forEach((c) => c.addEventListener('click', () => P.ir('candidatura/' + c.dataset.c)));
    }
  });

  // ------------------------------------------------------------ candidatura (RH/gestor)
  P.tela('candidatura', {
    titulo: 'Candidatura', sub: 'vagas',
    async render(el, [id]) {
      const d = await api('ats/candidaturas/' + id);
      const { candidatura: ca, candidato: c, vaga: v, entrevistas, eventos, oferta } = d;
      const a = ca.analise_ia;
      const staff = ['rh', 'bp'].includes(P.U.perfil);
      const idx = ETAPAS.indexOf(ca.etapa);
      // "Próximo passo": uma única ação recomendada conforme a etapa (o restante fica em "Mais ações")
      const pendente = entrevistas.find((e) => e.status === 'agendada');
      const proximo = ['Reprovado', 'Desistiu', 'Contratado'].includes(ca.etapa) ? null
        : oferta && oferta.status === 'enviada' ? { txt: 'Aguardando resposta da proposta', info: true }
        : ca.score_ia == null && ['Inscrito', 'Triagem'].includes(ca.etapa) ? { id: 'triar', txt: '✦ Triar com IA', dica: 'Veja em segundos a aderência aos requisitos.' }
        : pendente ? { id: 'pscore', txt: 'Preencher scorecard da ' + pendente.tipo, dica: 'O roteiro estruturado está logo abaixo.', ent: pendente.id }
        : ['Inscrito', 'Triagem'].includes(ca.etapa) ? { id: 'pent', txt: 'Agendar entrevista', dica: 'A IA monta o roteiro por competências.' }
        : ca.etapa.startsWith('Entrevista') && !entrevistas.some((e) => e.tipo === ca.etapa) ? { id: 'pent', txt: 'Agendar ' + ca.etapa, dica: 'A IA monta o roteiro por competências.' }
        : staff ? { id: 'poferta', txt: 'Fazer proposta', dica: 'A IA redige a carta-proposta.' } : { txt: 'Aguardando o RH fazer a proposta', info: true };
      el.innerHTML = `${proximo ? `<div class="ia-box row" style="justify-content:space-between"><div><b>Próximo passo</b><br><span class="small">${esc(proximo.info ? proximo.txt : proximo.dica)}</span></div>
          ${proximo.info ? '' : `<button class="btn primary" id="proximo">${esc(proximo.txt)}</button>`}</div>` : ''}
        <div class="row"><button class="btn sm" data-voltar>← ${esc(v.titulo)}</button><span class="spacer"></span>
          <details class="mais"><summary class="btn sm">Mais ações</summary><div class="mais-menu">
          <select id="mvEtapa">${ETAPAS.slice(0, 5).concat(['Reprovado']).map((e) => `<option ${e === ca.etapa ? 'selected' : ''}>${e}</option>`).join('')}</select>
          <button class="btn" id="mover">Mover de etapa</button><button class="btn" id="entrevista">＋ Agendar entrevista</button>${staff ? '<button class="btn" id="oferta">Fazer proposta</button>' : ''}</div></details></div>
        <div class="stepper">${ETAPAS.map((e, i) => `<span class="${i < idx ? 'feito' : i === idx ? 'atual' : ''}">${e}</span>`).join('')}${['Reprovado', 'Desistiu'].includes(ca.etapa) ? `<span class="atual">${ca.etapa}</span>` : ''}</div>
        <div class="grid g2">
          ${card(esc(c.nome), `${esc(c.cargo_atual || '')} · ${c.anos_experiencia || '?'} anos · ${esc(c.cidade || '')}${c.matricula ? ' · colaborador(a) interno(a) ' + c.matricula : ''}`,
            `<p>${esc(c.resumo || 'Sem resumo.')}</p>${(c.experiencias || []).map((x) => `<p class="small"><b>${esc(x.cargo)}</b> · ${esc(x.empresa)} (${esc(x.periodo)})<br>${(x.destaques || []).map(esc).join(' · ')}</p>`).join('')}
             <p class="small"><b>Formação:</b> ${(c.formacao || []).map(esc).join('; ') || '—'}<br><b>Habilidades:</b> ${(c.habilidades || []).map(esc).join(', ') || '—'}<br><b>Certificações:</b> ${(c.certificacoes || []).map(esc).join(', ') || '—'} · <b>Idiomas:</b> ${(c.idiomas || []).map(esc).join(', ') || '—'}</p>
             ${c.curriculo_arquivo ? `<a class="btn sm" href="api/arquivos/${c.curriculo_arquivo}" target="_blank" rel="noopener">Ver currículo</a>` : ''}`)}
          ${card('Análise da IA', 'Sugestão para apoiar — não substitui a avaliação de pessoas', a ? `<div class="row"><span style="font-size:28px;font-weight:700">${a.score}</span><span class="muted">/100</span>${st(a.recomendacao === 'avançar' ? 'ok' : a.recomendacao === 'não avançar' ? 'critico' : 'atencao', a.recomendacao)}</div>
            <p>${esc(a.justificativa)}</p><table><thead><tr><th>Requisito</th><th>Atende</th><th>Evidência</th></tr></thead><tbody>${(a.aderencia || []).map((r) => `<tr><td>${esc(r.requisito)}</td><td>${st(r.atende === 'sim' ? 'ok' : r.atende === 'parcial' ? 'atencao' : 'critico', r.atende.replace('_', ' '))}</td><td class="small">${esc(r.evidencia)}</td></tr>`).join('')}</tbody></table>
            <div class="grid g2"><div><h3 style="font-size:13px">Pontos fortes</h3>${P.lista(a.pontos_fortes)}</div><div><h3 style="font-size:13px">Lacunas</h3>${P.lista(a.lacunas)}</div></div>`
            : vazio('Ainda não triado.') + '<button class="btn primary" id="triar">✦ Triar com IA</button>')}
        </div>
        ${card('Entrevistas', 'Roteiro estruturado igual para todos os candidatos da vaga + scorecard por competência', entrevistas.map((e) => `<div class="card" style="margin-bottom:10px"><div class="row"><b>${esc(e.tipo)}</b><span class="muted small">${P.data(e.data)} · ${esc(e.entrevistador_nome || '')}</span><span class="spacer"></span>${e.status === 'realizada' ? st('ok', `Realizada · ${esc(e.recomendacao)}`) : st('atencao', 'Agendada')}</div>
            ${e.roteiro ? `<details><summary class="small">Ver roteiro da IA</summary><p class="small">${esc(e.roteiro.abertura)}</p>${e.roteiro.blocos.map((b) => `<p class="small"><b>${esc(b.competencia)}</b></p>${P.lista(b.perguntas)}<p class="small muted">Sinais positivos: ${b.sinais_positivos.map(esc).join('; ')} · Alertas: ${b.sinais_de_alerta.map(esc).join('; ')}</p>`).join('')}<p class="small"><b>Técnicas:</b></p>${P.lista(e.roteiro.perguntas_tecnicas)}</details>` : ''}
            ${e.status === 'realizada' ? `<p class="small">${Object.entries(e.notas).map(([k, n]) => `${esc(k)}: <b>${n}</b>`).join(' · ')}</p><p class="small">${esc(e.comentario || '')}</p>`
              : `<button class="btn sm primary" data-av="${e.id}">Preencher scorecard</button>`}</div>`).join('') || vazio('Nenhuma entrevista.'))}
        ${oferta ? card('Proposta', `${P.brl(oferta.salario)} · início ${P.data(oferta.data_inicio)} · ${esc(oferta.status)}`, md(oferta.carta)) : ''}
        ${eventos.length ? card('Histórico', '', '<ul class="small">' + eventos.map((x) => `<li>${new Date(x.data).toLocaleString('pt-BR')} — <b>${esc(x.autor)}</b>: ${esc(x.texto)}</li>`).join('') + '</ul>') : ''}`;
      const px = el.querySelector('#proximo');
      if (px) px.addEventListener('click', () => {
        if (proximo.id === 'pscore') return scorecard(proximo.ent, v.competencias || []);
        const alvo = { triar: '#triar', pent: '#entrevista', poferta: '#oferta' }[proximo.id];
        el.querySelector(alvo).click();
      });
      el.querySelector('[data-voltar]').addEventListener('click', () => P.ir('vagagestao/' + v.id));
      el.querySelector('#mover').addEventListener('click', async (ev) => {
        const etapa = el.querySelector('#mvEtapa').value; let motivo = null;
        if (etapa === 'Reprovado') { motivo = prompt('Motivo da reprovação (será registrado):'); if (!motivo) return; }
        await acao(ev.target, () => api(`ats/candidaturas/${id}/mover`, { etapa, motivo }), 'Etapa atualizada'); P.recarregar();
      });
      const triar = el.querySelector('#triar');
      if (triar) triar.addEventListener('click', async () => { await acao(triar, () => api(`ats/candidaturas/${id}/triar`, {}), 'Triagem concluída'); P.recarregar(); });
      el.querySelector('#entrevista').addEventListener('click', () => modal('Agendar entrevista', `<div class="form"><label class="field">Tipo<select id="eTipo"><option>Entrevista RH</option><option ${P.U.perfil === 'gestor' ? 'selected' : ''}>Entrevista Gestor</option></select></label>
        <label class="field">Data<input type="date" id="eData" value="${new Date().toISOString().slice(0, 10)}"></label><label class="row small"><input type="checkbox" id="eIA" checked> Gerar roteiro estruturado com IA</label></div>`,
        [['Agendar', async (dlg, b) => { await acao(b, () => api(`ats/candidaturas/${id}/entrevista`, { tipo: P.$('#eTipo').value, data: P.$('#eData').value, roteiro_ia: P.$('#eIA').checked }), 'Entrevista agendada'); dlg.close(); P.recarregar(); }, true]]));
      el.querySelectorAll('[data-av]').forEach((b) => b.addEventListener('click', () => scorecard(b.dataset.av, v.competencias || [])));
      const of = el.querySelector('#oferta');
      if (of) of.addEventListener('click', () => modal('Fazer proposta', `<div class="form"><label class="field">Salário mensal (R$)<input type="number" id="oSal" value="${Math.round(((v.salario_min || 0) + (v.salario_max || 0)) / 2) || ''}"></label>
        <label class="field">Data de início<input type="date" id="oIni"></label><label class="field">Benefícios a destacar (opcional)<input id="oBen"></label><p class="small muted">A IA redige a carta-proposta; você pode revisá-la depois.</p></div>`,
        [['Enviar proposta', async (dlg, b) => { await acao(b, () => api(`ats/candidaturas/${id}/oferta`, { salario: +P.$('#oSal').value, data_inicio: P.$('#oIni').value, beneficios: P.$('#oBen').value }), 'Proposta enviada'); dlg.close(); P.recarregar(); }, true]]));
    }
  });

  function scorecard(eid, comps) {
    modal('Scorecard da entrevista', `<p class="small muted">Avalie com base em evidências do que a pessoa relatou (situação, ação, resultado). 1 = muito abaixo · 3 = atende · 5 = excepcional.</p>
      <div class="notas">${comps.map((c, i) => `<span>${esc(c)}</span>${P.escala('c' + i)}`).join('')}</div>
      <label class="field" style="margin-top:12px">Recomendação<select id="sRec"><option>forte sim</option><option selected>sim</option><option>não</option><option>forte não</option></select></label>
      <label class="field">Comentário com evidências<textarea id="sCom" rows="4"></textarea></label><div id="sRev"></div>`, [
      ['✦ Revisar texto com IA', async (d, b) => { const r = await acao(b, () => api('performance/ia-revisar-texto', { texto: P.$('#sCom').value, tipo: 'parecer de entrevista' })); P.$('#sRev').innerHTML = P.painelRevisao(r); }],
      ['Salvar avaliação', async (dlg, b) => {
        const notas = {}; comps.forEach((c, i) => { const x = document.querySelector(`input[name="c${i}"]:checked`); if (x) notas[c] = +x.value; });
        await acao(b, () => api(`ats/entrevistas/${eid}/avaliar`, { notas, recomendacao: P.$('#sRec').value, comentario: P.$('#sCom').value }), 'Avaliação registrada'); dlg.close(); P.recarregar();
      }, true]]);
  }

  // ------------------------------------------------------------ mural (candidatos e mobilidade interna)
  P.tela('mural', {
    titulo: (u) => (u.perfil === 'candidato' ? 'Vagas abertas' : 'Vagas internas'),
    async render(el) {
      const vs = await api('ats/vagas?escopo=mural');
      const q = (P.buscaMural || '').toLowerCase();
      const lista = vs.filter((v) => !q || (v.titulo + v.descricao + v.tribo).toLowerCase().includes(q));
      el.innerHTML = `${P.U.perfil !== 'candidato' ? '<p class="small muted">Mobilidade interna: candidate-se a vagas de outras áreas. Seu gestor é informado apenas se você avançar para entrevista.</p>' : ''}
        <div class="row"><input type="search" id="bm" placeholder="Buscar por cargo, área ou palavra-chave" value="${esc(P.buscaMural || '')}" style="flex:1"><span class="muted small">${lista.length} vagas</span></div>
        <div class="grid g3">${lista.slice(0, 60).map((v) => `<section class="card vaga-card" data-v="${v.id}"><h2>${esc(v.titulo)}</h2><p class="hint">${esc(v.nivel)} · ${esc(v.modelo_trabalho || '')}${v.afirmativa ? ' · <b>vaga afirmativa</b>' : ''}</p>
          <p class="small">${esc((v.descricao || '').split('\n')[0].slice(0, 180))}</p></section>`).join('') || vazio('Nenhuma vaga encontrada.')}</div>`;
      el.querySelector('#bm').addEventListener('change', (e) => { P.buscaMural = e.target.value; P.recarregar(); });
      el.querySelectorAll('[data-v]').forEach((c) => c.addEventListener('click', () => P.ir('vaga/' + c.dataset.v)));
    }
  });
  P.tela('vaga', {
    titulo: 'Vaga', sub: 'mural',
    async render(el, [id]) {
      const { vaga: v } = await api('ats/vagas/' + id);
      const req = v.requisitos || {};
      el.innerHTML = `<button class="btn sm" onclick="history.back()">← Vagas</button>${card(esc(v.titulo), `${esc(v.nivel)} · ${esc(v.modelo_trabalho || '')}${v.afirmativa ? ' · vaga afirmativa' : ''}`,
        md(v.descricao) + `<div class="grid g2"><div><h3 style="font-size:13px">Requisitos</h3>${P.lista(req.obrigatorios)}</div><div><h3 style="font-size:13px">Desejáveis</h3>${P.lista(req.desejaveis)}</div></div>
        <label class="field">Mensagem (opcional)<textarea id="msg" rows="3"></textarea></label><button class="btn primary" id="cand" style="margin-top:10px">Quero me candidatar</button>`)}`;
      el.querySelector('#cand').addEventListener('click', async (ev) => {
        try { await acao(ev.target, () => api(`ats/vagas/${id}/candidatar`, { mensagem: el.querySelector('#msg').value }), 'Candidatura enviada!'); P.ir('candidaturas'); }
        catch (e) { if (/perfil/.test(e.message)) P.ir('perfil'); }
      });
    }
  });

  // ------------------------------------------------------------ perfil do candidato
  P.tela('perfil', {
    titulo: 'Meu perfil profissional', sub: 'perfil',
    async render(el) {
      const c = await api('ats/meu-perfil');
      el.innerHTML = card('Currículo', 'Envie em PDF ou imagem: a IA preenche seu perfil automaticamente (sem guardar dados como CPF ou endereço).',
        `<div class="row"><input type="file" id="cv" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt"><button class="btn primary" id="enviarCv">✦ Ler currículo com IA</button></div>`) +
        card('Perfil', 'Revise e complete', `<div class="form">
          <label class="field">Cargo atual<input id="pCargo" value="${esc(c.cargo_atual || '')}"></label>
          <label class="field">Anos de experiência<input id="pAnos" type="number" value="${c.anos_experiencia || ''}"></label>
          <label class="field">Resumo profissional<textarea id="pResumo" rows="4">${esc(c.resumo || '')}</textarea></label>
          <label class="field">Habilidades (separadas por vírgula)<input id="pHab" value="${esc((c.habilidades || []).join(', '))}"></label>
          <label class="field">Formação (uma por linha)<textarea id="pForm" rows="2">${esc((c.formacao || []).join('\n'))}</textarea></label>
          <label class="field">Cidade<input id="pCid" value="${esc(c.cidade || '')}"></label><label class="field">LinkedIn<input id="pLink" value="${esc(c.linkedin || '')}"></label>
          <label class="row small"><input type="checkbox" id="pDiv" ${c.diverso ? 'checked' : ''}> Autodeclaração (opcional): pertenço a grupo sub-representado (mulheres em tecnologia, pessoas negras, PcD, LGBTQIA+). Usado apenas em indicadores agregados de diversidade — nunca na triagem.</label>
          <button class="btn primary" id="salvar">Salvar perfil</button></div>
          ${(c.experiencias || []).length ? '<h3 style="font-size:13px">Experiências lidas do currículo</h3>' + c.experiencias.map((x) => `<p class="small"><b>${esc(x.cargo)}</b> · ${esc(x.empresa)} (${esc(x.periodo)})</p>`).join('') : ''}`);
      el.querySelector('#enviarCv').addEventListener('click', async (ev) => {
        const f = el.querySelector('#cv').files[0]; if (!f) return P.toast('Escolha um arquivo');
        await acao(ev.target, async () => api('ats/meu-perfil/curriculo', await P.arquivoB64(f)), 'Perfil preenchido pela IA — revise'); P.recarregar();
      });
      el.querySelector('#salvar').addEventListener('click', async (ev) => {
        await acao(ev.target, () => api('ats/meu-perfil', { cargo_atual: P.$('#pCargo').value, anos_experiencia: +P.$('#pAnos').value || null, resumo: P.$('#pResumo').value,
          habilidades: P.$('#pHab').value.split(',').map((s) => s.trim()).filter(Boolean), formacao: P.$('#pForm').value.split('\n').map((s) => s.trim()).filter(Boolean),
          cidade: P.$('#pCid').value, linkedin: P.$('#pLink').value, diverso: P.$('#pDiv').checked }), 'Perfil salvo');
      });
    }
  });

  // ------------------------------------------------------------ minhas candidaturas
  P.tela('candidaturas', {
    titulo: 'Minhas candidaturas',
    async render(el) {
      const cs = await api('ats/minhas-candidaturas');
      el.innerHTML = cs.map((c) => {
        const idx = ETAPAS.indexOf(c.etapa);
        return card(esc(c.titulo), `Enviada em ${P.data(c.criado_em)}`, `<div class="stepper">${ETAPAS.map((e, i) => `<span class="${i < idx ? 'feito' : i === idx ? 'atual' : ''}">${e}</span>`).join('')}${c.etapa_publica === 'Encerrada' ? '<span class="atual">Processo encerrado</span>' : ''}</div>
          ${c.entrevistas.map((e) => `<p class="small">📅 ${esc(e.tipo)} em ${P.data(e.data)}</p>`).join('')}
          ${c.oferta ? `<div class="ia-box"><h4>Proposta (${esc(c.oferta.status)})</h4>${md(c.oferta.carta)}${c.oferta.status === 'enviada' ? `<div class="row"><button class="btn primary" data-aceitar="${c.oferta.id}">Aceitar proposta</button><button class="btn" data-recusar="${c.oferta.id}">Recusar</button></div>` : ''}</div>` : ''}`);
      }).join('') || vazio('Você ainda não se candidatou. <a href="#/mural">Ver vagas</a>');
      el.querySelectorAll('[data-aceitar]').forEach((b) => b.addEventListener('click', async () => { await acao(b, () => api(`ats/ofertas/${b.dataset.aceitar}/responder`, { aceitar: true }), 'Parabéns! Próximo passo: documentos de admissão'); P.ir('admissoes'); }));
      el.querySelectorAll('[data-recusar]').forEach((b) => b.addEventListener('click', async () => { if (confirm('Recusar a proposta?')) { await acao(b, () => api(`ats/ofertas/${b.dataset.recusar}/responder`, { aceitar: false })); P.recarregar(); } }));
    }
  });
})();
