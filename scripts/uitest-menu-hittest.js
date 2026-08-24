/**
 * Verifica a hipótese: o mousedown (globalmente escutado em document para
 * fechar o menu ao clicar fora) fecha o menu ANTES do mouseup, e um clique
 * de mouse de verdade faz hit-test de novo no mouseup — não usa a mesma
 * referência de nó do mousedown. Se o menu já sumiu, o clique cai em outra
 * coisa (ou em nada), e o item do menu nunca recebe seu próprio evento
 * 'click'. Isso reproduz sem usar a referência guardada do nó: pega o
 * elemento que está REALMENTE no ponto (x,y) em cada etapa, como o
 * navegador faz de verdade.
 */
(async () => {
  const log = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const waitFor = async (fn, label, timeout = 6000) => {
    const limite = Date.now() + timeout;
    while (Date.now() < limite) {
      const v = fn();
      if (v) return v;
      await sleep(80);
    }
    throw new Error(`tempo esgotado esperando: ${label}`);
  };

  const record = (passou, texto, detalhe) => {
    log.push(`  ${passou ? 'ok   ' : 'FALHA'} ${texto}` + (detalhe ? `\n        ${detalhe}` : ''));
  };

  try {
    log.push('\n[hit-test real do menu de contexto]');

    const sessao = await waitFor(() => $('#tree .node.session'), 'sessão na árvore');
    const rect = sessao.getBoundingClientRect();
    sessao.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 10, clientY: rect.top + 5 }));

    const menu = await waitFor(() => $('.context-menu'), 'menu de contexto abriu');
    // O listener que fecha ao clicar fora é anexado num setTimeout(0)
    // (macrotask) — se o `await` acima resolveu só com microtasks (o menu já
    // existia no primeiro poll síncrono), esse setTimeout pode ainda não ter
    // rodado. Um clique de mouse de verdade sempre acontece bem depois disso;
    // esperar aqui de propósito reproduz o timing real, não o do teste.
    await sleep(50);
    const item = $$('.context-menu .item').find((n) => n.textContent.startsWith('Conectar') && !n.textContent.includes('nova'));
    const r = item.getBoundingClientRect();
    const px = r.left + 10;
    const py = r.top + r.height / 2;

    const antesDoMousedown = document.elementFromPoint(px, py);
    log.push(`  info  elementFromPoint ANTES do mousedown: ${antesDoMousedown && antesDoMousedown.outerHTML.slice(0, 80)}`);

    // Só o mousedown, como um clique de mouse de verdade faz primeiro.
    antesDoMousedown.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: px, clientY: py }));
    await sleep(30);

    const depoisDoMousedown = document.elementFromPoint(px, py);
    const menuAindaAberto = !!$('.context-menu');
    record(menuAindaAberto, 'o menu continua aberto depois só do mousedown no item',
      `elementFromPoint agora: ${depoisDoMousedown ? depoisDoMousedown.outerHTML.slice(0, 80) : 'null'}`);

    if (!menuAindaAberto) {
      log.push('  info  CONFIRMADO: o próprio mousedown já fechou o menu antes do mouseup rodar.');
      log.push(`  info  um mouseup/click de verdade nesse ponto agora atinge: ${depoisDoMousedown ? depoisDoMousedown.tagName + '.' + depoisDoMousedown.className : 'nada (fora de qualquer elemento coberto)'}`);
    }

    // Termina o clique no que estiver LÁ AGORA (hit-test de novo, como o
    // navegador faz de verdade) — não na referência antiga de `item`.
    const alvoFinal = document.elementFromPoint(px, py) || document.body;
    const abasAntes = $$('#tabs .tab').length;
    alvoFinal.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: px, clientY: py }));
    alvoFinal.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: px, clientY: py }));
    await sleep(400);
    const abasDepois = $$('#tabs .tab').length;

    record(abasDepois > abasAntes, 'depois do ciclo completo (hit-test real a cada etapa), "Conectar" abriu uma aba',
      `antes=${abasAntes} depois=${abasDepois}`);

    // --- clicar FORA do menu ainda precisa fechar -----------------------------
    const sessao2 = $('#tree .node.session');
    const r2 = sessao2.getBoundingClientRect();
    sessao2.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r2.left + 10, clientY: r2.top + 5 }));
    await waitFor(() => $('.context-menu'), 'segundo menu abriu');
    await sleep(50);
    // Clica bem longe do menu, fora de qualquer item.
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    await sleep(100);
    record(!$('.context-menu'), 'clicar fora do menu ainda fecha ele');
  } catch (err) {
    log.push(`  FALHA roteiro interrompido: ${err.message}\n${err.stack}`);
  }

  return { ok: true, log };
})()
