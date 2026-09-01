/**
 * Semeia um resultado de checagem de atualização já em cache, pra ver o
 * diálogo automático sem depender de rede nem esperar os 3s + o `did-finish-load`.
 *
 *   TSM_DATA_DIR=/tmp/upd node scripts/seed-fake-update.js
 */
'use strict';
const Module = require('node:module');

const stub = {
  app: {
    getPath: () => process.env.TSM_DATA_DIR,
    getVersion: () => '1.6.3',
    getName: () => 'TSM',
    isPackaged: false
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => b.toString()
  },
  ipcMain: { handle: () => {} }
};
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return stub;
  return origLoad.apply(this, arguments);
};

if (!process.env.TSM_DATA_DIR) {
  console.error('defina TSM_DATA_DIR');
  process.exit(1);
}

const db = require('../src/main/store/db');
const repo = require('../src/main/store/repo');
const { BUILTIN_THEMES, DEFAULT_SETTINGS } = require('../src/shared/themes');

db.open();
repo.tx(() => {
  for (const t of BUILTIN_THEMES) if (!repo.themes.find(t.id)) repo.themes.upsert({ ...t, builtin: true });
  const atual = repo.settings.all();
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (atual[k] === undefined) repo.settings.set(k, v);
  }
  repo.settings.set('update.lastCheckAt', Date.now());
  repo.settings.set('update.lastResult', {
    latest: 'v99.0.0',
    url: 'https://github.com/diegocarlesso/TSM/releases/tag/v99.0.0',
    checkedAt: Date.now()
  });
});

console.log(`semeado em ${db.getPath()}`);
db.close();
