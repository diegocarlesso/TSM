'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { Client } = require('ssh2');
const repo = require('../store/repo');

const DEFAULT_PORT = 22;

function expandHome(p) {
  if (!p) return p;
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

function agentSocket() {
  if (process.platform === 'win32') {
    return process.env.SSH_AUTH_SOCK || 'pageant';
  }
  return process.env.SSH_AUTH_SOCK || null;
}

/**
 * Uma sessao SSH interativa.
 *
 * Eventos: `data`(string), `ready`, `close`(code), `error`(Error),
 *          `banner`(string), `status`(string),
 *          `hostkey`({host,port,keyType,fingerprint,known,changed}) — pedido de confirmacao,
 *          `prompt`({id,kind,message,echo}) — senha/2FA pedidos pelo servidor.
 */
class SshConnection extends EventEmitter {
  constructor(config, secrets) {
    super();
    this.config = config;
    this.secrets = secrets || {};
    this.client = new Client();
    this.stream = null;
    this.jumpClient = null;
    this.closed = false;
    this.pendingPrompts = new Map();
    this.forwards = [];
  }

  get target() {
    const { host, port = DEFAULT_PORT, username } = this.config;
    return `${username ? `${username}@` : ''}${host}:${port}`;
  }

  async connect() {
    const cfg = this.config;
    const sock = cfg.jump && cfg.jump.host ? await this._openJump() : undefined;
    this._wire();
    this.client.connect(this._connectOptions(sock));
  }

  _connectOptions(sock) {
    const cfg = this.config;
    const opts = {
      host: cfg.host,
      port: Number(cfg.port) || DEFAULT_PORT,
      username: cfg.username || os.userInfo().username,
      readyTimeout: Number(cfg.readyTimeout) || 30000,
      keepaliveInterval: cfg.keepalive === false ? 0 : (Number(cfg.keepaliveInterval) || 30000),
      keepaliveCountMax: 5,
      compress: !!cfg.compression,
      tryKeyboard: true,
      sock
    };

    if (cfg.hostKeyAlgorithms) opts.algorithms = { serverHostKey: cfg.hostKeyAlgorithms };
    if (cfg.legacyAlgorithms) {
      // Equipamentos antigos (switches, ILO, ONTs) ainda falam algoritmos legados.
      opts.algorithms = {
        kex: [
          'curve25519-sha256', 'curve25519-sha256@libssh.org',
          'ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521',
          'diffie-hellman-group-exchange-sha256', 'diffie-hellman-group14-sha256',
          'diffie-hellman-group14-sha1', 'diffie-hellman-group1-sha1',
          'diffie-hellman-group-exchange-sha1'
        ],
        cipher: [
          'aes128-gcm@openssh.com', 'aes256-gcm@openssh.com',
          'aes128-ctr', 'aes192-ctr', 'aes256-ctr',
          'aes128-cbc', 'aes192-cbc', 'aes256-cbc', '3des-cbc'
        ],
        serverHostKey: [
          'ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521',
          'rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa', 'ssh-dss'
        ],
        hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1', 'hmac-md5']
      };
    }

    const auth = cfg.authType || 'password';
    if (auth === 'key' || auth === 'key+password') {
      const keyPath = expandHome(cfg.privateKeyPath);
      if (!keyPath || !fs.existsSync(keyPath)) {
        throw new Error(`Chave privada nao encontrada: ${cfg.privateKeyPath}`);
      }
      opts.privateKey = fs.readFileSync(keyPath);
      if (this.secrets.passphrase) opts.passphrase = this.secrets.passphrase;
    }
    if (auth === 'agent') {
      const a = agentSocket();
      if (!a) throw new Error('SSH agent nao disponivel (SSH_AUTH_SOCK nao definido)');
      opts.agent = a;
      opts.agentForward = !!cfg.agentForward;
    }
    if (this.secrets.password && auth !== 'agent') {
      opts.password = this.secrets.password;
    }

    opts.hostVerifier = (key, callback) => this._verifyHostKey(key, callback);
    return opts;
  }

  _verifyHostKey(key, callback) {
    const fingerprint = 'SHA256:' + crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
    const host = this.config.host;
    const port = Number(this.config.port) || DEFAULT_PORT;
    const keyType = 'ssh-host';
    const known = repo.knownHosts.find(host, port, keyType);

    if (!known) {
      this.emit('hostkey', { host, port, keyType, fingerprint, known: false, changed: false });
      this.once('hostkey:answer', (accept) => {
        if (accept) repo.knownHosts.save(host, port, keyType, fingerprint);
        callback(!!accept);
      });
      return;
    }
    if (known.fingerprint !== fingerprint) {
      this.emit('hostkey', {
        host, port, keyType, fingerprint, known: true, changed: true, previous: known.fingerprint
      });
      this.once('hostkey:answer', (accept) => {
        if (accept) repo.knownHosts.save(host, port, keyType, fingerprint);
        callback(!!accept);
      });
      return;
    }
    callback(true);
  }

  _wire() {
    const c = this.client;

    c.on('banner', (msg) => this.emit('banner', msg));

    c.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
      // Muitos servidores usam kbd-interactive para a propria senha; se ja temos,
      // respondemos direto e so incomodamos o usuario em 2FA/OTP.
      const answers = [];
      const ask = [];
      prompts.forEach((p, i) => {
        const isPassword = /password|senha|contrase/i.test(p.prompt) && !p.echo;
        if (isPassword && this.secrets.password) {
          answers[i] = this.secrets.password;
        } else {
          ask.push({ index: i, prompt: p.prompt, echo: p.echo });
        }
      });
      if (!ask.length) return finish(answers);

      let remaining = ask.length;
      for (const item of ask) {
        const id = `${Date.now()}-${item.index}`;
        this.pendingPrompts.set(id, (value) => {
          answers[item.index] = value ?? '';
          if (--remaining === 0) finish(answers);
        });
        this.emit('prompt', {
          id, kind: 'keyboard-interactive',
          message: item.prompt || name || 'Autenticacao',
          echo: !!item.echo
        });
      }
    });

    c.on('ready', () => {
      this.emit('status', 'autenticado');
      if (this.config.noShell) {
        // Sessao so de arquivos (tipo `sftp`): nao gastamos um canal de shell.
        this.emit('ready');
        this._applyForwards();
        return;
      }
      this._openShell();
    });

    c.on('error', (err) => {
      this.emit('error', err);
    });

    c.on('close', () => {
      if (!this.closed) {
        this.closed = true;
        this.emit('close', 0);
      }
      this._teardownJump();
    });
  }

  _openShell() {
    const cfg = this.config;
    const ptyOpts = {
      term: cfg.terminalType || 'xterm-256color',
      cols: cfg.cols || 120,
      rows: cfg.rows || 30
    };
    const shellOpts = {};
    if (cfg.x11Forward) shellOpts.x11 = true;
    if (cfg.env && typeof cfg.env === 'object') shellOpts.env = cfg.env;

    this.client.shell(ptyOpts, shellOpts, (err, stream) => {
      if (err) return this.emit('error', err);
      this.stream = stream;
      stream.setEncoding('utf8');
      stream.on('data', (d) => this.emit('data', d));
      stream.stderr.on('data', (d) => this.emit('data', d.toString('utf8')));
      stream.on('close', (code) => {
        if (!this.closed) {
          this.closed = true;
          this.emit('close', code ?? 0);
        }
        this.client.end();
      });

      this.emit('ready');
      this._applyForwards();

      if (cfg.initialCommand) {
        const delay = Number(cfg.initialCommandDelay) || 300;
        setTimeout(() => {
          if (this.stream) this.stream.write(`${cfg.initialCommand}\n`);
        }, delay);
      }
    });
  }

  // ------------------------------------------------------- jump / gateway --
  _openJump() {
    return new Promise((resolve, reject) => {
      const j = this.config.jump;
      const jc = new Client();
      this.jumpClient = jc;
      this.emit('status', `conectando ao gateway ${j.host}`);

      jc.on('ready', () => {
        jc.forwardOut('127.0.0.1', 0, this.config.host, Number(this.config.port) || DEFAULT_PORT,
          (err, stream) => (err ? reject(err) : resolve(stream)));
      });
      jc.on('error', (err) => reject(new Error(`Gateway SSH: ${err.message}`)));

      const opts = {
        host: j.host,
        port: Number(j.port) || DEFAULT_PORT,
        username: j.username,
        readyTimeout: 20000,
        tryKeyboard: false
      };
      if (this.secrets.jumpPassword) opts.password = this.secrets.jumpPassword;
      if (j.privateKeyPath) {
        const kp = expandHome(j.privateKeyPath);
        if (fs.existsSync(kp)) opts.privateKey = fs.readFileSync(kp);
        if (this.secrets.jumpPassphrase) opts.passphrase = this.secrets.jumpPassphrase;
      }
      if (!opts.password && !opts.privateKey) {
        const a = agentSocket();
        if (a) opts.agent = a;
      }
      jc.connect(opts);
    });
  }

  _teardownJump() {
    if (this.jumpClient) {
      try { this.jumpClient.end(); } catch { /* ja fechado */ }
      this.jumpClient = null;
    }
    for (const f of this.forwards) {
      try { if (f.server) f.server.close(); } catch { /* ja fechado */ }
    }
    this.forwards = [];
  }

  // ---------------------------------------------------- port forwarding ----
  _applyForwards() {
    for (const f of this.config.portForwards || []) {
      try {
        this.addForward(f);
      } catch (err) {
        this.emit('data', `\r\n\x1b[31m[TSM] tunel falhou: ${err.message}\x1b[0m\r\n`);
      }
    }
  }

  /** Abre um tunel e devolve o registro, para a UI poder lista-lo e remove-lo. */
  addForward(spec) {
    const entry = spec.type === 'remote'
      ? this._addRemoteForward(spec)
      : this._addLocalForward(spec);
    this.forwards.push(entry);
    this.emit('forwards', this.listForwards());
    return entry;
  }

  listForwards() {
    return this.forwards.map((f) => ({
      id: f.id,
      type: f.spec.type || 'local',
      localHost: f.spec.localHost || '127.0.0.1',
      localPort: f.spec.localPort,
      remoteHost: f.spec.remoteHost,
      remotePort: f.spec.remotePort,
      status: f.status
    }));
  }

  removeForward(id) {
    const idx = this.forwards.findIndex((f) => f.id === id);
    if (idx === -1) return false;
    const [entry] = this.forwards.splice(idx, 1);
    try {
      if (entry.server) entry.server.close();
      else if (entry.spec.type === 'remote') {
        this.client.unforwardIn(entry.spec.remoteHost || '127.0.0.1', entry.spec.remotePort);
      }
    } catch { /* ja fechado */ }
    if (entry.onTcp) this.client.removeListener('tcp connection', entry.onTcp);
    this.emit('forwards', this.listForwards());
    return true;
  }

  _addLocalForward(spec) {
    const { localHost = '127.0.0.1', localPort, remoteHost, remotePort } = spec;
    const entry = { id: crypto.randomUUID(), spec, status: 'abrindo', server: null };

    const server = net.createServer((socket) => {
      this.client.forwardOut(localHost, localPort, remoteHost, remotePort, (err, stream) => {
        if (err) { socket.destroy(); return; }
        socket.pipe(stream).pipe(socket);
      });
    });
    entry.server = server;

    server.listen(localPort, localHost, () => {
      entry.status = 'ativo';
      this.emit('forwards', this.listForwards());
      this.emit('data',
        `\r\n\x1b[36m[TSM] tunel local ${localHost}:${localPort} -> ${remoteHost}:${remotePort}\x1b[0m\r\n`);
    });
    server.on('error', (err) => {
      entry.status = `erro: ${err.message}`;
      this.emit('forwards', this.listForwards());
      this.emit('data', `\r\n\x1b[31m[TSM] tunel local ${localPort}: ${err.message}\x1b[0m\r\n`);
    });
    return entry;
  }

  _addRemoteForward(spec) {
    const { remoteHost = '127.0.0.1', remotePort, localHost = '127.0.0.1', localPort } = spec;
    const entry = { id: crypto.randomUUID(), spec, status: 'abrindo', server: null };

    this.client.forwardIn(remoteHost, remotePort, (err) => {
      if (err) {
        entry.status = `erro: ${err.message}`;
        this.emit('forwards', this.listForwards());
        this.emit('data', `\r\n\x1b[31m[TSM] tunel remoto ${remotePort}: ${err.message}\x1b[0m\r\n`);
        return;
      }
      entry.status = 'ativo';
      this.emit('forwards', this.listForwards());
      this.emit('data',
        `\r\n\x1b[36m[TSM] tunel remoto ${remoteHost}:${remotePort} -> ${localHost}:${localPort}\x1b[0m\r\n`);
    });

    // Cada tunel remoto so atende o proprio destino. Guardamos o handler para
    // poder remove-lo depois sem derrubar os outros tuneis da mesma conexao.
    entry.onTcp = (info, accept) => {
      if (info.destPort !== remotePort) return;
      const stream = accept();
      const socket = net.connect(localPort, localHost, () => stream.pipe(socket).pipe(stream));
      socket.on('error', () => stream.end());
    };
    this.client.on('tcp connection', entry.onTcp);
    return entry;
  }

  // ------------------------------------------------------------- controle --
  write(data) {
    if (this.stream) this.stream.write(data);
  }

  resize(cols, rows) {
    if (this.stream) this.stream.setWindow(rows, cols, 0, 0);
  }

  answerPrompt(id, value) {
    const fn = this.pendingPrompts.get(id);
    if (fn) {
      this.pendingPrompts.delete(id);
      fn(value);
    }
  }

  answerHostKey(accept) {
    this.emit('hostkey:answer', accept);
  }

  /** Handle SFTP reaproveitando a MESMA conexao TCP/SSH ja autenticada. */
  sftp() {
    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)));
    });
  }

  close() {
    this.closed = true;
    try { if (this.stream) this.stream.end(); } catch { /* noop */ }
    try { this.client.end(); } catch { /* noop */ }
    this._teardownJump();
  }
}

module.exports = { SshConnection, DEFAULT_PORT };
