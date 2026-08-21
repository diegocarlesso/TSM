'use strict';
/**
 * Painel de arquivos (SFTP/SCP) apoiado na MESMA conexao SSH ja autenticada —
 * como o "SSH browser" do MobaXterm. Nada de segunda senha, segundo TCP.
 *
 * `scp` e `sftp` compartilham o transporte SSH; o que muda e o protocolo de
 * arquivo. Usamos o subsistema SFTP (mais capaz e presente em qualquer
 * OpenSSH moderno) e expomos `scpDownload`/`scpUpload` para servidores
 * legados que so tem o binario `scp`.
 */
const fs = require('node:fs');
const path = require('node:path');
const manager = require('./transports/manager');

const handles = new Map();  // connectionId -> sftp handle

async function handleFor(connectionId) {
  if (handles.has(connectionId)) return handles.get(connectionId);
  const conn = manager.sshConnectionFor(connectionId);
  if (!conn) throw new Error('Esta conexao nao suporta transferencia de arquivos');
  const sftp = await conn.sftp();
  sftp.on('close', () => handles.delete(connectionId));
  handles.set(connectionId, sftp);
  return sftp;
}

function release(connectionId) {
  const h = handles.get(connectionId);
  if (h) {
    try { h.end(); } catch { /* noop */ }
    handles.delete(connectionId);
  }
}

const p = (fn) => new Promise((resolve, reject) =>
  fn((err, res) => (err ? reject(err) : resolve(res))));

function modeToString(mode) {
  const types = { 0o140000: 's', 0o120000: 'l', 0o100000: '-', 0o060000: 'b', 0o040000: 'd', 0o020000: 'c', 0o010000: 'p' };
  const type = types[mode & 0o170000] || '-';
  const rwx = (n) => `${n & 4 ? 'r' : '-'}${n & 2 ? 'w' : '-'}${n & 1 ? 'x' : '-'}`;
  return type + rwx((mode >> 6) & 7) + rwx((mode >> 3) & 7) + rwx(mode & 7);
}

async function list(connectionId, dir) {
  const sftp = await handleFor(connectionId);
  const target = dir || await p((cb) => sftp.realpath('.', cb));
  const entries = await p((cb) => sftp.readdir(target, cb));

  const items = entries.map((e) => ({
    name: e.filename,
    path: posixJoin(target, e.filename),
    size: e.attrs.size,
    mtime: e.attrs.mtime * 1000,
    mode: e.attrs.mode,
    permissions: modeToString(e.attrs.mode),
    uid: e.attrs.uid,
    gid: e.attrs.gid,
    isDirectory: (e.attrs.mode & 0o170000) === 0o040000,
    isSymlink: (e.attrs.mode & 0o170000) === 0o120000
  }));

  items.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
  });

  return { path: target, parent: posixParent(target), items };
}

function posixJoin(dir, name) {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

function posixParent(dir) {
  if (dir === '/' || !dir.includes('/')) return '/';
  const trimmed = dir.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx <= 0 ? '/' : trimmed.slice(0, idx);
}

async function mkdir(connectionId, dir) {
  const sftp = await handleFor(connectionId);
  await p((cb) => sftp.mkdir(dir, cb));
  return dir;
}

async function rename(connectionId, from, to) {
  const sftp = await handleFor(connectionId);
  await p((cb) => sftp.rename(from, to, cb));
  return to;
}

async function chmod(connectionId, target, mode) {
  const sftp = await handleFor(connectionId);
  await p((cb) => sftp.chmod(target, mode, cb));
}

async function stat(connectionId, target) {
  const sftp = await handleFor(connectionId);
  const s = await p((cb) => sftp.stat(target, cb));
  return { size: s.size, mode: s.mode, mtime: s.mtime * 1000, isDirectory: s.isDirectory() };
}

async function remove(connectionId, target, isDirectory) {
  const sftp = await handleFor(connectionId);
  if (!isDirectory) return p((cb) => sftp.unlink(target, cb));
  // Diretorio: esvazia recursivamente antes de remover.
  const entries = await p((cb) => sftp.readdir(target, cb));
  for (const e of entries) {
    const child = posixJoin(target, e.filename);
    const dir = (e.attrs.mode & 0o170000) === 0o040000;
    await remove(connectionId, child, dir);
  }
  return p((cb) => sftp.rmdir(target, cb));
}

async function readFile(connectionId, target, maxBytes = 2 * 1024 * 1024) {
  const sftp = await handleFor(connectionId);
  const s = await p((cb) => sftp.stat(target, cb));
  if (s.size > maxBytes) {
    throw new Error(`Arquivo grande demais para editar aqui (${(s.size / 1048576).toFixed(1)} MB)`);
  }
  const buf = await p((cb) => sftp.readFile(target, cb));
  return buf.toString('utf8');
}

async function writeFile(connectionId, target, content) {
  const sftp = await handleFor(connectionId);
  await p((cb) => sftp.writeFile(target, Buffer.from(content, 'utf8'), cb));
}

/** Download com progresso; `onProgress(transferido, total)`. */
async function download(connectionId, remotePath, localPath, onProgress) {
  const sftp = await handleFor(connectionId);
  const s = await p((cb) => sftp.stat(remotePath, cb));
  await new Promise((resolve, reject) => {
    let done = 0;
    const rs = sftp.createReadStream(remotePath);
    const ws = fs.createWriteStream(localPath);
    rs.on('data', (chunk) => {
      done += chunk.length;
      if (onProgress) onProgress(done, s.size);
    });
    rs.on('error', reject);
    ws.on('error', reject);
    ws.on('finish', resolve);
    rs.pipe(ws);
  });
  return { localPath, bytes: s.size };
}

async function upload(connectionId, localPath, remotePath, onProgress) {
  const sftp = await handleFor(connectionId);
  const total = fs.statSync(localPath).size;
  await new Promise((resolve, reject) => {
    let done = 0;
    const rs = fs.createReadStream(localPath);
    const ws = sftp.createWriteStream(remotePath);
    rs.on('data', (chunk) => {
      done += chunk.length;
      if (onProgress) onProgress(done, total);
    });
    rs.on('error', reject);
    ws.on('error', reject);
    ws.on('close', resolve);
    ws.on('finish', resolve);
    rs.pipe(ws);
  });
  return { remotePath, bytes: total };
}

/** Envia uma pasta inteira, criando a arvore no destino. */
async function uploadDirectory(connectionId, localDir, remoteDir, onProgress) {
  const sftp = await handleFor(connectionId);
  try { await p((cb) => sftp.mkdir(remoteDir, cb)); } catch { /* ja existe */ }
  for (const entry of fs.readdirSync(localDir, { withFileTypes: true })) {
    const lp = path.join(localDir, entry.name);
    const rp = posixJoin(remoteDir, entry.name);
    if (entry.isDirectory()) await uploadDirectory(connectionId, lp, rp, onProgress);
    else await upload(connectionId, lp, rp, onProgress);
  }
}

async function downloadDirectory(connectionId, remoteDir, localDir, onProgress) {
  fs.mkdirSync(localDir, { recursive: true });
  const { items } = await list(connectionId, remoteDir);
  for (const item of items) {
    const lp = path.join(localDir, item.name);
    if (item.isDirectory) await downloadDirectory(connectionId, item.path, lp, onProgress);
    else await download(connectionId, item.path, lp, onProgress);
  }
}

module.exports = {
  list, mkdir, rename, remove, chmod, stat, readFile, writeFile,
  download, upload, uploadDirectory, downloadDirectory, release, posixJoin, posixParent
};
