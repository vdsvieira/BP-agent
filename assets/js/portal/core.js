/* =========================================================================
 * Portal de Gente & Gestão — núcleo: sessão, rotas, menus por perfil e UI
 * As permissões reais são aplicadas no servidor; aqui só escolhemos o que mostrar.
 * ========================================================================= */
(function (global) {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TELAS = {};
  const P = { U: null, TELAS, esc, $ };

  // ---------------------------------------------------------------- API
  P.api = async function (caminho, corpo) {
    const r = await fetch('api/' + caminho, corpo === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
    if (r.status === 401) { location.href = 'login.html'; throw new Error('Sessão expirada'); }
    const j = await r.json().catch(() => ({ erro: 'Resposta inválida do servidor' }));
    if (!r.ok) throw new Error(j.erro || 'Erro ' + r.status);
    return j;
  };
  /** Executa uma ação com feedback visual no botão e mensagem de erro amigável. */
  P.acao = async function (botao, fn, sucesso) {
    const txt = botao && botao.innerHTML;
    if (botao) { botao.disabled = true; botao.innerHTML = '<span class="dots">Processando</span>'; }
    try { const r = await fn(); if (sucesso) P.toast(sucesso); return r; } catch (e) { P.toast('⚠️ ' + e.message, 6000); throw e; } finally { if (botao && botao.isConnected) { botao.disabled = false; botao.innerHTML = txt; } }
  };
  P.arquivoB64 = (arq) => new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok({ nome: arq.name, mime: arq.type, base64: String(r.result).split(',')[1] }); r.onerror = erro; r.readAsDataURL(arq); });

  // ---------------------------------------------------------------- UI
  P.toast = function (msg, ms) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), ms || 3000);
  };
  P.modal = function (titulo, corpo, botoes) {
    const dlg = $('#modal');
    $('#modalTitle').textContent = titulo; $('#modalBody').innerHTML = corpo; $('#modalFoot').innerHTML = '';
    (botoes || []).forEach(([txt, fn, primario]) => {
      const b = document.createElement('button'); b.className = 'btn' + (primario ? ' primary' : ''); b.innerHTML = txt;
      b.addEventListener('click', () => fn(dlg, b)); $('#modalFoot').appendChild(b);
    });
    if (!dlg.open) dlg.showModal();
    return dlg;
  };
  $('#modal').addEventListener('click', (e) => { if (e.target.hasAttribute('data-close') || e.target.id === 'modal') $('#modal').close(); });
  P.st = (tipo, txt) => `<span class="st ${tipo}">${esc(txt)}</span>`;
  P.prog = (v) => `<div class="progress" title="${Math.round(v * 100)}%"><span style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%"></span></div>`;
  P.pct = (v) => Math.round((v || 0) * 100) + '%';
  P.data = (s) => (s ? new Date(s.length <= 10 ? s + 'T12:00:00' : s).toLocaleDateString('pt-BR') : '—');
  P.brl = (v) => (v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
  P.score = (s) => (s == null ? '' : `<span class="score ${s >= 75 ? 'alto' : s >= 50 ? 'medio' : 'baixo'}" title="Aderência estimada pela IA">${s}</span>`);
  P.lista = (arr) => (arr && arr.length ? '<ul>' + arr.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>' : '<p class="muted small">—</p>');
  P.md = function (t) {
    const out = []; let lista = false;
    esc(t || '').split('\n').forEach((l) => {
      const b = l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      const h = b.match(/^(#{1,4})\s+(.*)/), li = b.match(/^\s*[-*]\s+(.*)/);
      if (li) { if (!lista) { out.push('<ul>'); lista = true; } out.push(`<li>${li[1]}</li>`); return; }
      if (lista) { out.push('</ul>'); lista = false; }
      if (h) out.push(`<h${h[1].length + 2}>${h[2]}</h${h[1].length + 2}>`); else if (b.trim()) out.push(`<p>${b}</p>`);
    });
    if (lista) out.push('</ul>');
    return `<div class="md">${out.join('')}</div>`;
  };
  P.card = (titulo, hint, corpo, extra) => `<section class="card"><div class="card-head"><div><h2>${titulo}</h2>${hint ? `<p class="hint">${hint}</p>` : ''}</div>${extra || ''}</div>${corpo}</section>`;
  // textos longos (nomes, cargos) usam tamanho menor para não estourar o cartão
  P.tile = (lbl, val, sub, status) => { const txt = typeof val === 'string' && val.length > 9 && !/^[\d.,%R$\s/+–-]+$/.test(val);
    return `<div class="tile ${status ? 'status-' + status : ''}"><div class="lbl">${lbl}</div><div class="val ${txt ? 'txt' : ''}">${val}</div>${sub ? `<div class="delta">${sub}</div>` : ''}</div>`; };
  /** Estado vazio com uma única ação clara */
  P.vazioAcao = (ico, titulo, texto, botao, id) => `<div class="vazio-acao"><div class="ico">${ico}</div><h2>${titulo}</h2><p>${texto}</p>${botao ? `<button class="btn primary" id="${id}">${botao}</button>` : ''}</div>`;
  P.vazio = (txt) => `<div class="empty">${txt}</div>`;
  /** Avaliador de caixas de seleção 1–5 */
  P.escala = (nome, valor) => `<div class="escala">${[1, 2, 3, 4, 5].map((n) => `<label title="${n}"><input type="radio" name="${esc(nome)}" value="${n}" ${valor === n ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>`;
  /** Painel padrão para resultados de "revisar com IA" de textos (viés, SBI) */
  P.painelRevisao = (r) => `<div class="ia-box"><h4>✦ Revisão da IA</h4>${r.alertas && r.alertas.length ? '<ul>' + r.alertas.map((a) => `<li><b>"${esc(a.trecho)}"</b> — ${esc(a.problema)}. <i>${esc(a.sugestao)}</i></li>`).join('') + '</ul>' : '<p>Nenhum viés de linguagem encontrado.</p>'}
    ${r.falta_evidencia ? '<p>⚠️ Faltam exemplos concretos (situação e comportamento observados).</p>' : ''}<p><b>Versão sugerida:</b></p><p>${esc(r.versao_sugerida)}</p><p class="small muted">${esc(r.dica || '')}</p></div>`;

  // ---------------------------------------------------------------- navegação
  const MENUS = {
    candidato: [['inicio', 'Início'], ['mural', 'Vagas abertas'], ['perfil', 'Meu perfil'], ['candidaturas', 'Minhas candidaturas'], ['admissoes', 'Minha admissão']],
    colaborador: [['inicio', 'Início'], ['onboarding', 'Meu onboarding'], ['metas', 'Metas (OKRs)'], ['avaliacoes', 'Minhas avaliações'], ['feedbacks', 'Feedbacks'], ['mural', 'Vagas internas'], ['candidaturas', 'Minhas candidaturas']],
    gestor: [['inicio', 'Início'], ['time', 'Meu time'], ['vagas', 'Vagas do time'], ['admissoes', 'Admissões do time'], ['onboarding', 'Onboarding do time'], ['metas', 'Metas (OKRs)'], ['avaliacoes', 'Avaliações'], ['calibracao', 'Resultados do time'], ['feedbacks', 'Feedbacks']],
    rh: [['inicio', 'Início'], ['vagas', 'Recrutamento (ATS)'], ['admissoes', 'Admissões'], ['onboarding', 'Onboarding'], ['metas', 'Metas (OKRs)'], ['ciclos', 'Ciclos de performance'], ['calibracao', 'Calibração'], ['feedbacks', 'Feedbacks'], ['@cockpit', '↗ Cockpit do BP']]
  };
  MENUS.bp = MENUS.rh;
  const PAPEL = { bp: 'HR Business Partner', rh: 'RH', gestor: 'Gestor(a)', colaborador: 'Colaborador(a)', candidato: 'Candidato(a)' };

  P.tela = (id, def) => { TELAS[id] = def; };
  P.ir = (rota) => { location.hash = '#/' + rota; };
  P.recarregar = () => render();

  async function render() {
    const [id, ...params] = (location.hash.replace(/^#\/?/, '') || 'inicio').split('/');
    const menu = MENUS[P.U.perfil] || [];
    const tela = TELAS[id] && menu.some(([m]) => m === id || TELAS[id].sub === m) ? TELAS[id] : TELAS[menu[0][0]];
    $('#nav').innerHTML = menu.map(([m, n]) => m.startsWith('@') ? `<button data-ext="index.html"><span>${n}</span></button>`
      : `<button data-r="${m}" ${(TELAS[id] ? (TELAS[id].sub || id) : 'inicio') === m ? 'aria-current="page"' : ''}><span>${n}</span></button>`).join('');
    $('#nav').querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => { P.ir(b.dataset.r); $('#sidebar').classList.remove('open'); }));
    $('#nav').querySelectorAll('[data-ext]').forEach((b) => b.addEventListener('click', () => { location.href = b.dataset.ext; }));
    const el = $('#view');
    $('#titulo').textContent = typeof tela.titulo === 'function' ? tela.titulo(P.U) : tela.titulo;
    $('#subtitulo').textContent = tela.sub_titulo || 'Ambiente simulado · ' + new Date().toLocaleDateString('pt-BR');
    el.innerHTML = '<div class="loading">Carregando…</div>';
    try { await tela.render(el, params); } catch (e) { el.innerHTML = P.vazio('⚠️ ' + esc(e.message)); }
    el.focus({ preventScroll: true });
  }

  async function iniciar() {
    try { P.U = await P.api('auth/eu'); } catch (e) { return; }
    $('#perfilPill').textContent = PAPEL[P.U.perfil] || P.U.perfil;
    $('#userNome').textContent = P.U.nome;
    $('#sairBtn').addEventListener('click', async () => { await P.api('auth/logout', {}).catch(() => 0); location.href = 'login.html'; });
    $('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
    $('#temaBtn').addEventListener('click', () => {
      const atual = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      document.documentElement.dataset.theme = atual === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('bp-tema', JSON.stringify(document.documentElement.dataset.theme)); } catch (e) { /* sem armazenamento */ }
    });
    window.addEventListener('hashchange', render);
    render();
  }
  try { const t = JSON.parse(localStorage.getItem('bp-tema')); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* sem armazenamento */ }
  global.P = P;
  document.addEventListener('DOMContentLoaded', iniciar);
})(window);
