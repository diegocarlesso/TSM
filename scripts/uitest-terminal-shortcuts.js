/**
 * Confere que atalhos do app (Ctrl+Shift+seta, Ctrl+Shift+W, Ctrl+W) chegam
 * até o listener global mesmo com um terminal em foco.
 *
 * Antes da correção, o xterm.js processava TODO keydown internamente (sem
 * `attachCustomKeyEventHandler`) e chamava preventDefault/stopPropagation
 * mesmo para teclas que o app precisava tratar — o evento nunca chegava no
 * `window`. O teste dispara o evento no MESMO elemento que o xterm escuta
 * de verdade (`.xterm-helper-textarea`), não em `window` diretamente, porque
 * disparar em `window` não reproduz o bug (contorna o xterm por completo).
 *
 *   TSM_DATA_DIR=./demo node scripts/seed-demo.js
 *   TSM_SMOKE=1 TSM_UITEST=scripts/uitest-terminal-shortcuts.js TSM_DATA_DIR=./demo npx electron .
 */
(async () => {
  const log = [];
  let ok = true;
  const record = (passou, texto, detalhe) => {
    log.push(`  ${passou ? 'ok   ' : 'FALHA'} ${texto}` + (!passou && detalhe ? `\n        ${detalhe}` : ''));
    if (!passou) ok = false;
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const waitFor = async (fn, label, timeout = 8000) => {
    const limite = Date.now() + timeout;
    while (Date.now() < limite) {
      const v = fn();
      if (v) return v;
      await sleep(80);
    }
    throw new Error(`tempo esgotado esperando: ${label}`);
  };

  const keyOnTextarea = (textarea, key, mods = {}) => {
    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key, code: key, ctrlKey: true, bubbles: true, cancelable: true, ...mods
    }));
  };

  try {
    log.push('\n[atalhos dentro do terminal]');

    $('#btn-tab-shell').click();
    // shellMenuOrDefault() consulta os shells instalados por IPC antes de
    // decidir entre abrir direto ou mostrar o menu de escolha — o tempo disso
    // varia, então espera por QUALQUER um dos dois em vez de um sleep fixo.
    await waitFor(() => $('.context-menu') || $$('#tabs .tab').length >= 1, 'menu de shells ou aba abrir');
    const menu = $('.context-menu');
    if (menu) menu.querySelector('.item')?.click();
    await waitFor(() => $$('#tabs .tab').length >= 1, 'aba de shell abrir');
    await sleep(400); // término da conexão do pty + montagem do xterm

    const textarea = await waitFor(() => $('.xterm-helper-textarea'), 'textarea do xterm existir');
    textarea.focus();

    const leavesAntes = $$('.tab-view.active .leaf').length;
    keyOnTextarea(textarea, 'ArrowRight', { shiftKey: true });
    await waitFor(() => $$('.tab-view.active .leaf').length > leavesAntes, 'Ctrl+Shift+seta dividir o painel');
    record(true, 'Ctrl+Shift+→ dividido no terminal chega até o app (divide o painel)');

    const tabsAntes = $$('#tabs .tab').length;
    const textarea2 = await waitFor(() => $('.tab-view.active .leaf.focused .xterm-helper-textarea')
      || $('.tab-view.active .leaf:last-child .xterm-helper-textarea'), 'textarea do painel em foco');
    keyOnTextarea(textarea2, 'w', { shiftKey: true });
    await waitFor(() => $$('.tab-view.active .leaf').length < leavesAntes + 1, 'Ctrl+Shift+W fechar o painel');
    record(true, 'Ctrl+Shift+W no terminal fecha só o painel em foco');

    const textarea3 = await waitFor(() => $('.xterm-helper-textarea'), 'textarea restante');
    keyOnTextarea(textarea3, 'w');
    // painel já conectado -> pede confirmação antes de fechar a aba.
    await waitFor(() => $('.modal-backdrop') || $$('#tabs .tab').length < tabsAntes, 'confirmação ou aba fechar');
    const confirmacao = $('.modal-backdrop');
    if (confirmacao) confirmacao.querySelector('.modal-foot button.danger, .modal-foot button:last-child')?.click();
    await waitFor(() => $$('#tabs .tab').length < tabsAntes, 'Ctrl+W fechar a aba');
    record(true, 'Ctrl+W no terminal fecha a aba');
  } catch (err) {
    record(false, 'exceção durante o teste', err.message);
  }

  return { ok, log };
})();
