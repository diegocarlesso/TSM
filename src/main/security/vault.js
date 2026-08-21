'use strict';
/**
 * Cofre de credenciais do TSM.
 *
 * Duas estrategias de cifragem, escolhidas por preferencia do usuario:
 *
 *  - `safeStorage` (padrao): delega ao sistema operacional — DPAPI no Windows,
 *    Keychain no macOS, libsecret/kwallet no Linux. Sem senha para digitar.
 *  - `aes-256-gcm`: senha mestra do proprio TSM, derivada com scrypt. Necessaria
 *    quando o usuario quer o mesmo banco em varias maquinas (modo portatil) ou
 *    quando o SO nao oferece keyring (Linux headless).
 *
 * Em nenhum dos casos a senha em claro toca o disco.
 */
const crypto = require('node:crypto');
const { safeStorage } = require('electron');
const db = require('../store/db');
const repo = require('../store/repo');

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 32 };
const MAGIC = 'TSMv1';

let masterKey = null;      // Buffer, apenas em memoria
let unlocked = false;

// ------------------------------------------------------------ derivacao ----
function deriveKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 256 * 1024 * 1024
  });
}

/** Envelope: MAGIC | salt(16) | iv(12) | tag(16) | ciphertext */
function sealWithKey(key, plaintext, salt) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from(MAGIC, 'ascii'), salt, iv, cipher.getAuthTag(), ct]);
}

function openWithKeyFactory(blob, keyFor) {
  const magic = blob.subarray(0, MAGIC.length).toString('ascii');
  if (magic !== MAGIC) throw new Error('Envelope de credencial invalido ou corrompido');
  let off = MAGIC.length;
  const salt = blob.subarray(off, off += 16);
  const iv = blob.subarray(off, off += 12);
  const tag = blob.subarray(off, off += 16);
  const ct = blob.subarray(off);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(salt), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

// ------------------------------------------------------- senha mestra ------
function isMasterEnabled() {
  return !!repo.settings.get('vault.master.verifier', null);
}

function isUnlocked() {
  return !isMasterEnabled() || unlocked;
}

function scheme() {
  if (isMasterEnabled()) return 'aes-256-gcm';
  return safeStorage.isEncryptionAvailable() ? 'safeStorage' : 'plain-blocked';
}

/**
 * Define (ou troca) a senha mestra. Re-cifra todos os segredos existentes.
 * Passar `null` desativa a senha mestra e volta para o keyring do SO.
 */
function setMasterPassword(newPassphrase, currentPassphrase = null) {
  if (isMasterEnabled()) {
    if (!verifyMaster(currentPassphrase)) throw new Error('Senha mestra atual incorreta');
  }

  // 1. Le tudo em claro com a chave vigente.
  const rows = db.get().prepare('SELECT owner_kind, owner_id, field FROM secrets').all();
  const plain = rows.map((r) => ({ ...r, value: read(r.owner_kind, r.owner_id, r.field) }));

  // 2. Troca a chave.
  if (newPassphrase) {
    const salt = crypto.randomBytes(16);
    masterKey = deriveKey(newPassphrase, salt);
    unlocked = true;
    repo.settings.set('vault.master.salt', salt.toString('base64'));
    repo.settings.set('vault.master.verifier',
      sealWithKey(masterKey, 'tsm-vault-ok', salt).toString('base64'));
  } else {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('O sistema nao oferece armazenamento seguro; mantenha a senha mestra ativa.');
    }
    masterKey = null;
    unlocked = false;
    repo.settings.set('vault.master.salt', null);
    repo.settings.set('vault.master.verifier', null);
  }

  // 3. Regrava tudo com a nova estrategia.
  const d = db.get();
  d.transaction(() => {
    for (const p of plain) {
      if (p.value === null) continue;
      write(p.owner_kind, p.owner_id, p.field, p.value);
    }
  })();
}

function verifyMaster(passphrase) {
  const saltB64 = repo.settings.get('vault.master.salt', null);
  const verifier = repo.settings.get('vault.master.verifier', null);
  if (!saltB64 || !verifier) return false;
  try {
    const salt = Buffer.from(saltB64, 'base64');
    const key = deriveKey(passphrase, salt);
    return openWithKeyFactory(Buffer.from(verifier, 'base64'), () => key) === 'tsm-vault-ok';
  } catch {
    return false;
  }
}

function unlock(passphrase) {
  if (!isMasterEnabled()) return true;
  const saltB64 = repo.settings.get('vault.master.salt', null);
  if (!verifyMaster(passphrase)) return false;
  masterKey = deriveKey(passphrase, Buffer.from(saltB64, 'base64'));
  unlocked = true;
  return true;
}

function lock() {
  if (masterKey) masterKey.fill(0);
  masterKey = null;
  unlocked = false;
}

// ------------------------------------------------------------- segredos ----
function encrypt(value) {
  const s = scheme();
  if (s === 'aes-256-gcm') {
    if (!unlocked) throw new Error('Cofre bloqueado: informe a senha mestra');
    const salt = Buffer.from(repo.settings.get('vault.master.salt'), 'base64');
    return { scheme: s, blob: sealWithKey(masterKey, value, salt) };
  }
  if (s === 'safeStorage') {
    return { scheme: s, blob: safeStorage.encryptString(value) };
  }
  throw new Error(
    'Nenhum mecanismo de cifragem disponivel. Defina uma senha mestra em Configuracoes > Seguranca.'
  );
}

function decrypt(blob, blobScheme) {
  if (blobScheme === 'safeStorage') return safeStorage.decryptString(Buffer.from(blob));
  if (!unlocked) throw new Error('Cofre bloqueado: informe a senha mestra');
  // O salt viaja no envelope apenas como metadado: `setMasterPassword` re-cifra
  // todos os segredos ao rotacionar, entao a chave em memoria e sempre a correta.
  return openWithKeyFactory(Buffer.from(blob), () => masterKey);
}

function write(ownerKind, ownerId, field, value) {
  if (value === null || value === undefined || value === '') {
    return clear(ownerKind, ownerId, field);
  }
  const { scheme: s, blob } = encrypt(String(value));
  db.get().prepare(
    `INSERT INTO secrets (owner_kind, owner_id, field, ciphertext, scheme, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_kind, owner_id, field)
       DO UPDATE SET ciphertext = excluded.ciphertext, scheme = excluded.scheme,
                     updated_at = excluded.updated_at`
  ).run(ownerKind, ownerId, field, blob, s, Date.now());
}

function read(ownerKind, ownerId, field) {
  const row = db.get().prepare(
    'SELECT ciphertext, scheme FROM secrets WHERE owner_kind = ? AND owner_id = ? AND field = ?'
  ).get(ownerKind, ownerId, field);
  if (!row) return null;
  try {
    return decrypt(row.ciphertext, row.scheme);
  } catch (err) {
    throw new Error(`Falha ao decifrar ${field}: ${err.message}`);
  }
}

/** So diz *se* existe segredo — usado pela UI, que nunca recebe o valor. */
function has(ownerKind, ownerId, field) {
  const row = db.get().prepare(
    'SELECT 1 AS x FROM secrets WHERE owner_kind = ? AND owner_id = ? AND field = ?'
  ).get(ownerKind, ownerId, field);
  return !!row;
}

function clear(ownerKind, ownerId, field = null) {
  const d = db.get();
  if (field) {
    d.prepare('DELETE FROM secrets WHERE owner_kind = ? AND owner_id = ? AND field = ?')
      .run(ownerKind, ownerId, field);
  } else {
    d.prepare('DELETE FROM secrets WHERE owner_kind = ? AND owner_id = ?').run(ownerKind, ownerId);
  }
}

// --------------------------------------------- cifragem para export/import -
/** Cifra um payload arbitrario com senha informada na hora (export protegido). */
function sealExport(jsonString, passphrase) {
  const salt = crypto.randomBytes(16);
  return sealWithKey(deriveKey(passphrase, salt), jsonString, salt).toString('base64');
}

function openExport(b64, passphrase) {
  const blob = Buffer.from(b64, 'base64');
  const salt = blob.subarray(MAGIC.length, MAGIC.length + 16);
  return openWithKeyFactory(blob, () => deriveKey(passphrase, salt));
}

module.exports = {
  scheme, isMasterEnabled, isUnlocked, unlock, lock, setMasterPassword, verifyMaster,
  write, read, has, clear, sealExport, openExport
};
