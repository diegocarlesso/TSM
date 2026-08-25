/**
 * Semeia uma credencial (identidade) com usuário, para testar o preenchimento
 * automático do editor de sessão ao escolher "Credencial salva".
 *
 *   TSM_DATA_DIR=/tmp/ident node scripts/seed-identity.js
 *
 * Não grava senha aqui de propósito: fora do Electron de verdade não há
 * `safeStorage` real, e cifrar com um duplo de teste geraria um envelope que
 * o app (com o safeStorage de verdade) não conseguiria decifrar depois. Quem
 * precisa de uma senha na credencial grava pelo `window.tsm.secrets.set`
 * de dentro do próprio roteiro de teste, já rodando no Electron real.
 */
'use strict';
const Module = require('node:module');

const stub = {
  app: {
    getPath: () => process.env.TSM_DATA_DIR,
    getVersion: () => '1.1.0',
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
  repo.settings.set('connection.confirmClose', false);

  const ident = repo.identities.create({ id: 'ident-teste', name: 'prod-bastion', username: 'deploy' });
  const pasta = repo.folders.create({ name: 'Teste credencial' });
  repo.sessions.create({
    name: 'servidor sem usuário',
    type: 'ssh',
    folderId: pasta.id,
    config: { host: '10.0.0.9', port: 22 }
  });
  console.log(`identidade: ${ident.id} (${ident.username})`);
});

console.log(`semeado em ${db.getPath()}`);
db.close();
