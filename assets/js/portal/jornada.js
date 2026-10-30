/* Portal — admissão, onboarding e meu time */
(function () {
  'use strict';
  const { esc, api, acao, card, tile, st, vazio, modal } = P;
  const STATUS_ADM = { documentos: ['atencao', 'Aguardando documentos'], exame_contrato_acessos: ['atencao', 'Exame, contrato e acessos'], pronto: ['ok', 'Pronto para efetivar'], efetivado: ['ok', 'Efetivado'], cancelado: ['critico', 'Cancelado'] };
  const ITEM = { pendente: ['atencao', 'Pendente'], enviado: ['oportunidade', 'Enviado — aguardando conferência'], validado: ['ok', 'Validado'], rejeitado: ['critico', 'Rejeitado'] };
  const RESP = { candidato: 'Você / candidato(a)', rh: 'RH', ti: 'TI', gestor: 'Gestor(a)', novo: 'Nova pessoa', buddy: 'Buddy' };

  // ------------------------------------------------------------ admissões
  P.tela('admissoes', {
    titulo: (u) => (u.perfil === 'candidato' ? 'Minha admissão' : 'Admissões'),
    async render(el) {
      const ps = await api('admissao');
      if (P.U.perfil === 'candidato' && ps.length === 1) return P.ir('admissao/' + ps[0].id);
      el.innerHTML = card('Processos de admissão', 'Abertos automaticamente quando a pessoa aceita a proposta no ATS', ps.length ? `<div class="table-wrap"><table><thead><tr><th>Pessoa</th><th>Cargo</th><th>Início</th><th>Status</th><th>Progresso</th></tr></thead><tbody>
        ${ps.map((p) => `<tr class="clickable" data-p="${p.id}"><td><b>${esc(p.nome)}</b></td><td>${esc(p.cargo)}<div class="small muted">${esc(p.tribo || p.diretoria)}</div></td><td>${P.data(p.data_inicio)}</td>
          <td>${st(...(STATUS_ADM[p.status] || ['atencao', p.status]))}</td><td style="min-width:140px">${P.prog(p.progresso)}<span class="small muted">${p.pendencias} pendência(s)</span></td></tr>`).join('')}</tbody></table></div>`
        : vazio('Nenhum processo de admissão. Quando um(a) candidato(a) aceitar uma proposta, o processo aparece aqui.'));
      el.querySelectorAll('[data-p]').forEach((tr) => tr.addEventListener('click', () => P.ir('admissao/' + tr.dataset.p)));
    }
  });

  P.tela('admissao', {
    titulo: 'Admissão', sub: 'admissoes',
    async render(el, [id]) {
      const { processo: p, itens } = await api('admissao/' + id);
      const perfil = P.U.perfil, staff = ['rh', 'bp'].includes(perfil);
      const grupos = {};
      itens.forEach((i) => (grupos[i.responsavel] = grupos[i.responsavel] || []).push(i));
      const itemHtml = (i) => {
        const pa = i.parecer_ia;
        const podeEnviar = (perfil === 'candidato' && i.responsavel === 'candidato' && i.status !== 'validado') || (staff && i.tipo === 'documento');
        const podeValidar = staff || (perfil === 'gestor' && i.responsavel === 'gestor');
        return `<div class="tarefa"><div style="flex:1"><div class="t"><b>${esc(i.nome)}</b>${i.obrigatorio ? '' : ' <span class="pill">opcional</span>'}</div>
          <div>${st(...ITEM[i.status])}${i.observacao ? ` <span class="small">— ${esc(i.observacao)}</span>` : ''}</div>
          ${pa ? `<div class="ia-box"><b>✦ Conferência da IA:</b> ${esc(pa.resumo || '')}${pa.pendencias && pa.pendencias.length ? '<br>Pendências: ' + pa.pendencias.map(esc).join('; ') : ''}
            ${pa.corresponde_ao_item === false ? '<br>⚠️ O arquivo não parece ser o documento pedido.' : ''}${pa.legivel === false ? '<br>⚠️ Ilegível.' : ''}</div>` : ''}</div>
          <div class="row">${podeEnviar ? `<label class="btn sm">Enviar arquivo<input type="file" hidden data-up="${i.id}" accept=".pdf,.png,.jpg,.jpeg,.webp"></label>` : ''}
          ${i.arquivo_id && perfil !== 'gestor' ? `<a class="btn sm" href="api/arquivos/${i.arquivo_id}" target="_blank" rel="noopener">Ver</a>` : ''}
          ${podeValidar && i.status !== 'validado' ? `<button class="btn sm primary" data-ok="${i.id}">${i.tipo === 'documento' ? 'Validar' : 'Concluído'}</button>` : ''}
          ${staff && i.tipo === 'documento' && i.status === 'enviado' ? `<button class="btn sm" data-rej="${i.id}">Rejeitar</button>` : ''}</div></div>`;
      };
      el.innerHTML = `<div class="row">${perfil !== 'candidato' ? '<button class="btn sm" onclick="history.back()">← Admissões</button>' : ''}${st(...(STATUS_ADM[p.status] || ['atencao', p.status]))}<span class="spacer"></span>
          ${staff && p.status !== 'efetivado' ? `<button class="btn primary" id="efetivar" ${p.pendencias ? 'title="Há pendências obrigatórias"' : ''}>Efetivar admissão</button>` : ''}</div>
        <div class="tiles">${tile('Pessoa', esc(p.nome))}${tile('Cargo', esc(p.cargo), esc(p.nivel))}${tile('Início', P.data(p.data_inicio))}${tile('Progresso', P.pct(p.progresso), p.pendencias + ' pendência(s)', p.pendencias ? 'atencao' : 'ok')}</div>
        ${p.status === 'efetivado' ? `<div class="ia-box">✓ Admissão efetivada — matrícula <b>${esc(p.matricula_gerada)}</b>. O plano de onboarding foi criado.${perfil === 'candidato' ? ' Saia e entre de novo para acessar seu portal de colaborador(a).' : ''}</div>` : ''}
        ${perfil === 'candidato' ? '<p class="small muted">Envie cada documento em PDF ou foto nítida. A IA confere se é o documento certo e se está legível; o RH valida em seguida. Seus documentos ficam visíveis apenas para o RH.</p>' : ''}
        ${Object.entries(grupos).map(([r, is]) => card(RESP[r] || r, '', is.map(itemHtml).join(''))).join('')}`;
      el.querySelectorAll('[data-up]').forEach((inp) => inp.addEventListener('change', async () => {
        const f = inp.files[0]; if (!f) return;
        P.toast('Enviando e conferindo com IA…', 6000);
        await acao(null, async () => api(`admissao/itens/${inp.dataset.up}/enviar`, await P.arquivoB64(f)), 'Documento enviado'); P.recarregar();
      }));
      el.querySelectorAll('[data-ok]').forEach((b) => b.addEventListener('click', async () => { await acao(b, () => api(`admissao/itens/${b.dataset.ok}/status`, { status: 'validado' })); P.recarregar(); }));
      el.querySelectorAll('[data-rej]').forEach((b) => b.addEventListener('click', async () => { const m = prompt('Motivo (será mostrado ao candidato):'); if (m) { await acao(b, () => api(`admissao/itens/${b.dataset.rej}/status`, { status: 'rejeitado', observacao: m })); P.recarregar(); } }));
      const ef = el.querySelector('#efetivar');
      if (ef) ef.addEventListener('click', async () => { const r = await acao(ef, () => api(`admissao/${id}/efetivar`, {}), 'Admissão efetivada'); P.toast('Matrícula ' + r.matricula + ' criada — já aparece no cockpit', 5000); P.recarregar(); });
    }
  });

  // ------------------------------------------------------------ onboarding
  P.tela('onboarding', {
    titulo: (u) => (u.perfil === 'colaborador' ? 'Meu onboarding' : 'Onboarding'),
    async render(el) {
      const ps = await api('onboarding');
      const meu = ps.find((p) => p.matricula === P.U.matricula);
      if (P.U.perfil === 'colaborador' && meu) return P.ir('onb/' + meu.id);
      const risco = { alto: 'critico', 'médio': 'atencao', baixo: 'ok' };
      el.innerHTML = card(P.U.perfil === 'colaborador' ? 'Onboardings em que você é buddy' : 'Planos de onboarding', 'Plano 30-60-90 com tarefas por responsável e check-ins de experiência', ps.length ? `<div class="table-wrap"><table><thead><tr><th>Pessoa</th><th>Início</th><th class="num">Dias</th><th>Progresso</th><th class="num">Atrasadas</th><th>Risco (check-in)</th></tr></thead><tbody>
        ${ps.map((p) => `<tr class="clickable" data-p="${p.id}"><td><b>${esc(p.pessoa.nome)}</b><div class="small muted">${esc(p.pessoa.cargo)} · gestor ${esc(p.gestor_nome || '—')} · buddy ${esc(p.buddy_nome || '—')}</div></td>
          <td>${P.data(p.data_inicio)}</td><td class="num">${p.dias_de_casa}</td><td style="min-width:120px">${P.prog(p.progresso)}</td><td class="num">${p.atrasadas ? st('critico', p.atrasadas) : 0}</td>
          <td>${p.risco ? st(risco[p.risco], p.risco) : '<span class="muted small">sem check-in</span>'}</td></tr>`).join('')}</tbody></table></div>` : vazio('Nenhum onboarding.'));
      el.querySelectorAll('[data-p]').forEach((tr) => tr.addEventListener('click', () => P.ir('onb/' + tr.dataset.p)));
    }
  });

  const PERGUNTAS = { clareza: 'Está claro o que se espera de mim', acolhimento: 'Me sinto acolhido(a) pelo time', ferramentas: 'Tenho as ferramentas e acessos de que preciso', gestor: 'Meu gestor tem me dado apoio e feedback', expectativa: 'A vaga corresponde ao que foi apresentado no processo seletivo' };

  P.tela('onb', {
    titulo: 'Onboarding', sub: 'onboarding',
    async render(el, [id]) {
      const d = await api('onboarding/' + id);
      const m = P.U.matricula, staff = ['rh', 'bp'].includes(P.U.perfil);
      const eu = d.matricula === m, gestor = d.gestor_matricula === m, buddy = d.buddy_matricula === m;
      const pode = (t) => staff || gestor || (t.responsavel === 'novo' && eu) || (t.responsavel === 'buddy' && buddy);
      const fases = ['Pré-boarding', 'Semana 1', 'Até 30 dias', 'Até 60 dias', 'Até 90 dias'];
      const hoje = new Date().toISOString().slice(0, 10);
      const pl = d.plano_ia;
      const marcosFeitos = d.checkins.map((c) => c.marco);
      const proximo = [7, 30, 60, 90].find((x) => !marcosFeitos.includes(x) && d.dias_de_casa >= x - 3) || [7, 30, 60, 90].find((x) => !marcosFeitos.includes(x));
      el.innerHTML = `<div class="row">${!eu ? '<button class="btn sm" onclick="history.back()">← Onboarding</button>' : ''}<span class="spacer"></span>
          ${staff || gestor ? '<button class="btn" id="iaPlano">✦ Personalizar plano com IA</button>' : ''}${eu && proximo ? `<button class="btn primary" id="checkin">Responder check-in de ${proximo} dias</button>` : ''}</div>
        <div class="tiles">${tile(eu ? 'Bem-vindo(a)!' : 'Pessoa', esc(d.pessoa.nome), esc(d.pessoa.cargo))}${tile('Dias de casa', Math.max(0, d.dias_de_casa), 'início ' + P.data(d.data_inicio))}
          ${tile('Progresso', P.pct(d.progresso), d.atrasadas + ' atrasada(s)', d.atrasadas ? 'atencao' : 'ok')}${tile('Gestor · buddy', esc(d.gestor_nome || '—'), 'buddy: ' + esc(d.buddy_nome || '—'))}</div>
        <div class="grid g-2-1">
          ${card('Plano 30-60-90', 'Marque as tarefas sob sua responsabilidade', fases.map((f) => { const ts = d.tarefas.filter((t) => t.fase === f); return ts.length ? `<div class="fase">${f}</div>` + ts.map((t) => `<div class="tarefa ${t.status === 'feito' ? 'feito' : ''}">
            <input type="checkbox" data-t="${t.id}" ${t.status === 'feito' ? 'checked' : ''} ${pode(t) ? '' : 'disabled'} aria-label="Concluir">
            <div style="flex:1"><div class="t">${esc(t.titulo)}${t.origem === 'ia' ? ' <span class="pill">✦ IA</span>' : ''}</div>${t.descricao ? `<div class="small muted">${esc(t.descricao)}</div>` : ''}</div>
            <div class="small" style="text-align:right">${esc(RESP[t.responsavel] || t.responsavel)}<br>${t.status !== 'feito' && t.prazo < hoje ? st('critico', P.data(t.prazo)) : '<span class="muted">' + P.data(t.prazo) + '</span>'}</div></div>`).join('') : ''; }).join(''))}
          <div>${pl ? card('✦ Plano personalizado', '', `<p>${esc(pl.mensagem_de_boas_vindas)}</p><h3 style="font-size:13px">Objetivos dos 90 dias</h3>${P.lista(pl.objetivos_90_dias)}<h3 style="font-size:13px">Pessoas-chave</h3>${P.lista(pl.pessoas_chave_para_conhecer)}<h3 style="font-size:13px">Trilha de aprendizagem</h3>${P.lista(pl.trilha_de_aprendizagem)}`) : ''}
          ${eu || gestor || staff ? card('Check-ins de experiência', 'Confidencial: só você, seu gestor e o RH veem', d.checkins.map((c) => `<div class="ia-box"><b>${c.marco} dias</b> · sentimento ${c.sentimento}/5
            ${c.analise_ia && !eu ? `<br>Risco de saída precoce: ${st(c.analise_ia.risco_saida_precoce === 'alto' ? 'critico' : c.analise_ia.risco_saida_precoce === 'médio' ? 'atencao' : 'ok', c.analise_ia.risco_saida_precoce)}<br>${esc(c.analise_ia.resumo)}<br><b>Sugestões ao gestor:</b>${P.lista(c.analise_ia.sugestoes_ao_gestor)}` : ''}
            ${c.comentario ? `<p class="small">"${esc(c.comentario)}"</p>` : ''}</div>`).join('') || vazio('Nenhum check-in ainda.')) : ''}</div>
        </div>`;
      el.querySelectorAll('[data-t]').forEach((c) => c.addEventListener('change', async () => {
        try { await api(`onboarding/tarefas/${c.dataset.t}/concluir`, { feito: c.checked }); P.recarregar(); } catch (e) { c.checked = !c.checked; P.toast('⚠️ ' + e.message); }
      }));
      const ia = el.querySelector('#iaPlano');
      if (ia) ia.addEventListener('click', () => modal('Personalizar plano com IA', '<label class="field">Contexto do time e da função (projetos, sistemas, pessoas importantes)<textarea id="ctxIA" rows="5" style="width:100%"></textarea></label>',
        [['✦ Gerar', async (dlg, b) => { await acao(b, () => api(`onboarding/${id}/ia-plano`, { contexto: P.$('#ctxIA').value }), 'Plano personalizado'); dlg.close(); P.recarregar(); }, true]]));
      const ck = el.querySelector('#checkin');
      if (ck) ck.addEventListener('click', () => modal(`Check-in de ${proximo} dias`, `<p class="small muted">De 1 (discordo totalmente) a 5 (concordo totalmente). Suas respostas vão para você, seu gestor e o RH.</p>
        <div class="notas">${Object.entries(PERGUNTAS).map(([k, t]) => `<span>${t}</span>${P.escala('q_' + k)}`).join('')}<span><b>Como você está se sentindo?</b></span>${P.escala('q_sent')}</div>
        <label class="field" style="margin-top:10px">Quer contar algo mais?<textarea id="ckCom" rows="3"></textarea></label>`, [['Enviar', async (dlg, b) => {
        const respostas = {}; Object.keys(PERGUNTAS).forEach((k) => { const x = document.querySelector(`input[name="q_${k}"]:checked`); if (x) respostas[k] = +x.value; });
        const s = document.querySelector('input[name="q_sent"]:checked');
        if (!s || Object.keys(respostas).length < 5) return P.toast('Responda todas as afirmações');
        await acao(b, () => api(`onboarding/${id}/checkin`, { marco: proximo, respostas, sentimento: +s.value, comentario: P.$('#ckCom').value }), 'Obrigado! Check-in enviado'); dlg.close(); P.recarregar();
      }, true]]));
    }
  });

  // ------------------------------------------------------------ meu time (gestor)
  P.tela('time', {
    titulo: 'Meu time',
    async render(el) {
      const t = await api('performance/meu-time');
      el.innerHTML = `<div class="tiles">${tile('Pessoas', t.length)}${tile('Risco alto de saída', t.filter((p) => p.faixa_risco === 'Alto').length, 'modelo preditivo', t.some((p) => p.faixa_risco === 'Alto') ? 'critico' : 'ok')}
        ${tile('Recém-chegados (≤ 3 meses)', t.filter((p) => p.tempo_casa_meses <= 3).length)}</div>
        ${card('Pessoas', 'Use o risco como sinal para conversar — nunca como critério isolado de decisão', `<div class="table-wrap"><table><thead><tr><th>Pessoa</th><th class="num">Desempenho</th><th class="num">Potencial</th><th class="num">Tempo de casa</th><th>Risco de saída</th><th></th></tr></thead><tbody>
        ${t.map((p) => `<tr><td><b>${esc(p.nome)}</b><div class="small muted">${esc(p.cargo)} · ${p.matricula}</div></td><td class="num">${p.desempenho}</td><td class="num">${p.potencial}</td><td class="num">${p.tempo_casa_meses} m</td>
          <td>${p.faixa_risco ? st(p.faixa_risco === 'Alto' ? 'critico' : p.faixa_risco === 'Médio' ? 'atencao' : 'ok', p.faixa_risco + ' · ' + P.pct(p.risco_saida_12m)) : '—'}</td>
          <td><button class="btn sm" data-fb="${p.matricula}" data-nome="${esc(p.nome)}">Dar feedback</button></td></tr>`).join('')}</tbody></table></div>`)}`;
      el.querySelectorAll('[data-fb]').forEach((b) => b.addEventListener('click', () => P.formFeedback(b.dataset.fb, b.dataset.nome)));
    }
  });
})();
