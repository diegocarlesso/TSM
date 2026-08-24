/**
 * Roteiro de teste das automações (expect/send), executado DENTRO do renderer.
 *
 *   TSM_UITEST=scripts/uitest-automations.js TSM_SMOKE=1 npx electron .
 *
 * Cadastra um roteiro de dois passos, abre um shell local pelo caminho normal
 * da interface (clique + menu de contexto) e confere que os comandos foram de
 * fato enviados ao terminal. Devolve `{ ok, log }`.
 */
(async () => {
  const log = [];
  let ok = true;
  let criada = null;

  const record = (passou, texto, detalhe) => {
    const extra = !passou && detalhe ? `\n        ${detalhe}` : '';
    log.push(`  ${passou ? 'ok   ' : 'FALHA'} ${texto}${extra}`);
    if (!passou) ok = false;
    return passou;
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const waitFor = async (fn, label, timeout = 10000) => {
    const limite = Date.now() + timeout;
    while (Date.now() < limite) {
      const v = fn();
      if (v) return v;
      await sleep(80);
    }
    throw new Error(`tempo esgotado esperando: ${label}`);
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  /** Texto visível do terminal do painel ativo. */
  const termText = () => $$('.tab-view.active .xterm-rows')
    .map((n) => n.textContent)
    .join('\n');

  const MARCA_UM = 'TSM-PASSO-UM';
  const MARCA_DOIS = 'TSM-PASSO-DOIS';

  // Espelho dos eventos do motor, para o diagnóstico quando algo falha.
  const eventos = [];
  window.tsm.automation.onStep((p) => eventos.push(`step ${p.index + 1}`));
  window.tsm.automation.onTimeout((p) => eventos.push(`timeout no passo ${p.index + 1}`));
  window.tsm.automation.onError((p) => eventos.push(`error ${p.message}`));
  window.tsm.automation.onDone(() => eventos.push('done'));

  try {
    log.push('\n[automações]');

    // --- cadastra o roteiro ------------------------------------------------
    // O primeiro passo casa com vazio: manda um Enter para o shell reimprimir
    // o prompt, já que o prompt original passou antes de o roteiro começar.
    // Prompt de PowerShell/cmd/bash: todos terminam em > $ ou #.
    criada = await window.tsm.automations.create({
      name: 'Teste automático',
      category: 'uitest',
      // `sendEnter` acrescenta \n; o PSReadLine do PowerShell só submete com
      // \r, então aqui o CR vai explícito no próprio `send`.
      steps: [
        { expect: '.*', send: '\r', sendEnter: false, timeoutMs: 20000 },
        { expect: '[>$#]\\s*$', send: `echo ${MARCA_UM}\r`, sendEnter: false, timeoutMs: 20000 },
        { expect: MARCA_UM, send: `echo ${MARCA_DOIS}\r`, sendEnter: false, timeoutMs: 20000 }
      ]
    });
    record(!!criada && criada.steps.length === 3, 'grava um roteiro de três passos no banco');

    const lida = (await window.tsm.automations.list()).find((a) => a.id === criada.id);
    record(
      lida && lida.steps.length === 3 && lida.steps[0].timeoutMs === 20000
        && lida.steps[0].sendEnter === false,
      'os passos voltam do banco já desserializados',
      JSON.stringify(lida && lida.steps)
    );

    // --- abre um shell local pelo caminho normal da interface --------------
    $('#welcome [data-action="shell"]').click();
    const menuShells = await waitFor(() => $('.context-menu'), 'menu de shells');
    menuShells.querySelector('.item').click();

    await waitFor(() => $('.tab-view.active .xterm'), 'terminal montado');
    await waitFor(
      () => $$('#tabs .tab .tab-state.ok').length > 0,
      'o shell conectar', 15000
    );
    record(true, 'abre um shell local conectado');

    // O prompt precisa ter aparecido antes de o roteiro começar a escutar.
    await waitFor(() => /[>$#]/.test(termText()), 'prompt do shell', 15000);

    // --- roda a automação pelo menu de contexto da aba ---------------------
    const tab = $('#tabs .tab');
    const box = tab.getBoundingClientRect();
    tab.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: box.left + 10, clientY: box.bottom
    }));
    const menuAba = await waitFor(() => $('.context-menu'), 'menu de contexto da aba');
    const item = [...menuAba.querySelectorAll('.item')]
      .find((n) => n.textContent.startsWith('Rodar automação'));
    record(!!item, 'o menu da aba oferece "Rodar automação…" numa aba conectada');
    if (!item) throw new Error('item de menu ausente');
    item.click();

    // --- seletor de roteiros ----------------------------------------------
    // A barra pode ir e vir antes do próximo poll (o roteiro é rápido num
    // shell local), então observamos o DOM em vez de procurar depois.
    let barraVista = null;
    const observer = new MutationObserver(() => {
      const b = document.getElementById('automation-bar');
      if (b && !barraVista) barraVista = b;
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const seletor = await waitFor(() => $('.modal-backdrop'), 'seletor de automações');
    const linha = [...seletor.querySelectorAll('.node')]
      .find((n) => n.textContent.includes('Teste automático'));
    record(!!linha, 'o seletor lista a automação salva');
    if (!linha) throw new Error('automação não apareceu no seletor');
    linha.click();
    await waitFor(() => !$('.modal-backdrop'), 'seletor fechar');

    // --- execução ----------------------------------------------------------
    await waitFor(() => termText().includes(MARCA_UM), 'primeiro comando chegar no terminal', 30000);
    record(true, 'o passo do prompt casa e o comando chega ao terminal');

    await waitFor(() => termText().includes(MARCA_DOIS), 'segundo comando chegar no terminal', 30000);
    record(true, 'o passo seguinte casa com a saida do anterior e manda o próximo comando');

    await waitFor(() => eventos.includes('done'), 'evento done', 15000);
    record(
      eventos.join(' → ') === 'step 1 → step 2 → step 3 → done',
      'os eventos chegam ao renderer na ordem, terminando em done',
      eventos.join(' → ')
    );

    observer.disconnect();
    record(!!barraVista, 'a barra de progresso aparece enquanto a automação roda');
    record(
      !!barraVista && !!barraVista.querySelector('button'),
      'a barra tem um botão para interromper uma automação travada'
    );
    await waitFor(() => !$('#automation-bar'), 'a barra sumir ao terminar', 10000);
    record(true, 'a barra some quando o roteiro termina');

    // --- diálogo de cadastro ----------------------------------------------
    // Chega-se nele pelo rodapé do seletor, que é o caminho sem menu nativo.
    tab.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: box.left + 10, clientY: box.bottom
    }));
    const menuAba2 = await waitFor(() => $('.context-menu'), 'menu de contexto da aba (2)');
    [...menuAba2.querySelectorAll('.item')]
      .find((n) => n.textContent.startsWith('Rodar automação')).click();
    const seletor2 = await waitFor(() => $('.modal-backdrop'), 'seletor de automações (2)');
    [...seletor2.querySelectorAll('.modal-foot button')]
      .find((b) => b.textContent.startsWith('Gerenciar')).click();

    const crud = await waitFor(
      () => [...$$('.modal-backdrop')].find((m) => /Automações/.test(m.textContent)),
      'diálogo de automações'
    );
    record(
      /Teste automático/.test(crud.textContent) && /uitest/.test(crud.textContent),
      'o diálogo de automações lista nome, categoria e contagem de passos'
    );

    // Abre o editor de passos da automação salva.
    [...crud.querySelectorAll('.grid tbody button')].find((b) => b.textContent === '✎').click();
    const editor = await waitFor(
      () => [...$$('.modal-backdrop')].find((m) => /Esperar \(regex\)/.test(m.textContent)),
      'editor de passos'
    );
    const linhas = editor.querySelectorAll('.grid tbody tr');
    record(linhas.length === 3, 'o editor monta uma linha por passo', `${linhas.length} linhas`);

    const addBtn = [...editor.querySelectorAll('button')]
      .find((b) => b.textContent.includes('Adicionar passo'));
    record(!!addBtn, 'o editor oferece "+ Adicionar passo"');
    addBtn.click();
    await sleep(120);
    record(
      editor.querySelectorAll('.grid tbody tr').length === 4,
      'adicionar passo insere uma linha nova na tabela',
      `${editor.querySelectorAll('.grid tbody tr').length} linhas`
    );

    // Cancela o editor e fecha o diálogo, sem gravar a linha vazia.
    [...editor.querySelectorAll('.modal-foot button')]
      .find((b) => b.textContent === 'Cancelar').click();
    await sleep(150);
    const aindaCrud = [...$$('.modal-backdrop')].find((m) => /Automações/.test(m.textContent));
    if (aindaCrud) {
      [...aindaCrud.querySelectorAll('.modal-foot button')].pop().click();
    }
    await waitFor(() => !$('.modal-backdrop'), 'diálogos fecharem');

    const depoisDoCancelar = (await window.tsm.automations.list())
      .find((a) => a.id === criada.id);
    record(
      depoisDoCancelar && depoisDoCancelar.steps.length === 3,
      'cancelar o editor não grava o passo em branco',
      depoisDoCancelar && `${depoisDoCancelar.steps.length} passos`
    );

    // --- limpeza -----------------------------------------------------------
    // Fecha a aba pelo atalho e confirma, para o shell local não ficar vivo.
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'w', bubbles: true, cancelable: true, ctrlKey: true
    }));
    const limite = Date.now() + 3000;
    while (Date.now() < limite) {
      const backdrop = $('.modal-backdrop');
      if (backdrop) {
        [...backdrop.querySelectorAll('.modal-foot button')].pop().click();
        break;
      }
      await sleep(60);
    }
    await waitFor(() => $$('#tabs .tab').length === 0, 'a aba fechar', 6000);
    record(true, 'a aba com o shell fecha ao final do roteiro');
  } catch (err) {
    record(
      false, 'roteiro interrompido',
      `${err.message}\n        eventos: ${eventos.join(' → ') || '(nenhum)'}` +
      `\n        terminal: ${JSON.stringify(termText().slice(-300))}`
    );
  } finally {
    if (criada) {
      try { await window.tsm.automations.remove(criada.id); } catch { /* noop */ }
    }
  }

  return { ok, log };
})()
