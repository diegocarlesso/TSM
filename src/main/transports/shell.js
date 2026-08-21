'use strict';
/**
 * Shell local. Usa node-pty quando disponivel (indispensavel para vim, htop,
 * menuconfig...). Se o modulo nativo nao carregar — build sem rebuild, distro
 * exotica —, cai para pipes via child_process: perde o PTY, mas o app abre.
 */
const os = require('node:os');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');

// `@lydell/node-pty` distribui binarios Node-API prontos por plataforma, entao
// instala sem node-gyp/Visual Studio. `node-pty` fica como segunda opcao para
// quem ja tiver o modulo classico compilado.
let pty = null;
let ptyError = null;
for (const candidate of ['@lydell/node-pty', 'node-pty']) {
  try {
    pty = require(candidate);
    break;
  } catch (err) {
    ptyError = err;
  }
}

function firstExisting(candidates) {
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

/** Shells que fazem sentido oferecer na maquina atual. */
function detectShells() {
  const out = [];
  if (process.platform === 'win32') {
    const sysRoot = process.env.SystemRoot || 'C:\\Windows';
    const pwsh = firstExisting([
      `${process.env.ProgramFiles}\\PowerShell\\7\\pwsh.exe`,
      `${process.env.ProgramW6432}\\PowerShell\\7\\pwsh.exe`
    ]);
    if (pwsh) out.push({ id: 'pwsh', label: 'PowerShell 7', path: pwsh, args: [] });
    out.push({
      id: 'powershell', label: 'Windows PowerShell',
      path: `${sysRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, args: []
    });
    out.push({ id: 'cmd', label: 'Prompt de Comando', path: `${sysRoot}\\System32\\cmd.exe`, args: [] });

    const gitBash = firstExisting([
      `${process.env.ProgramFiles}\\Git\\bin\\bash.exe`,
      `${process.env.ProgramW6432}\\Git\\bin\\bash.exe`,
      'C:\\Program Files\\Git\\bin\\bash.exe'
    ]);
    if (gitBash) out.push({ id: 'gitbash', label: 'Git Bash', path: gitBash, args: ['--login', '-i'] });

    const wsl = firstExisting([`${sysRoot}\\System32\\wsl.exe`]);
    if (wsl) out.push({ id: 'wsl', label: 'WSL', path: wsl, args: [] });
  } else {
    const shells = ['/bin/zsh', '/bin/bash', '/usr/bin/zsh', '/usr/bin/bash', '/bin/sh'];
    for (const s of shells) {
      if (fs.existsSync(s)) {
        out.push({ id: s, label: s.split('/').pop(), path: s, args: ['-l'] });
      }
    }
    if (process.env.SHELL && !out.some((s) => s.path === process.env.SHELL)) {
      out.unshift({
        id: process.env.SHELL, label: `${process.env.SHELL.split('/').pop()} (padrao)`,
        path: process.env.SHELL, args: ['-l']
      });
    }
  }
  return out.filter((s, i, arr) => arr.findIndex((x) => x.path === s.path) === i);
}

function defaultShell() {
  const list = detectShells();
  return list[0] || { id: 'sh', label: 'sh', path: '/bin/sh', args: [] };
}

class ShellConnection extends EventEmitter {
  constructor(config) {
    super();
    this.config = config || {};
    this.proc = null;
    this.usingPty = false;
    this.closed = false;
  }

  get target() {
    return this.config.shellPath || defaultShell().path;
  }

  connect() {
    const cfg = this.config;
    const chosen = cfg.shellPath
      ? { path: cfg.shellPath, args: cfg.shellArgs || [] }
      : defaultShell();

    const cwd = cfg.cwd && fs.existsSync(cfg.cwd) ? cfg.cwd : os.homedir();
    const env = { ...process.env, ...(cfg.env || {}), TERM: cfg.terminalType || 'xterm-256color' };
    // Variaveis do Electron atrapalham processos filhos.
    delete env.ELECTRON_RUN_AS_NODE;

    if (pty) {
      this.usingPty = true;
      this.proc = pty.spawn(chosen.path, chosen.args || [], {
        name: cfg.terminalType || 'xterm-256color',
        cols: cfg.cols || 120,
        rows: cfg.rows || 30,
        cwd,
        env,
        useConpty: process.platform === 'win32'
      });
      this.proc.onData((d) => this.emit('data', d));
      this.proc.onExit(({ exitCode }) => {
        if (!this.closed) {
          this.closed = true;
          this.emit('close', exitCode);
        }
      });
    } else {
      const { spawn } = require('node:child_process');
      this.proc = spawn(chosen.path, chosen.args || [], { cwd, env, stdio: 'pipe' });
      this.proc.stdout.on('data', (d) => this.emit('data', d.toString('utf8')));
      this.proc.stderr.on('data', (d) => this.emit('data', d.toString('utf8')));
      this.proc.on('close', (code) => {
        if (!this.closed) {
          this.closed = true;
          this.emit('close', code ?? 0);
        }
      });
      this.proc.on('error', (err) => this.emit('error', err));
      this.emit('data',
        `\x1b[33m[TSM] node-pty indisponivel (${ptyError && ptyError.message}); ` +
        `modo pipe: aplicacoes de tela cheia nao funcionarao.\x1b[0m\r\n`);
    }

    this.emit('ready');
    if (cfg.initialCommand) {
      setTimeout(() => this.write(`${cfg.initialCommand}\r`), 300);
    }
  }

  write(data) {
    if (!this.proc) return;
    if (this.usingPty) this.proc.write(data);
    else this.proc.stdin.write(data);
  }

  resize(cols, rows) {
    if (this.proc && this.usingPty) {
      try { this.proc.resize(cols, rows); } catch { /* processo ja saiu */ }
    }
  }

  close() {
    this.closed = true;
    if (!this.proc) return;
    try {
      if (this.usingPty) this.proc.kill();
      else this.proc.kill('SIGHUP');
    } catch { /* ja morto */ }
  }
}

module.exports = { ShellConnection, detectShells, defaultShell, hasPty: () => !!pty };
