'use strict';
/**
 * Ponte segura entre o renderer e o processo principal.
 * `contextIsolation` fica ligado e o renderer não tem Node: tudo passa por aqui,
 * numa superfície explicita. Nenhuma credencial em claro atravessa esta ponte
 * no sentido main -> renderer.
 */
const { contextBridge, ipcRenderer } = require('electron');

/** Desempacota `{ok,data,error}` e lanca do lado do renderer quando falha. */
async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res) throw new Error(`Canal ${channel} não respondeu`);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

/** Assinatura de evento que devolve a função de cancelamento. */
function on(channel, handler) {
  const listener = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('tsm', {
  app: {
    info: () => call('tsm:app:info'),
    openExternal: (url) => call('tsm:app:openExternal', url),
    showItemInFolder: (p) => call('tsm:app:showItemInFolder', p),
    copy: (text) => call('tsm:app:clipboardWrite', text),
    paste: () => call('tsm:app:clipboardRead'),
    confirm: (opts) => call('tsm:app:confirm', opts)
  },

  folders: {
    list: () => call('tsm:folders:list'),
    create: (input) => call('tsm:folders:create', input),
    update: (id, patch) => call('tsm:folders:update', id, patch),
    remove: (id, opts) => call('tsm:folders:remove', id, opts),
    reorder: (items) => call('tsm:folders:reorder', items)
  },

  sessions: {
    list: () => call('tsm:sessions:list'),
    find: (id) => call('tsm:sessions:find', id),
    count: () => call('tsm:sessions:count'),
    recent: (n) => call('tsm:sessions:recent', n),
    search: (term) => call('tsm:sessions:search', term),
    create: (input) => call('tsm:sessions:create', input),
    update: (id, patch) => call('tsm:sessions:update', id, patch),
    duplicate: (id) => call('tsm:sessions:duplicate', id),
    remove: (id) => call('tsm:sessions:remove', id),
    reorder: (items) => call('tsm:sessions:reorder', items)
  },

  identities: {
    list: () => call('tsm:identities:list'),
    create: (input) => call('tsm:identities:create', input),
    update: (id, patch) => call('tsm:identities:update', id, patch),
    remove: (id) => call('tsm:identities:remove', id)
  },

  secrets: {
    set: (ownerKind, ownerId, field, value) => call('tsm:secrets:set', ownerKind, ownerId, field, value),
    has: (ownerKind, ownerId, field) => call('tsm:secrets:has', ownerKind, ownerId, field),
    clear: (ownerKind, ownerId, field) => call('tsm:secrets:clear', ownerKind, ownerId, field)
  },

  vault: {
    status: () => call('tsm:vault:status'),
    unlock: (pass) => call('tsm:vault:unlock', pass),
    lock: () => call('tsm:vault:lock'),
    setMaster: (next, current) => call('tsm:vault:setMaster', next, current)
  },

  settings: {
    all: () => call('tsm:settings:all'),
    get: (key, fallback) => call('tsm:settings:get', key, fallback),
    set: (key, value) => call('tsm:settings:set', key, value),
    merge: (patch) => call('tsm:settings:merge', patch)
  },

  update: {
    check: (opts) => call('tsm:update:check', opts),
    onAvailable: (h) => on('tsm:update:available', h)
  },

  themes: {
    list: () => call('tsm:themes:list'),
    upsert: (theme) => call('tsm:themes:upsert', theme),
    remove: (id) => call('tsm:themes:remove', id),
    resetBuiltins: () => call('tsm:themes:resetBuiltins')
  },

  conn: {
    open: (payload) => call('tsm:conn:open', payload),
    write: (id, data) => call('tsm:conn:write', id, data),
    resize: (id, cols, rows) => call('tsm:conn:resize', id, cols, rows),
    close: (id) => call('tsm:conn:close', id),
    list: () => call('tsm:conn:list'),
    answerPrompt: (id, promptId, value) => call('tsm:conn:answerPrompt', id, promptId, value),
    answerHostKey: (id, accept) => call('tsm:conn:answerHostKey', id, accept),

    startLog: (id, options) => call('tsm:conn:startLog', id, options),
    stopLog: (id) => call('tsm:conn:stopLog', id),
    logStatus: (id) => call('tsm:conn:logStatus', id),

    forwards: (id) => call('tsm:conn:forwards', id),
    addForward: (id, spec) => call('tsm:conn:addForward', id, spec),
    removeForward: (id, forwardId) => call('tsm:conn:removeForward', id, forwardId),

    onData: (h) => on('tsm:conn:data', h),
    onReady: (h) => on('tsm:conn:ready', h),
    onClose: (h) => on('tsm:conn:close', h),
    onError: (h) => on('tsm:conn:error', h),
    onStatus: (h) => on('tsm:conn:status', h),
    onPrompt: (h) => on('tsm:conn:prompt', h),
    onHostKey: (h) => on('tsm:conn:hostkey', h),
    onForwards: (h) => on('tsm:conn:forwards', h)
  },

  snippets: {
    list: () => call('tsm:snippets:list'),
    create: (input) => call('tsm:snippets:create', input),
    update: (id, patch) => call('tsm:snippets:update', id, patch),
    remove: (id) => call('tsm:snippets:remove', id)
  },

  automations: {
    list: () => call('tsm:automations:list'),
    create: (input) => call('tsm:automations:create', input),
    update: (id, patch) => call('tsm:automations:update', id, patch),
    remove: (id) => call('tsm:automations:remove', id)
  },

  automation: {
    run: (connectionId, automationId) => call('tsm:automation:run', connectionId, automationId),
    stop: (runId) => call('tsm:automation:stop', runId),

    onStep: (h) => on('tsm:automation:step', h),
    onTimeout: (h) => on('tsm:automation:timeout', h),
    onDone: (h) => on('tsm:automation:done', h),
    onError: (h) => on('tsm:automation:error', h)
  },

  keys: {
    list: () => call('tsm:keys:list'),
    generate: (options) => call('tsm:keys:generate', options),
    inspect: (filePath, passphrase) => call('tsm:keys:inspect', filePath, passphrase),
    types: () => call('tsm:keys:types')
  },

  sftp: {
    list: (id, dir) => call('tsm:sftp:list', id, dir),
    mkdir: (id, dir) => call('tsm:sftp:mkdir', id, dir),
    rename: (id, from, to) => call('tsm:sftp:rename', id, from, to),
    remove: (id, target, isDir) => call('tsm:sftp:remove', id, target, isDir),
    chmod: (id, target, mode) => call('tsm:sftp:chmod', id, target, mode),
    read: (id, target) => call('tsm:sftp:read', id, target),
    write: (id, target, content) => call('tsm:sftp:write', id, target, content),
    download: (id, items, destDir) => call('tsm:sftp:download', id, items, destDir),
    upload: (id, remoteDir, localPaths) => call('tsm:sftp:upload', id, remoteDir, localPaths),
    onProgress: (h) => on('tsm:sftp:progress', h)
  },

  io: {
    pickImport: () => call('tsm:io:pickImport'),
    preview: (filePath) => call('tsm:io:preview', filePath),
    import: (filePath, options) => call('tsm:io:import', filePath, options),
    export: (options) => call('tsm:io:export', options),
    backupDb: () => call('tsm:io:backupDb'),
    pickFile: (opts) => call('tsm:io:pickFile', opts)
  },

  serial: {
    list: () => call('tsm:serial:list'),
    info: () => call('tsm:serial:info'),
    sendBreak: (id, ms) => call('tsm:serial:break', id, ms)
  },

  system: {
    shells: () => call('tsm:shell:list'),
    knownHosts: () => call('tsm:knownhosts:list'),
    forgetHost: (host, port, keyType) => call('tsm:knownhosts:remove', host, port, keyType),
    log: (n) => call('tsm:log:recent', n),
    clearLog: () => call('tsm:log:clear'),
    logsDir: () => call('tsm:log:defaultDir')
  },

  menu: {
    on: (h) => on('tsm:menu', h)
  }
});
