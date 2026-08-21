'use strict';
/**
 * Registro central das conexoes vivas. O renderer nunca toca em sockets:
 * ele fala por id de conexao e recebe eventos `tsm:conn:*`.
 */
const crypto = require('node:crypto');
const { SshConnection } = require('./ssh');
const { TelnetConnection } = require('./telnet');
const { ShellConnection } = require('./shell');
const { SerialConnection } = require('./serial');
const repo = require('../store/repo');
const vault = require('../security/vault');
const logger = require('../logger');

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
    case 'serial':
      return new SerialConnection(config);
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
    name: (session && session.name) || config.host || config.path || config.shellPath || 'Sessao',
    target: conn.target
  };

  const logId = repo.log.open({
    sessionId: meta.sessionId, name: meta.name, type: kind, target: meta.target
  });
  live.set(id, { conn, meta, logId, sender });

  // Transportes sincronos (o shell local) emitem `ready` — e ate dados — antes
  // de `create()` retornar, ou seja, antes de o renderer saber o id da conexao.
  // Esses eventos ficam numa fila e so saem depois da resposta do IPC; sem isso
  // a aba ficava eternamente "conectando" com o terminal ja funcionando.
  let liberado = false;
  const fila = [];
  const enviar = (canal, payload) => {
    if (liberado) emit(sender, canal, payload);
    else fila.push([canal, payload]);
  };

  conn.on('data', (d) => {
    logger.write(id, d);
    enviar('tsm:conn:data', { id, data: d });
  });
  conn.on('forwards', (list) => enviar('tsm:conn:forwards', { id, forwards: list }));
  conn.on('status', (st) => enviar('tsm:conn:status', { id, status: st }));
  conn.on('banner', (b) => enviar('tsm:conn:data', { id, data: b.replace(/\n/g, '\r\n') }));
  conn.on('ready', () => {
    enviar('tsm:conn:ready', { id, meta });
    if (sessionId) repo.sessions.touch(sessionId);
  });
  // `p.id` e o id do prompt, distinto do id da conexao — nao achatar num objeto so.
  conn.on('prompt', (p) => enviar('tsm:conn:prompt', { id, prompt: p }));
  conn.on('hostkey', (h) => enviar('tsm:conn:hostkey', { id, ...h }));
  conn.on('error', (err) => {
    repo.log.close(logId, 'error', err.message);
    enviar('tsm:conn:error', { id, message: err.message });
  });
  conn.on('close', (code) => {
    repo.log.close(logId, 'closed');
    logger.stop(id);
    live.delete(id);
    enviar('tsm:conn:close', { id, code });
  });

  // Gravacao automatica quando a sessao pede.
  if (config.logging && config.logging.enabled) {
    try {
      logger.start(id, {
        template: config.logging.template,
        append: config.logging.append,
        stripAnsi: config.logging.stripAnsi,
        timestamp: config.logging.timestamp,
        meta: { name: meta.name, host: config.host, username: config.username, type: kind }
      });
    } catch (err) {
      enviar('tsm:conn:error', { id, message: `Log da sessao: ${err.message}` });
    }
  }

  try {
    await conn.connect();
  } catch (err) {
    repo.log.close(logId, 'error', err.message);
    live.delete(id);
    throw err;
  }

  // `setImmediate` e um macrotask: roda depois de a resposta do IPC ter sido
  // enviada, entao o renderer ja associou o id ao painel quando a fila esvazia.
  setImmediate(() => {
    liberado = true;
    for (const [canal, payload] of fila) emit(sender, canal, payload);
    fila.length = 0;
  });

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
  logger.stopAll();
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

// ------------------------------------------------------ log de sessao -----
function startLog(id, options) {
  const entry = live.get(id);
  if (!entry) throw new Error('Conexao nao esta ativa');
  const cfg = entry.conn.config || {};
  return logger.start(id, {
    ...options,
    meta: {
      name: entry.meta.name, host: cfg.host, username: cfg.username, type: entry.meta.type
    }
  });
}

const stopLog = (id) => logger.stop(id);
const logStatus = (id) => logger.status(id);

// ---------------------------------------------------------- tuneis --------
function forwardsOf(id) {
  const c = at(id);
  return c && typeof c.listForwards === 'function' ? c.listForwards() : [];
}

function addForward(id, spec) {
  const c = at(id);
  if (!c || typeof c.addForward !== 'function') throw new Error('Esta conexao nao suporta tuneis');
  c.addForward(spec);
  return c.listForwards();
}

function removeForward(id, forwardId) {
  const c = at(id);
  if (!c || typeof c.removeForward !== 'function') return [];
  c.removeForward(forwardId);
  return c.listForwards();
}

/** Acesso generico a conexao viva, para recursos especificos de um transporte. */
const connectionFor = (id) => at(id);

module.exports = {
  create, write, resize, close, answerPrompt, answerHostKey, list, closeAll, connectionFor,
  sshConnectionFor, resolveConfig, resolveSecrets,
  startLog, stopLog, logStatus, forwardsOf, addForward, removeForward
};
