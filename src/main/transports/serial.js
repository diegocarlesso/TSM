'use strict';
/**
 * Sessão serial (COM / tty).
 *
 * Diferente de SSH e Telnet, aqui não existe negociação nem controle de fluxo
 * de terminal: é um fluxo de bytes cru. Isso muda três coisas na prática, e
 * cada uma vira uma opção da sessão:
 *
 *   - `resize` não tem para onde ir — o equipamento do outro lado não sabe o
 *     tamanho da nossa janela;
 *   - muitos equipamentos não ecoam o que você digita, então o eco local é
 *     opcional e feito por nós;
 *   - o que a tecla Enter deve mandar (CR, LF ou CR+LF) varia por equipamento,
 *     e mandar o errado é a causa nº 1 de "conectei mas não responde".
 */
const { EventEmitter } = require('node:events');

let SerialPortLib = null;
let loadError = null;
try {
  ({ SerialPort: SerialPortLib } = require('serialport'));
} catch (err) {
  loadError = err;
}

const DEFAULTS = {
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  rtscts: false,
  xon: false,
  xoff: false,
  newline: 'cr',
  localEcho: false
};

const BAUD_RATES = [
  300, 1200, 2400, 4800, 9600, 19200, 38400, 57600,
  115200, 230400, 460800, 921600
];

const EOL = { cr: '\r', lf: '\n', crlf: '\r\n' };

/** Portas disponíveis na máquina, já num formato pronto para a interface. */
async function listPorts() {
  if (!SerialPortLib) {
    throw new Error(`Suporte a serial indisponível: ${loadError && loadError.message}`);
  }
  const portas = await SerialPortLib.list();
  return portas.map((p) => ({
    path: p.path,
    manufacturer: p.manufacturer || '',
    serialNumber: p.serialNumber || '',
    vendorId: p.vendorId || '',
    productId: p.productId || '',
    friendlyName: p.friendlyName || p.pnpId || ''
  }));
}

class SerialConnection extends EventEmitter {
  constructor(config) {
    super();
    this.config = { ...DEFAULTS, ...(config || {}) };
    this.port = null;
    this.closed = false;
  }

  get target() {
    return `${this.config.path || '?'} @ ${this.config.baudRate}`;
  }

  connect() {
    if (!SerialPortLib) {
      throw new Error(`Suporte a serial indisponível: ${loadError && loadError.message}`);
    }
    const cfg = this.config;
    if (!cfg.path) throw new Error('Informe a porta serial (ex.: COM3 ou /dev/ttyUSB0)');

    return new Promise((resolve, reject) => {
      this.port = new SerialPortLib({
        path: cfg.path,
        baudRate: Number(cfg.baudRate) || 9600,
        dataBits: Number(cfg.dataBits) || 8,
        stopBits: Number(cfg.stopBits) || 1,
        parity: cfg.parity || 'none',
        rtscts: !!cfg.rtscts,
        xon: !!cfg.xon,
        xoff: !!cfg.xoff,
        autoOpen: false
      });

      this.port.on('data', (buf) => {
        this.emit('data', buf.toString(cfg.encoding || 'utf8'));
      });

      this.port.on('error', (err) => {
        // Porta ocupada é o erro mais comum; vale dizer o que fazer.
        const msg = /Access denied|Resource temporarily unavailable|cannot open/i.test(err.message)
          ? `${err.message} — a porta ${cfg.path} já está aberta em outro programa?`
          : err.message;
        this.emit('error', new Error(msg));
      });

      this.port.on('close', () => {
        if (!this.closed) {
          this.closed = true;
          this.emit('close', 0);
        }
      });

      this.port.open((err) => {
        if (err) {
          const msg = /Access denied|Permission denied/i.test(err.message)
            ? `${err.message} — verifique se a porta não está em uso e se você tem permissão ` +
              '(no Linux, o usuário costuma precisar estar no grupo dialout).'
            : err.message;
          return reject(new Error(msg));
        }

        this.emit('data',
          `\x1b[36m[TSM] ${cfg.path} aberta a ${cfg.baudRate} ${cfg.dataBits}${
            String(cfg.parity)[0].toUpperCase()}${cfg.stopBits}\x1b[0m\r\n`);
        this.emit('ready');

        if (cfg.initialCommand) {
          setTimeout(() => this.write(`${cfg.initialCommand}\r`), 300);
        }
        resolve();
      });
    });
  }

  write(data) {
    if (!this.port || !this.port.isOpen) return;

    // O xterm manda CR ao pressionar Enter; aqui traduzimos para o que o
    // equipamento espera.
    const fim = EOL[this.config.newline] || '\r';
    const saida = data.replace(/\r\n|\r|\n/g, fim);

    if (this.config.localEcho) {
      // O eco precisa de CRLF para o cursor voltar à coluna 0 no terminal.
      this.emit('data', saida.replace(/\r\n?|\n/g, '\r\n'));
    }
    this.port.write(saida, this.config.encoding || 'utf8');
  }

  /** Sinal de break — vários equipamentos usam para entrar em modo de recuperação. */
  sendBreak(ms = 250) {
    if (!this.port || !this.port.isOpen) return;
    this.port.set({ brk: true }, () => {
      setTimeout(() => this.port.set({ brk: false }, () => {}), ms);
    });
  }

  /** Sem terminal remoto, não há janela para redimensionar. */
  resize() { /* nada a fazer numa serial */ }

  close() {
    this.closed = true;
    if (this.port && this.port.isOpen) {
      try { this.port.close(); } catch { /* já fechada */ }
    }
  }
}

module.exports = {
  SerialConnection, listPorts, BAUD_RATES, DEFAULTS,
  isAvailable: () => !!SerialPortLib
};
