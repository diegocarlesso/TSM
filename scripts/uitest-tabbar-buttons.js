/**
 * Confere os botões "Sessão" e "Shell" adicionados na barra de abas, ao lado
 * do "+" de conexão rápida — atalho para não precisar ir até a barra lateral.
 *
 *   TSM_SMOKE=1 TSM_UITEST=scripts/uitest-tabbar-buttons.js npx electron .
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
    log.push('\n[barra de abas — botões Sessão / Shell]');

    record(!!$('#btn-tab-new-session'), 'botão "Sessão" existe na barra de abas');
    record(!!$('#btn-tab-shell'), 'botão "Shell" existe na barra de abas');
    record(!!$('#btn-quick'), 'botão "+" de conexão rápida ainda existe');

    $('#btn-tab-new-session').click();
    const dlgSessao = await waitFor(() => $('.modal-backdrop'), 'diálogo de nova sessão abrir');
    record(/Nova sessão|Sessão/.test(dlgSessao.textContent), 'diálogo aberto é o de nova sessão');
    // fecha pelo botão de cancelar (primeiro botão do rodapé)
    dlgSessao.querySelector('.modal-foot button').click();
    await waitFor(() => !$('.modal-backdrop'), 'diálogo de nova sessão fechar');

    const abasAntes = $$('#tabs .tab').length;
    $('#btn-tab-shell').click();
    // com mais de um shell instalado, "Shell" abre um menu de escolha em vez
    // de abrir direto — mesmo comportamento do botão "Shell local" da tela
    // de boas-vindas (shellMenuOrDefault).
    await waitFor(() => $('.context-menu') || $$('#tabs .tab').length > abasAntes, 'menu de shells ou aba abrir');
    const menu = $('.context-menu');
    if (menu) menu.querySelector('.item')?.click();
    await waitFor(() => $$('#tabs .tab').length > abasAntes, 'nova aba de shell local abrir');
    record(true, 'clique em "Shell" abre uma aba de shell local');
    record(!$('#welcome').classList.contains('') || $('#welcome').style.display === 'none' || !$('#welcome').offsetParent,
      'tela de boas-vindas some ao abrir a aba');
  } catch (err) {
    record(false, 'exceção durante o teste', err.message);
  }

  return { ok, log };
})();
