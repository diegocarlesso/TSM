'use strict';
const { Menu, app, shell } = require('electron');

/** Manda o comando para o renderer, que sabe qual aba esta ativa. */
function send(win, command, payload) {
  if (win && !win.isDestroyed()) win.webContents.send('tsm:menu', { command, payload });
}

function build(win) {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{
      label: app.getName(),
      submenu: [
        { role: 'about', label: 'Sobre o TSM' },
        { type: 'separator' },
        { label: 'Preferências...', accelerator: 'Cmd+,', click: () => send(win, 'settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: 'Ocultar' },
        { role: 'hideOthers', label: 'Ocultar outros' },
        { role: 'unhide', label: 'Mostrar todos' },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' }
      ]
    }] : []),

    {
      label: '&Sessões',
      submenu: [
        { label: 'Nova sessão...', accelerator: 'CmdOrCtrl+N', click: () => send(win, 'session:new') },
        { label: 'Conexão rápida...', accelerator: 'CmdOrCtrl+Shift+N', click: () => send(win, 'quickconnect') },
        { label: 'Nova pasta...', accelerator: 'CmdOrCtrl+Shift+F', click: () => send(win, 'folder:new') },
        { type: 'separator' },
        { label: 'Shell local', accelerator: 'CmdOrCtrl+Shift+T', click: () => send(win, 'shell:new') },
        { type: 'separator' },
        { label: 'Duplicar em nova aba', accelerator: 'CmdOrCtrl+D', click: () => send(win, 'tab:duplicate') },
        { label: 'Fechar aba', accelerator: 'CmdOrCtrl+W', click: () => send(win, 'tab:close') },
        { label: 'Reconectar painel', accelerator: 'CmdOrCtrl+R', click: () => send(win, 'tab:reconnect') },
        { type: 'separator' },
        { label: 'Dividir a direita', accelerator: 'CmdOrCtrl+Shift+Right', click: () => send(win, 'split:right') },
        { label: 'Dividir abaixo', accelerator: 'CmdOrCtrl+Shift+Down', click: () => send(win, 'split:down') },
        { label: 'Fechar painel', accelerator: 'CmdOrCtrl+Shift+W', click: () => send(win, 'pane:close') },
        { type: 'separator' },
        { label: 'Importar sessões...', click: () => send(win, 'import') },
        { label: 'Exportar sessões...', click: () => send(win, 'export') },
        { label: 'Backup do banco...', click: () => send(win, 'backup') },
        { label: 'Abrir a pasta de dados', click: () => send(win, 'opendata') },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit', label: 'Sair' }])
      ]
    },

    {
      label: '&Editar',
      submenu: [
        { label: 'Copiar', accelerator: 'CmdOrCtrl+Shift+C', click: () => send(win, 'term:copy') },
        { label: 'Colar', accelerator: 'CmdOrCtrl+Shift+V', click: () => send(win, 'term:paste') },
        { label: 'Selecionar tudo', accelerator: 'CmdOrCtrl+Shift+A', click: () => send(win, 'term:selectAll') },
        { type: 'separator' },
        { label: 'Localizar no terminal...', accelerator: 'CmdOrCtrl+F', click: () => send(win, 'term:find') },
        { label: 'Limpar terminal', accelerator: 'CmdOrCtrl+K', click: () => send(win, 'term:clear') },
        { type: 'separator' },
        { label: 'Buscar sessão...', accelerator: 'CmdOrCtrl+P', click: () => send(win, 'palette') }
      ]
    },

    {
      label: '&Exibir',
      submenu: [
        { label: 'Mostrar/ocultar barra lateral', accelerator: 'CmdOrCtrl+B', click: () => send(win, 'toggle:sidebar') },
        { label: 'Painel de arquivos (SFTP)', accelerator: 'CmdOrCtrl+Shift+E', click: () => send(win, 'toggle:sftp') },
        { type: 'separator' },
        { label: 'Aumentar fonte', accelerator: 'CmdOrCtrl+=', click: () => send(win, 'font:inc') },
        { label: 'Diminuir fonte', accelerator: 'CmdOrCtrl+-', click: () => send(win, 'font:dec') },
        { label: 'Fonte padrão', accelerator: 'CmdOrCtrl+0', click: () => send(win, 'font:reset') },
        { type: 'separator' },
        { label: 'Aparência...', click: () => send(win, 'appearance') },
        { role: 'togglefullscreen', label: 'Tela cheia' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Ferramentas de desenvolvedor' },
        { role: 'reload', label: 'Recarregar interface' }
      ]
    },

    {
      label: 'Fe&rramentas',
      submenu: [
        { label: 'Biblioteca de comandos...', accelerator: 'CmdOrCtrl+Shift+S', click: () => send(win, 'snippets') },
        { label: 'Túneis da sessão...', click: () => send(win, 'tunnels') },
        { label: 'Gravar sessão em arquivo...', click: () => send(win, 'sessionlog') },
        { label: 'MultiExec', accelerator: 'CmdOrCtrl+Shift+M', click: () => send(win, 'multiexec') },
        { type: 'separator' },
        { label: 'Chaves SSH...', click: () => send(win, 'keys') },
        { label: 'Credenciais salvas...', click: () => send(win, 'identities') },
        { label: 'Chaves de host conhecidas...', click: () => send(win, 'knownhosts') },
        { label: 'Histórico de conexões...', click: () => send(win, 'history') },
        { type: 'separator' },
        { label: 'Configurações...', accelerator: 'CmdOrCtrl+,', click: () => send(win, 'settings') },
        { label: 'Bloquear cofre', accelerator: 'CmdOrCtrl+L', click: () => send(win, 'vault:lock') }
      ]
    },

    {
      label: 'A&juda',
      submenu: [
        { label: 'Atalhos de teclado', click: () => send(win, 'help:shortcuts') },
        { label: 'Repositório do projeto', click: () => shell.openExternal('https://github.com/diegocarlesso/TSM') },
        { label: 'Sobre o TSM', click: () => send(win, 'help:about') }
      ]
    }
  ];

  return Menu.buildFromTemplate(template);
}

function install(win) {
  Menu.setApplicationMenu(build(win));
}

module.exports = { install, build };
