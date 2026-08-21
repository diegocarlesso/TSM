/**
 * Semeia um banco de demonstracao SEM abrir o Electron.
 *
 *   TSM_DATA_DIR=/tmp/demo node scripts/seed-demo.js
 *
 * Serve para capturas e para experimentar a interface com a arvore cheia.
 */
'use strict';
const Module = require('node:module');

const stub = {
  app: { getPath: () => process.env.TSM_DATA_DIR, getVersion: () => '1.0.0', getName: () => 'TSM', isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },
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

  const prod = repo.folders.create({ name: 'Producao' });
  const bancos = repo.folders.create({ name: 'Bancos', parentId: prod.id });
  const web = repo.folders.create({ name: 'Web', parentId: prod.id });
  const redes = repo.folders.create({ name: 'Rede' });
  const homolog = repo.folders.create({ name: 'Homologacao' });

  const criar = (name, type, config, folderId, tags, color) =>
    repo.sessions.create({ name, type, config, folderId, tags, color });

  criar('web-01', 'ssh', { host: '10.20.0.11', port: 22, username: 'deploy' }, web.id, ['nginx']);
  criar('web-02', 'ssh', { host: '10.20.0.12', port: 22, username: 'deploy' }, web.id, ['nginx']);
  criar('pg-primario', 'ssh', { host: '10.20.1.5', port: 2222, username: 'postgres' }, bancos.id, ['postgres'], '#8ed81c');
  criar('pg-replica', 'ssh', { host: '10.20.1.6', port: 2222, username: 'postgres' }, bancos.id, ['postgres']);
  criar('redis', 'ssh', { host: '10.20.1.9', port: 22, username: 'root' }, bancos.id, ['cache']);
  criar('bastion', 'ssh', { host: 'bastion.exemplo.com', port: 22, username: 'diego' }, null, ['gateway'], '#0090f0');
  criar('switch-core', 'telnet', { host: '192.168.1.1', port: 23, username: 'admin' }, redes.id, ['cisco']);
  criar('olt-01', 'telnet', { host: '192.168.1.20', port: 23, username: 'root' }, redes.id, ['fiberhome']);
  criar('firewall', 'ssh', { host: '192.168.1.254', port: 22, username: 'admin' }, redes.id, ['pfsense']);
  criar('app-homolog', 'ssh', { host: '10.30.0.5', port: 22, username: 'app' }, homolog.id, []);
  criar('Shell local', 'shell', {}, null, []);

  repo.snippets.create({ name: 'Uso de disco', content: 'df -hT', category: 'Diagnostico' });
  repo.snippets.create({ name: 'Top 10 memoria', content: 'ps aux --sort=-%mem | head -11', category: 'Diagnostico' });
  repo.snippets.create({ name: 'Log do nginx', content: 'journalctl -u nginx -n 200 --no-pager', category: 'Web' });
});

console.log(`semeado em ${db.getPath()}: ${repo.sessions.count()} sessoes, ${repo.folders.list().length} pastas`);
db.close();
