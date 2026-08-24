/**
 * Diagnóstico ao vivo contra dados reais: clica em "Shell local" e no menu de
 * contexto de uma sessão de verdade, capturando QUALQUER erro de JS que
 * aconteça no processo — não assume que vai funcionar, só reporta o que
 * realmente acontece em cada passo.
 *
 *   TSM_DATA_DIR=<pasta real> TSM_SMOKE=1 TSM_UITEST=scripts/uitest-diag-real.js npx electron .
 */
(async () => {
  const log = [];
  const erros = [];
  window.addEventListener('error', (e) => erros.push(`error: ${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => erros.push(`unhandledrejection: ${e.reason && e.reason.message || e.reason}`));

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
    return null;
  };

  log.push('\n[diagnóstico contra dados reais]');
  log.push(`  info  sessões carregadas: ${$$('#tree .node.session').length}, pastas: ${$$('#tree .node.folder').length}`);
  log.push(`  info  window.tsm existe: ${!!window.tsm}`);

  // --- Shell local -----------------------------------------------------------
  try {
    const abasAntes = $$('#tabs .tab').length;
    const btnShell = $('#welcome [data-action="shell"]') || $('[title*="Shell local"]');
    log.push(`  info  botão "Shell local" encontrado: ${!!btnShell} (${btnShell ? btnShell.outerHTML.slice(0, 100) : 'n/a'})`);
    if (btnShell) {
      btnShell.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await sleep(300);
      const menu = $('.context-menu');
      log.push(`  info  menu de shells apareceu: ${!!menu} (itens: ${menu ? $$('.context-menu .item').map((n) => n.textContent).join(' | ') : 'n/a'})`);
      if (menu) {
        const item = menu.querySelector('.item');
        const rect = item.getBoundingClientRect();
        log.push(`  info  clicando no item "${item.textContent}" em (${rect.left + 5}, ${rect.top + 5})`);
        for (const type of ['mousedown', 'mouseup', 'click']) {
          item.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: rect.left + 5, clientY: rect.top + 5 }));
        }
        await sleep(500);
      }
      const abasDepois = $$('#tabs .tab').length;
      log.push(`  ${abasDepois > abasAntes ? 'ok   ' : 'FALHA'} abas: antes=${abasAntes} depois=${abasDepois}`);
      if (abasDepois === abasAntes) {
        log.push(`        DOM do modal/menu residual: ${$('.modal-backdrop') ? 'modal aberto' : 'nenhum'} / ${$('.context-menu') ? 'menu ainda aberto' : 'menu fechado'}`);
      }
    }
  } catch (err) {
    log.push(`  FALHA exceção no fluxo de shell local: ${err.message}\n${err.stack}`);
  }

  await sleep(300);
  // fecha qualquer coisa aberta antes do próximo teste
  for (const tab of [...$$('#tabs .tab')]) {
    tab.querySelector('.tab-close')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(100);
    const backdrop = $('.modal-backdrop');
    if (backdrop) [...backdrop.querySelectorAll('.modal-foot button')].pop()?.click();
    await sleep(100);
  }

  // --- Menu de contexto de uma sessão real -----------------------------------
  try {
    const sessao = $('#tree .node.session');
    log.push(`\n  info  primeira sessão real na árvore: ${sessao ? sessao.querySelector('.label').textContent : 'NENHUMA'}`);
    if (sessao) {
      const rect = sessao.getBoundingClientRect();
      sessao.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 10, clientY: rect.top + 5 }));
      await sleep(200);
      const menu = $('.context-menu');
      log.push(`  info  menu de contexto da sessão apareceu: ${!!menu} (itens: ${menu ? $$('.context-menu .item').map((n) => n.textContent).join(' | ') : 'n/a'})`);
      if (menu) {
        const itemConectar = $$('.context-menu .item').find((n) => n.textContent.startsWith('Conectar') && !n.textContent.includes('nova'));
        const abasAntes = $$('#tabs .tab').length;
        const r2 = itemConectar.getBoundingClientRect();
        log.push(`  info  clicando em "Conectar" em (${r2.left + 5}, ${r2.top + 5})`);
        for (const type of ['mousedown', 'mouseup', 'click']) {
          itemConectar.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: r2.left + 5, clientY: r2.top + 5 }));
        }
        await sleep(500);
        const abasDepois = $$('#tabs .tab').length;
        log.push(`  ${abasDepois > abasAntes ? 'ok   ' : 'FALHA'} Conectar numa sessão real: abas antes=${abasAntes} depois=${abasDepois}`);
      }
    }
  } catch (err) {
    log.push(`  FALHA exceção no menu de contexto: ${err.message}\n${err.stack}`);
  }

  log.push(`\n  erros de JS capturados durante todo o roteiro: ${erros.length}`);
  for (const e of erros) log.push(`        ${e}`);

  return { ok: erros.length === 0, log };
})()
