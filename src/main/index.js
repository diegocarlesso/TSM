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
    backgroundColor: '#12161c',
    title: 'Total Session Manager',
    icon: path.join(__dirname, '../../build/icon.png'),
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
    repo.settings.set('window.maximized', mainWindow.isMaximized());
    if (!mainWindow.isMaximized() && !mainWindow.isFullScreen()) {
      repo.settings.set('window.bounds', mainWindow.getNormalBounds());
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

  // TSM_SMOKE=1 abre, espera a interface montar e sai — usado no teste de fumaca.
  if (process.env.TSM_SMOKE) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const ok = await mainWindow.webContents.executeJavaScript(
          'Boolean(document.querySelector("#tree") && window.tsm && !document.querySelector("body > pre"))'
        );
        console.log(ok ? '[smoke-ui] interface montou' : '[smoke-ui] FALHA ao montar a interface');
        app.exit(ok ? 0 : 1);
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

app.on('before-quit', () => {
  manager.closeAll();
  db.close();
});

process.on('uncaughtException', (err) => {
  console.error('[TSM] excecao nao tratada:', err);
});
