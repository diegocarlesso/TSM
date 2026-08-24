/**
 * Reproduz, sem intervenção manual, os três problemas relatados sobre a
 * árvore de sessões importadas: barra de rolagem ausente, nome cortado
 * demais e "Editar" no menu de contexto não abrindo o diálogo.
 *
 *   TSM_DATA_DIR=/tmp/tsm-telecom node scripts/seed-telecom-repro.js
 *   TSM_SMOKE=1 TSM_UITEST=scripts/uitest-telecom-repro.js npx electron .
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

  try {
    log.push('\n[árvore com sessão importada — reprodução]');

    await waitFor(() => $$('#tree .node.session').length >= 50, 'sessões carregadas na árvore');

    // --- barra de rolagem -----------------------------------------------
    const tree = $('#tree');
    const cs = getComputedStyle(tree);
    log.push(`  info  janela ${window.innerHeight}px · #tree min-height computado="${cs.minHeight}" overflow-y="${cs.overflowY}"`);
    const overflowing = tree.scrollHeight > tree.clientHeight + 2;
    record(overflowing, `#tree tem conteúdo maior que a área visível (scrollHeight=${tree.scrollHeight} clientHeight=${tree.clientHeight})`);
    if (overflowing) {
      const antes = tree.scrollTop;
      tree.scrollTop = tree.scrollHeight;
      await sleep(50);
      record(tree.scrollTop > antes, `rolar #tree move scrollTop (antes=${antes}, depois=${tree.scrollTop})`);
    }

    // --- nome cortado ------------------------------------------------------
    const linhas = $$('#tree .node.session');
    const alvo = linhas.find((n) => n.querySelector('.label') && n.querySelector('.label').textContent.startsWith('172.16.255.123'));
    if (alvo) {
      const label = alvo.querySelector('.label');
      const meta = alvo.querySelector('.meta');
      const visivel = label.getBoundingClientRect().width;
      record(visivel >= 40, `label "${label.textContent}" tem largura visível ${visivel.toFixed(0)}px (meta="${meta.textContent}")`);
    } else {
      record(false, 'não achei a linha 172.16.255.123 na árvore para medir o rótulo');
    }

    // --- Editar pelo menu de contexto --------------------------------------
    const linhaEditar = linhas.find((n) => n.querySelector('.label') && n.querySelector('.label').textContent.includes('RT-HW-PE-N01'))
      || linhas[5];
    linhaEditar.scrollIntoView();
    await sleep(100);
    const rect = linhaEditar.getBoundingClientRect();
    linhaEditar.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: rect.left + 10, clientY: rect.top + 5
    }));

    const menu = await waitFor(() => $('.context-menu'), 'menu de contexto aberto');
    const itemEditar = $$('.context-menu .item').find((n) => n.textContent.includes('Editar'));
    record(!!itemEditar, `item "Editar…" presente no menu (${$$('.context-menu .item').map((n) => n.textContent).join(' | ')})`);
    if (!itemEditar) throw new Error('sem item Editar no menu');

    itemEditar.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await sleep(10);
    itemEditar.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    itemEditar.click();

    const modalAbriu = await waitFor(() => $('.modal-backdrop .modal-head'), 'diálogo de edição abriu', 3000)
      .catch(() => null);
    record(!!modalAbriu, modalAbriu
      ? `diálogo abriu: "${modalAbriu.textContent.trim()}"`
      : 'diálogo de edição NÃO abriu depois do clique em "Editar…" (reproduzido)');

    if (modalAbriu) {
      const nomeInput = $('.modal-body input[type=text]');
      record(!!nomeInput && nomeInput.value.length > 0, `campo Nome preenchido: "${nomeInput && nomeInput.value}"`);
    }
  } catch (err) {
    record(false, 'roteiro interrompido', err.message);
  }

  return { ok, log };
})()
