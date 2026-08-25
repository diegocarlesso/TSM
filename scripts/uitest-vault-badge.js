/**
 * Confere que o botão direito no badge do cofre (rodapé da barra lateral)
 * abre Configurações > Segurança direto, sem precisar passar pelo menu
 * Ferramentas — é onde ficam as credenciais salvas, difícil de achar de
 * outra forma.
 *
 *   TSM_SMOKE=1 TSM_UITEST=scripts/uitest-vault-badge.js npx electron .
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
    log.push('\n[botão direito no badge do cofre]');

    $('#vault-state').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await waitFor(() => $('.modal-backdrop'), 'diálogo de configurações abrir');

    const abaAtiva = [...$$('.tabs-strip button')].find((b) => b.classList.contains('active'));
    record(abaAtiva && abaAtiva.textContent.trim() === 'Segurança', 'abre direto na aba Segurança',
      abaAtiva && abaAtiva.textContent.trim());
    record(!!$$('button').find((b) => b.textContent.includes('Credenciais salvas')),
      'a aba mostra o botão de credenciais salvas');
  } catch (err) {
    record(false, 'exceção durante o teste', err.message);
  }

  return { ok, log };
})();
