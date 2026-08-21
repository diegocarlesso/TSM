'use strict';
/** Arvore de sessoes: pastas aninhadas, filtro, drag & drop e menu de contexto. */
import { el, $, contextMenu, confirmDialog, promptDialog, guard, toast } from './ui.js';
import { state, buildTree, reloadTree, emit } from './state.js';

const TYPE_GLYPH = {
  ssh: '🖧', telnet: '⌨', shell: '▣', sftp: '🗎', serial: '⬌'
};

const TYPE_LABEL = {
  ssh: 'SSH', telnet: 'Telnet', shell: 'Shell', sftp: 'SFTP', serial: 'Serial'
};

let handlers = {};

export function initTree(callbacks) {
  handlers = callbacks;
  const root = $('#tree');

  root.addEventListener('dragover', (e) => {
    // Soltar no vazio = mover para a raiz.
    if (e.target === root) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  });
  root.addEventListener('drop', (e) => {
    if (e.target === root) {
      e.preventDefault();
      applyDrop(readDrag(e), { parentId: null, position: 'into' });
    }
  });
  root.addEventListener('contextmenu', (e) => {
    if (e.target === root) rootMenu(e);
  });

  render();
}

export function render() {
  const root = $('#tree');
  const scroll = root.scrollTop;
  root.replaceChildren();

  const nodes = buildTree();
  const filtering = !!state.filter.trim();

  for (const node of nodes) renderNode(root, node, 0, filtering);

  root.scrollTop = scroll;
  $('#session-count').textContent =
    `${state.sessions.length} ${state.sessions.length === 1 ? 'sessao' : 'sessoes'}`;
}

function renderNode(container, node, depth, filtering) {
  if (filtering && !node.visible) return;

  const isFolder = node.kind === 'folder';
  const data = node.data;
  const expanded = filtering || state.expanded.has(data.id) || (isFolder && data.expanded && !state.expanded.size);
  const selected = state.selectedNode
    && state.selectedNode.kind === node.kind
    && state.selectedNode.id === data.id;

  const row = el('div', {
    class: `node ${node.kind}${selected ? ' selected' : ''}`,
    draggable: 'true',
    dataset: { kind: node.kind, id: data.id },
    style: `padding-left:${6 + depth * 13}px`,
    title: describe(node)
  });

  row.append(el('span', {
    class: 'twisty',
    text: isFolder ? (expanded ? '▾' : '▸') : ''
  }));

  const glyph = isFolder ? (expanded ? '📂' : '📁') : (TYPE_GLYPH[data.type] || '•');
  row.append(el('span', { class: 'glyph', text: glyph }));
  row.append(el('span', { class: 'label', text: data.name }));

  if (!isFolder) {
    row.append(el('span', { class: 'meta', text: shortTarget(data) }));
    if (data.color) row.append(el('span', { class: 'dot', style: `background:${data.color}` }));
  } else if (node.children.length) {
    row.append(el('span', { class: 'meta', text: String(countSessions(node)) }));
  }

  row.addEventListener('click', () => {
    state.selectedNode = { kind: node.kind, id: data.id };
    if (isFolder) toggleFolder(data.id);
    else emit('selection');
    render();
  });

  row.addEventListener('dblclick', () => {
    if (isFolder) return;
    handlers.onOpenSession && handlers.onOpenSession(data);
  });

  row.addEventListener('contextmenu', (e) => {
    state.selectedNode = { kind: node.kind, id: data.id };
    render();
    isFolder ? folderMenu(e, data) : sessionMenu(e, data);
  });

  wireDrag(row, node);
  container.append(row);

  if (isFolder && expanded) {
    for (const child of node.children) renderNode(container, child, depth + 1, filtering);
  }
}

function describe(node) {
  if (node.kind === 'folder') return node.data.name;
  const s = node.data;
  const parts = [TYPE_LABEL[s.type] || s.type, shortTarget(s)];
  if (s.notes) parts.push(`\n${s.notes}`);
  if (s.last_used_at) parts.push(`\nUltimo uso: ${new Date(s.last_used_at).toLocaleString('pt-BR')}`);
  return parts.filter(Boolean).join(' · ');
}

function shortTarget(s) {
  const c = s.config || {};
  if (s.type === 'serial') return c.path ? `${c.path} @ ${c.baudRate || 9600}` : 'serial';
  if (s.type === 'shell') return c.shellPath ? c.shellPath.split(/[\\/]/).pop() : 'local';
  if (!c.host) return '';
  const user = c.username ? `${c.username}@` : '';
  const port = c.port && c.port !== defaultPort(s.type) ? `:${c.port}` : '';
  return `${user}${c.host}${port}`;
}

function defaultPort(type) {
  return type === 'telnet' ? 23 : 22;
}

function countSessions(node) {
  let n = 0;
  for (const c of node.children) {
    if (c.kind === 'session') n++;
    else n += countSessions(c);
  }
  return n;
}

function toggleFolder(id) {
  if (state.expanded.has(id)) state.expanded.delete(id);
  else state.expanded.add(id);
  window.tsm.folders.update(id, { expanded: state.expanded.has(id) }).catch(() => {});
}

export function expandAll() {
  for (const f of state.folders) state.expanded.add(f.id);
  render();
}

export function collapseAll() {
  state.expanded.clear();
  render();
}

// ------------------------------------------------------------ drag&drop ---
let dragging = null;

function wireDrag(row, node) {
  row.addEventListener('dragstart', (e) => {
    dragging = { kind: node.kind, id: node.data.id, parentId: node.data.parent_id ?? node.data.folder_id ?? null };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `${node.kind}:${node.data.id}`);
    row.style.opacity = '.4';
  });

  row.addEventListener('dragend', () => {
    row.style.opacity = '';
    dragging = null;
    clearDropMarks();
  });

  row.addEventListener('dragover', (e) => {
    if (!dragging) return;
    if (dragging.kind === node.kind && dragging.id === node.data.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    clearDropMarks();
    const rect = row.getBoundingClientRect();
    const rel = (e.clientY - rect.top) / rect.height;

    if (node.kind === 'folder' && rel > 0.25 && rel < 0.75) row.classList.add('drop-into');
    else if (rel < 0.5) row.classList.add('drop-above');
    else row.classList.add('drop-below');
  });

  row.addEventListener('dragleave', () => row.classList.remove('drop-into', 'drop-above', 'drop-below'));

  row.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const position = row.classList.contains('drop-into') ? 'into'
      : row.classList.contains('drop-above') ? 'above' : 'below';
    clearDropMarks();

    const targetParent = node.kind === 'folder' && position === 'into'
      ? node.data.id
      : (node.data.parent_id ?? node.data.folder_id ?? null);

    applyDrop(readDrag(e), {
      parentId: targetParent,
      position,
      anchor: node
    });
  });
}

function readDrag(e) {
  if (dragging) return dragging;
  const raw = e.dataTransfer.getData('text/plain');
  if (!raw || !raw.includes(':')) return null;
  const [kind, id] = raw.split(':');
  return { kind, id };
}

function clearDropMarks() {
  for (const n of document.querySelectorAll('.node')) {
    n.classList.remove('drop-into', 'drop-above', 'drop-below');
  }
}

async function applyDrop(src, target) {
  if (!src) return;
  await guard(async () => {
    // Ordem: recalculamos os irmaos do destino e reinserimos na posicao pedida.
    const siblings = siblingsOf(target.parentId, src.kind);
    const filtered = siblings.filter((s) => s.id !== src.id);

    let index = filtered.length;
    if (target.anchor && target.position !== 'into') {
      const anchorIdx = filtered.findIndex((s) => s.id === target.anchor.data.id);
      if (anchorIdx !== -1) index = target.position === 'above' ? anchorIdx : anchorIdx + 1;
    }

    const moved = src.kind === 'folder'
      ? state.folders.find((f) => f.id === src.id)
      : state.sessions.find((s) => s.id === src.id);
    if (!moved) return;

    filtered.splice(index, 0, moved);
    const payload = filtered.map((item, i) => ({
      id: item.id,
      sortOrder: i,
      ...(src.kind === 'folder' ? { parentId: target.parentId } : { folderId: target.parentId })
    }));

    if (src.kind === 'folder') await window.tsm.folders.reorder(payload);
    else await window.tsm.sessions.reorder(payload);

    if (target.parentId) state.expanded.add(target.parentId);
    await reloadTree();
    render();
  });
}

function siblingsOf(parentId, kind) {
  const list = kind === 'folder'
    ? state.folders.filter((f) => (f.parent_id || null) === (parentId || null))
    : state.sessions.filter((s) => (s.folder_id || null) === (parentId || null));
  return [...list].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

// -------------------------------------------------------------- menus -----
function rootMenu(e) {
  contextMenu(e, [
    { label: 'Nova sessao…', key: 'Ctrl+N', onClick: () => handlers.onNewSession(null) },
    { label: 'Nova pasta…', key: 'Ctrl+Shift+F', onClick: () => newFolder(null) },
    { separator: true },
    { label: 'Expandir tudo', onClick: expandAll },
    { label: 'Recolher tudo', onClick: collapseAll },
    { separator: true },
    { label: 'Importar sessoes…', onClick: () => handlers.onImport() },
    { label: 'Exportar sessoes…', onClick: () => handlers.onExport() }
  ]);
}

function folderMenu(e, folder) {
  contextMenu(e, [
    { label: 'Nova sessao aqui…', onClick: () => handlers.onNewSession(folder.id) },
    { label: 'Nova subpasta…', onClick: () => newFolder(folder.id) },
    { separator: true },
    { label: 'Abrir todas as sessoes', onClick: () => openFolder(folder.id) },
    { separator: true },
    { label: 'Renomear…', key: 'F2', onClick: () => renameFolder(folder) },
    { label: 'Cor…', onClick: () => pickFolderColor(folder) },
    { separator: true },
    { label: 'Excluir pasta', danger: true, onClick: () => removeFolder(folder) }
  ]);
}

function sessionMenu(e, session) {
  contextMenu(e, [
    { label: 'Conectar', key: 'Enter', onClick: () => handlers.onOpenSession(session) },
    {
      label: 'Conectar em nova aba',
      onClick: () => handlers.onOpenSession(session, { force: true })
    },
    {
      label: 'Abrir navegador de arquivos',
      hidden: !['ssh', 'sftp'].includes(session.type),
      onClick: () => handlers.onOpenSftp(session)
    },
    { separator: true },
    { label: 'Editar…', key: 'F2', onClick: () => handlers.onEditSession(session) },
    { label: 'Duplicar', onClick: () => duplicate(session) },
    {
      label: 'Copiar comando SSH',
      hidden: session.type !== 'ssh',
      onClick: () => copyCommand(session)
    },
    { separator: true },
    { label: 'Excluir sessao', danger: true, onClick: () => removeSession(session) }
  ]);
}

// ------------------------------------------------------------- acoes ------
export async function newFolder(parentId) {
  const name = await promptDialog({ title: 'Nova pasta', label: 'Nome', placeholder: 'Producao' });
  if (!name) return;
  await guard(async () => {
    const f = await window.tsm.folders.create({ name, parentId });
    if (parentId) state.expanded.add(parentId);
    state.expanded.add(f.id);
    await reloadTree();
    render();
  });
}

async function renameFolder(folder) {
  const name = await promptDialog({ title: 'Renomear pasta', label: 'Nome', value: folder.name });
  if (!name || name === folder.name) return;
  await guard(async () => {
    await window.tsm.folders.update(folder.id, { name });
    await reloadTree();
    render();
  });
}

async function pickFolderColor(folder) {
  const input = el('input', { type: 'color', value: folder.color || '#4f9cf9' });
  const { modal } = await import('./ui.js');
  const color = await modal({
    title: 'Cor da pasta',
    width: 320,
    render: () => el('div', { class: 'form-grid' }, [el('label', { text: 'Cor' }), input]),
    footer: (api) => [
      el('button', { text: 'Remover cor', onClick: () => api.close(null) }),
      el('button', { class: 'primary', text: 'Aplicar', onClick: () => api.close(input.value) })
    ]
  });
  if (color === undefined) return;
  await guard(async () => {
    await window.tsm.folders.update(folder.id, { color });
    await reloadTree();
    render();
  });
}

async function removeFolder(folder) {
  const kids = state.sessions.filter((s) => s.folder_id === folder.id).length;
  const choice = await confirmDialog({
    title: 'Excluir pasta',
    message: `Excluir "${folder.name}"?`,
    detail: kids
      ? `${kids} sessao(oes) direta(s) serao excluidas junto com as subpastas.`
      : 'As subpastas tambem serao removidas.',
    confirmLabel: 'Excluir tudo',
    danger: true
  });
  if (!choice) return;
  await guard(async () => {
    await window.tsm.folders.remove(folder.id, { deleteSessions: true });
    await reloadTree();
    render();
    toast('Pasta excluida', 'ok');
  });
}

async function duplicate(session) {
  await guard(async () => {
    await window.tsm.sessions.duplicate(session.id);
    await reloadTree();
    render();
  });
}

async function removeSession(session) {
  const ok = await confirmDialog({
    title: 'Excluir sessao',
    message: `Excluir "${session.name}"?`,
    detail: 'As credenciais salvas dessa sessao tambem serao apagadas.',
    confirmLabel: 'Excluir',
    danger: true
  });
  if (!ok) return;
  await guard(async () => {
    await window.tsm.sessions.remove(session.id);
    await reloadTree();
    render();
    toast('Sessao excluida', 'ok');
  });
}

function copyCommand(session) {
  const c = session.config || {};
  const parts = ['ssh'];
  if (c.port && c.port !== 22) parts.push('-p', String(c.port));
  if (c.privateKeyPath) parts.push('-i', c.privateKeyPath);
  if (c.compression) parts.push('-C');
  if (c.x11Forward) parts.push('-X');
  if (c.jump && c.jump.host) {
    parts.push('-J', `${c.jump.username ? `${c.jump.username}@` : ''}${c.jump.host}${c.jump.port && c.jump.port !== 22 ? `:${c.jump.port}` : ''}`);
  }
  parts.push(`${c.username ? `${c.username}@` : ''}${c.host}`);
  window.tsm.app.copy(parts.join(' '));
  toast('Comando copiado', 'ok');
}

async function openFolder(folderId) {
  const list = state.sessions.filter((s) => s.folder_id === folderId);
  if (list.length > 8) {
    const ok = await confirmDialog({
      title: 'Abrir pasta inteira',
      message: `Abrir ${list.length} sessoes de uma vez?`,
      confirmLabel: 'Abrir'
    });
    if (!ok) return;
  }
  for (const s of list) await handlers.onOpenSession(s, { force: true });
}
