'use strict';
const path = require('node:path');
const { app, BrowserWindow, nativeTheme, session } = require('electron');

const db = require('./store/db');
const repo = require('./store/repo');
const ipc = require('./ipc');
const menu = require('./menu');
const manager = require('./transports/manager');
const { BUILTIN_THEMES, DEFAULT_SETTINGS } = require('../shared/themes');

// Uma instancia so: a segunda foca a janela existente em vez de abrir outra.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let smokeExitCode = 0;

function seed() {
  repo.tx(() => {
    for (const t of BUILTIN_THEMES) {
      if (!repo.themes.find(t.id)) repo.themes.upsert({ ...t, builtin: true });
    }
    const current = repo.settings.all();
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      if (current[k] === undefined) repo.settings.set(k, v);
    }
  });
}

function restoreBounds() {
  const saved = repo.settings.get('window.bounds', null);
  const base = { width: 1360, height: 860, minWidth: 900, minHeight: 560 };
  if (!saved) return base;
  return { ...base, ...saved };
}

function createWindow() {
  const bounds = restoreBounds();

  mainWindow = new BrowserWindow({
    ...bounds,
    show: false,
    backgroundColor: '#0c1422',   // igual ao --bg-1, evita flash branco ao abrir
    title: 'Total Session Manager',
    icon: path.join(__dirname, '../../assets/icon-512.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      webviewTag: false
    }
  });

  if (repo.settings.get('window.maximized', false)) mainWindow.maximize();

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  const persistBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      repo.settings.set('window.maximized', mainWindow.isMaximized());
      if (!mainWindow.isMaximized() && !mainWindow.isFullScreen()) {
        repo.settings.set('window.bounds', mainWindow.getNormalBounds());
      }
    } catch (err) {
      // Salvar a geometria nunca pode impedir a janela de fechar.
      console.error('[TSM] nao foi possivel salvar a geometria:', err.message);
    }
  };
  mainWindow.on('resize', debounce(persistBounds, 400));
  mainWindow.on('move', debounce(persistBounds, 400));
  mainWindow.on('close', persistBounds);

  mainWindow.on('minimize', () => {
    if (repo.settings.get('security.lockOnMinimize', false)) {
      require('./security/vault').lock();
    }
  });

  // Nada de navegar para fora nem abrir janelas: links vao para o navegador.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  // Em desenvolvimento, erros do renderer aparecem no terminal em vez de ficarem
  // presos no DevTools — sem isso, uma falha de boot vira uma janela em branco.
  if (!app.isPackaged) {
    mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      if (level >= 2) console.error(`[renderer] ${message} (${sourceId}:${line})`);
    });
    mainWindow.webContents.on('render-process-gone', (_e, details) =>
      console.error('[renderer] processo caiu:', details));
  }

  // Ganchos de teste, ativados so por variavel de ambiente:
  //   TSM_SMOKE=1              -> abre, confere que a interface montou e sai;
  //   TSM_UITEST=<arquivo.js>  -> alem disso, roda um roteiro no renderer.
  // O roteiro dirige a interface por eventos de DOM reais, entao nao existe
  // nenhuma porta de teste exposta no codigo de producao.
  if (process.env.TSM_SMOKE || process.env.TSM_UITEST) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        let ok = await mainWindow.webContents.executeJavaScript(
          'Boolean(document.querySelector("#tree") && window.tsm && !document.querySelector("body > pre"))'
        );
        console.log(ok ? '[smoke-ui] interface montou' : '[smoke-ui] FALHA ao montar a interface');

        if (ok && process.env.TSM_UITEST) {
          try {
            const roteiro = require('node:fs').readFileSync(process.env.TSM_UITEST, 'utf8');
            const res = await mainWindow.webContents.executeJavaScript(roteiro, true);
            for (const linha of res.log) console.log(linha);
            ok = res.ok;
          } catch (err) {
            console.error('[uitest] roteiro falhou:', err.message);
            ok = false;
          }
        }

        // TSM_SHOT=<arquivo.png> salva uma captura da janela — util para
        // conferir a aparencia sem depender de alguem olhar a tela.
        if (process.env.TSM_SHOT) {
          try {
            const img = await mainWindow.webContents.capturePage();
            require('node:fs').writeFileSync(process.env.TSM_SHOT, img.toPNG());
            console.log(`[shot] ${process.env.TSM_SHOT}`);
          } catch (err) {
            console.error('[shot] falhou:', err.message);
          }
        }

        smokeExitCode = ok ? 0 : 1;
        // `quit` (e nao `exit`) para passar pelo `before-quit`: fechar conexoes
        // e o banco. `app.exit` deixaria processos filhos orfaos no Windows.
        app.quit();
        setTimeout(() => app.exit(smokeExitCode), 4000).unref();
      }, 2500);
    });
  }

  menu.install(mainWindow);
  mainWindow.on('closed', () => { mainWindow = null; });
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  db.open();
  seed();

  // CSP restritiva: o renderer e local e nao carrega nada da rede.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data:; font-src 'self' data:; connect-src 'none'"
        ]
      }
    });
  });

  nativeTheme.themeSource = repo.settings.get('ui.theme', 'dark') === 'system'
    ? 'system'
    : repo.settings.get('ui.theme', 'dark');

  ipc.register();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// A ordem aqui importa: `before-quit` roda ANTES de as janelas fecharem, e o
// handler de `close` ainda grava as dimensoes da janela no banco. Fechar o banco
// aqui fazia essa gravacao estourar e o encerramento travar. Conexoes podem
// cair cedo; o banco so fecha em `will-quit`, com todas as janelas ja fechadas.
let shuttingDown = false;
app.on('before-quit', () => {
  if (shuttingDown) return;
  shuttingDown = true;
  manager.closeAll();
});

app.on('will-quit', () => {
  db.close();
});

app.on('quit', () => {
  if (process.env.TSM_SMOKE) process.exitCode = smokeExitCode;
});

process.on('uncaughtException', (err) => {
  console.error('[TSM] excecao nao tratada:', err);
});
