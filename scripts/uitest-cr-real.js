/**
 * Confere, contra um PowerShell de verdade (node-pty, não simulado), que o
 * comportamento PADRÃO (sendEnter/run = true, sem nenhum \r explícito
 * digitado à mão) agora confirma o comando em vez de deixar o prompt preso
 * em "&gt;&gt;" — o sintoma exato do bug antes do fix. uitest-automations.js
 * já usa um workaround (\r explícito no `send`) que passava mesmo com o bug
 * antigo; este roteiro testa especificamente o caminho sem workaround.
 *
 *   TSM_SMOKE=1 TSM_UITEST=scripts/uitest-cr-real.js TSM_SHOT=cr.png npx electron .
 */
(async () => {
  const log = [];
  let ok = true;
  let snippetId = null;
  let automationId = null;

  const record = (passou, texto, detalhe) => {
    log.push(`  ${passou ? 'ok   ' : 'FALHA'} ${texto}` + (!passou && detalhe ? `\n        ${detalhe}` : ''));
    if (!passou) ok = false;
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const termText = () => $$('.tab-view.active .xterm-rows').map((n) => n.textContent).join('\n');

  const waitFor = async (fn, label, timeout = 15000) => {
    const limite = Date.now() + timeout;
    while (Date.now() < limite) {
      const v = fn();
      if (v) return v;
      await sleep(100);
    }
    throw new Error(`tempo esgotado esperando: ${label}`);
  };

  try {
    log.push('\n[\\r contra PowerShell de verdade — sem workaround]');

    $('#welcome [data-action="shell"]').click();
    const menuShells = await waitFor(() => $('.context-menu'), 'menu de shells');
    menuShells.querySelector('.item').click();
    await waitFor(() => $('.tab-view.active .xterm'), 'terminal montado');
    await waitFor(() => /PS [A-Za-z]:\\|>\s*$/.test(termText()), 'prompt do PowerShell apareceu', 15000);
    record(true, 'shell local abriu (PowerShell real via node-pty)');

    // --- Biblioteca de comandos: "executar ao enviar" padrão, sem \r à mão ---
    const MARCA = `TSM_CR_SNIPPET_${Date.now()}`;
    const snippet = await window.tsm.snippets.create({
      name: 'teste-cr-snippet', content: `echo ${MARCA}`, category: 'uitest', run: true
    });
    snippetId = snippet.id;

    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 's', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true
    }));
    const biblioteca = await waitFor(
      () => [...$$('.modal-backdrop')].find((m) => /Biblioteca de comandos/.test(m.textContent)),
      'diálogo da biblioteca abriu'
    );
    const linha = [...biblioteca.querySelectorAll('.node')].find((n) => n.textContent.includes('teste-cr-snippet'));
    record(!!linha, 'snippet "teste-cr-snippet" aparece na lista');
    // A linha em si não tem onClick — quem envia é o botão "↵" (Enviar para a
    // aba ativa) dentro dela.
    const btnEnviar = linha.querySelector('button[title="Enviar para a aba ativa"]');
    record(!!btnEnviar, 'botão "Enviar para a aba ativa" existe na linha');
    btnEnviar.click();
    await sleep(500);
    biblioteca.querySelector('.modal-head button').click();
    await waitFor(() => !$('.modal-backdrop'), 'diálogo da biblioteca fechar');

    const snippetOk = await waitFor(() => termText().includes(MARCA), 'saída do snippet no terminal', 8000)
      .then(() => true).catch(() => false);
    record(snippetOk, `Biblioteca de comandos (run:true, sem \\r manual): "${MARCA}" saiu no terminal`,
      snippetOk ? undefined : `saída atual:\n${termText().slice(-500)}`);
    const ultimaLinha = termText().trim().split('\n').pop() || '';
    record(!/^>>/.test(ultimaLinha.trim()), 'prompt não ficou preso em ">>" depois do snippet', ultimaLinha);

    // --- Automação: sendEnter padrão (true), sem \r à mão no `send` ----------
    const MARCA2 = `TSM_CR_AUTO_${Date.now()}`;
    const automation = await window.tsm.automations.create({
      name: 'teste-cr-automacao', category: 'uitest',
      steps: [
        { expect: '.*', send: '', sendEnter: true, timeoutMs: 5000 },
        { expect: '[>$#]\\s*$', send: `echo ${MARCA2}`, sendEnter: true, timeoutMs: 8000 }
      ]
    });
    automationId = automation.id;

    const tab = $('#tabs .tab');
    const box = tab.getBoundingClientRect();
    tab.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: box.left + 10, clientY: box.bottom
    }));
    const menuAba = await waitFor(() => $('.context-menu'), 'menu de contexto da aba');
    const itemRodar = [...menuAba.querySelectorAll('.item')].find((n) => n.textContent.startsWith('Rodar automação'));
    itemRodar.click();

    const seletor = await waitFor(() => $('.modal-backdrop'), 'seletor de automações');
    const linhaAuto = [...seletor.querySelectorAll('.node')].find((n) => n.textContent.includes('teste-cr-automacao'));
    record(!!linhaAuto, 'automação "teste-cr-automacao" aparece no seletor');
    linhaAuto.click();
    await waitFor(() => !$('.modal-backdrop'), 'seletor fechar');

    const autoOk = await waitFor(() => termText().includes(MARCA2), 'saída da automação no terminal', 10000)
      .then(() => true).catch(() => false);
    record(autoOk, `Automação (sendEnter:true, sem \\r manual): "${MARCA2}" saiu no terminal`,
      autoOk ? undefined : `saída atual:\n${termText().slice(-500)}`);
  } catch (err) {
    record(false, 'roteiro interrompido', `${err.message}\n${err.stack || ''}`);
  } finally {
    if (snippetId) await window.tsm.snippets.remove(snippetId).catch(() => {});
    if (automationId) await window.tsm.automations.remove(automationId).catch(() => {});
  }

  return { ok, log };
})()
