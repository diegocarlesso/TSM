'use strict';
/**
 * Camada fina sobre o SQLite que expõe a MESMA API para dois motores:
 *
 *  1. `better-sqlite3` — nativo, mais rápido. Usado se estiver compilado.
 *  2. `node-sqlite3-wasm` — SQLite em WebAssembly com I/O de arquivo real.
 *     Não exige node-gyp nem Visual Studio Build Tools, então o app instala
 *     e roda em qualquer máquina.
 *
 * `repo.js` não sabe qual dos dois está ativo: a superfície aqui imita a do
 * better-sqlite3 (`prepare().run/get/all`, `exec`, `pragma`, `transaction`).
 */
const fs = require('node:fs');

let engine = null;      // 'better-sqlite3' | 'node-sqlite3-wasm'
let Impl = null;

function loadEngine() {
  if (Impl) return;
  try {
    Impl = require('better-sqlite3');
    engine = 'better-sqlite3';
    return;
  } catch { /* segue para o WASM */ }
  try {
    Impl = require('node-sqlite3-wasm').Database;
    engine = 'node-sqlite3-wasm';
  } catch (err) {
    throw new Error(
      'Nenhum motor SQLite disponivel. Rode `npm install` novamente. ' +
      `Detalhe: ${err.message}`
    );
  }
}

/** Handle unificado. */
class Db {
  constructor(filePath) {
    loadEngine();
    this.filePath = filePath;
    this.engine = engine;
    this.raw = new Impl(filePath);
    this._cache = new Map();
    this._depth = 0;
  }

  get isWasm() {
    return this.engine === 'node-sqlite3-wasm';
  }

  exec(sql) {
    this.raw.exec(sql);
    return this;
  }

  /**
   * Statement com assinatura varargs, como no better-sqlite3.
   * No modo WASM os statements são caros de criar, então ficam em cache por SQL.
   */
  prepare(sql) {
    if (!this.isWasm) return this.raw.prepare(sql);

    let st = this._cache.get(sql);
    if (!st) {
      st = this.raw.prepare(sql);
      this._cache.set(sql, st);
    }
    const bind = (args) => {
      if (!args.length) return undefined;
      // Um único objeto simples = parâmetros nomeados; o resto é posicional.
      if (args.length === 1 && args[0] && typeof args[0] === 'object'
          && !Array.isArray(args[0]) && !ArrayBuffer.isView(args[0])) {
        return args[0];
      }
      return args.map(normalize);
    };
    return {
      run: (...args) => st.run(bind(args)),
      get: (...args) => st.get(bind(args)),
      all: (...args) => st.all(bind(args)),
      iterate: (...args) => st.iterate(bind(args))
    };
  }

  /** `pragma('user_version', {simple:true})` -> valor; sem `simple` -> linhas. */
  pragma(statement, options = {}) {
    if (!this.isWasm) return this.raw.pragma(statement, options);

    const sql = `PRAGMA ${statement}`;
    if (/=/.test(statement)) {
      // PRAGMA de escrita: alguns devolvem linha, outros não.
      try {
        const row = this.raw.get(sql);
        return options.simple && row ? Object.values(row)[0] : row;
      } catch {
        this.raw.run(sql);
        return undefined;
      }
    }
    const rows = this.raw.all(sql);
    if (options.simple) return rows.length ? Object.values(rows[0])[0] : undefined;
    return rows;
  }

  /**
   * Devolve uma função que roda `fn` dentro de uma transação.
   * Transações aninhadas viram SAVEPOINT, como no better-sqlite3.
   */
  transaction(fn) {
    if (!this.isWasm) return this.raw.transaction(fn);

    return (...args) => {
      const nested = this._depth > 0;
      const name = `tsm_sp_${this._depth}`;
      this.raw.run(nested ? `SAVEPOINT ${name}` : 'BEGIN');
      this._depth++;
      try {
        const result = fn(...args);
        this._depth--;
        this.raw.run(nested ? `RELEASE ${name}` : 'COMMIT');
        return result;
      } catch (err) {
        this._depth--;
        try {
          this.raw.run(nested ? `ROLLBACK TO ${name}` : 'ROLLBACK');
        } catch { /* a transação já pode ter sido desfeita pelo próprio SQLite */ }
        throw err;
      }
    };
  }

  /** Cópia consistente do banco. */
  async backup(destination) {
    if (!this.isWasm) return this.raw.backup(destination);
    // O VFS do WASM não expõe a API de backup online. Como esse modo não usa
    // WAL, um checkpoint (quando suportado) seguido de cópia do arquivo dá uma
    // imagem consistente. O checkpoint é best-effort: em journal `delete` ele
    // não se aplica e o SQLite reclama — copiar continua sendo correto.
    try {
      this.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch { /* sem WAL: nada a fazer */ }
    fs.copyFileSync(this.filePath, destination);
    return { totalPages: 0, remainingPages: 0 };
  }

  close() {
    if (this.isWasm) {
      for (const st of this._cache.values()) {
        try { st.finalize(); } catch { /* já finalizado */ }
      }
      this._cache.clear();
    }
    this.raw.close();
  }
}

/** O WASM aceita Buffer/Uint8Array, mas não booleanos nem undefined. */
function normalize(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (Buffer.isBuffer(v)) return new Uint8Array(v);
  return v;
}

function open(filePath) {
  return new Db(filePath);
}

function activeEngine() {
  loadEngine();
  return engine;
}

module.exports = { open, activeEngine };
