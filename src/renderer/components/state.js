'use strict';
/** Estado central do renderer. Nada de framework: um store minúsculo com pub/sub. */

const listeners = new Set();

export const state = {
  info: null,
  settings: {},
  folders: [],
  sessions: [],
  themes: [],
  uiThemes: [],
  identities: [],
  vault: { scheme: 'safeStorage', masterEnabled: false, unlocked: true },
  filter: '',
  selectedNode: null,          // { kind:'folder'|'session', id }
  expanded: new Set(),
  // Uma aba contem uma ÁRVORE de painéis (ver components/layout.js).
  // `panes` continua sendo a lista plana de terminais; cada um sabe sua aba.
  tabs: [],                    // { id, name, root, activePaneId }
  activeTabId: null,
  panes: [],                   // { id, tabId, connectionId, session, type, name, status, term, ... }
  activePaneId: null,
  sftp: { paneId: null, path: null, items: [], selected: new Set() },
  multiExec: false
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(event = 'change') {
  for (const fn of listeners) {
    try { fn(event, state); } catch (err) { console.error(err); }
  }
}

export async function reloadTree() {
  const [folders, sessions] = await Promise.all([
    window.tsm.folders.list(),
    window.tsm.sessions.list()
  ]);
  state.folders = folders;
  state.sessions = sessions;
  // `expanded` reflete o campo persistido de TODAS as pastas, não só as que já
  // foram clicadas nesta sessão — sem isso, a árvore só sabia mostrar pastas
  // "abertas por padrão" enquanto ninguém tivesse clicado em nenhuma pasta
  // ainda; a primeira pasta clicada por qualquer motivo derrubava esse padrão
  // para todas as outras de uma vez (ver tree.js).
  state.expanded.clear();
  for (const f of folders) {
    if (f.expanded) state.expanded.add(f.id);
  }
  emit('tree');
}

export async function reloadSettings() {
  state.settings = await window.tsm.settings.all();
  emit('settings');
}

export async function reloadThemes() {
  const { terminal, ui } = await window.tsm.themes.list();
  state.themes = terminal;
  state.uiThemes = ui;
  emit('themes');
}

export async function reloadVault() {
  state.vault = await window.tsm.vault.status();
  emit('vault');
}

export async function reloadIdentities() {
  state.identities = await window.tsm.identities.list();
  emit('identities');
}

export function setting(key, fallback) {
  const v = state.settings[key];
  return v === undefined ? fallback : v;
}

export async function saveSetting(key, value) {
  state.settings[key] = value;
  await window.tsm.settings.set(key, value);
  emit('settings');
}

export function activePane() {
  return state.panes.find((p) => p.id === state.activePaneId) || null;
}

export function paneById(id) {
  return state.panes.find((p) => p.id === id) || null;
}

export function paneByConnection(connectionId) {
  return state.panes.find((p) => p.connectionId === connectionId) || null;
}

// ----------------------------------------------------------------- abas ---
export function activeTab() {
  return state.tabs.find((t) => t.id === state.activeTabId) || null;
}

export function tabById(id) {
  return state.tabs.find((t) => t.id === id) || null;
}

export function tabOfPane(paneId) {
  const pane = paneById(paneId);
  return pane ? tabById(pane.tabId) : null;
}

/** Painéis de uma aba, na ordem visual da árvore. */
export function panesOfTab(tabId) {
  return state.panes.filter((p) => p.tabId === tabId);
}

/** O nome da aba é o do painel em foco — como no Windows Terminal. */
export function tabTitle(tab) {
  if (tab.name) return tab.name;
  const focused = paneById(tab.activePaneId);
  return focused ? focused.name : 'Sessão';
}

/** Constrói a árvore hierarquica a partir das listas planas. */
export function buildTree() {
  const byParent = new Map();
  for (const f of state.folders) {
    const key = f.parent_id || '';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(f);
  }
  const sessionsByFolder = new Map();
  for (const s of state.sessions) {
    const key = s.folder_id || '';
    if (!sessionsByFolder.has(key)) sessionsByFolder.set(key, []);
    sessionsByFolder.get(key).push(s);
  }

  const term = state.filter.trim().toLowerCase();
  const matches = (s) => {
    if (!term) return true;
    const hay = [
      s.name, s.type, s.notes, (s.tags || []).join(' '),
      s.config.host, s.config.username, s.config.shellPath
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(term);
  };

  const walk = (parentId) => {
    const folders = (byParent.get(parentId || '') || [])
      .map((f) => {
        const node = { kind: 'folder', data: f, children: walk(f.id) };
        node.visible = node.children.some((c) => c.visible);
        return node;
      });
    const sessions = (sessionsByFolder.get(parentId || '') || [])
      .map((s) => ({ kind: 'session', data: s, children: [], visible: matches(s) }));

    return [...folders, ...sessions].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      const ao = a.data.sort_order ?? 0;
      const bo = b.data.sort_order ?? 0;
      if (ao !== bo) return ao - bo;
      return a.data.name.localeCompare(b.data.name, 'pt-BR', { sensitivity: 'base' });
    });
  };

  return walk(null);
}

// -------------------------------------------------- atalhos reservados -----
// Ctrl+letra (sem Shift) que o app usa e o xterm.js normalmente mandaria pro
// shell como sequência de controle (Ctrl+D = EOF, Ctrl+R = busca reversa...).
// A sobreposição é proposital — mesma escolha do MobaXterm — mas só faz
// sentido se a tecla realmente chegar no app em vez de morrer no terminal.
const RESERVED_PLAIN = new Set(['n', 'w', 'd', 'r', 'p', 'b', 'f', 'k', 'l']);
// Ctrl+Shift+letra: sem equivalente de controle no terminal, sempre do app.
const RESERVED_SHIFT = new Set(['n', 'f', 't', 'w', 'c', 'v', 'a', 'e', 'm', 's', 'r']);

/**
 * True quando o evento é um atalho do app (menu ou `bindShortcuts`), não
 * entrada para o shell. Usado tanto pelo listener global quanto pelo
 * `attachCustomKeyEventHandler` de cada terminal — uma fonte só de verdade,
 * para não desalinhar "o que os dois lados acham que é atalho".
 */
export function isAppShortcut(e) {
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    return ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key);
  }

  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) return false;

  if (e.key === 'Tab') return true;
  if (!e.shiftKey && /^[1-9]$/.test(e.key)) return true;
  if ([',', '=', '-', '0'].includes(e.key)) return true;

  const key = e.key.toLowerCase();
  if (e.shiftKey) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') return true;
    return RESERVED_SHIFT.has(key);
  }
  return RESERVED_PLAIN.has(key);
}
