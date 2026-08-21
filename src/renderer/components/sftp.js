'use strict';
/** Navegador de arquivos remoto (SFTP/SCP) montado sobre a conexao SSH ativa. */
import { el, $, contextMenu, confirmDialog, promptDialog, guard, toast, modal, formatBytes, formatDate } from './ui.js';
import { state, paneById, emit } from './state.js';

let currentPath = null;
let selected = new Set();

export function initSftp() {
  $('#sftp-close').addEventListener('click', hide);
  $('#sftp-up').addEventListener('click', () => navigateUp());
  $('#sftp-refresh').addEventListener('click', () => refresh());
  $('#sftp-upload').addEventListener('click', () => uploadPicker());
  $('#sftp-mkdir').addEventListener('click', () => makeDir());

  $('#sftp-path').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') navigate(e.target.value.trim());
  });

  const panel = $('#sftp-panel');
  panel.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      panel.classList.add('dragover');
    }
  });
  panel.addEventListener('dragleave', () => panel.classList.remove('dragover'));
  panel.addEventListener('drop', async (e) => {
    e.preventDefault();
    panel.classList.remove('dragover');
    const paths = [...e.dataTransfer.files].map((f) => f.path).filter(Boolean);
    if (paths.length) await uploadPaths(paths);
  });

  window.tsm.sftp.onProgress(({ label, done, total }) => {
    const pct = total ? Math.round((done / total) * 100) : 0;
    $('#sftp-status').textContent = `${label} — ${formatBytes(done)} / ${formatBytes(total)} (${pct}%)`;
  });
}

export function isOpen() {
  return !$('#sftp-panel').classList.contains('hidden');
}

export function hide() {
  $('#sftp-panel').classList.add('hidden');
  state.sftp.paneId = null;
  emit('sftp');
}

/** Abre o painel para o painel/aba informado (ou o ativo). */
export async function show(paneId) {
  const pane = paneById(paneId || state.activePaneId);
  if (!pane) return toast('Abra uma sessao primeiro', 'warn');
  if (!pane.connectionId) return toast('A sessao nao esta conectada', 'warn');
  if (pane.type === 'telnet' || pane.type === 'shell') {
    return toast('Transferencia de arquivos so em sessoes SSH/SFTP', 'warn');
  }

  state.sftp.paneId = pane.id;
  $('#sftp-panel').classList.remove('hidden');
  emit('sftp');
  await navigate(null);
}

export function toggle() {
  if (isOpen()) hide();
  else show();
}

function connectionId() {
  const pane = paneById(state.sftp.paneId);
  return pane ? pane.connectionId : null;
}

export async function navigate(dir) {
  const id = connectionId();
  if (!id) return;
  await guard(async () => {
    $('#sftp-status').textContent = 'carregando…';
    const res = await window.tsm.sftp.list(id, dir);
    currentPath = res.path;
    selected = new Set();
    $('#sftp-path').value = res.path;
    renderList(res);
    $('#sftp-status').textContent = `${res.items.length} item(ns)`;
  });
}

function navigateUp() {
  if (!currentPath) return;
  const parent = currentPath === '/' ? '/' : currentPath.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
  navigate(parent);
}

export function refresh() {
  return navigate(currentPath);
}

function renderList(res) {
  const list = $('#sftp-list');
  list.replaceChildren();

  if (res.path !== '/') {
    list.append(el('div', {
      class: 'sftp-row',
      onDblclick: () => navigateUp()
    }, [
      el('span', { text: '↰' }),
      el('span', { class: 'name muted', text: '..' }),
      el('span', {}), el('span', {})
    ]));
  }

  for (const item of res.items) {
    const row = el('div', {
      class: 'sftp-row',
      dataset: { path: item.path },
      title: `${item.permissions}  ${formatDate(item.mtime)}`
    }, [
      el('span', { text: item.isDirectory ? '📁' : item.isSymlink ? '🔗' : '🗎' }),
      el('span', { class: 'name', text: item.name }),
      el('span', { class: 'size', text: item.isDirectory ? '' : formatBytes(item.size) }),
      el('span', { class: 'perm', text: item.permissions })
    ]);

    row.addEventListener('click', (e) => {
      if (!e.ctrlKey && !e.metaKey) selected.clear();
      if (selected.has(item.path)) selected.delete(item.path);
      else selected.add(item.path);
      syncSelection(res.items);
    });

    row.addEventListener('dblclick', () => {
      if (item.isDirectory) navigate(item.path);
      else openFile(item);
    });

    row.addEventListener('contextmenu', (e) => {
      if (!selected.has(item.path)) {
        selected.clear();
        selected.add(item.path);
        syncSelection(res.items);
      }
      itemMenu(e, item, res.items);
    });

    list.append(row);
  }

  list.oncontextmenu = (e) => {
    if (e.target === list) {
      contextMenu(e, [
        { label: 'Enviar arquivos…', onClick: () => uploadPicker() },
        { label: 'Nova pasta…', onClick: () => makeDir() },
        { label: 'Atualizar', onClick: () => refresh() }
      ]);
    }
  };
}

function syncSelection(items) {
  for (const row of document.querySelectorAll('#sftp-list .sftp-row')) {
    row.classList.toggle('selected', selected.has(row.dataset.path));
  }
  const n = selected.size;
  const bytes = items.filter((i) => selected.has(i.path) && !i.isDirectory)
    .reduce((acc, i) => acc + i.size, 0);
  $('#sftp-status').textContent = n
    ? `${n} selecionado(s) — ${formatBytes(bytes)}`
    : `${items.length} item(ns)`;
}

function selectedItems(items) {
  return items.filter((i) => selected.has(i.path));
}

function itemMenu(e, item, items) {
  const chosen = selectedItems(items);
  contextMenu(e, [
    {
      label: item.isDirectory ? 'Abrir' : 'Editar',
      onClick: () => (item.isDirectory ? navigate(item.path) : openFile(item))
    },
    { label: `Baixar (${chosen.length})`, onClick: () => download(chosen) },
    { separator: true },
    { label: 'Renomear…', onClick: () => rename(item) },
    { label: 'Permissoes…', onClick: () => chmod(item) },
    { label: 'Copiar caminho', onClick: () => { window.tsm.app.copy(item.path); toast('Caminho copiado', 'ok'); } },
    { separator: true },
    { label: `Excluir (${chosen.length})`, danger: true, onClick: () => removeItems(chosen) }
  ]);
}

async function download(items) {
  const id = connectionId();
  if (!id || !items.length) return;
  await guard(async () => {
    const res = await window.tsm.sftp.download(id, items.map((i) => ({
      name: i.name, path: i.path, isDirectory: i.isDirectory
    })));
    if (res.canceled) return;
    toast(`${res.files.length} item(ns) baixado(s)`, 'ok');
    $('#sftp-status').textContent = `salvo em ${res.dir}`;
  });
}

async function uploadPicker() {
  const id = connectionId();
  if (!id || !currentPath) return;
  await guard(async () => {
    const res = await window.tsm.sftp.upload(id, currentPath, null);
    if (res.canceled) return;
    toast(`${res.files.length} arquivo(s) enviado(s)`, 'ok');
    await refresh();
  });
}

async function uploadPaths(paths) {
  const id = connectionId();
  if (!id || !currentPath) return;
  await guard(async () => {
    const res = await window.tsm.sftp.upload(id, currentPath, paths);
    if (!res.canceled) {
      toast(`${res.files.length} item(ns) enviado(s)`, 'ok');
      await refresh();
    }
  });
}

async function makeDir() {
  const id = connectionId();
  if (!id || !currentPath) return;
  const name = await promptDialog({ title: 'Nova pasta remota', label: 'Nome' });
  if (!name) return;
  await guard(async () => {
    await window.tsm.sftp.mkdir(id, `${currentPath.replace(/\/+$/, '')}/${name}`);
    await refresh();
  });
}

async function rename(item) {
  const id = connectionId();
  const name = await promptDialog({ title: 'Renomear', label: 'Novo nome', value: item.name });
  if (!name || name === item.name) return;
  await guard(async () => {
    const dir = item.path.slice(0, item.path.lastIndexOf('/')) || '/';
    await window.tsm.sftp.rename(id, item.path, `${dir === '/' ? '' : dir}/${name}`);
    await refresh();
  });
}

async function chmod(item) {
  const id = connectionId();
  const octal = (item.mode & 0o777).toString(8).padStart(3, '0');
  const value = await promptDialog({
    title: 'Permissoes',
    label: 'Modo octal',
    value: octal,
    hint: 'Ex.: 644 para arquivo, 755 para executavel/pasta.'
  });
  if (!value) return;
  const mode = Number.parseInt(value, 8);
  if (!Number.isFinite(mode)) return toast('Modo invalido', 'err');
  await guard(async () => {
    await window.tsm.sftp.chmod(id, item.path, mode);
    await refresh();
  });
}

async function removeItems(items) {
  const id = connectionId();
  if (!id || !items.length) return;
  const ok = await confirmDialog({
    title: 'Excluir no servidor',
    message: `Excluir ${items.length} item(ns) permanentemente?`,
    detail: items.slice(0, 8).map((i) => i.path).join('\n') + (items.length > 8 ? '\n…' : ''),
    confirmLabel: 'Excluir',
    danger: true
  });
  if (!ok) return;
  await guard(async () => {
    for (const item of items) await window.tsm.sftp.remove(id, item.path, item.isDirectory);
    toast('Excluido', 'ok');
    await refresh();
  });
}

/** Editor de texto simples embutido, para configs rapidas. */
async function openFile(item) {
  const id = connectionId();
  if (!id) return;
  await guard(async () => {
    const content = await window.tsm.sftp.read(id, item.path);
    const area = el('textarea', {
      value: content,
      style: 'width:100%;min-height:52vh;font-family:var(--font-mono);font-size:12px;' +
             'background:var(--bg-1);border:1px solid var(--border);border-radius:6px;padding:8px;' +
             'color:var(--text);user-select:text;'
    });
    const save = await modal({
      title: item.path,
      width: 820,
      render: () => area,
      footer: (api) => [
        el('button', { text: 'Fechar', onClick: () => api.close(false) }),
        el('button', { class: 'primary', text: 'Salvar no servidor', onClick: () => api.close(true) })
      ]
    });
    if (save === true) {
      await window.tsm.sftp.write(id, item.path, area.value);
      toast('Arquivo salvo', 'ok');
      await refresh();
    }
  });
}
