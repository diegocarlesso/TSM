'use strict';
/**
 * Importador de PuTTY. Aceita dois formatos:
 *
 *  1. `.reg` exportado de HKCU\Software\SimonTatham\PuTTY\Sessions (Windows);
 *  2. arquivos de `~/.putty/sessions/<nome>` (Linux/macOS), um por sessao.
 *
 * O PuTTY nao guarda senhas, entao nada de segredo vem junto — so config.
 */
const fs = require('node:fs');
const path = require('node:path');

const PROTOCOL_MAP = { ssh: 'ssh', telnet: 'telnet', raw: 'telnet', rlogin: 'telnet', serial: 'serial' };

/** Nomes de sessao no registro vem percent-encoded (%20, %5C...). */
function decodeName(name) {
  try {
    return decodeURIComponent(name.replace(/%(?![0-9A-Fa-f]{2})/g, '%25'));
  } catch {
    return name;
  }
}

function unescapeRegString(s) {
  return s.replace(/\\\\/g, '\\').replace(/\\"/g, '"');
}

function parseReg(text) {
  const blocks = [];
  let current = null;

  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^\s*\[HKEY_[^\]]*\\PuTTY\\Sessions\\([^\]]+)\]\s*$/i);
    if (header) {
      current = { name: decodeName(header[1]), values: {} };
      blocks.push(current);
      continue;
    }
    if (!current) continue;

    const str = line.match(/^\s*"([^"]+)"\s*=\s*"(.*)"\s*$/);
    if (str) { current.values[str[1]] = unescapeRegString(str[2]); continue; }

    const dword = line.match(/^\s*"([^"]+)"\s*=\s*dword:([0-9a-fA-F]+)\s*$/);
    if (dword) { current.values[dword[1]] = Number.parseInt(dword[2], 16); }
  }
  return blocks;
}

function parseSessionFile(name, text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const raw = line.slice(eq + 1).trim();
    const num = Number(raw);
    values[key] = raw !== '' && Number.isFinite(num) && /^\d+$/.test(raw) ? num : raw;
  }
  return { name: decodeName(name), values };
}

function toSession(block, warnings) {
  const v = block.values;
  const proto = String(v.Protocol || 'ssh').toLowerCase();
  const type = PROTOCOL_MAP[proto];

  if (!type) {
    warnings.push(`"${block.name}": protocolo ${proto} nao suportado — ignorada.`);
    return null;
  }
  if (type === 'serial') {
    warnings.push(`"${block.name}": sessoes seriais ainda nao sao suportadas — ignorada.`);
    return null;
  }
  if (!v.HostName) {
    warnings.push(`"${block.name}": sem HostName — provavelmente e so um perfil de aparencia.`);
    return null;
  }

  const config = {
    host: String(v.HostName).trim(),
    port: Number(v.PortNumber) || (type === 'ssh' ? 22 : 23)
  };
  if (v.UserName) config.username = String(v.UserName);
  if (v.PublicKeyFile) {
    config.privateKeyPath = String(v.PublicKeyFile).replace(/\\/g, '/');
    config.authType = 'key';
    if (/\.ppk$/i.test(config.privateKeyPath)) {
      warnings.push(
        `"${block.name}": a chave e .ppk (formato PuTTY). Converta para OpenSSH ` +
        `(puttygen chave.ppk -O private-openssh -o chave.pem) antes de conectar.`
      );
    }
  }
  if (v.Compression) config.compression = true;
  if (v.X11Forward) config.x11Forward = true;
  if (v.TerminalType) config.terminalType = String(v.TerminalType);
  if (v.ProxyHost) {
    config.jump = { host: String(v.ProxyHost), port: Number(v.ProxyPort) || 22, username: String(v.ProxyUsername || '') };
  }
  if (v.RemoteCommand) config.initialCommand = String(v.RemoteCommand);

  // Encaminhamentos: "L8080=localhost:80" vira um tunel local.
  const forwards = [];
  if (typeof v.PortForwardings === 'string' && v.PortForwardings) {
    for (const spec of v.PortForwardings.split('\t').filter(Boolean)) {
      const fm = spec.match(/^([LR])(\d+)=(.+):(\d+)$/);
      if (!fm) continue;
      forwards.push({
        type: fm[1] === 'L' ? 'local' : 'remote',
        localPort: Number(fm[2]),
        remoteHost: fm[3],
        remotePort: Number(fm[4])
      });
    }
  }
  if (forwards.length) config.portForwards = forwards;

  // O nome pode carregar hierarquia se o usuario usou "Pasta/Sessao".
  const parts = block.name.split(/[\\/]/).filter(Boolean);
  const name = parts.pop();
  const folderPath = parts.length ? parts.join('/') : null;

  return { name, type, folderPath, config, icon: null };
}

/** Entrada `.reg` (Buffer). */
function parseRegistryExport(buffer) {
  // .reg exportado pelo regedit e UTF-16LE com BOM.
  let text;
  if (buffer[0] === 0xff && buffer[1] === 0xfe) text = buffer.toString('utf16le');
  else text = buffer.toString('utf8');

  const warnings = [];
  const blocks = parseReg(text);
  const sessions = blocks.map((b) => toSession(b, warnings)).filter(Boolean);
  const folders = collectFolders(sessions);

  if (!blocks.length) warnings.push('Nenhuma chave PuTTY\\Sessions encontrada no .reg.');
  return { folders, sessions, theme: null, warnings, stats: { total: sessions.length } };
}

/** Entrada: diretorio `~/.putty/sessions`. */
function parseSessionsDir(dir) {
  const warnings = [];
  const sessions = [];
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    if (!fs.statSync(full).isFile()) continue;
    const block = parseSessionFile(file, fs.readFileSync(full, 'utf8'));
    const s = toSession(block, warnings);
    if (s) sessions.push(s);
  }
  return { folders: collectFolders(sessions), sessions, theme: null, warnings, stats: { total: sessions.length } };
}

function collectFolders(sessions) {
  const set = new Map();
  for (const s of sessions) {
    if (!s.folderPath) continue;
    let acc = '';
    let parent = null;
    for (const part of s.folderPath.split('/')) {
      acc = acc ? `${acc}/${part}` : part;
      if (!set.has(acc)) set.set(acc, { path: acc, name: part, parentPath: parent, icon: null });
      parent = acc;
    }
  }
  return [...set.values()];
}

module.exports = { parseRegistryExport, parseSessionsDir };
