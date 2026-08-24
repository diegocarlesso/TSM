'use strict';
const path = require('node:path');
const fs = require('node:fs');

let db = null;
let dbPath = null;

/**
 * Abre (ou cria) o banco de sessões em `<pasta de dados>/tsm.db`.
 * Quem decide a pasta é `paths.js`: por padrão `data/` ao lado do executável
 * (modo portátil), com o perfil do usuário como reserva.
 */
function open() {
  if (db) return db;

  const sqlite = require('./sqlite');
  const paths = require('../paths');

  const dir = paths.dataDir();
  fs.mkdirSync(dir, { recursive: true });
  dbPath = path.join(dir, 'tsm.db');

  db = sqlite.open(dbPath);
  // WAL só existe no motor nativo; o VFS do WASM ignora e segue em `delete`.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  migrate(db);
  return db;
}

function engine() {
  return db ? db.engine : require('./sqlite').activeEngine();
}

function get() {
  if (!db) return open();
  return db;
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

function getPath() {
  return dbPath;
}

/** Backup consistente do banco (usa a API online-backup do SQLite). */
async function backupTo(target) {
  await get().backup(target);
  return target;
}

const MIGRATIONS = [
  // ---- v1: esquema base -------------------------------------------------
  (d) => {
    d.exec(`
      CREATE TABLE folders (
        id          TEXT PRIMARY KEY,
        parent_id   TEXT REFERENCES folders(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        color       TEXT,
        icon        TEXT,
        expanded    INTEGER NOT NULL DEFAULT 1,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX idx_folders_parent ON folders(parent_id, sort_order);

      CREATE TABLE sessions (
        id           TEXT PRIMARY KEY,
        folder_id    TEXT REFERENCES folders(id) ON DELETE SET NULL,
        name         TEXT NOT NULL,
        type         TEXT NOT NULL CHECK (type IN ('ssh','telnet','shell','sftp','serial')),
        sort_order   INTEGER NOT NULL DEFAULT 0,
        config       TEXT NOT NULL DEFAULT '{}',
        theme_id     TEXT,
        color        TEXT,
        icon         TEXT,
        tags         TEXT NOT NULL DEFAULT '',
        notes        TEXT NOT NULL DEFAULT '',
        identity_id  TEXT REFERENCES identities(id) ON DELETE SET NULL,
        use_count    INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      );
      CREATE INDEX idx_sessions_folder ON sessions(folder_id, sort_order);
      CREATE INDEX idx_sessions_name   ON sessions(name);
      CREATE INDEX idx_sessions_recent ON sessions(last_used_at DESC);

      -- credenciais reutilizáveis, no estilo "credentials" do MobaXterm
      CREATE TABLE identities (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        username    TEXT NOT NULL DEFAULT '',
        auth_type   TEXT NOT NULL DEFAULT 'password',
        key_path    TEXT NOT NULL DEFAULT '',
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      -- segredos cifrados; a chave nunca fica em claro no banco
      CREATE TABLE secrets (
        owner_kind  TEXT NOT NULL,           -- 'session' | 'identity'
        owner_id    TEXT NOT NULL,
        field       TEXT NOT NULL,           -- 'password' | 'passphrase' | 'proxy_password'
        ciphertext  BLOB NOT NULL,
        scheme      TEXT NOT NULL,           -- 'safeStorage' | 'aes-256-gcm'
        updated_at  INTEGER NOT NULL,
        PRIMARY KEY (owner_kind, owner_id, field)
      );

      CREATE TABLE settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE themes (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        builtin    INTEGER NOT NULL DEFAULT 0,
        data       TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE known_hosts (
        host       TEXT NOT NULL,
        port       INTEGER NOT NULL,
        key_type   TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        first_seen INTEGER NOT NULL,
        PRIMARY KEY (host, port, key_type)
      );

      CREATE TABLE connection_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        name       TEXT NOT NULL,
        type       TEXT NOT NULL,
        target     TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at   INTEGER,
        status     TEXT NOT NULL DEFAULT 'open',
        error      TEXT
      );
      CREATE INDEX idx_log_started ON connection_log(started_at DESC);
    `);
  },

  // ---- v2: biblioteca de comandos e estado da área de trabalho ----------
  (d) => {
    d.exec(`
      CREATE TABLE snippets (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        content    TEXT NOT NULL,
        category   TEXT NOT NULL DEFAULT '',
        shortcut   TEXT NOT NULL DEFAULT '',
        run        INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_snippets_cat ON snippets(category, sort_order);
    `);
  },

  // ---- v3: roteiros de automação (expect/send) --------------------------
  (d) => {
    d.exec(`
      CREATE TABLE automations (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        category   TEXT NOT NULL DEFAULT '',
        steps      TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_automations_cat ON automations(category, sort_order);
    `);
  }
];

function migrate(d) {
  const current = d.pragma('user_version', { simple: true });
  for (let v = current; v < MIGRATIONS.length; v++) {
    const step = MIGRATIONS[v];
    d.transaction(() => {
      step(d);
      d.pragma(`user_version = ${v + 1}`);
    })();
  }
}

module.exports = { open, get, close, getPath, backupTo, engine };
