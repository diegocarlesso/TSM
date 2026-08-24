/**
 * Reproduz "os botões da tela inicial não fazem nada": #panes e #welcome são
 * dois <div> absolutos (inset:0) dentro de #workspace; #panes vem DEPOIS no
 * HTML, então pinta por cima mesmo vazio, e captura os cliques que deveriam
 * ir para os botões da tela de boas-vindas por baixo.
 *
 *   TSM_SMOKE=1 TSM_UITEST=scripts/uitest-welcome-repro.js npx electron .
 *
 * Roda num banco vazio (sem sessões, sem abas) de propósito — é exatamente
 * o estado em que a tela de boas-vindas aparece.
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

  const waitFor = async (fn, label, timeout = 8000) => {
    const limite = Date.now() + timeout;
    while (Date.now() < limite) {
      const v = fn();
      if (v) return v;
      await sleep(80);
    }
    throw new Error(`tempo esgotado esperando: ${label}`);
  };

  try {
    log.push('\n[tela de boas-vindas — botões]');

    await waitFor(() => $('#welcome') && !$('#welcome').classList.contains('hidden'), 'tela de boas-vindas visível');

    const btn = await waitFor(() => $('#welcome [data-action="new-session"]'), 'botão "Nova sessão"');
    const rect = btn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // O que o navegador realmente entregaria o clique, no ponto central do botão.
    const alvoReal = document.elementFromPoint(cx, cy);
    record(
      btn === alvoReal || btn.contains(alvoReal),
      `o elemento sob o cursor no botão "Nova sessão" é o próprio botão (achou: ${alvoReal ? alvoReal.id || alvoReal.className || alvoReal.tagName : 'nada'})`,
      alvoReal && alvoReal !== btn ? 'outro elemento está por cima e vai roubar o clique' : undefined
    );

    // Clique de verdade (mousedown+mouseup+click no ponto), não .click() direto no nó —
    // .click() ignora quem está por cima; isso aqui reproduz o que o mouse faz.
    for (const type of ['mousedown', 'mouseup', 'click']) {
      const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window });
      (alvoReal || btn).dispatchEvent(ev);
    }

    const modalAbriu = await waitFor(() => $('.modal-backdrop .modal-head'), 'diálogo "Nova sessão" abriu', 2500)
      .catch(() => null);
    record(!!modalAbriu, modalAbriu
      ? `diálogo abriu: "${modalAbriu.textContent.trim()}"`
      : 'clique no ponto do botão NÃO abriu o diálogo (reproduzido)');
  } catch (err) {
    record(false, 'roteiro interrompido', err.message);
  }

  return { ok, log };
})()
