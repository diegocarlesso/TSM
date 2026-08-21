/**
 * Abre uma sessão serial numa porta REAL e exercita o caminho todo.
 *
 *   TSM_DATA_DIR=... node scripts/seed-serial.js
 *   TSM_SMOKE=1 TSM_UITEST=scripts/uitest-serial-real.js TSM_SHOT=x.png npx electron .
 *
 * O que dá para afirmar sem equipamento do outro lado: a porta abre com os
 * parâmetros pedidos, bytes saem por ela, e uma segunda tentativa de abrir a
 * mesma porta recebe o erro real do sistema operacional. O que NÃO dá para
 * afirmar: que algum aparelho respondeu — para isso é preciso um cabo com algo
 * na outra ponta (ou um loopback nos pinos 2-3).
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

  const key = (k, mods = {}) => window.dispatchEvent(new KeyboardEvent('keydown', {
    key: k, bubbles: true, cancelable: true,
    ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt
  }));

  /** Texto visível de um painel do split. */
  const textoDoPainel = (i) => {
    const folhas = $$('.tab-view.active .leaf');
    return folhas[i] ? folhas[i].innerText : '';
  };

  try {
    log.push('\n[serial numa porta real]');

    const portas = await window.tsm.serial.list();
    record(portas.length > 0, `o sistema enumera ${portas.length} porta(s): ` +
      portas.map((p) => p.path).join(', '));
    if (!portas.length) throw new Error('nenhuma porta serial nesta máquina');
    const alvo = portas[0].path;

    // --- abre a sessão serial pela árvore ---------------------------------
    const noSerial = await waitFor(
      () => $$('#tree .node.session').find((n) => n.textContent.includes('console')),
      'sessão serial na árvore'
    );
    noSerial.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    await waitFor(() => $('.tab-view.active .xterm'), 'terminal montado');
    await waitFor(
      () => /conectado/.test($('#status-right').textContent),
      'porta abrir', 10000
    );
    record(true, `${alvo} abriu de verdade e a aba ficou "conectado"`);

    const banner = await waitFor(
      () => (textoDoPainel(0).includes('aberta a') ? textoDoPainel(0) : null),
      'banner de abertura'
    );
    const linhaBanner = banner.split('\n').find((l) => l.includes('aberta a')) || '';
    record(
      linhaBanner.includes(alvo) && linhaBanner.includes('9600'),
      `os parâmetros aparecem no terminal: ${linhaBanner.trim()}`
    );

    // --- manda bytes pela porta -------------------------------------------
    key('m', { ctrl: true, shift: true });
    const barra = await waitFor(() => $('#multiexec input'), 'barra do MultiExec');
    barra.value = 'show version';
    barra.dispatchEvent(new Event('input', { bubbles: true }));
    $$('#multiexec button').find((b) => b.textContent.trim() === 'Enviar').click();
    await sleep(600);

    record(
      textoDoPainel(0).includes('show version'),
      'o comando saiu pela porta e o eco local mostrou no terminal'
    );
    key('m', { ctrl: true, shift: true });   // fecha a barra
    await sleep(200);

    // --- a porta ocupada precisa dar erro claro ---------------------------
    key('ArrowRight', { ctrl: true, shift: true });
    await waitFor(() => $$('.tab-view.active .leaf').length === 2, 'segundo painel');
    const erro = await waitFor(
      () => ($('.pane-banner.err') ? $('.pane-banner.err').textContent : null),
      'erro de porta ocupada', 10000
    );
    record(
      /aberta em outro programa|Access|denied|ocupada/i.test(erro),
      `abrir a mesma porta duas vezes dá erro do sistema, com explicação: "${erro.replace('Reconectar', '').replace('Fechar', '').trim()}"`
    );

    // Volta o foco para o painel que funcionou, para a captura ficar honesta.
    key('ArrowLeft', { alt: true });
    await sleep(400);

    log.push('');
    log.push('  nota: sem equipamento na outra ponta da COM1, nada retorna — o que');
    log.push('        está provado aqui é a abertura da porta, a saída de bytes e o');
    log.push('        tratamento de erro, não uma conversa com algum aparelho.');
  } catch (err) {
    record(false, 'roteiro interrompido', err.message);
  }

  return { ok, log };
})()
