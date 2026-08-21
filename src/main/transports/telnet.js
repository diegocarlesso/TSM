'use strict';
/**
 * Cliente Telnet (RFC 854/855) com negociacao de opcoes suficiente para
 * equipamentos de rede reais: ECHO, SGA, TERMINAL-TYPE, NAWS e BINARY.
 *
 * Tambem faz o auto-login opcional (usuario/senha) igual ao MobaXterm:
 * observa o fluxo de entrada procurando os prompts e responde uma unica vez.
 */
const net = require('node:net');
const { EventEmitter } = require('node:events');

const IAC = 255, DONT = 254, DO = 253, WONT = 252, WILL = 251, SB = 250, SE = 240;
const OPT = { BINARY: 0, ECHO: 1, SGA: 3, STATUS: 5, TTYPE: 24, NAWS: 31, TSPEED: 32, NEW_ENVIRON: 39 };

// Opcoes que aceitamos ATIVAR do nosso lado (respondemos WILL a um DO).
const WE_WILL = new Set([OPT.TTYPE, OPT.NAWS, OPT.SGA, OPT.BINARY, OPT.TSPEED]);
// Opcoes que aceitamos que o SERVIDOR ative (respondemos DO a um WILL).
const WE_DO = new Set([OPT.ECHO, OPT.SGA, OPT.BINARY]);

const DEFAULT_PORT = 23;

class TelnetConnection extends EventEmitter {
  constructor(config, secrets) {
    super();
    this.config = config;
    this.secrets = secrets || {};
    this.socket = null;
    this.closed = false;
    this.cols = config.cols || 120;
    this.rows = config.rows || 30;
    this.negotiated = new Set();
    this.buffer = Buffer.alloc(0);
    this.loginState = config.autoLogin && config.username ? 'user' : 'done';
    this.recentText = '';
  }

  get target() {
    return `${this.config.host}:${Number(this.config.port) || DEFAULT_PORT}`;
  }

  connect() {
    const host = this.config.host;
    const port = Number(this.config.port) || DEFAULT_PORT;

    this.socket = net.createConnection({ host, port }, () => {
      this.emit('status', 'conectado');
      // Anunciamos o que sabemos fazer sem esperar o servidor pedir.
      this._send(Buffer.from([IAC, WILL, OPT.TTYPE, IAC, WILL, OPT.NAWS, IAC, DO, OPT.SGA]));
      this._sendNaws();
      this.emit('ready');
    });

    this.socket.setNoDelay(true);
    if (this.config.keepalive !== false) this.socket.setKeepAlive(true, 30000);

    this.socket.on('data', (chunk) => this._onData(chunk));
    this.socket.on('error', (err) => this.emit('error', err));
    this.socket.on('close', () => {
      if (!this.closed) {
        this.closed = true;
        this.emit('close', 0);
      }
    });
  }

  _send(buf) {
    if (this.socket && !this.socket.destroyed) this.socket.write(buf);
  }

  _sendNaws() {
    const b = Buffer.from([
      IAC, SB, OPT.NAWS,
      (this.cols >> 8) & 0xff, this.cols & 0xff,
      (this.rows >> 8) & 0xff, this.rows & 0xff,
      IAC, SE
    ]);
    this._send(b);
  }

  _sendTtype() {
    const name = Buffer.from(this.config.terminalType || 'xterm-256color', 'ascii');
    this._send(Buffer.concat([
      Buffer.from([IAC, SB, OPT.TTYPE, 0 /* IS */]), name, Buffer.from([IAC, SE])
    ]));
  }

  /** Separa os comandos IAC do texto e devolve so o texto ao terminal. */
  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const out = [];
    let i = 0;

    while (i < this.buffer.length) {
      const byte = this.buffer[i];

      if (byte !== IAC) { out.push(byte); i++; continue; }

      // IAC no fim do buffer: espera o resto no proximo chunk.
      if (i + 1 >= this.buffer.length) break;
      const cmd = this.buffer[i + 1];

      if (cmd === IAC) { out.push(IAC); i += 2; continue; }        // 0xFF literal

      if (cmd === WILL || cmd === WONT || cmd === DO || cmd === DONT) {
        if (i + 2 >= this.buffer.length) break;
        this._negotiate(cmd, this.buffer[i + 2]);
        i += 3;
        continue;
      }

      if (cmd === SB) {
        const end = this._findSubnegotiationEnd(i + 2);
        if (end === -1) break;                                      // incompleto
        this._subnegotiate(this.buffer.subarray(i + 2, end));
        i = end + 2;                                                // pula IAC SE
        continue;
      }

      i += 2;                                                       // outros comandos de 2 bytes
    }

    this.buffer = this.buffer.subarray(i);
    if (out.length) {
      const text = Buffer.from(out).toString(this.config.encoding || 'utf8');
      this.emit('data', text);
      if (this.loginState !== 'done') this._tryAutoLogin(text);
    }
  }

  _findSubnegotiationEnd(start) {
    for (let j = start; j < this.buffer.length - 1; j++) {
      if (this.buffer[j] === IAC && this.buffer[j + 1] === SE) return j;
    }
    return -1;
  }

  _negotiate(cmd, opt) {
    const key = `${cmd}:${opt}`;
    if (cmd === DO) {
      if (WE_WILL.has(opt)) {
        if (!this.negotiated.has(key)) {
          this.negotiated.add(key);
          this._send(Buffer.from([IAC, WILL, opt]));
        }
        if (opt === OPT.NAWS) this._sendNaws();
      } else {
        this._send(Buffer.from([IAC, WONT, opt]));
      }
      return;
    }
    if (cmd === DONT) {
      this._send(Buffer.from([IAC, WONT, opt]));
      return;
    }
    if (cmd === WILL) {
      this._send(Buffer.from([IAC, WE_DO.has(opt) ? DO : DONT, opt]));
      return;
    }
    if (cmd === WONT) {
      this._send(Buffer.from([IAC, DONT, opt]));
    }
  }

  _subnegotiate(payload) {
    if (payload.length >= 2 && payload[0] === OPT.TTYPE && payload[1] === 1 /* SEND */) {
      this._sendTtype();
    }
  }

  /** Auto-login: procura os prompts de usuario/senha e responde uma vez cada. */
  _tryAutoLogin(text) {
    this.recentText = (this.recentText + text).slice(-256);
    const userRe = this.config.loginPrompt
      ? new RegExp(this.config.loginPrompt, 'i')
      : /(login|user\s*name|usuario|username)\s*:\s*$/i;
    const passRe = this.config.passwordPrompt
      ? new RegExp(this.config.passwordPrompt, 'i')
      : /(password|senha|pass)\s*:\s*$/i;

    if (this.loginState === 'user' && userRe.test(this.recentText)) {
      this.write(`${this.config.username}\r\n`);
      this.recentText = '';
      this.loginState = this.secrets.password ? 'password' : 'done';
      return;
    }
    if (this.loginState === 'password' && passRe.test(this.recentText)) {
      this.write(`${this.secrets.password}\r\n`);
      this.recentText = '';
      this.loginState = 'done';
      if (this.config.initialCommand) {
        setTimeout(() => this.write(`${this.config.initialCommand}\r\n`), 500);
      }
    }
  }

  write(data) {
    if (!this.socket || this.socket.destroyed) return;
    // Todo 0xFF digitado precisa ser escapado como IAC IAC.
    const raw = Buffer.from(data, this.config.encoding || 'utf8');
    if (!raw.includes(IAC)) return this._send(raw);
    const parts = [];
    for (const b of raw) {
      parts.push(b);
      if (b === IAC) parts.push(IAC);
    }
    this._send(Buffer.from(parts));
  }

  resize(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this._sendNaws();
  }

  close() {
    this.closed = true;
    if (this.socket) this.socket.destroy();
  }
}

module.exports = { TelnetConnection, DEFAULT_PORT };
