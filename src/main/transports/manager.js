'use strict';
/**
 * Registro central das conexoes vivas. O renderer nunca toca em sockets:
 * ele fala por id de conexao e recebe eventos `tsm:conn:*`.
 */
const crypto = require('node:crypto');
const { SshConnection } = require('./ssh');
const { TelnetConnection } = require('./telnet');
const { ShellConnection } = require('./shell');
const repo = require('../store/repo');
const vault = require('../security/vault');

const live = new Map();   // id -> { conn, meta, logId }

function emit(sender, channel, payload) {
  if (sender && !sender.isDestroyed()) sender.send(channel, payload);
}

/** Junta config da sessao + overrides do "conectar como" da UI. */
function resolveConfig(session, overrides = {}) {
  return { ...(session ? session.config : {}), ...overrides };
}

/** Le os segredos da sessao e da identidade vinculada (identidade e o fallback). */
function resolveSecrets(session, overrides = {}) {
  const out = {};
  if (session) {
    for (const field of ['password', 'passphrase', 'jumpPassword', 'jumpPassphrase']) {
      if (vault.has('session', session.id, field)) {
        out[field] = vault.read('session', session.id, field);
      }
    }
    if (session.identity_id) {
      for (const field of ['password', 'passphrase']) {
        if (out[field] === undefined && vault.has('identity', session.identity_id, field)) {
          out[field] = vault.read('identity', session.identity_id, field);
        }
      }
    }
  }
  return { ...out, ...overrides };
}

function build(type, config, secrets) {
  switch (type) {
    case 'ssh':
    case 'sftp':
      return new SshConnection(config, secrets);
    case 'telnet':
      return new TelnetConnection(config, secrets);
    case 'shell':
      return new ShellConnection(config, secrets);
    default:
      throw new Error(`Tipo de sessao nao suportado: ${type}`);
  }
}

async function create(sender, { sessionId, type, config: inlineConfig, secrets: inlineSecrets, cols, rows }) {
  const session = sessionId ? repo.sessions.find(sessionId) : null;
  const kind = type || (session && session.type);
  if (!kind) throw new Error('Sessao inexistente');

  const config = { ...resolveConfig(session, inlineConfig), cols, rows };
  const secrets = resolveSecrets(session, inlineSecrets);

  const id = crypto.randomUUID();
  const conn = build(kind, config, secrets);
  const meta = {
    id,
    sessionId: sessionId || null,
    type: kind,
    name: (session && session.name) || config.host || config.shellPath || 'Sessao',
    target: conn.target
  };

  const logId = repo.log.open({
    sessionId: meta.sessionId, name: meta.name, type: kind, target: meta.target
  });
  live.set(id, { conn, meta, logId, sender });

  conn.on('data', (d) => emit(sender, 'tsm:conn:data', { id, data: d }));
  conn.on('status', (s) => emit(sender, 'tsm:conn:status', { id, status: s }));
  conn.on('banner', (b) => emit(sender, 'tsm:conn:data', { id, data: b.replace(/\n/g, '\r\n') }));
  conn.on('ready', () => {
    emit(sender, 'tsm:conn:ready', { id, meta });
    if (sessionId) repo.sessions.touch(sessionId);
  });
  // `p.id` e o id do prompt, distinto do id da conexao — nao achatar num objeto so.
  conn.on('prompt', (p) => emit(sender, 'tsm:conn:prompt', { id, prompt: p }));
  conn.on('hostkey', (h) => emit(sender, 'tsm:conn:hostkey', { id, ...h }));
  conn.on('error', (err) => {
    repo.log.close(logId, 'error', err.message);
    emit(sender, 'tsm:conn:error', { id, message: err.message });
  });
  conn.on('close', (code) => {
    repo.log.close(logId, 'closed');
    live.delete(id);
    emit(sender, 'tsm:conn:close', { id, code });
  });

  try {
    await conn.connect();
  } catch (err) {
    repo.log.close(logId, 'error', err.message);
    live.delete(id);
    throw err;
  }
  return meta;
}

const at = (id) => {
  const entry = live.get(id);
  return entry ? entry.conn : null;
};

function write(id, data) { const c = at(id); if (c) c.write(data); }
function resize(id, cols, rows) { const c = at(id); if (c) c.resize(cols, rows); }
function close(id) { const c = at(id); if (c) c.close(); }
function answerPrompt(id, promptId, value) { const c = at(id); if (c && c.answerPrompt) c.answerPrompt(promptId, value); }
function answerHostKey(id, accept) { const c = at(id); if (c && c.answerHostKey) c.answerHostKey(accept); }
function list() { return [...live.values()].map((e) => e.meta); }

function closeAll() {
  for (const { conn } of live.values()) {
    try { conn.close(); } catch { /* noop */ }
  }
  live.clear();
}

/** Usado pelo painel SFTP para reaproveitar a conexao SSH ja aberta. */
function sshConnectionFor(id) {
  const c = at(id);
  if (!c || typeof c.sftp !== 'function') return null;
  return c;
}

module.exports = {
  create, write, resize, close, answerPrompt, answerHostKey, list, closeAll,
  sshConnectionFor, resolveConfig, resolveSecrets
};
