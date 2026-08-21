'use strict';
/**
 * Onde o TSM guarda os dados.
 *
 * O app é PORTÁTIL: por padrão o banco, os logs e as chaves ficam numa pasta
 * `data/` ao lado do executável, então copiar a pasta (ou o pendrive) leva
 * tudo junto. So caímos no perfil do usuário quando a pasta do executável e
 * somente leitura — instalação em `Program Files`, `.app` dentro de `/Applications`,
 * AppImage montado em um sistema de arquivos read-only.
 *
 * Ordem de resolução:
 *   1. `TSM_DATA_DIR` — controle explicito do usuário;
 *   2. `PORTABLE_EXECUTABLE_DIR` — definida pelo .exe portátil (que roda a partir
 *      de um diretório temporário, então `process.execPath` não serve);
 *   3. `<pasta do executável>/data`, se der para escrever;
 *   4. `userData` do sistema.
 */
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

let cached = null;

/** Pasta que o usuário enxerga como "onde o programa esta". */
function appDir() {
  // O .exe portátil se auto-extrai num temp; esta variável aponta o lugar real.
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;

  if (!app.isPackaged) {
    // Em desenvolvimento `process.execPath` é o electron de node_modules.
    return path.resolve(__dirname, '../..');
  }

  const exeDir = path.dirname(process.execPath);
  if (process.platform === 'darwin') {
    // .../TSM.app/Contents/MacOS/TSM -> pasta que CONTEM o .app
    const idx = exeDir.lastIndexOf(`${path.sep}Contents${path.sep}MacOS`);
    if (idx !== -1) return path.dirname(exeDir.slice(0, idx));
  }
  return exeDir;
}

function isWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.tsm-write-test-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function dataDir() {
  if (cached) return cached;

  const candidates = [];
  if (process.env.TSM_DATA_DIR) candidates.push(path.resolve(process.env.TSM_DATA_DIR));
  candidates.push(path.join(appDir(), 'data'));

  for (const dir of candidates) {
    if (isWritable(dir)) {
      cached = dir;
      return cached;
    }
  }

  cached = app.getPath('userData');
  fs.mkdirSync(cached, { recursive: true });
  return cached;
}

/** True quando os dados estão mesmo ao lado do executável. */
function isPortable() {
  return dataDir().startsWith(appDir());
}

const logsDir = () => path.join(dataDir(), 'logs');
const keysDir = () => path.join(dataDir(), 'keys');

module.exports = { dataDir, appDir, logsDir, keysDir, isPortable };
