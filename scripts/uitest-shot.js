/**
 * Roteiro que deixa a interface num estado representativo para a captura:
 * algumas sessões na árvore e uma aba dividida em três painéis.
 *
 *   TSM_UITEST=scripts/uitest-shot.js TSM_SHOT=tela.png TSM_SMOKE=1 npx electron .
 *
 * Usa as mesmas APIs da interface — nada de porta de teste no produto.
 */
(async () => {
  const log = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const waitFor = async (fn, label, timeout = 8000) => {
    const limite = Date.now() + timeout;
    while (Date.now() < limite) {
      const v = fn();
      if (v) return v;
      await sleep(60);
    }
    throw new Error(`tempo esgotado: ${label}`);
  };

  const key = (k, mods = {}) => window.dispatchEvent(new KeyboardEvent('keydown', {
    key: k, bubbles: true, cancelable: true,
    ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt
  }));

  try {
    // A árvore já vem semeada por scripts/seed-demo.js — recarregar a página
    // aqui mataria a promise que o processo principal esta aguardando.
    await waitFor(() => $$('#tree .node').length > 3, 'árvore povoada');

    // Abre as pastas para a captura mostrar a hierarquia.
    for (const node of $$('#tree .node.folder')) {
      if (node.querySelector('.twisty').textContent === '▸') node.click();
      await sleep(120);
    }
    await sleep(300);

    // --- uma aba dividida em três painéis --------------------------------
    $('#welcome [data-action="shell"]').click();
    const menu = await waitFor(() => $('.context-menu'), 'menu de shells');
    menu.querySelector('.item').click();
    await waitFor(() => $('.tab-view.active .xterm'), 'terminal montado');
    await sleep(600);

    key('ArrowRight', { ctrl: true, shift: true });
    await waitFor(() => $$('.tab-view.active .leaf').length === 2, 'segundo painel');
    await sleep(500);

    key('ArrowDown', { ctrl: true, shift: true });
    await waitFor(() => $$('.tab-view.active .leaf').length === 3, 'terceiro painel');

    // Deixa os shells imprimirem alguma coisa, senão a captura fica vazia.
    await sleep(2200);

    log.push(`  ok    estado montado: ${$$('#tree .node').length} nos na árvore, ` +
             `${$$('.tab-view.active .leaf').length} painéis na aba`);
    return { ok: true, log };
  } catch (err) {
    log.push(`  FALHA ao montar o estado: ${err.message}`);
    return { ok: false, log };
  }
})()
