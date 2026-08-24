/**
 * Semeia uma pasta com muitas sessões de nomes/hosts longos, reproduzindo o
 * formato de uma importação real do MobaXterm (usuário entre colchetes,
 * nomes que começam iguais, IPs). Usado para reproduzir os bugs relatados:
 * barra de rolagem ausente, nome cortado demais e "Editar" não abrindo.
 *
 *   TSM_DATA_DIR=/tmp/telecom node scripts/seed-telecom-repro.js
 */
'use strict';
const Module = require('node:module');

const stub = {
  app: {
    getPath: () => process.env.TSM_DATA_DIR,
    getVersion: () => '1.2.0',
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

const DEVICES = [
  ['172.16.2.30 - ROTD-borda-01', '172.16.2.30', 'UMTELECOM-metro'],
  ['172.16.253.2 - ROTD-borda-02', '172.16.253.2', 'UMTELECOM-metro'],
  ['172.16.254.166 (admin)', '172.16.254.166', 'admin'],
  ['172.16.254.24 - switch-acesso', '172.16.254.24', 'UMTELECOM-metro'],
  ['172.16.254.52 - switch-acesso', '172.16.254.52', 'UMTELECOM-metro'],
  ['172.16.255.123 - RT-HW-PE-N01', '172.16.255.123', 'UMTELECOM-metro'],
  ['172.16.255.182 - RT-HW-PE-N02', '172.16.255.182', 'UMTELECOM-metro'],
  ['172.16.255.226 - RT-HW-PE-N03', '172.16.255.226', 'UMTELECOM-metro'],
  ['172.16.255.93 - RT-HW-PE-N04', '172.16.255.93', 'UMTELECOM-metro'],
  ['177.36.0.3 (admin)', '177.36.0.3', 'admin'],
  ['192.168.6.234 - core', '192.168.6.234', '1telecom'],
  ['libre - proxy', '179.124.138.248', 'metro'],
  ['ROTD-BKB-Central', '172.16.255.252', 'metro'],
  ['RT-HW-PE-N05', '172.16.255.143', 'metro'],
  ['R-172.16.255.133', '172.16.255.133', 'UMTELECOM-metro'],
  ['R-172.16.255.129', '172.16.255.129', 'UMTELECOM-metro'],
  ['R-172.16.255.161', '172.16.255.161', 'UMTELECOM-metro'],
  ['SW-172.16.255.4', '172.16.255.4', 'UMTELECOM-metro'],
  ['SW-172.16.255.116', '172.16.255.116', 'UMTELECOM-metro']
];

db.open();
repo.tx(() => {
  for (const t of BUILTIN_THEMES) if (!repo.themes.find(t.id)) repo.themes.upsert({ ...t, builtin: true });
  const atual = repo.settings.all();
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (atual[k] === undefined) repo.settings.set(k, v);
  }
  repo.settings.set('connection.confirmClose', false);

  const telecom = repo.folders.create({ name: '1TELECOM' });
  // Pastas nascem fechadas por padrão; este seed simula uma pasta que o
  // usuário já abriu, para exercitar rolagem/rótulo com muitas sessões visíveis.
  repo.folders.update(telecom.id, { expanded: true });
  let i = 0;
  // Repete a base ~3x com IPs variados até passar de 50 — o relato original
  // era de 34 sessões numa pasta só, sem barra de rolagem.
  for (let round = 0; round < 3; round++) {
    for (const [name, host, username] of DEVICES) {
      const ipVariante = round === 0 ? host : host.replace(/\.\d+$/, `.${100 + round * 20 + (i % 20)}`);
      repo.sessions.create({
        name: round === 0 ? name : `${name} #${round + 1}`,
        type: 'ssh',
        folderId: telecom.id,
        sortOrder: i++,
        config: { host: ipVariante, port: 22, username, terminalType: 'xterm-256color' }
      });
    }
  }
});

console.log(`semeado em ${db.getPath()}: ${repo.sessions.count()} sessões`);
db.close();
