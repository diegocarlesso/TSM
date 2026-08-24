/**
 * Roda ISOLADO (processo próprio, cache de módulos limpo) para confirmar que
 * db.open() remove sozinho um diretório `tsm.db.lock` órfão antes de abrir o
 * banco — sem isso, toda escrita falha com SQLITE_BUSY silenciosamente depois
 * de um encerramento sujo (crash, Gerenciador de Tarefas, queda de energia).
 *
 * Chamado por scripts/smoke.js via child_process; não é pra rodar sozinho,
 * mas funciona (`node scripts/check-stale-lock.js`) se precisar depurar.
 */
'use strict';
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tsm-lock-check-'));
process.env.TSM_DATA_DIR = tmp;

const electronStub = {
  app: { getPath: () => tmp, getVersion: () => '1.0.0', getName: () => 'TSM', isPackaged: false },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.concat([Buffer.from('FAKE'), Buffer.from(s, 'utf8')]),
    decryptString: (b) => Buffer.from(b).subarray(4).toString('utf8')
  },
  ipcMain: { handle: () => {} }
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return electronStub;
  return origLoad.call(this, request, ...rest);
};

// Simula um encerramento sujo: o diretório de trava já existe ANTES de o
// banco ser aberto pela primeira vez nesta pasta de dados.
fs.mkdirSync(path.join(tmp, 'tsm.db.lock'));

const db = require('../src/main/store/db');
const repo = require('../src/main/store/repo');

db.open();
if (fs.existsSync(path.join(tmp, 'tsm.db.lock'))) {
  console.error('FALHA: o diretório de trava órfão continuou depois de db.open()');
  process.exit(1);
}

// Não basta abrir sem lançar exceção — SQLITE_BUSY podia ser engolido em
// algum ponto. Uma escrita de verdade prova que a trava não está mais presa.
repo.settings.set('smoke.stale-lock-check', 'ok');
const lido = repo.settings.get('smoke.stale-lock-check', null);
db.close();

if (lido !== 'ok') {
  console.error(`FALHA: escrita depois da limpeza não voltou (lido=${JSON.stringify(lido)})`);
  process.exit(1);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('ok');
process.exit(0);
