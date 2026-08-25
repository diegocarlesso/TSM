'use strict';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';

import { el, toast, notifyError, contextMenu, promptDialog, confirmDialog } from './ui.js';
import {
  state, setting, emit, paneById, activePane, tabById, activeTab, isAppShortcut
} from './state.js';
import * as layout from './layout.js';

let paneSeq = 0;
let tabSeq = 0;

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
 * Cria um painel e conecta.
 *
 * `spec`: { session } para sessão salva, ou { type, config, name } para ad-hoc.
 * `placement`:
 *   - `{}`                              -> abre numa aba nova;
 *   - `{ splitFrom: paneId, dir, before }` -> divide o painel indicado.
 *
 * O elemento do painel NÃO é inserido no DOM aqui: quem posiciona é o
 * renderizador da árvore de layout, que reaproveita o mesmo elemento a cada
 * mudança (por isso o buffer e o scroll do terminal sobrevivem ao split).
 */
export async function openPane(spec, placement = {}) {
  const id = `pane-${++paneSeq}`;
  const session = spec.session || null;
  const type = spec.type || (session && session.type) || 'ssh';
  const name = spec.name || (session && session.name) || spec.config?.host || 'Sessão';

  const host = el('div', { class: 'term-host' });
  const findBar = buildFindBar();
  const root = el('div', { class: 'pane', dataset: { paneId: id } }, [findBar.node, host]);

  const tab = attachToLayout(id, placement);

  const term = new Terminal(terminalOptions(session));
  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(new WebLinksAddon((event, uri) => window.tsm.app.openExternal(uri)));
  const unicode = new Unicode11Addon();
  term.loadAddon(unicode);
  term.unicode.activeVersion = '11';

  findBar.bind(search, term);

  const pane = {
    id, tabId: tab.id, root, host, term, fit, search, findBar,
    session, type, name,
    connectionId: null,
    status: 'conectando',
    spec,
    opened: false,
    disposers: []
  };
  state.panes.push(pane);
  state.activeTabId = tab.id;
  tab.activePaneId = id;
  state.activePaneId = id;

  wireTerminal(pane);
  emit('panes');   // o app monta a árvore e insere `root` no DOM, sincronamente

  // `term.open()` exige o host já no documento — e `term.element` só existe
  // depois dele, então os handlers de DOM vem em seguida.
  mountTerminal(pane);
  requestAnimationFrame(() => {
    fitPane(pane);
    term.focus();
  });

  await connectPane(pane);
  return pane;
}

/** Abre o terminal no DOM (idempotente) e liga o que depende de `term.element`. */
function mountTerminal(pane) {
  if (pane.opened || !pane.host.isConnected) return false;
  pane.term.open(pane.host);
  pane.opened = true;
  wireTerminalDom(pane);
  return true;
}

/** Encaixa o novo painel na árvore: aba nova ou divisão de um painel existente. */
function attachToLayout(paneId, placement) {
  if (placement.splitFrom) {
    const source = paneById(placement.splitFrom);
    const tab = source && tabById(source.tabId);
    if (tab) {
      tab.root = layout.splitLeaf(
        tab.root, source.id, paneId,
        placement.dir === 'col' ? 'col' : 'row',
        !!placement.before
      );
      return tab;
    }
  }

  const tab = {
    id: `tab-${++tabSeq}`,
    name: null,
    root: layout.leaf(paneId),
    activePaneId: paneId
  };
  state.tabs.push(tab);
  return tab;
}

/** Divide o painel indicado abrindo outra instancia da mesma sessão. */
export function splitPane(pane, dir) {
  if (!pane) return Promise.resolve(null);
  const spec = pane.session
    ? { session: pane.session }
    : { type: pane.type, config: pane.spec.config, name: pane.name };
  return openPane(spec, { splitFrom: pane.id, dir });
}

export function fitPane(pane) {
  if (!pane || !pane.opened) return;
  const tab = tabById(pane.tabId);
  if (!tab || tab.id !== state.activeTabId) return;   // aba oculta: sem dimensões
  try {
    pane.fit.fit();
  } catch { /* terminal ainda não pintado */ }
}

/** Reajusta todos os terminais da aba visível — chamado após mudar o layout. */
export function fitActiveTab() {
  const tab = tabById(state.activeTabId);
  if (!tab) return;
  for (const paneId of layout.leafIds(tab.root)) {
    const pane = paneById(paneId);
    if (!pane) continue;
    mountTerminal(pane);
    fitPane(pane);
  }
}

function buildFindBar() {
  const input = el('input', { type: 'search', placeholder: 'Localizar…' });
  const node = el('div', { class: 'find-bar hidden' }, [
    input,
    el('button', { text: '↑', title: 'Anterior' }),
    el('button', { text: '↓', title: 'Próximo' }),
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

  // Sem isto, o xterm processa TODO keydown como entrada de terminal — inclusive
  // os atalhos do app (Ctrl+D, Ctrl+R, Ctrl+Shift+seta...), que nunca chegavam
  // no listener global nem no acelerador do menu porque o xterm já tinha dado
  // preventDefault/stopPropagation antes. Devolver `false` aqui pula o
  // processamento interno do xterm para esse evento e deixa ele seguir normal
  // (bolha até o `window`, aciona o acelerador nativo do Electron).
  term.attachCustomKeyEventHandler((e) => e.type !== 'keydown' || !isAppShortcut(e));

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

}

/** Handlers que dependem de `term.element` — só existem após `term.open()`. */
function wireTerminalDom(pane) {
  const { term } = pane;

  // Clicar num painel do split passa o foco para ele.
  term.element.addEventListener('mousedown', () => {
    if (state.activePaneId !== pane.id) focusPane(pane.id);
  }, true);

  // Botão direito: colar (padrão) ou menu, conforme preferência.
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
      { label: 'Dividir a direita', key: 'Ctrl+Shift+→', onClick: () => splitPane(pane, 'row') },
      { label: 'Dividir abaixo', key: 'Ctrl+Shift+↓', onClick: () => splitPane(pane, 'col') },
      { separator: true },
      { label: 'Localizar…', key: 'Ctrl+F', onClick: () => pane.findBar.toggle(term) },
      { label: 'Limpar', key: 'Ctrl+K', onClick: () => term.clear() },
      { separator: true },
      { label: 'Reconectar', onClick: () => reconnectPane(pane) },
      {
        label: 'Enviar break',
        hidden: pane.type !== 'serial',
        onClick: () => window.tsm.serial.sendBreak(pane.connectionId, 300)
      },
      { label: 'Fechar painel', danger: true, onClick: () => closePane(pane.id) }
    ]);
  });

  // O painel muda de tamanho por resize da janela OU por arraste de divisoria;
  // o observer cobre os dois casos sem o layout precisar avisar ninguém.
  const ro = new ResizeObserver(() => fitPane(pane));
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

export async function closePane(paneId, { skipConfirm = false } = {}) {
  const pane = paneById(paneId);
  if (!pane) return;

  if (!skipConfirm && pane.status === 'conectado' && setting('connection.confirmClose', true)) {
    const ok = await confirmDialog({
      title: 'Fechar painel',
      message: `Encerrar "${pane.name}"?`,
      detail: 'A conexão será desfeita.',
      confirmLabel: 'Fechar',
      danger: true
    });
    if (!ok) return;
  }

  const tab = tabById(pane.tabId);

  if (pane.connectionId) await window.tsm.conn.close(pane.connectionId).catch(() => {});
  for (const d of pane.disposers) d();
  pane.term.dispose();
  pane.root.remove();

  state.panes = state.panes.filter((p) => p.id !== paneId);
  if (state.sftp.paneId === paneId) state.sftp.paneId = null;

  if (tab) {
    // Escolhe o próximo foco ANTES de mexer na árvore, para pegar um vizinho
    // de verdade em vez de "o último painel aberto em qualquer aba".
    const siblings = layout.leafIds(tab.root).filter((id) => id !== paneId);
    tab.root = layout.removeLeaf(tab.root, paneId);

    if (!tab.root) {
      state.tabs = state.tabs.filter((t) => t.id !== tab.id);
      if (state.activeTabId === tab.id) {
        const next = state.tabs[state.tabs.length - 1] || null;
        state.activeTabId = next ? next.id : null;
        state.activePaneId = next ? next.activePaneId : null;
      }
    } else if (tab.activePaneId === paneId) {
      tab.activePaneId = siblings[siblings.length - 1] || null;
      if (state.activeTabId === tab.id) state.activePaneId = tab.activePaneId;
    }
  }

  emit('panes');
  requestAnimationFrame(() => {
    fitActiveTab();
    const focused = paneById(state.activePaneId);
    if (focused) focused.term.focus();
  });
}

/** Fecha a aba inteira, com uma única confirmacao para todos os painéis. */
export async function closeTab(tabId) {
  const tab = tabById(tabId);
  if (!tab) return;
  const ids = layout.leafIds(tab.root);
  const conectados = ids.map(paneById).filter((p) => p && p.status === 'conectado');

  if (conectados.length && setting('connection.confirmClose', true)) {
    const ok = await confirmDialog({
      title: 'Fechar aba',
      message: ids.length > 1
        ? `Encerrar os ${ids.length} painéis desta aba?`
        : `Encerrar "${conectados[0].name}"?`,
      detail: conectados.map((p) => `• ${p.name}`).join('\n'),
      confirmLabel: 'Fechar',
      danger: true
    });
    if (!ok) return;
  }
  for (const id of ids) await closePane(id, { skipConfirm: true });
}

export function focusPane(paneId) {
  const pane = paneById(paneId);
  if (!pane) return;
  const tab = tabById(pane.tabId);
  if (tab) {
    state.activeTabId = tab.id;
    tab.activePaneId = paneId;
  }
  state.activePaneId = paneId;
  emit('panes');
  requestAnimationFrame(() => {
    fitActiveTab();
    pane.term.focus();
  });
}

/** Foca uma aba inteira, voltando ao painel que estava em foco nela. */
export function focusTab(tabId) {
  const tab = tabById(tabId);
  if (!tab) return;
  state.activeTabId = tabId;
  const target = paneById(tab.activePaneId) || paneById(layout.leafIds(tab.root)[0]);
  if (target) {
    state.activePaneId = target.id;
    tab.activePaneId = target.id;
  }
  emit('panes');
  requestAnimationFrame(() => {
    fitActiveTab();
    if (target) target.term.focus();
  });
}

/** Move o foco para o painel vizinho ('left'|'right'|'up'|'down'). */
export function focusNeighbor(direction) {
  const tab = activeTab();
  if (!tab) return;
  const next = layout.neighbor(tab.root, state.activePaneId, direction);
  if (next) focusPane(next);
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
  // Colagem multilinha é um classico de acidente em produção.
  if (text.includes('\n') && text.trim().split('\n').length > 3) {
    const ok = await confirmDialog({
      title: 'Colar varias linhas',
      message: `Colar ${text.trim().split('\n').length} linhas nesta sessão?`,
      detail: 'Cada quebra de linha será executada como um comando.',
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
      try { pane.term.options[k] = v; } catch { /* opção não aplicável */ }
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
    pane.term.write(`\r\n\x1b[90m[TSM] sessão encerrada (código ${code}).\x1b[0m\r\n`);
    setBanner(pane, 'Sessão encerrada.');
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

  // Senha/OTP pedidos pelo servidor durante a autenticação.
  window.tsm.conn.onPrompt(async ({ id, prompt }) => {
    const pane = state.panes.find((p) => p.connectionId === id);
    const value = await promptDialog({
      title: pane ? `Autenticação — ${pane.name}` : 'Autenticação',
      label: prompt.message || 'Senha',
      password: !prompt.echo
    });
    window.tsm.conn.answerPrompt(id, prompt.id, value ?? '');
  });

  // Verificação de chave de host.
  window.tsm.conn.onHostKey(async (payload) => {
    const { id, host, port, fingerprint, changed, previous } = payload;
    const accepted = await confirmDialog({
      title: changed ? '⚠ A CHAVE DO HOST MUDOU' : 'Host desconhecido',
      message: changed
        ? `A chave de ${host}:${port} não é a mesma de antes.`
        : `Primeira conexão com ${host}:${port}.`,
      detail: changed
        ? `Anterior: ${previous}\nAtual:     ${fingerprint}\n\n` +
          'Isso pode ser reinstalação do servidor — ou um ataque man-in-the-middle. ' +
          'So aceite se você sabe por que a chave mudou.'
        : `Impressão digital: ${fingerprint}\n\nConfirme por um canal confiável antes de aceitar.`,
      confirmLabel: changed ? 'Aceitar mesmo assim' : 'Aceitar e salvar',
      danger: !!changed
    });
    window.tsm.conn.answerHostKey(id, accepted);
  });
}

export { terminalOptions };
