'use strict';
/**
 * Gravação da saida das sessões em arquivo — o equivalente ao "session logging"
 * do MobaXterm. A gravação vive no processo principal, então continua rodando
 * mesmo com a aba em segundo plano ou a janela minimizada.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const streams = new Map();   // connectionId -> { stream, filePath, bytes, stripAnsi, timestamp }

// Sequências de escape ANSI: CSI (ESC [ ... ) e OSC (ESC ] ... BEL).
const ANSI_RE =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g;
function pad(n, size = 2) {
  return String(n).padStart(size, '0');
}

/**
 * Resolve o modelo de caminho. Aceita os mesmos marcadores do MobaXterm:
 * %name% %host% %user% %type% %Y% %M% %D% %h% %m% %s%
 */
function resolvePath(template, meta) {
  const d = new Date();
  // Proibidos em nome de arquivo no Windows, mais espaços em branco.
  const safe = (s) => String(s || '').replace(/[<>:"/\\|?*\s]+/g, '_');

  let out = String(template || '')
    .replace(/%name%/gi, safe(meta.name))
    .replace(/%host%/gi, safe(meta.host))
    .replace(/%user%/gi, safe(meta.username))
    .replace(/%type%/gi, safe(meta.type))
    .replace(/%Y%/g, String(d.getFullYear()))
    .replace(/%M%/g, pad(d.getMonth() + 1))
    .replace(/%D%/g, pad(d.getDate()))
    .replace(/%h%/g, pad(d.getHours()))
    .replace(/%m%/g, pad(d.getMinutes()))
    .replace(/%s%/g, pad(d.getSeconds()));

  if (out.startsWith('~')) out = path.join(os.homedir(), out.slice(1));
  if (!path.isAbsolute(out)) out = path.join(defaultDir(), out);
  if (!path.extname(out)) out += '.log';
  return out;
}

function defaultDir() {
  // Fica junto do banco: num pendrive, os logs viajam com o app.
  return require('./paths').logsDir();
}

function start(connectionId, options) {
  stop(connectionId);

  const filePath = resolvePath(
    options.template || '%name%_%Y%%M%%D%_%h%%m%%s%.log',
    options.meta || {}
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const stream = fs.createWriteStream(filePath, { flags: options.append ? 'a' : 'w' });
  const entry = {
    stream,
    filePath,
    bytes: 0,
    stripAnsi: options.stripAnsi !== false,
    timestamp: !!options.timestamp,
    atLineStart: true
  };
  streams.set(connectionId, entry);

  const header = `=== TSM · ${options.meta?.name || 'sessão'} · ${new Date().toLocaleString('pt-BR')} ===\n`;
  stream.write(header);
  return { filePath };
}

function write(connectionId, chunk) {
  const entry = streams.get(connectionId);
  if (!entry) return;

  let text = entry.stripAnsi ? chunk.replace(ANSI_RE, '') : chunk;
  if (!text) return;

  if (entry.timestamp) {
    // Carimba cada linha nova, sem quebrar linhas que chegam picotadas.
    const stamp = () => `[${new Date().toISOString()}] `;
    let out = '';
    for (const ch of text) {
      if (entry.atLineStart && ch !== '\n' && ch !== '\r') {
        out += stamp();
        entry.atLineStart = false;
      }
      out += ch;
      if (ch === '\n') entry.atLineStart = true;
    }
    text = out;
  }

  entry.bytes += Buffer.byteLength(text);
  entry.stream.write(text);
}

/**
 * Encerra a gravação. Devolve uma promise que só resolve após o flush do
 * stream — quem for ler o arquivo em seguida (a UI, um teste) precisa disso.
 */
function stop(connectionId) {
  const entry = streams.get(connectionId);
  if (!entry) return Promise.resolve(null);
  streams.delete(connectionId);

  const info = { filePath: entry.filePath, bytes: entry.bytes };
  return new Promise((resolve) => {
    try {
      entry.stream.end(
        `\n=== TSM · encerrado em ${new Date().toLocaleString('pt-BR')} ===\n`,
        () => resolve(info)
      );
    } catch {
      resolve(info);
    }
  });
}

function status(connectionId) {
  const entry = streams.get(connectionId);
  return entry ? { active: true, filePath: entry.filePath, bytes: entry.bytes } : { active: false };
}

function stopAll() {
  return Promise.all([...streams.keys()].map((id) => stop(id)));
}

/** Texto sem as sequências de escape — reaproveitado pelo motor de automação. */
const stripAnsi = (text) => String(text).replace(ANSI_RE, '');

module.exports = { start, write, stop, status, stopAll, resolvePath, defaultDir, stripAnsi };
