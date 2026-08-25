/**
 * Confere o preenchimento automático ao escolher "Credencial salva" no editor
 * de sessão: o usuário é copiado pro campo, e o placeholder da senha avisa
 * que ela vem da credencial (sem nunca mostrar o valor em claro).
 *
 *   TSM_DATA_DIR=./ident node scripts/seed-identity.js
 *   TSM_SMOKE=1 TSM_UITEST=scripts/uitest-identity-autofill.js TSM_DATA_DIR=./ident npx electron .
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

  const campo = (rotulo, raiz = document) => {
    const label = $$('.form-grid label', raiz).find((l) => l.textContent.trim() === rotulo);
    return label ? label.nextElementSibling : null;
  };

  const irPara = async (rotuloAba) => {
    const botao = [...$$('.tabs-strip button')].find((b) => b.textContent.trim() === rotuloAba);
    botao.click();
    await sleep(100);
  };

  try {
    log.push('\n[preenchimento automático da credencial salva]');

    await window.tsm.secrets.set('identity', 'ident-teste', 'password', 'segredo123');

    $('#btn-new-session').click();
    await waitFor(() => $('.modal-backdrop'), 'editor de sessão abrir');

    // O dropdown mora na aba Geral (junto de Host/Porta/Usuário) — não na
    // Autenticação — pra ficar visível na primeira aba, sem precisar saber
    // que existe uma aba separada só pra isso.
    record($('.tabs-strip button.active')?.textContent.trim() === 'Geral',
      'o editor já abre na aba Geral, onde a credencial fica visível');
    const dropdown = campo('Credencial salva'); // select() devolve o <select> direto, sem wrapper
    const opcoes = [...dropdown.querySelectorAll('option')].map((o) => o.textContent);
    record(opcoes.some((t) => t.includes('prod-bastion')), 'a credencial semeada aparece no dropdown', opcoes.join(', '));

    await irPara('Autenticação');
    const senhaAntes = campo('Senha').querySelector('input').placeholder;
    record(senhaAntes === 'não definida', 'antes de escolher, a senha mostra "não definida"', senhaAntes);
    await irPara('Geral');

    dropdown.value = 'ident-teste';
    dropdown.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(300); // busca async de secrets.has('identity', ...)

    const usuario = campo('Usuário'); // input direto, sem wrapper
    record(usuario.value === 'deploy', 'escolher a credencial preenche o usuário na mesma aba', usuario.value);

    await irPara('Autenticação');
    const senhaDepois = campo('Senha').querySelector('input').placeholder;
    record(senhaDepois.includes('credencial salva'), 'a senha avisa que vem da credencial (sem mostrar o valor)', senhaDepois);
    record(!senhaDepois.includes('segredo123'), 'o valor da senha nunca aparece em claro na interface');
  } catch (err) {
    record(false, 'exceção durante o teste', err.message);
  }

  return { ok, log };
})();
