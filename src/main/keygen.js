'use strict';
/**
 * Geração e inspeção de chaves SSH — o equivalente ao MobaKeyGen/PuTTYgen.
 *
 * Usa o gerador do próprio `ssh2`, que escreve no formato OPENSSH PRIVATE KEY
 * (o mesmo do `ssh-keygen`), então a chave serve tanto aqui quanto no cliente
 * de linha de comando. Em modo portátil as chaves ficam em `data/keys`.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { utils: sshUtils } = require('ssh2');
const paths = require('./paths');

const TYPES = {
  ed25519: { label: 'Ed25519 (recomendado)', bits: null },
  ecdsa: { label: 'ECDSA', bits: [256, 384, 521] },
  rsa: { label: 'RSA', bits: [2048, 3072, 4096] }
};

/**
 * Gera um par de chaves.
 * `passphrase` vazio produz chave sem senha — aceitável para automação, mas o
 * chamador deve deixar isso explicito para o usuário.
 */
function generate({ type = 'ed25519', bits, comment = '', passphrase = '' } = {}) {
  if (!TYPES[type]) throw new Error(`Tipo de chave não suportado: ${type}`);

  const opts = { comment: comment || `${os.userInfo().username}@${os.hostname()}` };
  if (type === 'rsa') opts.bits = Number(bits) || 4096;
  if (type === 'ecdsa') opts.bits = Number(bits) || 256;
  if (passphrase) {
    opts.passphrase = passphrase;
    opts.cipher = 'aes256-cbc';
  }

  const pair = sshUtils.generateKeyPairSync(type, opts);
  return {
    type,
    bits: opts.bits || 256,
    comment: opts.comment,
    privateKey: pair.private,
    publicKey: pair.public.trim(),
    fingerprint: fingerprintOf(pair.public),
    encrypted: !!passphrase
  };
}

/** SHA256 em base64, no mesmo formato que o `ssh-keygen -lf` imprime. */
function fingerprintOf(publicKeyLine) {
  const parts = String(publicKeyLine).trim().split(/\s+/);
  const blob = parts[1];
  if (!blob) return null;
  const digest = crypto.createHash('sha256').update(Buffer.from(blob, 'base64')).digest('base64');
  return `SHA256:${digest.replace(/=+$/, '')}`;
}

/** Grava o par no disco com as permissões que o OpenSSH exige (0600). */
function save(pair, { dir, name } = {}) {
  const targetDir = dir || paths.keysDir();
  fs.mkdirSync(targetDir, { recursive: true });

  const base = (name || `id_${pair.type}`).replace(/[<>:"/\\|?*]/g, '_');
  const privatePath = path.join(targetDir, base);
  const publicPath = `${privatePath}.pub`;

  if (fs.existsSync(privatePath)) {
    throw new Error(`Já existe uma chave chamada "${base}" em ${targetDir}`);
  }

  fs.writeFileSync(privatePath, pair.privateKey, { mode: 0o600 });
  fs.writeFileSync(publicPath, `${pair.publicKey}\n`, { mode: 0o644 });
  if (process.platform !== 'win32') fs.chmodSync(privatePath, 0o600);

  return { privatePath, publicPath };
}

/** Lê uma chave existente e conta o essencial sobre ela, sem expor o segredo. */
function inspect(filePath, passphrase = '') {
  const raw = fs.readFileSync(filePath);
  const parsed = sshUtils.parseKey(raw, passphrase || undefined);

  if (parsed instanceof Error) {
    if (/encrypted|passphrase/i.test(parsed.message)) {
      return { path: filePath, encrypted: true, needsPassphrase: true, error: parsed.message };
    }
    throw new Error(`Não foi possível ler a chave: ${parsed.message}`);
  }

  const key = Array.isArray(parsed) ? parsed[0] : parsed;
  const publicLine = `${key.type} ${key.getPublicSSH().toString('base64')}${key.comment ? ` ${key.comment}` : ''}`;
  return {
    path: filePath,
    type: key.type,
    comment: key.comment || '',
    publicKey: publicLine,
    fingerprint: fingerprintOf(publicLine),
    encrypted: !!passphrase,
    needsPassphrase: false
  };
}

/** Lista as chaves conhecidas: as do TSM e as de `~/.ssh`. */
function list() {
  const dirs = [paths.keysDir(), path.join(os.homedir(), '.ssh')];
  const out = [];
  const seen = new Set();

  for (const dir of dirs) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name.endsWith('.pub') || name === 'known_hosts' || name === 'config' || name === 'authorized_keys') {
        continue;
      }
      const full = path.join(dir, name);
      if (seen.has(full)) continue;
      try {
        if (!fs.statSync(full).isFile()) continue;
        const head = fs.readFileSync(full, { encoding: 'utf8' }).slice(0, 40);
        if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(head)) continue;
      } catch {
        continue;
      }
      seen.add(full);

      let info = { path: full, name, dir, type: '?', fingerprint: null, encrypted: null };
      try {
        const pubPath = `${full}.pub`;
        if (fs.existsSync(pubPath)) {
          const line = fs.readFileSync(pubPath, 'utf8').trim();
          const parts = line.split(/\s+/);
          info.type = parts[0];
          info.comment = parts.slice(2).join(' ');
          info.fingerprint = fingerprintOf(line);
        } else {
          const detail = inspect(full);
          info = { ...info, ...detail, name, dir };
        }
      } catch {
        // Chave cifrada ou ilegível: listamos assim mesmo, só sem os detalhes.
        info.encrypted = true;
      }
      out.push(info);
    }
  }
  return out;
}

module.exports = { generate, save, inspect, list, fingerprintOf, TYPES };
