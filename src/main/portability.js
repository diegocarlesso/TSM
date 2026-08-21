'use strict';
/**
 * Importação e exportação de sessões/configurações.
 *
 * Formato nativo: JSON (`.tsm.json`), legível e versionado. Segredos NUNCA
 * saem em claro: ou ficam de fora, ou vao num bloco AES-256-GCM cifrado com
 * uma senha que o usuário digita na hora da exportação.
 */
const fs = require('node:fs');
const path = require('node:path');
const repo = require('./store/repo');
const vault = require('./security/vault');
const moba = require('./importers/mobaxterm');
const putty = require('./importers/putty');

const FORMAT = 'tsm-export';
const VERSION = 1;

// --------------------------------------------------------------- export ----
function buildExport({ includeSecrets = false, passphrase = null, sessionIds = null } = {}) {
  const allSessions = repo.sessions.list();
  const sessions = sessionIds ? allSessions.filter((s) => sessionIds.includes(s.id)) : allSessions;
  const keepFolders = new Set();

  // Mantem a cadeia de pastas até a raiz das sessões exportadas.
  const foldersById = new Map(repo.folders.list().map((f) => [f.id, f]));
  for (const s of sessions) {
    let cur = s.folder_id;
    while (cur && foldersById.has(cur) && !keepFolders.has(cur)) {
      keepFolders.add(cur);
      cur = foldersById.get(cur).parent_id;
    }
  }

  const payload = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    folders: [...keepFolders].map((id) => {
      const f = foldersById.get(id);
      return {
        id: f.id, parentId: f.parent_id, name: f.name,
        sortOrder: f.sort_order, color: f.color, icon: f.icon
      };
    }),
    sessions: sessions.map((s) => ({
      id: s.id, folderId: s.folder_id, name: s.name, type: s.type,
      sortOrder: s.sort_order, config: s.config, themeId: s.theme_id,
      color: s.color, icon: s.icon, tags: s.tags, notes: s.notes,
      identityId: s.identity_id
    })),
    identities: repo.identities.list().map((i) => ({
      id: i.id, name: i.name, username: i.username, authType: i.auth_type, keyPath: i.key_path
    })),
    themes: repo.themes.list().filter((t) => !t.builtin)
      .map((t) => ({ id: t.id, name: t.name, data: t.data })),
    settings: repo.settings.all(),
    encrypted: false,
    secrets: null
  };

  // Preferências do cofre não viajam: sal/verificador são daquela instalação.
  delete payload.settings['vault.master.salt'];
  delete payload.settings['vault.master.verifier'];

  if (includeSecrets) {
    if (!passphrase) throw new Error('Exportar credenciais exige uma senha de proteção do arquivo.');
    const bag = [];
    for (const s of payload.sessions) {
      for (const field of ['password', 'passphrase', 'jumpPassword', 'jumpPassphrase']) {
        if (vault.has('session', s.id, field)) {
          bag.push({ ownerKind: 'session', ownerId: s.id, field, value: vault.read('session', s.id, field) });
        }
      }
    }
    for (const i of payload.identities) {
      for (const field of ['password', 'passphrase']) {
        if (vault.has('identity', i.id, field)) {
          bag.push({ ownerKind: 'identity', ownerId: i.id, field, value: vault.read('identity', i.id, field) });
        }
      }
    }
    payload.encrypted = true;
    payload.secrets = vault.sealExport(JSON.stringify(bag), passphrase);
  }

  return payload;
}

function exportToFile(filePath, options) {
  const payload = buildExport(options);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return {
    filePath,
    sessions: payload.sessions.length,
    folders: payload.folders.length,
    encrypted: payload.encrypted
  };
}

// --------------------------------------------------------------- import ----
/**
 * Aplica uma estrutura neutra {folders, sessions} ao banco.
 * `strategy`: 'merge' (padrão, cria o que falta) | 'replace' (limpa antes).
 */
function applyParsed(parsed, options = {}) {
  // Uma transação só para o import inteiro: ver o comentário em repo.tx().
  return repo.tx(() => applyParsedInner(parsed, options));
}

function applyParsedInner(parsed, { strategy = 'merge', targetFolderId = null } = {}) {
  const created = { folders: 0, sessions: 0, skipped: 0 };
  const pathToId = new Map();

  if (strategy === 'replace') {
    for (const s of repo.sessions.list()) repo.sessions.remove(s.id);
    for (const f of repo.folders.list().filter((f) => !f.parent_id)) {
      repo.folders.remove(f.id, { deleteSessions: true });
    }
  }

  const existingFolders = repo.folders.list();
  // Separador NUL: nenhum nome de pasta/sessão pode conte-lo, então a chave
  // composta nunca colide (ao contrário de um espaço ou barra).
  const folderKey = (parentId, name) => `${parentId || ''}\u0000${name.toLowerCase()}`;
  const existingByKey = new Map(existingFolders.map((f) => [folderKey(f.parent_id, f.name), f]));

  // Cria as pastas em ordem de profundidade para o pai sempre existir antes.
  const ordered = [...(parsed.folders || [])].sort(
    (a, b) => a.path.split('/').length - b.path.split('/').length
  );
  for (const f of ordered) {
    const parentId = f.parentPath ? (pathToId.get(f.parentPath) ?? targetFolderId) : targetFolderId;
    const key = folderKey(parentId, f.name);
    const hit = existingByKey.get(key);
    if (hit) {
      pathToId.set(f.path, hit.id);
      continue;
    }
    const createdFolder = repo.folders.create({ name: f.name, parentId });
    existingByKey.set(key, createdFolder);
    pathToId.set(f.path, createdFolder.id);
    created.folders++;
  }

  const existingSessions = repo.sessions.list();
  const sessionKey = (folderId, name) => `${folderId || ''}\u0000${name.toLowerCase()}`;
  const existingSessionKeys = new Set(existingSessions.map((s) => sessionKey(s.folder_id, s.name)));

  for (const s of parsed.sessions || []) {
    const folderId = s.folderPath ? (pathToId.get(s.folderPath) ?? targetFolderId) : targetFolderId;
    if (existingSessionKeys.has(sessionKey(folderId, s.name))) {
      created.skipped++;
      continue;
    }
    repo.sessions.create({
      folderId, name: s.name, type: s.type, config: s.config,
      icon: s.icon || null, tags: s.tags || [], notes: s.notes || ''
    });
    existingSessionKeys.add(sessionKey(folderId, s.name));
    created.sessions++;
  }

  return created;
}

/** Import do formato nativo (preserva ids, temas, identidades e segredos). */
function importNative(payload, options = {}) {
  return repo.tx(() => importNativeInner(payload, options));
}

function importNativeInner(payload, { strategy = 'merge', passphrase = null } = {}) {
  if (payload.format !== FORMAT) throw new Error('Arquivo não é um export do TSM.');
  if (payload.version > VERSION) {
    throw new Error(`Arquivo gerado por uma versão mais nova do TSM (v${payload.version}).`);
  }

  const stats = { folders: 0, sessions: 0, identities: 0, themes: 0, secrets: 0, skipped: 0 };

  if (strategy === 'replace') {
    for (const s of repo.sessions.list()) repo.sessions.remove(s.id);
    for (const f of repo.folders.list().filter((f) => !f.parent_id)) {
      repo.folders.remove(f.id, { deleteSessions: true });
    }
  }

  for (const i of payload.identities || []) {
    if (!repo.identities.find(i.id)) { repo.identities.create(i); stats.identities++; }
  }
  for (const t of payload.themes || []) {
    repo.themes.upsert({ id: t.id, name: t.name, data: t.data }); stats.themes++;
  }

  const ordered = [...(payload.folders || [])].sort((a, b) => depthOf(a, payload.folders) - depthOf(b, payload.folders));
  for (const f of ordered) {
    if (repo.folders.find(f.id)) continue;
    repo.folders.create({
      id: f.id, name: f.name, parentId: f.parentId,
      sortOrder: f.sortOrder, color: f.color, icon: f.icon
    });
    stats.folders++;
  }

  for (const s of payload.sessions || []) {
    if (repo.sessions.find(s.id)) { stats.skipped++; continue; }
    repo.sessions.create({
      id: s.id, folderId: s.folderId, name: s.name, type: s.type,
      sortOrder: s.sortOrder, config: s.config, themeId: s.themeId,
      color: s.color, icon: s.icon, tags: s.tags, notes: s.notes, identityId: s.identityId
    });
    stats.sessions++;
  }

  if (payload.settings) {
    const clean = { ...payload.settings };
    delete clean['vault.master.salt'];
    delete clean['vault.master.verifier'];
    repo.settings.merge(clean);
  }

  if (payload.encrypted && payload.secrets) {
    if (!passphrase) throw new Error('Este arquivo tem credenciais cifradas: informe a senha de proteção.');
    let bag;
    try {
      bag = JSON.parse(vault.openExport(payload.secrets, passphrase));
    } catch {
      throw new Error('Senha de proteção incorreta ou arquivo corrompido.');
    }
    for (const item of bag) {
      vault.write(item.ownerKind, item.ownerId, item.field, item.value);
      stats.secrets++;
    }
  }

  return stats;
}

function depthOf(folder, all) {
  let d = 0;
  let cur = folder;
  const byId = new Map(all.map((f) => [f.id, f]));
  while (cur && cur.parentId && byId.has(cur.parentId)) {
    d++;
    cur = byId.get(cur.parentId);
    if (d > 64) break;
  }
  return d;
}

/** Detecta o formato pelo conteúdo e importa. */
function importFromFile(filePath, options = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);

  if (ext === '.json' || ext === '.tsm') {
    const payload = JSON.parse(buffer.toString('utf8'));
    if (payload.format === FORMAT) {
      return { source: 'tsm', stats: importNative(payload, options), warnings: [] };
    }
    throw new Error('JSON não reconhecido como export do TSM.');
  }

  if (ext === '.reg') {
    const parsed = putty.parseRegistryExport(buffer);
    return { source: 'putty', stats: applyParsed(parsed, options), warnings: parsed.warnings };
  }

  if (ext === '.ini' || ext === '.mxtsessions') {
    const parsed = moba.parse(buffer);
    const stats = applyParsed(parsed, options);
    if (parsed.theme && options.importTheme !== false) {
      repo.themes.upsert({ name: `Importado do MobaXterm`, data: parsed.theme });
    }
    return { source: 'mobaxterm', stats, warnings: parsed.warnings, detected: parsed.stats };
  }

  throw new Error(`Extensão não suportada: ${ext}`);
}

/** Prévia sem gravar nada — a UI mostra antes de confirmar. */
function previewFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);

  if (ext === '.ini' || ext === '.mxtsessions') {
    const p = moba.parse(buffer);
    return { source: 'mobaxterm', folders: p.folders, sessions: p.sessions, warnings: p.warnings, detected: p.stats, hasTheme: !!p.theme };
  }
  if (ext === '.reg') {
    const p = putty.parseRegistryExport(buffer);
    return { source: 'putty', folders: p.folders, sessions: p.sessions, warnings: p.warnings };
  }
  if (ext === '.json' || ext === '.tsm') {
    const payload = JSON.parse(buffer.toString('utf8'));
    return {
      source: 'tsm',
      folders: payload.folders || [],
      sessions: payload.sessions || [],
      warnings: [],
      encrypted: !!payload.encrypted
    };
  }
  throw new Error(`Extensão não suportada: ${ext}`);
}

module.exports = { buildExport, exportToFile, importFromFile, previewFile, applyParsed, importNative, FORMAT, VERSION };
