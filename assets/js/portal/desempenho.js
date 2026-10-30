/* Portal — metas (OKRs), avaliações, feedback contínuo, ciclos e calibração */
(function () {
  'use strict';
  const { esc, api, acao, card, tile, st, vazio, modal } = P;
  const NIVEL_NOME = { empresa: 'Empresa', diretoria: 'Diretoria', tribo: 'Tribo', individual: 'Individual' };

  // ------------------------------------------------------------ metas
  P.tela('metas', {
    titulo: 'Metas (OKRs)',
    async render(el) {
      const { ciclo, objetivos } = await api('metas');
      const minhas = objetivos.filter((o) => o.nivel === 'individual' && o.dono === P.U.matricula);
      const filtro = P.filtroMetas || (P.U.perfil === 'colaborador' ? 'minhas' : 'tudo');
      const porPai = {};
      objetivos.forEach((o) => (porPai[o.pai_id || 0] = porPai[o.pai_id || 0] || []).push(o));
      const visiveis = new Set();
      const marcarCadeia = (o) => { while (o) { visiveis.add(o.id); o = objetivos.find((x) => x.id === o.pai_id); } };
      objetivos.forEach((o) => {
        if (filtro === 'tudo' || (filtro === 'minhas' && o.nivel === 'individual' && o.dono === P.U.matricula) || (filtro === 'time' && o.nivel === 'individual' && o.dono !== P.U.matricula)
          || (filtro === 'tribo' && o.nivel === 'tribo' && o.dono === P.U.tribo)) marcarCadeia(o);
      });
      const kr = (k, o) => `<div class="kr"><span>${esc(k.titulo)}</span><div>${P.prog(k.progresso)}<span class="small muted">${k.atual} / ${k.alvo} ${esc(k.unidade || '')}</span></div>
        ${o.pode_editar ? `<button class="btn sm" data-kr="${k.id}" data-t="${esc(k.titulo)}" data-a="${k.atual}">Atualizar</button>` : '<span></span>'}</div>`;
      const no = (o) => visiveis.has(o.id) ? `<div class="okr"><div class="row"><span class="nivel">${NIVEL_NOME[o.nivel]} · ${esc(o.dono_nome)}</span><span class="spacer"></span><b>${P.pct(o.progresso)}</b></div>
        <h3>${esc(o.titulo)}</h3>${o.krs.map((k) => kr(k, o)).join('')}</div>${(porPai[o.id] || []).some((f) => visiveis.has(f.id)) ? `<div class="okr-filhos">${porPai[o.id].map(no).join('')}</div>` : ''}` : '';
      const raizes = objetivos.filter((o) => !o.pai_id || !objetivos.some((x) => x.id === o.pai_id));
      const filtros = [['tudo', 'Empresa toda']].concat(P.U.matricula ? [['minhas', 'Minhas'], ['tribo', 'Minha tribo']] : []).concat(P.U.perfil === 'gestor' ? [['time', 'Meu time']] : []);
      el.innerHTML = `<div class="row"><div class="chips">${filtros.map(([k, n]) => `<button class="chip" data-f="${k}" aria-pressed="${filtro === k}">${n}</button>`).join('')}</div><span class="spacer"></span>
        <span class="muted small">${esc(ciclo.nome)}</span><button class="btn primary" id="novo">＋ Novo objetivo</button></div>
        ${filtro === 'minhas' && !minhas.length ? P.vazioAcao('🎯', 'Você ainda não tem metas', 'Crie seu primeiro objetivo em poucos passos — a IA sugere OKRs alinhados à sua tribo.', '✦ Criar com ajuda da IA', 'criarIA')
          : raizes.map(no).join('') || vazio('Nenhum objetivo neste filtro.')}`;
      el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { P.filtroMetas = b.dataset.f; P.recarregar(); }));
      el.querySelectorAll('[data-kr]').forEach((b) => b.addEventListener('click', () => modal('Check-in: ' + b.dataset.t, `<div class="form"><label class="field">Valor atual<input type="number" step="any" id="kVal" value="${b.dataset.a}"></label>
        <label class="field">Confiança de atingir o alvo (1 a 10)<input type="range" min="1" max="10" value="7" id="kConf"></label><label class="field">Comentário (o que mudou, bloqueios)<textarea id="kCom" rows="3"></textarea></label></div>`,
        [['Salvar', async (dlg, x) => { await acao(x, () => api(`metas/krs/${b.dataset.kr}/checkin`, { valor: +P.$('#kVal').value, confianca: +P.$('#kConf').value, comentario: P.$('#kCom').value }), 'Atualizado'); dlg.close(); P.recarregar(); }, true]])));
      el.querySelector('#novo').addEventListener('click', () => novoObjetivo(objetivos));
      const cia = el.querySelector('#criarIA'); if (cia) cia.addEventListener('click', () => novoObjetivo(objetivos));
    }
  });

  function novoObjetivo(objetivos) {
    const staff = ['rh', 'bp'].includes(P.U.perfil);
    const niveis = staff ? ['individual', 'tribo', 'diretoria', 'empresa'] : P.U.perfil === 'gestor' ? ['individual', 'tribo', 'diretoria'] : ['individual'];
    const pais = objetivos.filter((o) => o.nivel !== 'individual');
    const linhaKR = (k) => `<div class="row kr-row"><input placeholder="Resultado-chave mensurável" style="flex:2" value="${esc(k.titulo || '')}"><input type="number" step="any" placeholder="Inicial" style="width:90px" value="${k.inicial ?? ''}">
      <input type="number" step="any" placeholder="Alvo" style="width:90px" value="${k.alvo ?? ''}"><input placeholder="Unidade" style="width:90px" value="${esc(k.unidade || '')}"></div>`;
    modal('Novo objetivo', `<div class="form">
      <div class="grid g2"><label class="field">Nível<select id="oNivel">${niveis.map((n) => `<option value="${n}">${NIVEL_NOME[n]}</option>`).join('')}</select></label>
      <label class="field">Dono (matrícula, id da tribo ou diretoria)<input id="oDono" placeholder="vazio = você" value=""></label></div>
      <label class="field">Alinhado a (objetivo-pai)<select id="oPai"><option value="">—</option>${pais.map((o) => `<option value="${o.id}" ${o.nivel === 'tribo' && o.dono === P.U.tribo ? 'selected' : ''}>${NIVEL_NOME[o.nivel]} · ${esc(o.titulo.slice(0, 80))}</option>`).join('')}</select></label>
      <label class="field">Objetivo<input id="oTit" placeholder="Qualitativo e inspirador"></label>
      <div id="krs">${linhaKR({})}${linhaKR({})}</div><button class="btn sm" id="maisKr" type="button">＋ resultado-chave</button>
      <label class="field">Contexto para a IA (opcional)<input id="oCtx" placeholder="Ex.: meu foco este ano é reduzir incidentes"></label>
      <div id="oIA"></div></div>`, [
      ['✦ Sugerir com IA', async (dlg, b) => {
        const r = await acao(b, () => api('metas/ia-sugerir', { pai_id: +P.$('#oPai').value || null, nivel: P.$('#oNivel').value, contexto: P.$('#oCtx').value }));
        P.$('#oIA').innerHTML = `<div class="ia-box"><h4>✦ Sugestões (clique para usar)</h4>${r.objetivos.map((o, i) => `<p><button class="btn sm" data-usar="${i}">Usar</button> <b>${esc(o.titulo)}</b><br><span class="small">${o.krs.map((k) => esc(k.titulo)).join(' · ')}</span></p>`).join('')}<p class="small muted">${esc(r.observacoes)}</p></div>`;
        P.$('#oIA').querySelectorAll('[data-usar]').forEach((u) => u.addEventListener('click', () => { const o = r.objetivos[+u.dataset.usar]; P.$('#oTit').value = o.titulo; P.$('#krs').innerHTML = o.krs.map(linhaKR).join(''); }));
      }],
      ['✦ Revisar qualidade', async (dlg, b) => {
        const r = await acao(b, () => api('metas/ia-revisar', { titulo: P.$('#oTit').value, krs: lerKRs().map((k) => k.titulo) }));
        P.$('#oIA').innerHTML = `<div class="ia-box"><h4>✦ Nota de qualidade: ${r.nota_qualidade}/10</h4>${P.lista(r.problemas)}<p><b>Versão melhorada:</b> ${esc(r.versao_melhorada.titulo)}</p><button class="btn sm" id="aplicar">Aplicar versão melhorada</button></div>`;
        P.$('#aplicar').addEventListener('click', () => { P.$('#oTit').value = r.versao_melhorada.titulo; P.$('#krs').innerHTML = r.versao_melhorada.krs.map(linhaKR).join(''); });
      }],
      ['Criar objetivo', async (dlg, b) => {
        await acao(b, () => api('metas/objetivos', { nivel: P.$('#oNivel').value, dono: P.$('#oDono').value || null, pai_id: +P.$('#oPai').value || null, titulo: P.$('#oTit').value, krs: lerKRs() }), 'Objetivo criado');
        dlg.close(); P.recarregar();
      }, true]]);
    P.$('#maisKr').addEventListener('click', () => P.$('#krs').insertAdjacentHTML('beforeend', linhaKR({})));
    function lerKRs() {
      return [...document.querySelectorAll('.kr-row')].map((r) => { const i = r.querySelectorAll('input'); return { titulo: i[0].value, inicial: i[1].value === '' ? 0 : +i[1].value, alvo: i[2].value === '' ? null : +i[2].value, unidade: i[3].value }; }).filter((k) => k.titulo);
    }
  }

  // ------------------------------------------------------------ avaliações
  P.tela('avaliacoes', {
    titulo: (u) => (u.perfil === 'gestor' ? 'Avaliações' : 'Minhas avaliações'),
    async render(el) {
      const m = await api('performance/minhas');
      const r = m.resultado;
      const pend = m.a_fazer.filter((a) => a.status !== 'enviada');
      el.innerHTML = `${m.ciclo_atual ? `<div class="ia-box">Ciclo <b>${esc(m.ciclo_atual.nome)}</b> — fase: <b>${m.ciclo_atual.status === 'avaliacoes' ? 'avaliações abertas' : 'calibração'}</b>. ${pend.length} avaliação(ões) sua(s) pendente(s).</div>` : ''}
        ${card('Avaliações a fazer', 'Autoavaliação e avaliação do seu time', m.a_fazer.length ? `<div class="table-wrap"><table><thead><tr><th>Pessoa</th><th>Tipo</th><th>Status</th><th></th></tr></thead><tbody>
          ${m.a_fazer.map((a) => `<tr><td><b>${esc(a.avaliado_nome)}</b><div class="small muted">${esc(a.avaliado_cargo || '')}</div></td><td>${a.tipo === 'auto' ? 'Autoavaliação' : a.tipo === 'gestor' ? 'Avaliação do gestor' : 'Avaliação de par'}</td>
          <td>${a.status === 'enviada' ? st('ok', 'Enviada') : a.status === 'rascunho' ? st('atencao', 'Rascunho') : st('atencao', 'Pendente')}</td>
          <td>${a.status !== 'enviada' && m.ciclo_atual && m.ciclo_atual.status === 'avaliacoes' ? `<button class="btn sm primary" data-av="${a.id}">Avaliar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : vazio('Nenhuma avaliação neste ciclo.'))}
        ${r ? card(`Meu resultado — ${esc(r.ciclo)}`, 'Após calibração', `<div class="tiles">${tile('Desempenho', (r.nota_calibrada || r.nota_final).toFixed(1).replace('.', ',') + ' / 5')}${tile('Potencial', (r.potencial_calibrado || r.potencial || '—') + ' / 3')}</div>
          ${r.resumo_ia ? `<p>${esc(r.resumo_ia.sintese)}</p>` : ''}${r.pdi ? '<h3 style="font-size:13px">Meu PDI</h3>' + r.pdi.map((x) => `<div class="ia-box"><b>${esc(x.objetivo)}</b> · ${esc(x.prazo)}<br>70% experiência: ${x.acoes_70_experiencia.map(esc).join('; ')}<br>20% relações: ${x.acoes_20_relacoes.map(esc).join('; ')}<br>10% formal: ${x.acoes_10_formal.map(esc).join('; ')}<br><span class="small muted">Indicador: ${esc(x.indicador)}</span></div>`).join('') : ''}
          <button class="btn" id="pdi" data-c="${r.ciclo_id}">✦ ${r.pdi ? 'Refazer' : 'Gerar'} meu PDI com IA</button>`) : ''}`;
      el.querySelectorAll('[data-av]').forEach((b) => b.addEventListener('click', () => P.ir('avaliacao/' + b.dataset.av)));
      const pdi = el.querySelector('#pdi');
      if (pdi) pdi.addEventListener('click', () => modal('Gerar PDI com IA', '<label class="field">Suas aspirações de carreira (próximos 2 anos)<textarea id="asp" rows="4" style="width:100%"></textarea></label>',
        [['✦ Gerar', async (d, b) => { await acao(b, () => api(`performance/resultados/${pdi.dataset.c}/${P.U.matricula}/ia-pdi`, { aspiracoes: P.$('#asp').value }), 'PDI gerado'); d.close(); P.recarregar(); }, true]]));
    }
  });

  P.tela('avaliacao', {
    titulo: 'Avaliação', sub: 'avaliacoes',
    async render(el, [id]) {
      const d = await api('performance/avaliacoes/' + id);
      const a = d.avaliacao, gestor = a.tipo === 'gestor';
      el.innerHTML = `<button class="btn sm" onclick="history.back()">← Avaliações</button>
        <div class="grid g-2-1">
          ${card(`${a.tipo === 'auto' ? 'Autoavaliação' : 'Avaliação'} — ${esc(d.avaliado.nome)}`, `${esc(d.ciclo.nome)} · ${esc(d.avaliado.cargo || '')} · 1 = muito abaixo · 3 = atende · 5 = excepcional`,
            `<div class="notas">${d.competencias.map((c, i) => `<span>${esc(c)}</span>${P.escala('n' + i, a.notas[c])}`).join('')}</div>
            ${gestor ? `<label class="field" style="margin-top:12px">Potencial<select id="pot"><option value="">—</option>${[[1, '1 · no papel atual'], [2, '2 · crescer na carreira'], [3, '3 · alto potencial']].map(([v, n]) => `<option value="${v}" ${a.potencial === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>` : ''}
            <label class="field">Pontos fortes (com exemplos)<textarea id="pf" rows="3">${esc(a.pontos_fortes || '')}</textarea></label>
            <label class="field">O que desenvolver<textarea id="dv" rows="3">${esc(a.desenvolver || '')}</textarea></label>
            <label class="field">Comentário geral<textarea id="cm" rows="3">${esc(a.comentario || '')}</textarea></label>
            <div id="rev"></div>
            <div class="row" style="margin-top:10px"><button class="btn" id="revisar">✦ Revisar textos com IA (viés e SBI)</button><span class="spacer"></span><button class="btn" id="rasc">Salvar rascunho</button><button class="btn primary" id="enviar">Enviar</button></div>`)}
          <div>${card('Metas do período', 'Para embasar a avaliação', d.metas.length ? d.metas.map((m) => `<p class="small"><b>${esc(m.kr)}</b><br>${m.atual} / ${m.alvo} ${esc(m.unidade || '')}</p>`).join('') : vazio('Sem OKRs individuais.'))}
          ${gestor ? card('Feedbacks recebidos no ano', 'Evidências registradas ao longo do ciclo', d.feedbacks.map((f) => `<p class="small">${st(f.tipo === 'reconhecimento' ? 'ok' : 'oportunidade', f.tipo)} ${esc(f.texto)} <span class="muted">— ${esc(f.de_nome)}</span></p>`).join('') || vazio('Nenhum.')) : ''}</div>
        </div>`;
      const ler = (enviar) => {
        const notas = {}; d.competencias.forEach((c, i) => { const x = document.querySelector(`input[name="n${i}"]:checked`); if (x) notas[c] = +x.value; });
        return { notas, potencial: gestor ? (+P.$('#pot').value || null) : null, pontos_fortes: P.$('#pf').value, desenvolver: P.$('#dv').value, comentario: P.$('#cm').value, enviar };
      };
      el.querySelector('#revisar').addEventListener('click', async (ev) => {
        const r = await acao(ev.target, () => api('performance/ia-revisar-texto', { tipo: 'avaliação de desempenho', texto: `Pontos fortes: ${P.$('#pf').value}\nA desenvolver: ${P.$('#dv').value}\nComentário: ${P.$('#cm').value}` }));
        P.$('#rev').innerHTML = P.painelRevisao(r);
      });
      el.querySelector('#rasc').addEventListener('click', (ev) => acao(ev.target, () => api('performance/avaliacoes/' + id, ler(false)), 'Rascunho salvo'));
      el.querySelector('#enviar').addEventListener('click', async (ev) => { if (!confirm('Depois de enviada, a avaliação não pode ser alterada. Enviar?')) return; await acao(ev.target, () => api('performance/avaliacoes/' + id, ler(true)), 'Avaliação enviada'); P.ir('avaliacoes'); });
    }
  });

  // ------------------------------------------------------------ feedback contínuo
  P.formFeedback = function (para, nome) {
    modal('Dar feedback' + (nome ? ' para ' + nome : ''), `<div class="form">${para ? '' : '<label class="field">Para quem<input id="fbBusca" placeholder="Digite o nome" list="fbLista"><datalist id="fbLista"></datalist></label>'}
      <label class="field">Tipo<select id="fbTipo"><option value="reconhecimento">Reconhecimento</option><option value="desenvolvimento">Desenvolvimento</option></select></label>
      <label class="field">Feedback — descreva a situação, o comportamento e o impacto<textarea id="fbTxt" rows="5"></textarea></label><div id="fbRev"></div></div>`, [
      ['✦ Revisar com IA', async (d, b) => { const r = await acao(b, () => api('performance/ia-revisar-texto', { texto: P.$('#fbTxt').value, tipo: 'feedback' })); P.$('#fbRev').innerHTML = P.painelRevisao(r); }],
      ['Enviar', async (dlg, b) => {
        let alvo = para;
        if (!alvo) { const v = P.$('#fbBusca').value; const m = v.match(/\((\w+)\)$/); alvo = m && m[1]; }
        if (!alvo) return P.toast('Escolha a pessoa na lista');
        await acao(b, () => api('performance/feedbacks', { para: alvo, tipo: P.$('#fbTipo').value, texto: P.$('#fbTxt').value }), 'Feedback enviado'); dlg.close(); if (location.hash.includes('feedbacks')) P.recarregar();
      }, true]]);
    const busca = P.$('#fbBusca');
    if (busca) busca.addEventListener('input', async () => {
      if (busca.value.length < 2 || /\(\w+\)$/.test(busca.value)) return;
      const ps = await api('performance/pessoas?q=' + encodeURIComponent(busca.value));
      P.$('#fbLista').innerHTML = ps.map((p) => `<option value="${esc(p.nome)} (${p.matricula})">${esc(p.cargo)}</option>`).join('');
    });
  };
  P.tela('feedbacks', {
    titulo: 'Feedbacks',
    async render(el) {
      const m = await api('performance/minhas');
      const rec = m.feedbacks.filter((f) => f.para_matricula === P.U.matricula), env = m.feedbacks.filter((f) => f.de_matricula === P.U.matricula);
      const item = (f, de) => `<div class="tarefa"><div style="flex:1">${st(f.tipo === 'reconhecimento' ? 'ok' : 'oportunidade', f.tipo)} ${esc(f.texto)}<div class="small muted">${de ? 'de ' + esc(f.de_nome) : 'para ' + esc(f.para_matricula)} · ${P.data(f.data)}</div></div></div>`;
      el.innerHTML = `<div class="row"><span class="spacer"></span><button class="btn primary" id="dar">＋ Dar feedback</button></div><div class="grid g2">
        ${card('Recebidos', '', rec.map((f) => item(f, true)).join('') || vazio('Nenhum ainda.'))}${card('Enviados', '', env.map((f) => item(f, false)).join('') || vazio('Nenhum ainda.'))}</div>`;
      el.querySelector('#dar').addEventListener('click', () => P.formFeedback());
    }
  });

  // ------------------------------------------------------------ ciclos (RH)
  P.tela('ciclos', {
    titulo: 'Ciclos de performance',
    async render(el) {
      const cs = await api('performance/ciclos');
      const fase = { avaliacoes: ['atencao', 'Avaliações abertas'], calibracao: ['oportunidade', 'Calibração'], encerrado: ['ok', 'Encerrado'] };
      el.innerHTML = `<div class="row"><span class="spacer"></span><button class="btn primary" id="novoCiclo">＋ Abrir ciclo</button></div>` + cs.map((c) => {
        const a = c.adesao || {};
        return card(esc(c.nome), `${P.data(c.inicio)} – ${P.data(c.fim)}`, `<div class="row">${st(...fase[c.status])}<span class="spacer"></span>
          ${c.status !== 'encerrado' ? `<button class="btn primary" data-av="${c.id}">${c.status === 'avaliacoes' ? 'Consolidar notas → calibração' : 'Encerrar e publicar resultados'}</button>` : ''}
          ${c.status !== 'avaliacoes' ? `<button class="btn" data-cal="${c.id}">Ver calibração</button>` : ''}</div>
          ${a.total ? `<div class="tiles" style="margin-top:10px">${tile('Autoavaliações', `${a.autos_ok}/${a.autos}`, P.pct(a.autos_ok / a.autos))}${tile('Avaliações de gestores', `${a.gestores_ok}/${a.gestores}`, P.pct(a.gestores_ok / a.gestores), a.gestores_ok / a.gestores < 0.6 ? 'atencao' : 'ok')}</div>` : ''}
          <p class="small muted">Nota final = gestor 70% + pares 15% + autoavaliação 15%. Ao encerrar, notas e potenciais calibrados atualizam a base de pessoas e o modelo de risco do cockpit.</p>`);
      }).join('');
      el.querySelectorAll('[data-av]').forEach((b) => b.addEventListener('click', async () => { if (!confirm('Avançar a fase do ciclo?')) return; await acao(b, () => api(`performance/ciclos/${b.dataset.av}/avancar`, {}), 'Fase avançada'); P.recarregar(); }));
      el.querySelectorAll('[data-cal]').forEach((b) => b.addEventListener('click', () => P.ir('calibracao/' + b.dataset.cal)));
      el.querySelector('#novoCiclo').addEventListener('click', async (ev) => { const n = prompt('Nome do ciclo:', 'Avaliação ' + (new Date().getFullYear() + 1)); if (n) { await acao(ev.target, () => api('performance/ciclos', { nome: n }), 'Ciclo aberto'); P.recarregar(); } });
    }
  });

  // ------------------------------------------------------------ calibração
  P.tela('calibracao', {
    titulo: (u) => (u.perfil === 'gestor' ? 'Resultados do time' : 'Calibração'),
    async render(el, [cid]) {
      const cs = await api('performance/ciclos');
      const ciclo = cs.find((c) => String(c.id) === cid) || cs.find((c) => c.status === 'calibracao') || cs.find((c) => c.status === 'encerrado');
      if (!ciclo) { el.innerHTML = vazio('Nenhum ciclo consolidado.'); return; }
      const dire = P.filtroDir || '';
      const d = await api(`performance/calibracao/${ciclo.id}${dire ? '?diretoria=' + dire : ''}`);
      const staff = ['rh', 'bp'].includes(P.U.perfil), total = d.resultados.length || 1;
      const max = Math.max(...Object.values(d.distribuicao).map((n) => n / total), ...Object.values(d.referencia)) || 1;
      const lista = d.resultados.slice().sort((a, b) => (b.nota_calibrada || b.nota_final) - (a.nota_calibrada || a.nota_final)).slice(0, 300);
      el.innerHTML = `<div class="row"><select id="cic">${cs.filter((c) => c.status !== 'avaliacoes').map((c) => `<option value="${c.id}" ${c.id === ciclo.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>
        ${staff ? `<select id="dir"><option value="">Todas as diretorias</option>${['varejo-pf', 'varejo-pj', 'atacado', 'tecnologia', 'riscos', 'operacoes', 'credito', 'digital'].map((x) => `<option ${x === dire ? 'selected' : ''}>${x}</option>`).join('')}</select>` : ''}
        ${st(ciclo.status === 'calibracao' ? 'oportunidade' : 'ok', ciclo.status === 'calibracao' ? 'Em calibração' : 'Encerrado')}</div>
        <div class="grid g2">${card('Distribuição de notas', 'Barras = real · tracejado = curva de referência (orientativa, não forçada)', `<div class="distrib">${[1, 2, 3, 4, 5].map((n) => `<div><span class="small">${P.pct((d.distribuicao[n] || 0) / total)}</span>
          <div class="b" style="height:${((d.distribuicao[n] || 0) / total) / max * 100}%"></div><div class="ref" style="margin-top:-${d.referencia[n] / max * 100}%"></div><b>${n}</b></div>`).join('')}</div>`)}
          ${card('Resumo', '', `${tile('Pessoas', d.resultados.length)} <p class="small muted">Na sessão de calibração, discuta primeiro os extremos (notas 1 e 5) e peça evidências. Use a Caixa de ferramentas → Calibração de talentos para o roteiro.</p>`)}</div>
        ${card('Resultados', staff && ciclo.status === 'calibracao' ? 'Ajuste nota e potencial calibrados (salva ao sair do campo)' : '', `<div class="table-wrap" style="max-height:560px;overflow:auto"><table><thead><tr><th>Pessoa</th><th class="num">Nota ponderada</th><th class="num">Nota calibrada</th><th class="num">Potencial</th><th></th></tr></thead><tbody>
          ${lista.map((r) => `<tr><td><b>${esc(r.nome)}</b><div class="small muted">${esc(r.cargo)} · ${esc(r.tribo || r.diretoria)}</div></td><td class="num">${(r.nota_final || 0).toFixed(2)}</td>
          <td class="num">${staff && ciclo.status === 'calibracao' ? `<input type="number" min="1" max="5" step="0.5" value="${r.nota_calibrada ?? ''}" data-nota="${r.matricula}" style="width:72px">` : (r.nota_calibrada ?? '—')}</td>
          <td class="num">${staff && ciclo.status === 'calibracao' ? `<select data-pot="${r.matricula}">${[1, 2, 3].map((p) => `<option ${(r.potencial_calibrado || r.potencial) === p ? 'selected' : ''}>${p}</option>`).join('')}</select>` : (r.potencial_calibrado || r.potencial || '—')}</td>
          <td><button class="btn sm" data-pdi="${r.matricula}">✦ PDI</button></td></tr>`).join('')}</tbody></table></div>`)}`;
      el.querySelector('#cic').addEventListener('change', (e) => P.ir('calibracao/' + e.target.value));
      const dsel = el.querySelector('#dir'); if (dsel) dsel.addEventListener('change', (e) => { P.filtroDir = e.target.value; P.recarregar(); });
      const salvar = (mat) => api(`performance/calibracao/${ciclo.id}/${mat}`, { nota_calibrada: +el.querySelector(`[data-nota="${mat}"]`).value, potencial_calibrado: +el.querySelector(`[data-pot="${mat}"]`).value })
        .then(() => P.toast('Calibração salva')).catch((e) => P.toast('⚠️ ' + e.message));
      el.querySelectorAll('[data-nota]').forEach((i) => i.addEventListener('change', () => salvar(i.dataset.nota)));
      el.querySelectorAll('[data-pot]').forEach((i) => i.addEventListener('change', () => salvar(i.dataset.pot)));
      el.querySelectorAll('[data-pdi]').forEach((b) => b.addEventListener('click', async () => {
        const r = await acao(b, () => api(`performance/resultados/${ciclo.id}/${b.dataset.pdi}/ia-pdi`, {}));
        modal('Síntese e PDI sugeridos pela IA', `<p>${esc(r.sintese)}</p><div class="grid g2"><div><h3 style="font-size:13px">Forças</h3>${P.lista(r.forcas)}</div><div><h3 style="font-size:13px">Oportunidades</h3>${P.lista(r.oportunidades)}</div></div>
          ${r.pdi.map((x) => `<div class="ia-box"><b>${esc(x.objetivo)}</b> · ${esc(x.prazo)}<br>70%: ${x.acoes_70_experiencia.map(esc).join('; ')}<br>20%: ${x.acoes_20_relacoes.map(esc).join('; ')}<br>10%: ${x.acoes_10_formal.map(esc).join('; ')}</div>`).join('')}`, [['Fechar', (d) => d.close(), true]]);
      }));
    }
  });
})();
