/**
 * Teste de fumaca do processo principal SEM abrir o Electron.
 * Substitui o modulo `electron` por um duplo de teste e exercita
 * banco, repositorio, cofre, importadores e export/import.
 *
 *   node scripts/smoke.js
 */
'use strict';
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tsm-smoke-'));
process.env.TSM_DATA_DIR = tmp;

// ---- duplo do modulo electron ---------------------------------------------
const electronStub = {
  app: {
    getPath: () => tmp,
    getVersion: () => '1.0.0',
    getName: () => 'TSM',
    isPackaged: false
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    // "Cifra" reversivel so para o teste; nao e o caminho de producao.
    encryptString: (s) => Buffer.concat([Buffer.from('FAKE'), Buffer.from(s, 'utf8')]),
    decryptString: (b) => Buffer.from(b).subarray(4).toString('utf8')
  },
  ipcMain: { handle: () => {} },
  dialog: {},
  shell: {},
  clipboard: {},
  BrowserWindow: { fromWebContents: () => null },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
  nativeTheme: {},
  session: {}
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return electronStub;
  return origLoad.apply(this, arguments);
};

// ---- helpers ---------------------------------------------------------------
let pass = 0;
let fail = 0;

function check(label, fn) {
  const t0 = Date.now();
  try {
    if (fn() === false) throw new Error('retornou false');
    const ms = Date.now() - t0;
    console.log(`  ok    ${label}${ms > 400 ? `  (${(ms / 1000).toFixed(1)}s)` : ''}`);
    pass++;
  } catch (err) {
    console.log(`  FALHA ${label}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    console.log(`        ${err.message}`);
    fail++;
  }
}

/**
 * Verificacoes assincronas. Como este arquivo e CommonJS (sem top-level await),
 * elas ficam numa fila e rodam no `finish()`, sob o cabecalho proprio.
 */
const pending = [];
const checkAsync = (section, label, fn) => pending.push({ section, label, fn });

async function runPending() {
  let lastSection = null;
  for (const item of pending) {
    if (item.section !== lastSection) {
      console.log(`\n[${item.section}]`);
      lastSection = item.section;
    }
    const t0 = Date.now();
    try {
      await item.fn();
      const ms = Date.now() - t0;
      console.log(`  ok    ${item.label}${ms > 400 ? `  (${(ms / 1000).toFixed(1)}s)` : ''}`);
      pass++;
    } catch (err) {
      console.log(`  FALHA ${item.label}`);
      console.log(`        ${err.message}`);
      fail++;
    }
  }
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg || 'condicao falsa');
};

// ---- inicio ----------------------------------------------------------------
const db = require('../src/main/store/db');
const repo = require('../src/main/store/repo');
const vault = require('../src/main/security/vault');
const moba = require('../src/main/importers/mobaxterm');
const putty = require('../src/main/importers/putty');
const portability = require('../src/main/portability');
const { BUILTIN_THEMES, DEFAULT_SETTINGS } = require('../src/shared/themes');
const telnet = require('../src/main/transports/telnet');
const shellTransport = require('../src/main/transports/shell');

console.log(`\nTSM - teste de fumaca (dados em ${tmp})\n`);

console.log('[banco]');
check('abre e aplica todas as migracoes', () => {
  db.open();
  const v = db.get().pragma('user_version', { simple: true });
  assert(v >= 2, `user_version = ${v}`);
  // As tabelas de todas as migracoes precisam existir.
  for (const t of ['folders', 'sessions', 'identities', 'secrets', 'settings',
                   'themes', 'known_hosts', 'connection_log', 'snippets']) {
    const row = db.get()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(t);
    assert(row, `tabela ${t} nao foi criada`);
  }
});
check(`motor ativo: ${db.engine()}`, () => true);

console.log('\n[pastas e sessoes]');
let f1;
let f2;
let s1;
check('cria pastas aninhadas', () => {
  f1 = repo.folders.create({ name: 'Producao' });
  f2 = repo.folders.create({ name: 'Bancos', parentId: f1.id });
  assert(repo.folders.list().length === 2);
  assert(repo.folders.find(f2.id).parent_id === f1.id);
});
check('impede ciclo ao mover pasta para dentro da propria subarvore', () => {
  try {
    repo.folders.update(f1.id, { parentId: f2.id });
    throw new Error('deveria ter recusado');
  } catch (err) {
    assert(/dentro dela mesma/.test(err.message), err.message);
  }
});
check('cria sessao com config JSON e etiquetas', () => {
  s1 = repo.sessions.create({
    name: 'db-master',
    type: 'ssh',
    folderId: f2.id,
    config: { host: '10.0.0.5', port: 22, username: 'root', compression: true },
    tags: ['producao', 'postgres']
  });
  assert(repo.sessions.find(s1.id).config.host === '10.0.0.5');
  assert(repo.sessions.find(s1.id).tags.length === 2);
});
check('sem limite de sessoes salvas (grava 500 numa transacao)', () => {
  const t0 = Date.now();
  repo.tx(() => {
    for (let i = 0; i < 500; i++) {
      repo.sessions.create({
        name: `host-${i}`,
        type: 'ssh',
        config: { host: `10.1.${i >> 8}.${i & 255}` }
      });
    }
  });
  const ms = Date.now() - t0;
  assert(repo.sessions.count() === 501, `contou ${repo.sessions.count()}`);
  // Guarda-chuva contra regressao: sem transacao isso levava mais de um minuto.
  assert(ms < 15000, `500 insercoes levaram ${ms} ms — a transacao deixou de ser aplicada?`);
});
check('busca por nome e por conteudo da config', () => {
  assert(repo.sessions.search('db-master').length === 1);
  assert(repo.sessions.search('10.1.0.').length > 1);
});
check('duplica e remove', () => {
  const dup = repo.sessions.duplicate(s1.id);
  assert(dup.name === 'db-master (copia)');
  repo.sessions.remove(dup.id);
  assert(repo.sessions.find(dup.id) === null);
});
check('reordena e move em lote', () => {
  repo.sessions.reorder([{ id: s1.id, folderId: f1.id, sortOrder: 7 }]);
  assert(repo.sessions.find(s1.id).sort_order === 7);
  assert(repo.sessions.find(s1.id).folder_id === f1.id);
});
check('descendentes por CTE recursiva', () => {
  const ids = repo.descendants(f1.id);
  assert(ids.length === 2 && ids.includes(f2.id), JSON.stringify(ids));
});

console.log('\n[cofre de credenciais]');
check('grava e le segredo pelo cofre do SO', () => {
  vault.write('session', s1.id, 'password', 'senha-super-secreta');
  assert(vault.has('session', s1.id, 'password'));
  assert(vault.read('session', s1.id, 'password') === 'senha-super-secreta');
});
check('ativar senha mestra re-cifra os segredos existentes', () => {
  vault.setMasterPassword('senha-mestra-123');
  assert(vault.scheme() === 'aes-256-gcm', vault.scheme());
  assert(vault.read('session', s1.id, 'password') === 'senha-super-secreta');
});
check('bloqueia, recusa senha errada, desbloqueia', () => {
  vault.lock();
  assert(!vault.isUnlocked());
  try {
    vault.read('session', s1.id, 'password');
    throw new Error('leu com o cofre bloqueado');
  } catch (err) {
    assert(/bloqueado/.test(err.message), err.message);
  }
  assert(vault.unlock('errada') === false);
  assert(vault.unlock('senha-mestra-123') === true);
  assert(vault.read('session', s1.id, 'password') === 'senha-super-secreta');
});
check('trocar a senha mestra preserva os segredos', () => {
  vault.setMasterPassword('outra-senha-456', 'senha-mestra-123');
  assert(vault.read('session', s1.id, 'password') === 'senha-super-secreta');
});
check('desativar a senha mestra volta ao cofre do SO', () => {
  vault.setMasterPassword(null, 'outra-senha-456');
  assert(vault.scheme() === 'safeStorage');
  assert(vault.read('session', s1.id, 'password') === 'senha-super-secreta');
});
check('envelope de export exige a senha correta', () => {
  const sealed = vault.sealExport(JSON.stringify({ a: 1 }), 'senha-do-arquivo');
  assert(JSON.parse(vault.openExport(sealed, 'senha-do-arquivo')).a === 1);
  let abriu = false;
  try {
    vault.openExport(sealed, 'senha-errada');
    abriu = true;
  } catch { /* esperado */ }
  assert(!abriu, 'abriu com a senha errada');
});

console.log('\n[temas e preferencias]');
check('semeia os temas embutidos', () => {
  for (const t of BUILTIN_THEMES) repo.themes.upsert({ ...t, builtin: true });
  assert(repo.themes.list().length === BUILTIN_THEMES.length);
  assert(repo.themes.find('dracula').data.background === '#282a36');
});
check('preferencias guardam JSON estruturado', () => {
  repo.settings.merge(DEFAULT_SETTINGS);
  assert(repo.settings.get('terminal.fontSize') === 14);
  repo.settings.set('window.bounds', { x: 10, y: 20, width: 800, height: 600 });
  assert(repo.settings.get('window.bounds').width === 800);
});

console.log('\n[biblioteca de comandos]');
check('cria, lista, edita e remove snippet', () => {
  const snip = repo.snippets.create({
    name: 'Uso de disco', content: 'df -h', category: 'Diagnostico'
  });
  assert(repo.snippets.list().length === 1);
  assert(repo.snippets.find(snip.id).run === true);
  repo.snippets.update(snip.id, { content: 'df -hT', run: false });
  assert(repo.snippets.find(snip.id).content === 'df -hT');
  assert(repo.snippets.find(snip.id).run === false);
  repo.snippets.remove(snip.id);
  assert(repo.snippets.list().length === 0);
});

console.log('\n[gravacao de sessao]');
const logger = require('../src/main/logger');
checkAsync('gravacao de sessao', 'grava a saida removendo as cores ANSI', async () => {
  const ESC = String.fromCharCode(27);
  const BEL = String.fromCharCode(7);
  const EOL = String.fromCharCode(13, 10);
  const file = path.join(tmp, 'sessao.log');
  logger.start('conn-teste', { template: file, meta: { name: 'teste' }, stripAnsi: true });
  logger.write('conn-teste', ESC + '[31mERRO' + ESC + '[0m ao conectar' + EOL);
  logger.write('conn-teste', ESC + ']0;titulo' + BEL + 'segunda linha' + EOL);
  // `stop` so resolve depois do flush; ler antes disso daria ENOENT.
  const st = await logger.stop('conn-teste');
  assert(st && st.filePath === file, JSON.stringify(st));
  const out = fs.readFileSync(file, 'utf8');
  assert(!out.includes(ESC), 'sobrou sequencia ANSI no log');
  assert(out.includes('ERRO ao conectar'), out);
  assert(out.includes('segunda linha'), out);
});
check('modelo de caminho expande os marcadores', () => {
  const resolved = logger.resolvePath('%name%-%host%-%Y%.log', { name: 'srv 01', host: '10.0.0.1' });
  assert(/srv_01-10\.0\.0\.1-\d{4}\.log$/.test(resolved), resolved);
});

console.log('\n[chaves SSH]');
const keygen = require('../src/main/keygen');
check('gera par ed25519 no formato OpenSSH', () => {
  const pair = keygen.generate({ type: 'ed25519', comment: 'diego@tsm' });
  assert(pair.privateKey.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----'), pair.privateKey.slice(0, 40));
  assert(pair.publicKey.startsWith('ssh-ed25519 AAAA'), pair.publicKey.slice(0, 30));
  assert(/^SHA256:/.test(pair.fingerprint), pair.fingerprint);
  assert(pair.encrypted === false);
});
check('grava o par e le de volta', () => {
  const pair = keygen.generate({ type: 'ed25519', comment: 'teste' });
  const saved = keygen.save(pair, { dir: path.join(tmp, 'keys'), name: 'id_teste' });
  assert(fs.existsSync(saved.privatePath) && fs.existsSync(saved.publicPath));
  const info = keygen.inspect(saved.privatePath);
  assert(info.fingerprint === pair.fingerprint, `${info.fingerprint} != ${pair.fingerprint}`);
  // Nao sobrescreve chave existente sem avisar.
  let sobrescreveu = false;
  try {
    keygen.save(pair, { dir: path.join(tmp, 'keys'), name: 'id_teste' });
    sobrescreveu = true;
  } catch { /* esperado */ }
  assert(!sobrescreveu, 'sobrescreveu uma chave que ja existia');
});
check('chave com senha nao abre sem a senha', () => {
  const pair = keygen.generate({ type: 'rsa', bits: 2048, passphrase: 'segredo123' });
  assert(pair.encrypted === true);
  const saved = keygen.save(pair, { dir: path.join(tmp, 'keys'), name: 'id_rsa_teste' });
  const semSenha = keygen.inspect(saved.privatePath);
  assert(semSenha.needsPassphrase === true, JSON.stringify(semSenha));
  const comSenha = keygen.inspect(saved.privatePath, 'segredo123');
  assert(comSenha.type === 'ssh-rsa', comSenha.type);
});

console.log('\n[modo portatil]');
check('os dados ficam na pasta apontada, nao no perfil do usuario', () => {
  const paths = require('../src/main/paths');
  assert(paths.dataDir() === tmp, `${paths.dataDir()} != ${tmp}`);
  assert(path.dirname(db.getPath()) === tmp, db.getPath());
  assert(paths.logsDir() === path.join(tmp, 'logs'));
  assert(paths.keysDir() === path.join(tmp, 'keys'));
});

console.log('\n[importador MobaXterm]');
const MOBA_LINES = [
  '[Bookmarks]',
  'SubRep=',
  'ImgNum=41',
  'gateway-borda= #109#0%bastion.exemplo.com%22%admin%%-1%-1%%%%%0%0%0%%%-1%0%0%0#MobaFont%10#0# #-1',
  '',
  '[Bookmarks_1]',
  'SubRep=Producao\\Bancos',
  'ImgNum=41',
  'pg-primario= #109#0%10.20.30.40%2222%postgres%1%1%_ProfileDir_\\.ssh\\id_ed25519%%%%0#MobaFont%10#0# #-1',
  'switch-core= #98#1%192.168.1.1%23%admin%%-1%-1%%%%%0#MobaFont%10#0# #-1',
  'area-de-trabalho= #91#4%10.0.0.9%3389%usuario%%%%%0#MobaFont%10#0# #-1',
  'linha-quebrada=isto nao e um bookmark',
  '',
  '[Colors]',
  'ForegroundColour=236,236,236',
  'BackgroundColour=30,30,30',
  'CursorColour=180,180,192',
  'Red=187,0,0',
  'BoldGreen=85,255,85'
];
const MOBA_INI = MOBA_LINES.join('\r\n');

let parsed;
check('faz parse das secoes e monta a hierarquia de pastas', () => {
  parsed = moba.parse(Buffer.from(MOBA_INI, 'latin1'));
  const paths = parsed.folders.map((f) => f.path).sort();
  assert(paths.includes('Producao') && paths.includes('Producao/Bancos'), JSON.stringify(paths));
});
check('mapeia SSH com porta, usuario e caminho de chave', () => {
  const pg = parsed.sessions.find((s) => s.name === 'pg-primario');
  assert(pg, 'sessao pg-primario nao encontrada');
  assert(pg.type === 'ssh', pg.type);
  assert(pg.config.host === '10.20.30.40', pg.config.host);
  assert(pg.config.port === 2222, String(pg.config.port));
  assert(pg.config.username === 'postgres', pg.config.username);
  assert(pg.config.privateKeyPath === '~/.ssh/id_ed25519', pg.config.privateKeyPath);
  assert(pg.config.x11Forward === true && pg.config.compression === true, 'flags nao mapeadas');
  assert(pg.folderPath === 'Producao/Bancos', pg.folderPath);
  assert(typeof pg.config.raw === 'string' && pg.config.raw.length > 10, 'linha original nao preservada');
});
check('mapeia Telnet (codigo de tipo 1)', () => {
  const sw = parsed.sessions.find((s) => s.name === 'switch-core');
  assert(sw && sw.type === 'telnet', sw && sw.type);
  assert(sw.config.host === '192.168.1.1' && sw.config.port === 23);
});
check('relata tipo nao suportado (RDP) em vez de descartar em silencio', () => {
  assert(!parsed.sessions.some((s) => s.name === 'area-de-trabalho'), 'RDP nao deveria ser importado');
  assert(
    parsed.warnings.some((w) => /area-de-trabalho/.test(w) && /rdp/i.test(w)),
    JSON.stringify(parsed.warnings)
  );
});
check('relata linha malformada', () => {
  assert(parsed.warnings.some((w) => /linha-quebrada/.test(w)), JSON.stringify(parsed.warnings));
});
check('converte a secao [Colors] de RGB para hex', () => {
  assert(parsed.theme.background === '#1e1e1e', parsed.theme.background);
  assert(parsed.theme.foreground === '#ececec', parsed.theme.foreground);
  assert(parsed.theme.red === '#bb0000', parsed.theme.red);
  assert(parsed.theme.brightGreen === '#55ff55', parsed.theme.brightGreen);
});
check('aplica ao banco criando pastas e sessoes', () => {
  const before = repo.sessions.count();
  const stats = portability.applyParsed(parsed, { strategy: 'merge' });
  assert(stats.sessions === 3, `criou ${stats.sessions}`);
  assert(repo.sessions.count() === before + 3);
  const pg = repo.sessions.list().find((s) => s.name === 'pg-primario');
  assert(repo.folders.find(pg.folder_id).name === 'Bancos');
});
check('reimportar o mesmo arquivo nao duplica', () => {
  const stats = portability.applyParsed(parsed, { strategy: 'merge' });
  assert(stats.sessions === 0 && stats.skipped === 3, JSON.stringify(stats));
});

console.log('\n[importador PuTTY]');
check('le .reg com nome percent-encoded, dword e port forwarding', () => {
  const reg = [
    'Windows Registry Editor Version 5.00',
    '',
    '[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Servidor%20Web]',
    '"HostName"="web.exemplo.com"',
    '"PortNumber"=dword:00000016',
    '"Protocol"="ssh"',
    '"UserName"="deploy"',
    '"Compression"=dword:00000001',
    '"PortForwardings"="L8080=localhost:80"',
    ''
  ].join('\r\n');
  const p = putty.parseRegistryExport(Buffer.from(reg, 'utf8'));
  assert(p.sessions.length === 1, `achou ${p.sessions.length}`);
  const s = p.sessions[0];
  assert(s.name === 'Servidor Web', s.name);
  assert(s.config.host === 'web.exemplo.com', s.config.host);
  assert(s.config.port === 22, String(s.config.port));
  assert(s.config.username === 'deploy' && s.config.compression === true);
  assert(s.config.portForwards[0].localPort === 8080, JSON.stringify(s.config.portForwards));
});

console.log('\n[export / import nativo]');
check('export sem credenciais nao vaza senha', () => {
  const payload = portability.buildExport({ includeSecrets: false });
  assert(payload.format === 'tsm-export' && payload.encrypted === false);
  assert(payload.sessions.length === repo.sessions.count());
  assert(payload.secrets === null);
  assert(!JSON.stringify(payload).includes('senha-super-secreta'), 'vazou senha no export');
});
check('export com credenciais cifra o bloco e o import restaura', () => {
  const file = path.join(tmp, 'export.tsm.json');
  portability.exportToFile(file, { includeSecrets: true, passphrase: 'arquivo-2026' });
  const raw = fs.readFileSync(file, 'utf8');
  assert(!raw.includes('senha-super-secreta'), 'senha em claro no arquivo');

  repo.tx(() => {
    for (const s of repo.sessions.list()) repo.sessions.remove(s.id);
  });
  assert(repo.sessions.count() === 0);

  const res = portability.importFromFile(file, { strategy: 'merge', passphrase: 'arquivo-2026' });
  assert(res.stats.sessions > 500, `restaurou ${res.stats.sessions}`);
  assert(vault.read('session', s1.id, 'password') === 'senha-super-secreta');
});
check('import recusa senha errada', () => {
  const file = path.join(tmp, 'export.tsm.json');
  let importou = false;
  try {
    portability.importFromFile(file, { strategy: 'merge', passphrase: 'errada' });
    importou = true;
  } catch (err) {
    assert(/incorreta|corrompido/.test(err.message), err.message);
  }
  assert(!importou, 'importou com a senha errada');
});
check('previa nao grava nada no banco', () => {
  const before = repo.sessions.count();
  const p = portability.previewFile(path.join(tmp, 'export.tsm.json'));
  assert(p.encrypted === true && p.sessions.length > 0);
  assert(repo.sessions.count() === before);
});

console.log('\n[telnet]');
const IAC = 255;
const DO = 253;
const WILL = 251;
const SB = 250;
const SE = 240;
const TTYPE = 24;
const ECHO = 1;

check('negocia opcoes e separa texto dos comandos IAC', () => {
  const conn = new telnet.TelnetConnection({ host: 'x', port: 23 }, {});
  const sent = [];
  conn.socket = { write: (b) => sent.push(Buffer.from(b)), destroyed: false };
  let text = '';
  conn.on('data', (d) => { text += d; });

  conn._onData(Buffer.from([IAC, DO, TTYPE, IAC, WILL, ECHO, IAC, SB, TTYPE, 1, IAC, SE]));
  conn._onData(Buffer.from('login: ', 'ascii'));
  assert(text === 'login: ', JSON.stringify(text));

  const all = Buffer.concat(sent);
  assert(all.includes(Buffer.from([IAC, WILL, TTYPE])), 'nao respondeu WILL TERMINAL-TYPE');
  assert(all.includes(Buffer.from([IAC, DO, ECHO])), 'nao respondeu DO ECHO');
  assert(all.includes(Buffer.from('xterm-256color', 'ascii')), 'nao enviou o terminal-type');
});
check('trata comando IAC partido entre dois chunks', () => {
  const conn = new telnet.TelnetConnection({ host: 'x' }, {});
  conn.socket = { write: () => {}, destroyed: false };
  let text = '';
  conn.on('data', (d) => { text += d; });
  conn._onData(Buffer.from([65, IAC]));
  conn._onData(Buffer.from([DO, TTYPE, 66]));
  assert(text === 'AB', JSON.stringify(text));
});
check('escapa 0xFF digitado como IAC IAC', () => {
  const conn = new telnet.TelnetConnection({ host: 'x', encoding: 'latin1' }, {});
  const sent = [];
  conn.socket = { write: (b) => sent.push(Buffer.from(b)), destroyed: false };
  conn.write(Buffer.from([65, 255, 66]).toString('latin1'));
  const out = Buffer.concat(sent);
  assert(out.equals(Buffer.from([65, 255, 255, 66])), out.toString('hex'));
});

console.log('\n[shell local]');
check(
  `detecta shells (${shellTransport.detectShells().length} encontrados, pty=${shellTransport.hasPty()})`,
  () => {
    assert(shellTransport.detectShells().length > 0);
    assert(shellTransport.defaultShell().path);
  }
);

checkAsync('backup', 'gera copia do banco', async () => {
  const dest = path.join(tmp, 'backup.db');
  await db.get().backup(dest);
  assert(fs.existsSync(dest), 'arquivo de backup nao foi criado');
  assert(fs.statSync(dest).size > 0, 'backup vazio');
});

async function finish() {
  await runPending();
  db.close();
  console.log(`\n${pass} passaram, ${fail} falharam\n`);
  if (!fail) fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}

finish();
