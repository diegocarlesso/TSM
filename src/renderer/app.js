'use strict';
import { el, $, $$, toast, guard, modal, contextMenu, confirmDialog, formatDate } from './components/ui.js';
import {
  state, subscribe, emit, reloadTree, reloadSettings, reloadThemes, reloadVault,
  reloadIdentities, setting, paneById, activePane
} from './components/state.js';
import { initTree, render as renderTree, newFolder } from './components/tree.js';
import {
  openPane, closePane, focusPane, reconnectPane, bindConnectionEvents,
  refreshAppearance, adjustFontSize, copySelection, pasteInto, broadcast
} from './components/terminal.js';
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
  document.documentElement.style.setProperty('--accent', setting('ui.accent', '#4f9cf9'));
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

// --------------------------------------------------------------- sessoes --
async function openSession(session, { force = false } = {}) {
  // Se o cofre estiver bloqueado e a sessao tiver senha, pedir antes de tentar.
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
  // Espera a conexao subir antes de listar arquivos.
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
    toast('Sessao salva', 'ok');
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
    else await settingsDialog('seguranca');
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
    const pane = activePane();
    if (pane) setTimeout(() => pane.fit.fit(), 60);
  });
}

// ----------------------------------------------------------------- abas ---
function renderTabs() {
  const bar = $('#tabs');
  bar.replaceChildren();

  for (const pane of state.panes) {
    const active = pane.id === state.activePaneId;
    pane.root.classList.toggle('active', active);

    const stateClass = pane.status === 'conectado' ? 'ok' : pane.status === 'erro' ? 'err' : '';
    const tab = el('div', {
      class: `tab${active ? ' active' : ''}`,
      title: `${pane.name}${pane.target ? ` — ${pane.target}` : ''} (${pane.status})`,
      onClick: () => focusPane(pane.id),
      onAuxclick: (e) => { if (e.button === 1) closePane(pane.id); },
      onContextmenu: (e) => tabMenu(e, pane)
    }, [
      el('span', { class: `tab-state ${stateClass}` }),
      el('span', { class: 'tab-name', text: pane.name }),
      el('span', {
        class: 'tab-close icon-btn', text: '✕',
        onClick: (e) => { e.stopPropagation(); closePane(pane.id); }
      })
    ]);
    if (pane.session && pane.session.color) tab.style.borderBottom = `2px solid ${pane.session.color}`;
    bar.append(tab);
  }

  const pane = activePane();
  $('#status-right').textContent = pane
    ? `${pane.type.toUpperCase()} · ${pane.target || ''} · ${pane.statusText || pane.status}`
    : '';

  if (!state.panes.length) showWelcome();
  else hideWelcome();
}

function tabMenu(e, pane) {
  contextMenu(e, [
    { label: 'Reconectar', key: 'Ctrl+R', onClick: () => reconnectPane(pane) },
    { label: 'Duplicar', key: 'Ctrl+D', onClick: () => duplicatePane(pane) },
    {
      label: 'Renomear aba…',
      onClick: async () => {
        const { promptDialog } = await import('./components/ui.js');
        const name = await promptDialog({ title: 'Renomear aba', label: 'Nome', value: pane.name });
        if (name) { pane.name = name; emit('panes'); }
      }
    },
    { separator: true },
    {
      label: 'Painel de arquivos',
      hidden: pane.type === 'telnet' || pane.type === 'shell',
      onClick: () => sftpPanel.show(pane.id)
    },
    {
      label: 'Editar sessao…',
      hidden: !pane.session,
      onClick: () => editSession(pane.session)
    },
    {
      label: 'Tuneis…',
      hidden: pane.type === 'shell' || pane.type === 'telnet',
      onClick: () => tunnelsDialog(pane)
    },
    { label: 'Gravar sessao em arquivo…', onClick: () => sessionLogDialog(pane) },
    { label: 'Biblioteca de comandos…', key: 'Ctrl+Shift+S', onClick: () => openSnippets() },
    { separator: true },
    { label: 'Fechar as outras', onClick: () => closeOthers(pane.id) },
    { label: 'Fechar aba', danger: true, key: 'Ctrl+W', onClick: () => closePane(pane.id) }
  ]);
}

async function duplicatePane(pane) {
  if (pane.session) await openPane({ session: pane.session });
  else await openPane({ type: pane.type, config: pane.spec.config, name: pane.name });
}

async function closeOthers(keepId) {
  for (const p of [...state.panes]) {
    if (p.id !== keepId) await closePane(p.id);
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
  list.append(el('li', { class: 'muted', style: 'cursor:default;justify-content:center' }, ['Sessoes recentes']));
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
    toast(`Enviado para ${n} sessao(oes)`, 'ok', 1500);
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

/** Abre a biblioteca de comandos ja ligada a aba ativa (ou a todas). */
function openSnippets() {
  return snippetsDialog({
    onSend: (text, toAll) => {
      if (toAll) {
        const n = broadcast(text);
        toast(`Enviado para ${n} sessao(oes)`, 'ok', 1600);
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
    type: 'text', placeholder: 'Buscar sessao por nome, host, usuario ou etiqueta…',
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
    title: 'Ir para sessao',
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
    if (!ctrl) return;

    // Ctrl+1..9 vai direto para a aba
    if (!e.shiftKey && /^[1-9]$/.test(e.key)) {
      const idx = Number(e.key) - 1;
      if (state.panes[idx]) { e.preventDefault(); focusPane(state.panes[idx].id); }
      return;
    }

    const key = e.key.toLowerCase();
    const pane = activePane();

    if (e.shiftKey && key === 'm') { e.preventDefault(); toggleMultiExec(); return; }
    if (e.shiftKey && key === 's') { e.preventDefault(); openSnippets(); return; }
    if (key === 'tab') {
      e.preventDefault();
      if (!state.panes.length) return;
      const i = state.panes.findIndex((p) => p.id === state.activePaneId);
      const next = e.shiftKey
        ? (i - 1 + state.panes.length) % state.panes.length
        : (i + 1) % state.panes.length;
      focusPane(state.panes[next].id);
      return;
    }
    if (key === 'f' && !e.shiftKey && pane) { e.preventDefault(); pane.findBar.toggle(pane.term); return; }
    if (key === 'p' && !e.shiftKey) { e.preventDefault(); commandPalette(); return; }
    if (key === 'b' && !e.shiftKey) { e.preventDefault(); toggleSidebar(); return; }
  });
}

function toggleSidebar() {
  $('#sidebar').classList.toggle('collapsed');
  const pane = activePane();
  if (pane) setTimeout(() => pane.fit.fit(), 60);
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
      case 'tab:close': return pane && closePane(pane.id);
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
      case 'appearance': return settingsDialog('aparencia');
      case 'settings': return settingsDialog('aparencia');
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
      : 'Nenhum mecanismo de cifragem disponivel. Clique para definir uma senha mestra.';
    if (v.scheme !== 'safeStorage') badge.classList.add('locked');
    return;
  }
  badge.classList.add(v.unlocked ? 'open' : 'locked');
  badge.textContent = v.unlocked ? 'cofre aberto' : 'cofre bloqueado';
  badge.title = v.unlocked ? 'Clique para bloquear' : 'Clique para desbloquear';
}

// Recalcula os terminais quando a janela muda de tamanho.
window.addEventListener('resize', () => {
  const pane = activePane();
  if (pane) {
    try { pane.fit.fit(); } catch { /* noop */ }
  }
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (setting('ui.theme', 'dark') === 'system') applyUiTheme('system');
});

boot().catch((err) => {
  document.body.innerHTML =
    `<pre style="padding:24px;color:#f85149;white-space:pre-wrap">Falha ao iniciar o TSM:\n\n${err.stack || err}</pre>`;
});
