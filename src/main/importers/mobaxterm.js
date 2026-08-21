'use strict';
/**
 * Importador de MobaXterm.ini e .mxtsessions.
 *
 * A Mobatek não publica a especificação do formato; o que existe é engenharia
 * reversa da comunidade. Por isso o parser aqui é DELIBERADAMENTE TOLERANTE:
 *
 *   - os campos que a comunidade documenta com confiança (tipo, host, porta,
 *     usuário, caminho de chave, gateway) são mapeados;
 *   - os demais NÃO são adivinhados: a linha crua vai inteira para
 *     `config.raw`, então nenhuma informação é perdida e dá para reprocessar
 *     se o mapeamento evoluir;
 *   - qualquer linha que não casar com o formato vira um aviso no relatório,
 *     em vez de derrubar a importação.
 *
 * Formato observado:
 *   [Bookmarks]            -> pasta raiz
 *   [Bookmarks_1]          -> outra pasta
 *   SubRep=Pasta\SubPasta  -> caminho da pasta (vazio = raiz)
 *   ImgNum=41              -> icone da pasta
 *   Nome= #<icone>#<tipo>%<host>%<porta>%<usuário>%...
 */

// Códigos de tipo do MobaXterm (engenharia reversa da comunidade).
const TYPE_MAP = {
  0: 'ssh',
  1: 'telnet',
  2: 'rsh',
  3: 'xdmcp',
  4: 'rdp',
  5: 'vnc',
  6: 'ftp',
  7: 'sftp',
  8: 'serial',
  9: 'file',
  10: 'shell',
  11: 'browser',
  12: 'mosh',
  13: 's3',
  14: 'wsl'
};

// O que o TSM sabe abrir hoje. O resto é importado como "não suportado".
const SUPPORTED = new Set(['ssh', 'telnet', 'sftp', 'shell']);

function decode(buffer) {
  // MobaXterm grava em Windows-1252. Se o arquivo tiver BOM UTF-8, respeita.
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8');
  }
  try {
    return new TextDecoder('windows-1252').decode(buffer);
  } catch {
    return buffer.toString('latin1');
  }
}

/** Divide o INI em seções preservando a ordem. */
function parseIni(text) {
  const sections = [];
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^﻿/, '');
    if (!line.trim() || line.trimStart().startsWith(';')) continue;

    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      current = { name: header[1], entries: [] };
      sections.push(current);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1 || !current) continue;
    current.entries.push({ key: line.slice(0, eq).trim(), value: line.slice(eq + 1) });
  }
  return sections;
}

/** `#109#0%host%22%user%...` -> { icon, typeCode, fields[] } */
function parseBookmarkValue(value) {
  const v = value.trim();
  if (!v.startsWith('#')) return null;

  // Os grupos são separados por '#': conexão # fonte # cores # extras.
  const groups = v.slice(1).split('#');
  const icon = Number.parseInt(groups[0], 10);
  const connGroup = groups[1] ?? '';
  const fields = connGroup.split('%');

  // O primeiro campo do grupo de conexão é o código de tipo.
  const typeCode = Number.parseInt(fields[0], 10);
  if (!Number.isFinite(typeCode)) return null;

  return {
    icon: Number.isFinite(icon) ? icon : null,
    typeCode,
    fields: fields.slice(1),
    fontGroup: groups[2] ?? '',
    colorGroup: groups[3] ?? '',
    raw: v
  };
}

const isFlag = (s) => s === '1' || s === '-1' || s === '0';
const truthy = (s) => s === '1';

/** Heurística: um campo que parece caminho de chave privada. */
function looksLikeKeyPath(s) {
  if (!s) return false;
  return /_ProfileDir_|[\\/]\.ssh[\\/]|\.pem$|\.ppk$|id_(rsa|dsa|ecdsa|ed25519)/i.test(s);
}

function normalizeKeyPath(s) {
  return String(s || '')
    .replace(/^_ProfileDir_[\\/]?/i, '~/')
    .replace(/\\/g, '/');
}

/**
 * Mapeia o grupo de conexão para a config do TSM.
 * So preenche o que dá para afirmar; o resto fica em `raw`.
 */
function buildConfig(kind, parsed) {
  const f = parsed.fields;
  const config = { raw: parsed.raw, mobaIcon: parsed.icon, mobaTypeCode: parsed.typeCode };

  if (kind === 'shell' || kind === 'wsl') {
    if (f[0]) config.shellPath = f[0];
    return config;
  }
  if (kind === 'serial') {
    config.port = f[0] || '';
    config.baudRate = Number(f[1]) || 9600;
    return config;
  }

  config.host = (f[0] || '').trim();
  const port = Number.parseInt(f[1], 10);
  if (Number.isFinite(port) && port > 0) config.port = port;
  const user = (f[2] || '').trim();
  if (user) config.username = user;

  // Varre o resto atrás de sinais reconhecíveis, sem assumir posição fixa.
  const key = f.slice(3).find(looksLikeKeyPath);
  if (key) {
    config.privateKeyPath = normalizeKeyPath(key);
    config.authType = 'key';
  }

  if (kind === 'ssh') {
    // Nas amostras conhecidas os dois flags logo após o usuário são
    // X11 forwarding e compressão. Marcamos como best-effort.
    if (isFlag(f[3])) config.x11Forward = truthy(f[3]);
    if (isFlag(f[4])) config.compression = truthy(f[4]);

    // Gateway/jump host: primeiro campo textual que parece host, após os flags.
    const tail = f.slice(5);
    const gwIdx = tail.findIndex((s) => s && /^[A-Za-z0-9._-]+$/.test(s) && /[.a-zA-Z]/.test(s) && !isFlag(s));
    if (gwIdx !== -1 && tail[gwIdx] !== config.host) {
      const gwUser = tail[gwIdx + 1];
      const gwPort = Number.parseInt(tail[gwIdx + 2], 10);
      config.jump = {
        host: tail[gwIdx],
        username: gwUser && !isFlag(gwUser) ? gwUser : '',
        port: Number.isFinite(gwPort) && gwPort > 0 ? gwPort : 22
      };
    }
  }
  return config;
}

/** Cores do tema: `[Colors]` com valores `R,G,B`. */
const COLOR_KEYS = {
  ForegroundColour: 'foreground',
  BackgroundColour: 'background',
  CursorColour: 'cursor',
  Black: 'black', Red: 'red', Green: 'green', Yellow: 'yellow',
  Blue: 'blue', Magenta: 'magenta', Cyan: 'cyan', White: 'white',
  BoldBlack: 'brightBlack', BoldRed: 'brightRed', BoldGreen: 'brightGreen',
  BoldYellow: 'brightYellow', BoldBlue: 'brightBlue', BoldMagenta: 'brightMagenta',
  BoldCyan: 'brightCyan', BoldWhite: 'brightWhite'
};

function rgbToHex(value) {
  const parts = String(value).split(',').map((n) => Number.parseInt(n.trim(), 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return '#' + parts.map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('');
}

function parseColors(sections) {
  const colorSection = sections.find((s) => s.name.toLowerCase() === 'colors');
  if (!colorSection) return null;
  const theme = {};
  for (const { key, value } of colorSection.entries) {
    const mapped = COLOR_KEYS[key];
    if (!mapped) continue;
    const hex = rgbToHex(value);
    if (hex) theme[mapped] = hex;
  }
  return Object.keys(theme).length ? theme : null;
}

/**
 * Faz o parse completo e devolve uma estrutura neutra
 * `{ folders, sessions, theme, warnings, stats }` — quem grava é o chamador.
 */
function parse(buffer) {
  const text = decode(buffer);
  const sections = parseIni(text);

  const folders = new Map();   // caminho "A/B" -> { path, name, parentPath, icon }
  const sessions = [];
  const warnings = [];
  const byType = {};

  const ensureFolder = (folderPath, icon) => {
    if (!folderPath) return null;
    const parts = folderPath.split(/[\\/]+/).filter(Boolean);
    let acc = '';
    let parent = null;
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      if (!folders.has(acc)) {
        folders.set(acc, { path: acc, name: part, parentPath: parent, icon: icon ?? null });
      }
      parent = acc;
    }
    return acc;
  };

  for (const section of sections) {
    if (!/^bookmarks(_\d+)?$/i.test(section.name)) continue;

    const subRep = section.entries.find((e) => e.key.toLowerCase() === 'subrep');
    const imgNum = section.entries.find((e) => e.key.toLowerCase() === 'imgnum');
    const folderPath = ensureFolder(
      subRep ? subRep.value.trim() : '',
      imgNum ? Number.parseInt(imgNum.value, 10) : null
    );

    for (const entry of section.entries) {
      const lower = entry.key.toLowerCase();
      if (lower === 'subrep' || lower === 'imgnum') continue;

      const parsed = parseBookmarkValue(entry.value);
      if (!parsed) {
        warnings.push(`Linha ignorada (formato não reconhecido) em [${section.name}]: ${entry.key}`);
        continue;
      }

      const kind = TYPE_MAP[parsed.typeCode] || `desconhecido(${parsed.typeCode})`;
      byType[kind] = (byType[kind] || 0) + 1;

      if (!SUPPORTED.has(kind)) {
        warnings.push(`"${entry.key}": tipo ${kind} ainda não é suportado pelo TSM — sessão não importada.`);
        continue;
      }

      const config = buildConfig(kind, parsed);
      if ((kind === 'ssh' || kind === 'telnet' || kind === 'sftp') && !config.host) {
        warnings.push(`"${entry.key}": sem host identificável — sessão não importada.`);
        continue;
      }

      sessions.push({
        name: entry.key,
        type: kind,
        folderPath,
        config,
        icon: parsed.icon != null ? `moba:${parsed.icon}` : null
      });
    }
  }

  if (!sessions.length && !folders.size) {
    warnings.push('Nenhuma seção [Bookmarks] encontrada — o arquivo é mesmo um MobaXterm.ini/.mxtsessions?');
  }

  return {
    folders: [...folders.values()],
    sessions,
    theme: parseColors(sections),
    warnings,
    stats: { total: sessions.length, byType }
  };
}

module.exports = { parse, TYPE_MAP, parseIni, decode };
