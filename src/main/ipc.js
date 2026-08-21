'use strict';
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { ipcMain, dialog, shell, app, clipboard, BrowserWindow } = require('electron');

const repo = require('./store/repo');
const db = require('./store/db');
const vault = require('./security/vault');
const manager = require('./transports/manager');
const sftp = require('./sftp');
const portability = require('./portability');
const shellTransport = require('./transports/shell');
const keygen = require('./keygen');
const paths = require('./paths');
const { BUILTIN_THEMES, UI_THEMES } = require('../shared/themes');

/** Envolve o handler para que erros virem `{ok:false,error}` em vez de rejeicao crua. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return { ok: true, data: await fn(event, ...args) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
}

function windowOf(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

function register() {
  // ------------------------------------------------------------- app ------
  handle('tsm:app:info', () => ({
    version: app.getVersion(),
    name: app.getName(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
    dbPath: db.getPath(),
    dataDir: paths.dataDir(),
    portable: paths.isPortable(),
    sqliteEngine: db.engine(),
    homedir: os.homedir(),
    hasPty: shellTransport.hasPty()
  }));

  handle('tsm:app:openExternal', (_e, url) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('URL nao permitida');
    return shell.openExternal(url);
  });

  handle('tsm:app:showItemInFolder', (_e, p) => shell.showItemInFolder(p));
  handle('tsm:app:clipboardWrite', (_e, text) => clipboard.writeText(text));
  handle('tsm:app:clipboardRead', () => clipboard.readText());

  // --------------------------------------------------------- estrutura ----
  handle('tsm:folders:list', () => repo.folders.list());
  handle('tsm:folders:create', (_e, input) => repo.folders.create(input));
  handle('tsm:folders:update', (_e, id, patch) => repo.folders.update(id, patch));
  handle('tsm:folders:remove', (_e, id, opts) => repo.folders.remove(id, opts));
  handle('tsm:folders:reorder', (_e, items) => repo.folders.reorder(items));

  handle('tsm:sessions:list', () => repo.sessions.list());
  handle('tsm:sessions:find', (_e, id) => repo.sessions.find(id));
  handle('tsm:sessions:count', () => repo.sessions.count());
  handle('tsm:sessions:recent', (_e, n) => repo.sessions.recent(n));
  handle('tsm:sessions:search', (_e, term) => repo.sessions.search(term));
  handle('tsm:sessions:create', (_e, input) => repo.sessions.create(input));
  handle('tsm:sessions:update', (_e, id, patch) => repo.sessions.update(id, patch));
  handle('tsm:sessions:duplicate', (_e, id) => repo.sessions.duplicate(id));
  handle('tsm:sessions:remove', (_e, id) => repo.sessions.remove(id));
  handle('tsm:sessions:reorder', (_e, items) => repo.sessions.reorder(items));

  handle('tsm:identities:list', () => repo.identities.list());
  handle('tsm:identities:create', (_e, input) => repo.identities.create(input));
  handle('tsm:identities:update', (_e, id, patch) => repo.identities.update(id, patch));
  handle('tsm:identities:remove', (_e, id) => repo.identities.remove(id));

  // ------------------------------------------------------------ cofre -----
  // O renderer NUNCA recebe um segredo em claro; so escreve e pergunta se existe.
  handle('tsm:secrets:set', (_e, ownerKind, ownerId, field, value) => {
    vault.write(ownerKind, ownerId, field, value);
    return true;
  });
  handle('tsm:secrets:has', (_e, ownerKind, ownerId, field) => vault.has(ownerKind, ownerId, field));
  handle('tsm:secrets:clear', (_e, ownerKind, ownerId, field) => {
    vault.clear(ownerKind, ownerId, field);
    return true;
  });

  handle('tsm:vault:status', () => ({
    scheme: vault.scheme(),
    masterEnabled: vault.isMasterEnabled(),
    unlocked: vault.isUnlocked()
  }));
  handle('tsm:vault:unlock', (_e, passphrase) => vault.unlock(passphrase));
  handle('tsm:vault:lock', () => { vault.lock(); return true; });
  handle('tsm:vault:setMaster', (_e, next, current) => {
    vault.setMasterPassword(next || null, current || null);
    return { scheme: vault.scheme(), masterEnabled: vault.isMasterEnabled() };
  });

  // ------------------------------------------------------ preferencias ----
  handle('tsm:settings:all', () => repo.settings.all());
  handle('tsm:settings:get', (_e, key, fallback) => repo.settings.get(key, fallback));
  handle('tsm:settings:set', (_e, key, value) => repo.settings.set(key, value));
  handle('tsm:settings:merge', (_e, patch) => repo.settings.merge(patch));

  handle('tsm:themes:list', () => ({ terminal: repo.themes.list(), ui: UI_THEMES }));
  handle('tsm:themes:upsert', (_e, theme) => repo.themes.upsert(theme));
  handle('tsm:themes:remove', (_e, id) => { repo.themes.remove(id); return true; });
  handle('tsm:themes:resetBuiltins', () => {
    for (const t of BUILTIN_THEMES) repo.themes.upsert({ ...t, builtin: true });
    return repo.themes.list();
  });

  // -------------------------------------------------------- conexoes ------
  handle('tsm:conn:open', (event, payload) => manager.create(event.sender, payload));
  handle('tsm:conn:write', (_e, id, data) => { manager.write(id, data); return true; });
  handle('tsm:conn:resize', (_e, id, cols, rows) => { manager.resize(id, cols, rows); return true; });
  handle('tsm:conn:close', (_e, id) => { sftp.release(id); manager.close(id); return true; });
  handle('tsm:conn:list', () => manager.list());
  handle('tsm:conn:answerPrompt', (_e, id, promptId, value) => {
    manager.answerPrompt(id, promptId, value);
    return true;
  });
  handle('tsm:conn:answerHostKey', (_e, id, accept) => {
    manager.answerHostKey(id, accept);
    return true;
  });

  // ------------------------------------------------- log de sessao -------
  handle('tsm:conn:startLog', (_e, id, options) => manager.startLog(id, options || {}));
  handle('tsm:conn:stopLog', (_e, id) => manager.stopLog(id));
  handle('tsm:conn:logStatus', (_e, id) => manager.logStatus(id));
  handle('tsm:log:defaultDir', () => require('./logger').defaultDir());

  // ------------------------------------------------------- tuneis --------
  handle('tsm:conn:forwards', (_e, id) => manager.forwardsOf(id));
  handle('tsm:conn:addForward', (_e, id, spec) => manager.addForward(id, spec));
  handle('tsm:conn:removeForward', (_e, id, forwardId) => manager.removeForward(id, forwardId));

  // ---------------------------------------------- biblioteca de comandos --
  handle('tsm:snippets:list', () => repo.snippets.list());
  handle('tsm:snippets:create', (_e, input) => repo.snippets.create(input));
  handle('tsm:snippets:update', (_e, id, patch) => repo.snippets.update(id, patch));
  handle('tsm:snippets:remove', (_e, id) => { repo.snippets.remove(id); return true; });

  // -------------------------------------------------------- chaves SSH ---
  handle('tsm:keys:list', () => keygen.list());
  handle('tsm:keys:generate', (_e, options) => {
    const pair = keygen.generate(options);
    // A chave privada NAO volta para o renderer; so o que da para mostrar.
    const saved = keygen.save(pair, { dir: options.dir, name: options.name });
    return {
      ...saved,
      type: pair.type, bits: pair.bits, comment: pair.comment,
      publicKey: pair.publicKey, fingerprint: pair.fingerprint, encrypted: pair.encrypted
    };
  });
  handle('tsm:keys:inspect', (_e, filePath, passphrase) => keygen.inspect(filePath, passphrase));
  handle('tsm:keys:types', () => keygen.TYPES);

  handle('tsm:shell:list', () => shellTransport.detectShells());
  handle('tsm:knownhosts:list', () => repo.knownHosts.list());
  handle('tsm:knownhosts:remove', (_e, host, port, keyType) => {
    repo.knownHosts.remove(host, port, keyType);
    return true;
  });
  handle('tsm:log:recent', (_e, n) => repo.log.recent(n));
  handle('tsm:log:clear', () => { repo.log.clear(); return true; });

  // ------------------------------------------------------------ SFTP ------
  const progressTo = (event, connectionId, label) => (done, total) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('tsm:sftp:progress', { id: connectionId, label, done, total });
    }
  };

  handle('tsm:sftp:list', (_e, id, dir) => sftp.list(id, dir));
  handle('tsm:sftp:mkdir', (_e, id, dir) => sftp.mkdir(id, dir));
  handle('tsm:sftp:rename', (_e, id, from, to) => sftp.rename(id, from, to));
  handle('tsm:sftp:remove', (_e, id, target, isDir) => sftp.remove(id, target, isDir));
  handle('tsm:sftp:chmod', (_e, id, target, mode) => sftp.chmod(id, target, mode));
  handle('tsm:sftp:read', (_e, id, target) => sftp.readFile(id, target));
  handle('tsm:sftp:write', (_e, id, target, content) => sftp.writeFile(id, target, content));

  handle('tsm:sftp:download', async (event, id, items, destDir) => {
    let dir = destDir;
    if (!dir) {
      const res = await dialog.showOpenDialog(windowOf(event), {
        title: 'Baixar para...',
        properties: ['openDirectory', 'createDirectory']
      });
      if (res.canceled || !res.filePaths.length) return { canceled: true };
      dir = res.filePaths[0];
    }
    const done = [];
    for (const item of items) {
      const local = path.join(dir, item.name);
      if (item.isDirectory) await sftp.downloadDirectory(id, item.path, local, progressTo(event, id, item.name));
      else await sftp.download(id, item.path, local, progressTo(event, id, item.name));
      done.push(local);
    }
    return { canceled: false, files: done, dir };
  });

  handle('tsm:sftp:upload', async (event, id, remoteDir, localPaths) => {
    let paths = localPaths;
    if (!paths || !paths.length) {
      const res = await dialog.showOpenDialog(windowOf(event), {
        title: 'Enviar arquivos',
        properties: ['openFile', 'multiSelections']
      });
      if (res.canceled) return { canceled: true };
      paths = res.filePaths;
    }
    const sent = [];
    for (const lp of paths) {
      const name = path.basename(lp);
      const remote = sftp.posixJoin(remoteDir, name);
      if (fs.statSync(lp).isDirectory()) {
        await sftp.uploadDirectory(id, lp, remote, progressTo(event, id, name));
      } else {
        await sftp.upload(id, lp, remote, progressTo(event, id, name));
      }
      sent.push(remote);
    }
    return { canceled: false, files: sent };
  });

  // ------------------------------------------------- import / export ------
  handle('tsm:io:pickImport', async (event) => {
    const res = await dialog.showOpenDialog(windowOf(event), {
      title: 'Importar sessoes',
      properties: ['openFile'],
      filters: [
        { name: 'Todos os formatos suportados', extensions: ['json', 'tsm', 'ini', 'mxtsessions', 'reg'] },
        { name: 'Export do TSM', extensions: ['json', 'tsm'] },
        { name: 'MobaXterm', extensions: ['ini', 'mxtsessions'] },
        { name: 'PuTTY (registro exportado)', extensions: ['reg'] }
      ]
    });
    return res.canceled ? null : res.filePaths[0];
  });

  handle('tsm:io:preview', (_e, filePath) => portability.previewFile(filePath));
  handle('tsm:io:import', (_e, filePath, options) => portability.importFromFile(filePath, options));

  handle('tsm:io:export', async (event, options) => {
    const res = await dialog.showSaveDialog(windowOf(event), {
      title: 'Exportar sessoes',
      defaultPath: `tsm-sessoes-${new Date().toISOString().slice(0, 10)}.tsm.json`,
      filters: [{ name: 'Export do TSM', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    return { canceled: false, ...portability.exportToFile(res.filePath, options) };
  });

  handle('tsm:io:backupDb', async (event) => {
    const res = await dialog.showSaveDialog(windowOf(event), {
      title: 'Backup do banco',
      defaultPath: `tsm-backup-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: 'SQLite', extensions: ['db'] }]
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    await db.backupTo(res.filePath);
    return { canceled: false, filePath: res.filePath };
  });

  handle('tsm:io:pickFile', async (event, opts = {}) => {
    const res = await dialog.showOpenDialog(windowOf(event), {
      title: opts.title || 'Selecionar arquivo',
      properties: opts.directory ? ['openDirectory'] : ['openFile'],
      filters: opts.filters
    });
    return res.canceled ? null : res.filePaths[0];
  });

  handle('tsm:app:confirm', async (event, opts) => {
    const res = await dialog.showMessageBox(windowOf(event), {
      type: opts.type || 'question',
      title: opts.title || 'Total Session Manager',
      message: opts.message,
      detail: opts.detail,
      buttons: opts.buttons || ['Cancelar', 'Confirmar'],
      defaultId: opts.defaultId ?? 1,
      cancelId: opts.cancelId ?? 0
    });
    return res.response;
  });
}

module.exports = { register };
