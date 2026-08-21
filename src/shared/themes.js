'use strict';
/** Temas de terminal embutidos. Compartilhado entre main (seed) e renderer. */

const BUILTIN_THEMES = [
  {
    id: 'tsm-dark',
    name: 'TSM Dark',
    data: {
      background: '#12161c', foreground: '#d6deeb', cursor: '#7ee787', cursorAccent: '#12161c',
      selectionBackground: '#264f78',
      black: '#1b1f27', red: '#ff6b6b', green: '#7ee787', yellow: '#ffd866',
      blue: '#6cb6ff', magenta: '#d2a8ff', cyan: '#67e8f9', white: '#c9d1d9',
      brightBlack: '#5c6773', brightRed: '#ff8787', brightGreen: '#95f6a1', brightYellow: '#ffe08a',
      brightBlue: '#8cc8ff', brightMagenta: '#e2c4ff', brightCyan: '#9beefc', brightWhite: '#f0f6fc'
    }
  },
  {
    id: 'mobaxterm-like',
    name: 'MobaXterm Classic',
    data: {
      background: '#000000', foreground: '#bbbbbb', cursor: '#bbbbbb', cursorAccent: '#000000',
      selectionBackground: '#3465a4',
      black: '#000000', red: '#bb0000', green: '#00bb00', yellow: '#bbbb00',
      blue: '#0000bb', magenta: '#bb00bb', cyan: '#00bbbb', white: '#bbbbbb',
      brightBlack: '#555555', brightRed: '#ff5555', brightGreen: '#55ff55', brightYellow: '#ffff55',
      brightBlue: '#5555ff', brightMagenta: '#ff55ff', brightCyan: '#55ffff', brightWhite: '#ffffff'
    }
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    data: {
      background: '#002b36', foreground: '#839496', cursor: '#93a1a1', cursorAccent: '#002b36',
      selectionBackground: '#073642',
      black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
      blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
      brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
      brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3'
    }
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    data: {
      background: '#fdf6e3', foreground: '#657b83', cursor: '#586e75', cursorAccent: '#fdf6e3',
      selectionBackground: '#eee8d5',
      black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
      blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
      brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
      brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3'
    }
  },
  {
    id: 'dracula',
    name: 'Dracula',
    data: {
      background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', cursorAccent: '#282a36',
      selectionBackground: '#44475a',
      black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
      blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
      brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5',
      brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff'
    }
  },
  {
    id: 'nord',
    name: 'Nord',
    data: {
      background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9', cursorAccent: '#2e3440',
      selectionBackground: '#434c5e',
      black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
      blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
      brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4'
    }
  },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    data: {
      background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2', cursorAccent: '#282828',
      selectionBackground: '#504945',
      black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921',
      blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984',
      brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26', brightYellow: '#fabd2f',
      brightBlue: '#83a598', brightMagenta: '#d3869b', brightCyan: '#8ec07c', brightWhite: '#ebdbb2'
    }
  },
  {
    id: 'one-light',
    name: 'One Light',
    data: {
      background: '#fafafa', foreground: '#383a42', cursor: '#526fff', cursorAccent: '#fafafa',
      selectionBackground: '#d0d0d0',
      black: '#383a42', red: '#e45649', green: '#50a14f', yellow: '#c18401',
      blue: '#4078f2', magenta: '#a626a4', cyan: '#0184bc', white: '#a0a1a7',
      brightBlack: '#4f525d', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b',
      brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#f2f2f2'
    }
  },
  {
    id: 'campbell',
    name: 'Campbell (Windows Terminal)',
    data: {
      background: '#0c0c0c', foreground: '#cccccc', cursor: '#cccccc', cursorAccent: '#0c0c0c',
      selectionBackground: '#3a96dd',
      black: '#0c0c0c', red: '#c50f1f', green: '#13a10e', yellow: '#c19c00',
      blue: '#0037da', magenta: '#881798', cyan: '#3a96dd', white: '#cccccc',
      brightBlack: '#767676', brightRed: '#e74856', brightGreen: '#16c60c', brightYellow: '#f9f1a5',
      brightBlue: '#3b78ff', brightMagenta: '#b4009e', brightCyan: '#61d6d6', brightWhite: '#f2f2f2'
    }
  }
];

/** Aparencia da janela (fora do terminal). */
const UI_THEMES = [
  { id: 'dark', name: 'Escuro' },
  { id: 'light', name: 'Claro' },
  { id: 'system', name: 'Seguir o sistema' }
];

const DEFAULT_SETTINGS = {
  'ui.theme': 'dark',
  'ui.accent': '#4f9cf9',
  'ui.sidebarWidth': 280,
  'ui.language': 'pt-BR',
  'terminal.theme': 'tsm-dark',
  'terminal.fontFamily': 'Cascadia Mono, JetBrains Mono, Consolas, Menlo, DejaVu Sans Mono, monospace',
  'terminal.fontSize': 14,
  'terminal.lineHeight': 1.2,
  'terminal.letterSpacing': 0,
  'terminal.cursorStyle': 'block',
  'terminal.cursorBlink': true,
  'terminal.scrollback': 100000,
  'terminal.bellSound': false,
  'terminal.rightClick': 'paste',
  'terminal.copyOnSelect': true,
  'terminal.wordSeparators': ' ()[]{}\'",;:│',
  'connection.confirmClose': true,
  'connection.reconnectOnDrop': false,
  'security.lockOnMinimize': false
};

module.exports = { BUILTIN_THEMES, UI_THEMES, DEFAULT_SETTINGS };
