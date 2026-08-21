'use strict';
import { el, $, $$, toast, guard, modal, contextMenu, confirmDialog, formatDate } from './components/ui.js';
import {
  state, subscribe, emit, reloadTree, reloadSettings, reloadThemes, reloadVault,
  reloadIdentities, setting, paneById, activePane, activeTab, tabTitle
} from './components/state.js';
import { initTree, render as renderTree, newFolder } from './components/tree.js';
import {
  openPane, closePane, closeTab, focusPane, focusTab, focusNeighbor, splitPane,
  reconnectPane, bindConnectionEvents, refreshAppearance, adjustFontSize,
  copySelection, pasteInto, broadcast, fitActiveTab
} from './components/terminal.js';
import * as layout from './components/layout.js';
import * as sftpPanel from './components/sftp.js';
import { sessionDialog, quickConnectDialog } from './components/session-dialog.js';
import {
  settingsDialog, themeEditor, identitiesDialog, knownHostsDialog, historyDialog,
  importDialog, exportDialog, shortcutsDialog, aboutDialog, applyUiTheme,
  lockVault, unlockVaultDialog
} from './components/settings-dialog.js';
import {
  snippetsDialog, tunnelsDialog, sessionLogDialog, keysDialog
} from './components/tools-dialog.js';

// ------------------------------------------------------------ bootstrap ---
async function boot() {
  state.info = await window.tsm.app.info();

  await Promise.all([reloadSettings(), reloadThemes(), reloadVault(), reloadIdentities()]);
  await reloadTree();

  applyUiTheme(setting('ui.theme', 'dark'));
  document.documentElement.style.setProperty('--accent', setting('ui.accent', '#0090f0'));
  document.documentElement.style.setProperty('--sidebar-w', `${setting('ui.sidebarWidth', 280)}px`);

  bindConnectionEvents();
  bindUi();
  bindShortcuts();
  bindMenu();

  initTree({
    onOpenSession: openSession,
    onEditSession: editSession,
    onNewSession: (folderId) => newSession(folderId),
    onOpenSftp: openSessionForFiles,
    onImport: importDialog,
    onExport: exportDialog
  });
  sftpPanel.initSftp();

  subscribe((event) => {
    if (event === 'panes') renderTabs();
    if (event === 'tree' || event === 'selection') renderTree();
    if (event === 'vault') renderVaultBadge();
  });

  renderTabs();
  renderVaultBadge();
  await renderRecent();

  $('#status-left').textContent =
    `${state.info.platform}/${state.info.arch} · Electron ${state.info.electron}`;
}

// --------------------------------------------------------------- sessões --
async function openSession(session, { force = false } = {}) {
  // Se o cofre estiver bloqueado e a sessão tiver senha, pedir antes de tentar.
  if (state.vault.masterEnabled && !state.vault.unlocked) {
    const hasSecret = await window.tsm.secrets.has('session', session.id, 'password');
    if (hasSecret && !(await unlockVaultDialog())) return;
  }

  if (!force) {
    const existing = state.panes.find((p) => p.session && p.session.id === session.id && p.connectionId);
    if (existing) return focusPane(existing.id);
  }
  await guard(() => openPane({ session }));
  hideWelcome();
}

async function openSessionForFiles(session) {
  const pane = state.panes.find((p) => p.session && p.session.id === session.id && p.connectionId)
    || await openPane({ session });
  hideWelcome();
  // Espera a conexão subir antes de listar arquivos.
  const start = Date.now();
  while (pane.status !== 'conectado' && Date.now() - start < 15000) {
    await new Promise((r) => setTimeout(r, 150));
  }
  await sftpPanel.show(pane.id);
}

async function newSession(folderId) {
  const created = await sessionDialog(null, { folderId: folderId ?? currentFolderId() });
  if (created) {
    renderTree();
    const ok = await confirmDialog({
      title: 'Conectar agora?',
      message: `"${created.name}" foi criada.`,
      confirmLabel: 'Conectar'
    });
    if (ok) await openSession(created);
  }
}

async function editSession(session) {
  const saved = await sessionDialog(session);
  if (saved) renderTree();
}

function currentFolderId() {
  const sel = state.selectedNode;
  if (!sel) return null;
  if (sel.kind === 'folder') return sel.id;
  const s = state.sessions.find((x) => x.id === sel.id);
  return s ? s.folder_id : null;
}

async function quickConnect() {
  const spec = await quickConnectDialog();
  if (!spec) return;
  hideWelcome();
  const pane = await guard(() => openPane({ type: spec.type, config: spec.config, name: spec.name }));
  if (pane && spec.save) {
    await window.tsm.sessions.create({
      name: spec.name, type: spec.type, config: spec.config, folderId: currentFolderId()
    });
    await reloadTree();
    toast('Sessão salva', 'ok');
  }
}

async function newLocalShell(shellPath) {
  hideWelcome();
  await guard(() => openPane({
    type: 'shell',
    config: shellPath ? { shellPath } : {},
    name: shellPath ? shellPath.split(/[\\/]/).pop() : 'Shell local'
  }));
}

// ------------------------------------------------------------- interface --
function bindUi() {
  $('#btn-new-session').addEventListener('click', () => newSession(null));
  $('#btn-new-folder').addEventListener('click', () => newFolder(currentFolderId()));
  $('#btn-import').addEventListener('click', importDialog);
  $('#btn-export').addEventListener('click', exportDialog);
  $('#btn-quick').addEventListener('click', quickConnect);
  $('#btn-settings').addEventListener('click', () => settingsDialog('aparência'));

  $('#search').addEventListener('input', (e) => {
    state.filter = e.target.value;
    renderTree();
  });
  $('#search').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.target.value = '';
      state.filter = '';
      renderTree();
    }
  });

  $('#vault-state').addEventListener('click', async () => {
    if (state.vault.masterEnabled && !state.vault.unlocked) await unlockVaultDialog();
    else if (state.vault.masterEnabled) await lockVault();
    else await settingsDialog('segurança');
  });

  for (const btn of $$('#welcome [data-action]')) {
    btn.addEventListener('click', () => {
      const a = btn.dataset.action;
      if (a === 'new-session') newSession(null);
      if (a === 'quick') quickConnect();
      if (a === 'shell') shellMenuOrDefault();
      if (a === 'import') importDialog();
    });
  }

  initSplitter();
}

async function shellMenuOrDefault() {
  const shells = await window.tsm.system.shells();
  if (shells.length <= 1) return newLocalShell(shells[0] && shells[0].path);
  const rect = $('#btn-quick').getBoundingClientRect();
  contextMenu(
    { preventDefault() {}, clientX: rect.left, clientY: rect.bottom },
    shells.map((s) => ({ label: s.label, onClick: () => newLocalShell(s.path) }))
  );
}

function initSplitter() {
  const splitter = $('#splitter');
  let dragging = false;

  splitter.addEventListener('mousedown', (e) => {
    dragging = true;
    e.preventDefault();
    document.body.style.cursor = 'col-resize';
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const w = Math.max(180, Math.min(560, e.clientX));
    document.documentElement.style.setProperty('--sidebar-w', `${w}px`);
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    const w = Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w'), 10);
    window.tsm.settings.set('ui.sidebarWidth', w);
    setTimeout(fitActiveTab, 60);
  });
}

// ----------------------------------------------------------------- abas ---
function renderTabs() {
  const bar = $('#tabs');
  bar.replaceChildren();

  for (const tab of state.tabs) {
    const active = tab.id === state.activeTabId;
    const panes = layout.leafIds(tab.root).map(paneById).filter(Boolean);
    const focused = paneById(tab.activePaneId) || panes[0];
    if (!focused) continue;

    const worst = panes.some((p) => p.status === 'erro') ? 'err'
      : panes.every((p) => p.status === 'conectado') ? 'ok' : '';

    const node = el('div', {
      class: `tab${active ? ' active' : ''}`,
      title: panes.map((p) => `${p.name}${p.target ? ` — ${p.target}` : ''} (${p.status})`).join('\n'),
      onClick: () => focusTab(tab.id),
      onAuxclick: (e) => { if (e.button === 1) closeTab(tab.id); },
      onContextmenu: (e) => tabMenu(e, tab, focused)
    }, [
      el('span', { class: `tab-state ${worst}` }),
      el('span', { class: 'tab-name', text: tabTitle(tab) }),
      panes.length > 1 ? el('span', { class: 'tab-count', text: String(panes.length) }) : null,
      el('span', {
        class: 'tab-close icon-btn', text: '✕',
        onClick: (e) => { e.stopPropagation(); closeTab(tab.id); }
      })
    ]);
    if (focused.session && focused.session.color) {
      node.style.borderBottom = `2px solid ${focused.session.color}`;
    }
    bar.append(node);
  }

  renderWorkspace();

  const pane = activePane();
  $('#status-right').textContent = pane
    ? `${pane.type.toUpperCase()} · ${pane.target || ''} · ${pane.statusText || pane.status}`
    : '';

  if (!state.tabs.length) showWelcome();
  else hideWelcome();
}

/**
 * Monta a árvore de layout de cada aba dentro de `#panes`.
 *
 * A reconstrução acontece só quando a ESTRUTURA muda (assinatura da árvore).
 * Foco e status são aplicados por classe, sem tocar no DOM dos terminais —
 * reanexar um elemento do xterm a cada evento seria caro e piscaria a tela.
 */
function renderWorkspace() {
  const container = $('#panes');
  const alive = new Set();

  for (const tab of state.tabs) {
    alive.add(tab.id);
    let view = container.querySelector(`.tab-view[data-tab-id="${tab.id}"]`);
    if (!view) {
      view = el('div', { class: 'tab-view', dataset: { tabId: tab.id } });
      container.append(view);
    }

    const sig = layout.signature(tab.root);
    if (view.dataset.sig !== sig) {
      layout.renderTree(view, tab.root, {
        mount: (paneId) => {
          const p = paneById(paneId);
          return p ? p.root : null;
        },
        activePaneId: tab.activePaneId,
        onResize: () => fitActiveTab()
      });
      view.dataset.sig = sig;
      if (tab.id === state.activeTabId) requestAnimationFrame(fitActiveTab);
    }

    view.classList.toggle('active', tab.id === state.activeTabId);
    const showFocus = tab.id === state.activeTabId && layout.countLeaves(tab.root) > 1;
    for (const leafEl of view.querySelectorAll('.leaf')) {
      leafEl.classList.toggle('focused', showFocus && leafEl.dataset.paneId === tab.activePaneId);
    }
  }

  for (const view of [...container.children]) {
    if (!alive.has(view.dataset.tabId)) view.remove();
  }
}

function tabMenu(e, tab, pane) {
  contextMenu(e, [
    { label: 'Dividir a direita', key: 'Ctrl+Shift+Seta direita', onClick: () => splitPane(pane, 'row') },
    { label: 'Dividir abaixo', key: 'Ctrl+Shift+Seta abaixo', onClick: () => splitPane(pane, 'col') },
    { separator: true },
    { label: 'Reconectar painel', key: 'Ctrl+R', onClick: () => reconnectPane(pane) },
    { label: 'Duplicar em nova aba', key: 'Ctrl+D', onClick: () => duplicatePane(pane) },
    {
      label: 'Renomear aba…',
      onClick: async () => {
        const { promptDialog } = await import('./components/ui.js');
        const name = await promptDialog({ title: 'Renomear aba', label: 'Nome', value: tabTitle(tab) });
        if (name !== undefined) { tab.name = name || null; emit('panes'); }
      }
    },
    { separator: true },
    {
      label: 'Painel de arquivos',
      hidden: !['ssh', 'sftp'].includes(pane.type),
      onClick: () => sftpPanel.show(pane.id)
    },
    {
      label: 'Editar sessão…',
      hidden: !pane.session,
      onClick: () => editSession(pane.session)
    },
    {
      label: 'Túneis…',
      hidden: !['ssh', 'sftp'].includes(pane.type),
      onClick: () => tunnelsDialog(pane)
    },
    {
      label: 'Enviar break',
      hidden: pane.type !== 'serial',
      onClick: () => guard(async () => {
        await window.tsm.serial.sendBreak(pane.connectionId, 300);
        toast('Break enviado', 'ok', 1500);
      })
    },
    { label: 'Gravar sessão em arquivo…', onClick: () => sessionLogDialog(pane) },
    { label: 'Biblioteca de comandos…', key: 'Ctrl+Shift+S', onClick: () => openSnippets() },
    { separator: true },
    {
      label: 'Fechar painel',
      key: 'Ctrl+Shift+W',
      hidden: layout.countLeaves(tab.root) < 2,
      onClick: () => closePane(pane.id)
    },
    { label: 'Fechar as outras abas', onClick: () => closeOtherTabs(tab.id) },
    { label: 'Fechar aba', danger: true, key: 'Ctrl+W', onClick: () => closeTab(tab.id) }
  ]);
}

async function duplicatePane(pane) {
  if (pane.session) await openPane({ session: pane.session });
  else await openPane({ type: pane.type, config: pane.spec.config, name: pane.name });
}

async function closeOtherTabs(keepId) {
  for (const t of [...state.tabs]) {
    if (t.id !== keepId) await closeTab(t.id);
  }
}

function showWelcome() {
  $('#welcome').classList.remove('hidden');
  renderRecent();
}

function hideWelcome() {
  $('#welcome').classList.add('hidden');
}

async function renderRecent() {
  const list = $('#recent-list');
  const recent = await window.tsm.sessions.recent(8);
  list.replaceChildren();
  if (!recent.length) return;
  list.append(el('li', { class: 'muted', style: 'cursor:default;justify-content:center' }, ['Sessões recentes']));
  for (const s of recent) {
    list.append(el('li', { onClick: () => openSession(s) }, [
      el('span', { text: s.name }),
      el('span', { class: 'muted', text: formatDate(s.last_used_at) })
    ]));
  }
}

// ------------------------------------------------------------- MultiExec --
function toggleMultiExec() {
  const existing = $('#multiexec');
  if (existing) {
    existing.remove();
    state.multiExec = false;
    const pane = activePane();
    if (pane) pane.term.focus();
    return;
  }

  const input = el('input', { placeholder: 'comando enviado a TODAS as abas conectadas…' });
  const bar = el('div', { class: 'multiexec-bar', id: 'multiexec' }, [
    el('span', { text: '⚡ MultiExec' }),
    input,
    el('button', { text: 'Enviar', onClick: () => send() }),
    el('button', { text: '✕', onClick: () => toggleMultiExec() })
  ]);

  const send = () => {
    const n = broadcast(`${input.value}\n`);
    toast(`Enviado para ${n} sessão(oes)`, 'ok', 1500);
    input.select();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); send(); }
    if (e.key === 'Escape') toggleMultiExec();
  });

  $('#workspace').before(bar);
  state.multiExec = true;
  input.focus();
}

/** Abre a biblioteca de comandos já ligada a aba ativa (ou a todas). */
function openSnippets() {
  return snippetsDialog({
    onSend: (text, toAll) => {
      if (toAll) {
        const n = broadcast(text);
        toast(`Enviado para ${n} sessão(oes)`, 'ok', 1600);
        return;
      }
      const pane = activePane();
      if (!pane || !pane.connectionId) return toast('Nenhuma aba conectada', 'warn');
      window.tsm.conn.write(pane.connectionId, text);
      toast(`Enviado para "${pane.name}"`, 'ok', 1600);
    }
  });
}

// ----------------------------------------------------------- paleta ------
async function commandPalette() {
  const sessions = state.sessions;
  let filtered = sessions.slice(0, 60);
  let index = 0;

  const input = el('input', {
    type: 'text', placeholder: 'Buscar sessão por nome, host, usuário ou etiqueta…',
    style: 'width:100%;padding:8px;background:var(--bg-1);border:1px solid var(--border);' +
           'border-radius:6px;outline:none;user-select:text'
  });
  const list = el('div', { style: 'margin-top:10px;max-height:50vh;overflow:auto' });

  const paint = () => {
    list.replaceChildren();
    filtered.forEach((s, i) => {
      const c = s.config || {};
      list.append(el('div', {
        class: `node${i === index ? ' selected' : ''}`,
        onClick: () => finish(s)
      }, [
        el('span', { class: 'glyph', text: s.type === 'ssh' ? '🖧' : s.type === 'telnet' ? '⌨' : '▣' }),
        el('span', { class: 'label', text: s.name }),
        el('span', { class: 'meta', text: c.host ? `${c.username ? `${c.username}@` : ''}${c.host}` : s.type })
      ]));
    });
  };

  let resolveFn;
  const done = new Promise((r) => { resolveFn = r; });
  const finish = (s) => { resolveFn(s); api.close(true); };
  let api;

  const filter = () => {
    const term = input.value.trim().toLowerCase();
    filtered = (term
      ? sessions.filter((s) => [s.name, s.config.host, s.config.username, (s.tags || []).join(' ')]
        .filter(Boolean).join(' ').toLowerCase().includes(term))
      : sessions).slice(0, 60);
    index = 0;
    paint();
  };

  input.addEventListener('input', filter);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); index = Math.min(index + 1, filtered.length - 1); paint(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); index = Math.max(index - 1, 0); paint(); }
    if (e.key === 'Enter') { e.preventDefault(); if (filtered[index]) finish(filtered[index]); }
  });

  paint();
  modal({
    title: 'Ir para sessão',
    width: 560,
    render: (a) => { api = a; return el('div', {}, [input, list]); }
  }).then(() => resolveFn(undefined));

  const chosen = await done;
  if (chosen) await openSession(chosen);
}

// -------------------------------------------------------------- atalhos ---
function bindShortcuts() {
  window.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;

    // Alt + setas navega entre os painéis da aba — sem Ctrl, para não brigar
    // com o Alt+seta de histórico de alguns shells.
    if (e.altKey && !ctrl && !e.shiftKey) {
      const dirs = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
      if (dirs[e.key]) {
        e.preventDefault();
        focusNeighbor(dirs[e.key]);
        return;
      }
    }

    if (!ctrl) return;

    // Ctrl+1..9 vai direto para a aba N.
    if (!e.shiftKey && /^[1-9]$/.test(e.key)) {
      const idx = Number(e.key) - 1;
      if (state.tabs[idx]) { e.preventDefault(); focusTab(state.tabs[idx].id); }
      return;
    }

    const key = e.key.toLowerCase();
    const pane = activePane();
    const tab = activeTab();

    // Divisão do painel em foco.
    if (e.shiftKey && e.key === 'ArrowRight') { e.preventDefault(); splitPane(pane, 'row'); return; }
    if (e.shiftKey && e.key === 'ArrowDown') { e.preventDefault(); splitPane(pane, 'col'); return; }

    if (e.shiftKey && key === 'w') { e.preventDefault(); if (pane) closePane(pane.id); return; }
    if (!e.shiftKey && key === 'w') { e.preventDefault(); if (tab) closeTab(tab.id); return; }

    if (e.shiftKey && key === 'm') { e.preventDefault(); toggleMultiExec(); return; }
    if (e.shiftKey && key === 's') { e.preventDefault(); openSnippets(); return; }

    if (key === 'tab') {
      e.preventDefault();
      if (!state.tabs.length) return;
      const i = state.tabs.findIndex((t) => t.id === state.activeTabId);
      const next = e.shiftKey
        ? (i - 1 + state.tabs.length) % state.tabs.length
        : (i + 1) % state.tabs.length;
      focusTab(state.tabs[next].id);
      return;
    }
    if (key === 'f' && !e.shiftKey && pane) { e.preventDefault(); pane.findBar.toggle(pane.term); return; }
    if (key === 'p' && !e.shiftKey) { e.preventDefault(); commandPalette(); return; }
    if (key === 'b' && !e.shiftKey) { e.preventDefault(); toggleSidebar(); return; }
  });
}

function toggleSidebar() {
  $('#sidebar').classList.toggle('collapsed');
  setTimeout(fitActiveTab, 60);
}

// ---------------------------------------------------- comandos do menu ----
function bindMenu() {
  window.tsm.menu.on(async ({ command }) => {
    const pane = activePane();
    switch (command) {
      case 'session:new': return newSession(null);
      case 'quickconnect': return quickConnect();
      case 'folder:new': return newFolder(currentFolderId());
      case 'shell:new': return shellMenuOrDefault();
      case 'tab:close': return activeTab() && closeTab(activeTab().id);
      case 'pane:close': return pane && closePane(pane.id);
      case 'split:right': return splitPane(pane, 'row');
      case 'split:down': return splitPane(pane, 'col');
      case 'tab:duplicate': return pane && duplicatePane(pane);
      case 'tab:reconnect': return pane && reconnectPane(pane);
      case 'term:copy': return pane && copySelection(pane);
      case 'term:paste': return pane && pasteInto(pane);
      case 'term:selectAll': return pane && pane.term.selectAll();
      case 'term:find': return pane && pane.findBar.toggle(pane.term);
      case 'term:clear': return pane && pane.term.clear();
      case 'palette': return commandPalette();
      case 'toggle:sidebar': return toggleSidebar();
      case 'toggle:sftp': return sftpPanel.toggle();
      case 'font:inc': return adjustFontSize(1);
      case 'font:dec': return adjustFontSize(-1);
      case 'font:reset': return adjustFontSize(0);
      case 'appearance': return settingsDialog('aparência');
      case 'settings': return settingsDialog('aparência');
      case 'identities': return identitiesDialog();
      case 'knownhosts': return knownHostsDialog();
      case 'history': return historyDialog();
      case 'import': return importDialog();
      case 'export': return exportDialog();
      case 'backup': return guard(async () => {
        const res = await window.tsm.io.backupDb();
        if (!res.canceled) toast(`Backup salvo em ${res.filePath}`, 'ok');
      });
      case 'snippets': return openSnippets();
      case 'multiexec': return toggleMultiExec();
      case 'opendata': return window.tsm.app.showItemInFolder(state.info.dbPath);
      case 'tunnels': return tunnelsDialog(pane);
      case 'sessionlog': return sessionLogDialog(pane);
      case 'keys': return keysDialog();
      case 'vault:lock': return lockVault();
      case 'help:shortcuts': return shortcutsDialog();
      case 'help:about': return aboutDialog();
      default: return undefined;
    }
  });
}

function renderVaultBadge() {
  const badge = $('#vault-state');
  const v = state.vault;
  badge.classList.remove('locked', 'open');
  if (!v.masterEnabled) {
    badge.textContent = v.scheme === 'safeStorage' ? 'cofre do SO' : 'sem cofre';
    badge.title = v.scheme === 'safeStorage'
      ? 'Credenciais cifradas pelo sistema operacional. Clique para configurar.'
      : 'Nenhum mecanismo de cifragem disponível. Clique para definir uma senha mestra.';
    if (v.scheme !== 'safeStorage') badge.classList.add('locked');
    return;
  }
  badge.classList.add(v.unlocked ? 'open' : 'locked');
  badge.textContent = v.unlocked ? 'cofre aberto' : 'cofre bloqueado';
  badge.title = v.unlocked ? 'Clique para bloquear' : 'Clique para desbloquear';
}

// Recalcula os terminais quando a janela muda de tamanho.
window.addEventListener('resize', () => fitActiveTab());

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (setting('ui.theme', 'dark') === 'system') applyUiTheme('system');
});

boot().catch((err) => {
  document.body.innerHTML =
    `<pre style="padding:24px;color:#f85149;white-space:pre-wrap">Falha ao iniciar o TSM:\n\n${err.stack || err}</pre>`;
});
