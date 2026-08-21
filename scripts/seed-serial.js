/**
 * Semeia uma sessão serial apontando para uma porta REAL da máquina.
 *
 *   TSM_DATA_DIR=/tmp/serial node scripts/seed-serial.js [COM3]
 *
 * Sem argumento, usa a primeira porta que o sistema enumerar.
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
const serial = require('../src/main/transports/serial');
const { BUILTIN_THEMES, DEFAULT_SETTINGS } = require('../src/shared/themes');

(async () => {
  const portas = await serial.listPorts();
  const alvo = process.argv[2] || (portas[0] && portas[0].path);

  if (!alvo) {
    console.error('nenhuma porta serial encontrada nesta máquina');
    process.exit(1);
  }
  console.log(`portas: ${portas.map((p) => p.path).join(', ') || '(nenhuma)'}`);
  console.log(`usando: ${alvo}`);

  db.open();
  repo.tx(() => {
    for (const t of BUILTIN_THEMES) if (!repo.themes.find(t.id)) repo.themes.upsert({ ...t, builtin: true });
    const atual = repo.settings.all();
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      if (atual[k] === undefined) repo.settings.set(k, v);
    }
    // Confirmar o fechamento atrapalharia a captura automatizada.
    repo.settings.set('connection.confirmClose', false);

    const equipamentos = repo.folders.create({ name: 'Equipamentos' });

    repo.sessions.create({
      name: `console ${alvo}`,
      type: 'serial',
      folderId: equipamentos.id,
      tags: ['console'],
      color: '#9ee62c',
      config: {
        path: alvo,
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        newline: 'cr',
        // Sem equipamento do outro lado nada volta; o eco local torna visível
        // o que sai pela porta.
        localEcho: true
      }
    });

    repo.sessions.create({
      name: `${alvo} a 115200`,
      type: 'serial',
      folderId: equipamentos.id,
      config: { path: alvo, baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', newline: 'crlf' }
    });
  });

  console.log(`semeado em ${db.getPath()}: ${repo.sessions.count()} sessões`);
  db.close();
})();
