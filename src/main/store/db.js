'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

let db = null;
let dbPath = null;

/**
 * Abre (ou cria) o banco de sessoes.
 * O arquivo fica em <userData>/tsm.db, salvo se o usuario apontar outro
 * diretorio via TSM_DATA_DIR (util para instalacao portatil em pendrive).
 */
function open() {
  if (db) return db;

  const Database = require('better-sqlite3');
  const dataDir = process.env.TSM_DATA_DIR
    ? path.resolve(process.env.TSM_DATA_DIR)
    : app.getPath('userData');

  fs.mkdirSync(dataDir, { recursive: true });
  dbPath = path.join(dataDir, 'tsm.db');

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  migrate(db);
  return db;
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

      -- credenciais reutilizaveis, no estilo "credentials" do MobaXterm
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

module.exports = { open, get, close, getPath, backupTo };
