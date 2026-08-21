/**
 * Roteiro de teste do split de paineis, executado DENTRO do renderer.
 *
 *   TSM_UITEST=scripts/uitest-split.js TSM_SMOKE=1 npx electron .
 *
 * Dirige a interface so por eventos de DOM reais — clique e teclado — para nao
 * existir nenhuma porta de teste no codigo de producao. Devolve `{ ok, log }`.
 */
(async () => {
  const log = [];
  let ok = true;

  const record = (passou, texto, detalhe) => {
    // O detalhe so aparece quando falha; num teste que passou, seria ruido.
    const extra = !passou && detalhe ? `\n        ${detalhe}` : '';
    log.push(`  ${passou ? 'ok   ' : 'FALHA'} ${texto}${extra}`);
    if (!passou) ok = false;
    return passou;
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const waitFor = async (fn, label, timeout = 8000) => {
    const limite = Date.now() + timeout;
    while (Date.now() < limite) {
      const v = fn();
      if (v) return v;
      await sleep(60);
    }
    throw new Error(`tempo esgotado esperando: ${label}`);
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const leaves = () => $$('.tab-view.active .leaf');
  const tabs = () => $$('#tabs .tab');

  const key = (k, mods = {}) => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: k, bubbles: true, cancelable: true,
      ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt
    }));
  };

  /**
   * Confirma o fechamento. A confirmacao so aparece se a sessao ja estava
   * conectada, entao aceitamos os dois caminhos e reportamos qual ocorreu.
   */
  const confirmarSePreciso = async () => {
    const limite = Date.now() + 2500;
    while (Date.now() < limite) {
      const backdrop = $('.modal-backdrop');
      if (backdrop) {
        [...backdrop.querySelectorAll('.modal-foot button')].pop().click();
        await waitFor(() => !$('.modal-backdrop'), 'dialogo fechar', 3000);
        return 'confirmado';
      }
      await sleep(60);
    }
    return 'sem confirmacao';
  };

  try {
    log.push('\n[identidade visual]');
    const logo = $('.welcome-logo');
    record(
      !!logo && logo.complete && logo.naturalWidth > 0,
      'o icone de assets/ carrega na tela inicial (CSP nao bloqueia)',
      logo ? `naturalWidth=${logo.naturalWidth}` : 'elemento nao existe'
    );
    record(!!$('.brand-logo'), 'o icone aparece na marca da barra lateral');

    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim().toLowerCase();
    record(accent === '#0090f0', 'a cor de destaque vem da paleta do icone', `--accent = ${accent}`);
    record(
      css.getPropertyValue('--brand-grad').includes('168, 240, 24')
        || css.getPropertyValue('--brand-grad').includes('a8f018'),
      'o gradiente da marca usa o lima do icone',
      `--brand-grad = ${css.getPropertyValue('--brand-grad').trim()}`
    );

    log.push('\n[split de paineis]');

    // --- abre um shell local pelo caminho normal da interface ------------
    $('#welcome [data-action="shell"]').click();
    const menu = await waitFor(() => $('.context-menu'), 'menu de shells');
    menu.querySelector('.item').click();

    await waitFor(() => leaves().length === 1, 'primeiro painel');
    await waitFor(() => $('.tab-view.active .xterm'), 'terminal montado');
    record(tabs().length === 1, 'abre uma aba com um painel');

    // O shell local emite `ready` antes de o renderer saber o id da conexao;
    // se a fila de eventos regredir, a aba fica presa em "conectando".
    let statusFinal = '';
    const conectou = await waitFor(
      () => {
        statusFinal = $('#status-right').textContent;
        return /conectado/.test(statusFinal) && $$('#tabs .tab .tab-state.ok').length > 0;
      },
      'status virar conectado', 6000
    ).catch(() => false);
    record(!!conectou, 'o status chega a "conectado" (eventos iniciais nao se perdem)', statusFinal);

    const primeiroPaneId = leaves()[0].dataset.paneId;

    // --- divide a direita -------------------------------------------------
    key('ArrowRight', { ctrl: true, shift: true });
    await waitFor(() => leaves().length === 2, 'segundo painel');
    record(
      !!$('.tab-view.active .split.row'),
      'Ctrl+Shift+Direita divide lado a lado',
      $('.tab-view.active .split') ? undefined : 'nenhum elemento .split no DOM'
    );
    record(tabs().length === 1, 'a divisao acontece DENTRO da aba, sem criar outra');
    record($$('.tab-view.active .split-handle').length === 1, 'cria uma divisoria arrastavel');
    record(
      !!$('#tabs .tab .tab-count'),
      'a aba mostra a contagem de paineis'
    );

    // o terminal do primeiro painel precisa ter sobrevivido ao remanejo do DOM
    const primeiroAindaVivo = leaves().some(
      (l) => l.dataset.paneId === primeiroPaneId && l.querySelector('.xterm')
    );
    record(primeiroAindaVivo, 'o terminal ja aberto sobrevive ao split (nao e recriado)');

    // --- divide abaixo ----------------------------------------------------
    key('ArrowDown', { ctrl: true, shift: true });
    await waitFor(() => leaves().length === 3, 'terceiro painel');
    record(!!$('.tab-view.active .split.col'), 'Ctrl+Shift+Abaixo divide na horizontal');
    record($$('.tab-view.active .split-handle').length === 2, 'duas divisorias com tres paineis');

    // --- foco e navegacao -------------------------------------------------
    const focadoAntes = $('.tab-view.active .leaf.focused');
    record(!!focadoAntes, 'o painel em foco fica destacado');

    key('ArrowLeft', { alt: true });
    await sleep(200);
    const focadoDepois = $('.tab-view.active .leaf.focused');
    record(
      focadoDepois && focadoAntes && focadoDepois.dataset.paneId !== focadoAntes.dataset.paneId,
      'Alt+Esquerda move o foco para o painel vizinho',
      focadoDepois ? `foco continuou em ${focadoDepois.dataset.paneId}` : 'nenhum painel em foco'
    );

    // --- redimensionar pela divisoria -------------------------------------
    const handle = $('.tab-view.active .split-handle.row');
    const antes = handle.previousElementSibling.getBoundingClientRect().width;
    const box = handle.getBoundingClientRect();
    handle.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, clientX: box.left + 2, clientY: box.top + 20
    }));
    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, clientX: box.left - 120, clientY: box.top + 20
    }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await sleep(250);
    const depois = $('.tab-view.active .split-handle.row').previousElementSibling
      .getBoundingClientRect().width;
    record(
      Math.abs(depois - antes) > 40,
      'arrastar a divisoria redimensiona os paineis',
      `largura ${Math.round(antes)} -> ${Math.round(depois)}`
    );

    // --- fecha um painel --------------------------------------------------
    // Espera o shell conectar de fato: e o caminho que pede confirmacao.
    await waitFor(
      () => $$('#tabs .tab .tab-state.ok').length > 0,
      'shell conectar',
      8000
    ).catch(() => null);

    key('w', { ctrl: true, shift: true });
    await confirmarSePreciso();
    await waitFor(() => leaves().length === 2, 'painel fechado');
    record(true, 'Ctrl+Shift+W fecha so o painel em foco');
    record(tabs().length === 1, 'a aba continua aberta com os paineis restantes');
    record(
      $$('.tab-view.active .split-handle').length === 1,
      'a divisao que ficou com um filho so e desfeita'
    );

    // --- fecha a aba inteira ----------------------------------------------
    key('w', { ctrl: true });
    await confirmarSePreciso();
    await waitFor(() => tabs().length === 0, 'aba fechada');
    record(leaves().length === 0, 'Ctrl+W fecha a aba com todos os paineis');
    record(
      !$('#welcome').classList.contains('hidden'),
      'a tela de boas-vindas volta quando nao ha mais abas'
    );
  } catch (err) {
    record(false, 'roteiro interrompido', err.message);
  }

  return { ok, log };
})()
