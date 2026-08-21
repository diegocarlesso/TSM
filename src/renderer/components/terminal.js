'use strict';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';

import { el, toast, notifyError, contextMenu, promptDialog, confirmDialog } from './ui.js';
import { state, setting, emit, paneById, activePane } from './state.js';

let paneSeq = 0;

function themeData(themeId) {
  const t = state.themes.find((x) => x.id === themeId) || state.themes[0];
  return t ? t.data : { background: '#12161c', foreground: '#d6deeb' };
}

function terminalOptions(session) {
  const themeId = (session && session.theme_id) || setting('terminal.theme', 'tsm-dark');
  return {
    fontFamily: setting('terminal.fontFamily', 'Consolas, monospace'),
    fontSize: Number(setting('terminal.fontSize', 14)),
    lineHeight: Number(setting('terminal.lineHeight', 1.2)),
    letterSpacing: Number(setting('terminal.letterSpacing', 0)),
    cursorStyle: setting('terminal.cursorStyle', 'block'),
    cursorBlink: !!setting('terminal.cursorBlink', true),
    scrollback: Number(setting('terminal.scrollback', 100000)),
    wordSeparator: setting('terminal.wordSeparators', ' ()[]{}\'",;:'),
    allowProposedApi: true,
    macOptionIsMeta: true,
    theme: themeData(themeId)
  };
}

/**
 * Cria um painel (aba) e conecta.
 * `spec`: { session } para sessao salva, ou { type, config, name } para ad-hoc.
 */
export async function openPane(spec) {
  const id = `pane-${++paneSeq}`;
  const session = spec.session || null;
  const type = spec.type || (session && session.type) || 'ssh';
  const name = spec.name || (session && session.name) || spec.config?.host || 'Sessao';

  const host = el('div', { class: 'term-host' });
  const findBar = buildFindBar();
  const root = el('div', { class: 'pane', dataset: { paneId: id } }, [findBar.node, host]);
  document.getElementById('panes').append(root);

  const term = new Terminal(terminalOptions(session));
  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(new WebLinksAddon((event, uri) => window.tsm.app.openExternal(uri)));
  const unicode = new Unicode11Addon();
  term.loadAddon(unicode);
  term.unicode.activeVersion = '11';

  term.open(host);
  findBar.bind(search, term);

  const pane = {
    id, root, host, term, fit, search, findBar,
    session, type, name,
    connectionId: null,
    status: 'conectando',
    spec,
    log: null,
    disposers: []
  };
  state.panes.push(pane);
  state.activePaneId = id;

  wireTerminal(pane);
  emit('panes');

  requestAnimationFrame(() => {
    fit.fit();
    term.focus();
  });

  await connectPane(pane);
  return pane;
}

function buildFindBar() {
  const input = el('input', { type: 'search', placeholder: 'Localizar…' });
  const node = el('div', { class: 'find-bar hidden' }, [
    input,
    el('button', { text: '↑', title: 'Anterior' }),
    el('button', { text: '↓', title: 'Proximo' }),
    el('button', { text: '✕', title: 'Fechar' })
  ]);
  const [prev, next, close] = [...node.querySelectorAll('button')];

  return {
    node, input,
    bind(search, term) {
      const opts = { caseSensitive: false, regex: false, wholeWord: false, decorations: {
        matchBackground: '#5f4b1f', activeMatchBackground: '#c08a1f'
      } };
      const doFind = (back) => {
        if (!input.value) return;
        if (back) search.findPrevious(input.value, opts);
        else search.findNext(input.value, opts);
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); doFind(e.shiftKey); }
        if (e.key === 'Escape') { e.preventDefault(); this.hide(term); }
      });
      input.addEventListener('input', () => doFind(false));
      prev.addEventListener('click', () => doFind(true));
      next.addEventListener('click', () => doFind(false));
      close.addEventListener('click', () => this.hide(term));
    },
    show() {
      node.classList.remove('hidden');
      input.focus();
      input.select();
    },
    hide(term) {
      node.classList.add('hidden');
      if (term) term.focus();
    },
    toggle(term) {
      if (node.classList.contains('hidden')) this.show();
      else this.hide(term);
    }
  };
}

function wireTerminal(pane) {
  const { term } = pane;

  term.onData((data) => {
    if (state.multiExec) return;                 // MultiExec cuida do envio
    if (pane.connectionId) window.tsm.conn.write(pane.connectionId, data);
  });

  term.onResize(({ cols, rows }) => {
    if (pane.connectionId) window.tsm.conn.resize(pane.connectionId, cols, rows);
  });

  term.onTitleChange((title) => {
    if (!pane.session && title) {
      pane.name = title;
      emit('panes');
    }
  });

  term.onSelectionChange(() => {
    if (setting('terminal.copyOnSelect', true)) {
      const sel = term.getSelection();
      if (sel) window.tsm.app.copy(sel);
    }
  });

  // Botao direito: colar (padrao) ou menu, conforme preferencia.
  term.element.addEventListener('contextmenu', async (e) => {
    const mode = setting('terminal.rightClick', 'paste');
    if (mode === 'paste') {
      e.preventDefault();
      const text = await window.tsm.app.paste();
      if (text && pane.connectionId) window.tsm.conn.write(pane.connectionId, text);
      return;
    }
    contextMenu(e, [
      { label: 'Copiar', key: 'Ctrl+Shift+C', onClick: () => copySelection(pane) },
      { label: 'Colar', key: 'Ctrl+Shift+V', onClick: () => pasteInto(pane) },
      { label: 'Selecionar tudo', onClick: () => term.selectAll() },
      { separator: true },
      { label: 'Localizar…', key: 'Ctrl+F', onClick: () => pane.findBar.toggle(term) },
      { label: 'Limpar', key: 'Ctrl+K', onClick: () => term.clear() },
      { separator: true },
      { label: 'Reconectar', onClick: () => reconnectPane(pane) },
      { label: 'Fechar aba', danger: true, onClick: () => closePane(pane.id) }
    ]);
  });

  const ro = new ResizeObserver(() => {
    if (pane.root.classList.contains('active')) {
      try { pane.fit.fit(); } catch { /* terminal ainda nao pintado */ }
    }
  });
  ro.observe(pane.host);
  pane.disposers.push(() => ro.disconnect());
}

async function connectPane(pane) {
  setBanner(pane, null);
  pane.status = 'conectando';
  emit('panes');

  const dims = pane.fit.proposeDimensions() || { cols: 120, rows: 30 };

  try {
    const meta = await window.tsm.conn.open({
      sessionId: pane.session ? pane.session.id : null,
      type: pane.type,
      config: pane.spec.config || null,
      secrets: pane.spec.secrets || null,
      cols: dims.cols,
      rows: dims.rows
    });
    pane.connectionId = meta.id;
    pane.target = meta.target;
    emit('panes');
  } catch (err) {
    pane.status = 'erro';
    pane.term.write(`\r\n\x1b[31m${err.message}\x1b[0m\r\n`);
    setBanner(pane, err.message, true);
    emit('panes');
  }
}

export function setBanner(pane, message, isError = false) {
  const existing = pane.root.querySelector('.pane-banner');
  if (existing) existing.remove();
  if (!message) return;
  const banner = el('div', { class: `pane-banner${isError ? ' err' : ''}` }, [
    el('span', { text: message }),
    el('button', { text: 'Reconectar', onClick: () => reconnectPane(pane) }),
    el('button', { text: 'Fechar', onClick: () => closePane(pane.id) })
  ]);
  pane.root.prepend(banner);
}

export async function reconnectPane(pane) {
  if (pane.connectionId) {
    await window.tsm.conn.close(pane.connectionId).catch(() => {});
    pane.connectionId = null;
  }
  pane.term.reset();
  await connectPane(pane);
  pane.term.focus();
}

export async function closePane(paneId) {
  const pane = paneById(paneId);
  if (!pane) return;

  if (pane.status === 'conectado' && setting('connection.confirmClose', true)) {
    const ok = await confirmDialog({
      title: 'Fechar sessao',
      message: `Encerrar "${pane.name}"?`,
      detail: 'A conexao sera desfeita.',
      confirmLabel: 'Fechar',
      danger: true
    });
    if (!ok) return;
  }

  if (pane.connectionId) await window.tsm.conn.close(pane.connectionId).catch(() => {});
  for (const d of pane.disposers) d();
  pane.term.dispose();
  pane.root.remove();

  state.panes = state.panes.filter((p) => p.id !== paneId);
  if (state.sftp.paneId === paneId) state.sftp.paneId = null;
  if (state.activePaneId === paneId) {
    state.activePaneId = state.panes.length ? state.panes[state.panes.length - 1].id : null;
  }
  emit('panes');
}

export function focusPane(paneId) {
  state.activePaneId = paneId;
  emit('panes');
  const pane = paneById(paneId);
  if (pane) {
    requestAnimationFrame(() => {
      try { pane.fit.fit(); } catch { /* noop */ }
      pane.term.focus();
    });
  }
}

export function copySelection(pane) {
  const sel = pane.term.getSelection();
  if (sel) {
    window.tsm.app.copy(sel);
    toast('Copiado', 'ok', 1200);
  }
}

export async function pasteInto(pane) {
  const text = await window.tsm.app.paste();
  if (!text || !pane.connectionId) return;
  // Colagem multilinha e um classico de acidente em producao.
  if (text.includes('\n') && text.trim().split('\n').length > 3) {
    const ok = await confirmDialog({
      title: 'Colar varias linhas',
      message: `Colar ${text.trim().split('\n').length} linhas nesta sessao?`,
      detail: 'Cada quebra de linha sera executada como um comando.',
      confirmLabel: 'Colar'
    });
    if (!ok) return;
  }
  window.tsm.conn.write(pane.connectionId, text);
}

/** Reaplica tema/fonte em todos os terminais abertos. */
export function refreshAppearance() {
  for (const pane of state.panes) {
    const opts = terminalOptions(pane.session);
    for (const [k, v] of Object.entries(opts)) {
      try { pane.term.options[k] = v; } catch { /* opcao nao aplicavel */ }
    }
    try { pane.fit.fit(); } catch { /* noop */ }
  }
}

export function adjustFontSize(delta) {
  const cur = Number(setting('terminal.fontSize', 14));
  const next = delta === 0 ? 14 : Math.max(6, Math.min(40, cur + delta));
  state.settings['terminal.fontSize'] = next;
  window.tsm.settings.set('terminal.fontSize', next);
  refreshAppearance();
}

// ------------------------------------------------------------ MultiExec ---
/** Envia o mesmo texto para todas as abas conectadas — o "MultiExec". */
export function broadcast(data) {
  let n = 0;
  for (const pane of state.panes) {
    if (pane.connectionId) {
      window.tsm.conn.write(pane.connectionId, data);
      n++;
    }
  }
  return n;
}

// ------------------------------------------- eventos vindos do main -------
export function bindConnectionEvents() {
  window.tsm.conn.onData(({ id, data }) => {
    const pane = state.panes.find((p) => p.connectionId === id);
    if (pane) pane.term.write(data);
  });

  window.tsm.conn.onReady(({ id }) => {
    const pane = state.panes.find((p) => p.connectionId === id);
    if (!pane) return;
    pane.status = 'conectado';
    setBanner(pane, null);
    try { pane.fit.fit(); } catch { /* noop */ }
    emit('panes');
  });

  window.tsm.conn.onStatus(({ id, status }) => {
    const pane = state.panes.find((p) => p.connectionId === id);
    if (pane) {
      pane.statusText = status;
      emit('panes');
    }
  });

  window.tsm.conn.onClose(({ id, code }) => {
    const pane = state.panes.find((p) => p.connectionId === id);
    if (!pane) return;
    pane.status = 'desconectado';
    pane.connectionId = null;
    pane.term.write(`\r\n\x1b[90m[TSM] sessao encerrada (codigo ${code}).\x1b[0m\r\n`);
    setBanner(pane, 'Sessao encerrada.');
    emit('panes');

    if (setting('connection.reconnectOnDrop', false) && code !== 0) {
      setTimeout(() => reconnectPane(pane), 2000);
    }
  });

  window.tsm.conn.onError(({ id, message }) => {
    const pane = state.panes.find((p) => p.connectionId === id);
    if (!pane) return notifyError(new Error(message));
    pane.status = 'erro';
    pane.term.write(`\r\n\x1b[31m[TSM] ${message}\x1b[0m\r\n`);
    setBanner(pane, message, true);
    emit('panes');
  });

  // Senha/OTP pedidos pelo servidor durante a autenticacao.
  window.tsm.conn.onPrompt(async ({ id, prompt }) => {
    const pane = state.panes.find((p) => p.connectionId === id);
    const value = await promptDialog({
      title: pane ? `Autenticacao — ${pane.name}` : 'Autenticacao',
      label: prompt.message || 'Senha',
      password: !prompt.echo
    });
    window.tsm.conn.answerPrompt(id, prompt.id, value ?? '');
  });

  // Verificacao de chave de host.
  window.tsm.conn.onHostKey(async (payload) => {
    const { id, host, port, fingerprint, changed, previous } = payload;
    const accepted = await confirmDialog({
      title: changed ? '⚠ A CHAVE DO HOST MUDOU' : 'Host desconhecido',
      message: changed
        ? `A chave de ${host}:${port} nao e a mesma de antes.`
        : `Primeira conexao com ${host}:${port}.`,
      detail: changed
        ? `Anterior: ${previous}\nAtual:     ${fingerprint}\n\n` +
          'Isso pode ser reinstalacao do servidor — ou um ataque man-in-the-middle. ' +
          'So aceite se voce sabe por que a chave mudou.'
        : `Impressao digital: ${fingerprint}\n\nConfirme por um canal confiavel antes de aceitar.`,
      confirmLabel: changed ? 'Aceitar mesmo assim' : 'Aceitar e salvar',
      danger: !!changed
    });
    window.tsm.conn.answerHostKey(id, accepted);
  });
}

export { terminalOptions };
