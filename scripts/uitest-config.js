/**
 * Roteiro de teste da previa de personalizacao e da sessao serial.
 *
 *   TSM_SMOKE=1 TSM_UITEST=scripts/uitest-config.js npx electron .
 *
 * Como o resto dos testes de interface, dirige tudo por eventos de DOM reais.
 */
(async () => {
  const log = [];
  let ok = true;

  const record = (passou, texto, detalhe) => {
    const extra = !passou && detalhe ? `\n        ${detalhe}` : '';
    log.push(`  ${passou ? 'ok   ' : 'FALHA'} ${texto}${extra}`);
    if (!passou) ok = false;
    return passou;
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const waitFor = async (fn, label, timeout = 6000) => {
    const limite = Date.now() + timeout;
    while (Date.now() < limite) {
      const v = fn();
      if (v) return v;
      await sleep(60);
    }
    throw new Error(`tempo esgotado esperando: ${label}`);
  };

  /** Acha o controle que fica na celula seguinte a um rotulo do formulario. */
  const campo = (rotulo, raiz = document) => {
    const label = $$('.form-grid label', raiz).find((l) => l.textContent.trim() === rotulo);
    return label ? label.nextElementSibling : null;
  };

  const trocarSelect = (elemento, valor) => {
    const alvo = elemento.tagName === 'SELECT' ? elemento : elemento.querySelector('select');
    alvo.value = valor;
    alvo.dispatchEvent(new Event('change', { bubbles: true }));
    return alvo;
  };

  const fecharModal = async () => {
    const botao = $('.modal-backdrop .modal-head .icon-btn');
    if (botao) botao.click();
    await waitFor(() => !$('.modal-backdrop'), 'modal fechar', 3000);
  };

  try {
    // ------------------------------------------- previa de personalizacao --
    log.push('\n[previa de personalizacao]');

    $('#btn-settings').click();
    await waitFor(() => $('.modal-backdrop'), 'dialogo de configuracoes');
    const previa = await waitFor(() => $('.theme-preview'), 'previa do tema');
    record(true, 'o botao de configuracoes abre o dialogo com a previa');

    const temas = [...campo('Tema do terminal').querySelectorAll('select option')]
      .map((o) => o.value);
    record(temas.length > 1, `a lista traz ${temas.length} temas`);

    const fundoAntes = getComputedStyle(previa).backgroundColor;
    const temaAtual = previa.dataset.themeId;
    const outro = temas.find((t) => t !== temaAtual);

    trocarSelect(campo('Tema do terminal'), outro);
    await sleep(350);

    const previaDepois = await waitFor(() => $('.theme-preview'), 'previa redesenhada');
    const fundoDepois = getComputedStyle(previaDepois).backgroundColor;
    record(
      fundoDepois !== fundoAntes && previaDepois.dataset.themeId === outro,
      'trocar o tema redesenha a previa',
      `tema ${temaAtual} -> ${previaDepois.dataset.themeId}; fundo ${fundoAntes} -> ${fundoDepois}`
    );

    // a previa tambem precisa refletir a tipografia
    const abaTerminal = $$('.tabs-strip button').find((b) => b.textContent.trim() === 'Terminal');
    abaTerminal.click();
    await sleep(200);

    const previaTerminal = await waitFor(() => $('.theme-preview'), 'previa na aba Terminal');
    const tamanhoAntes = getComputedStyle(previaTerminal).fontSize;
    const inputTamanho = campo('Tamanho');
    inputTamanho.value = '22';
    inputTamanho.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(350);

    const tamanhoDepois = getComputedStyle($('.theme-preview')).fontSize;
    record(
      tamanhoDepois !== tamanhoAntes && tamanhoDepois.startsWith('22'),
      'mudar o tamanho da fonte aparece na previa',
      `${tamanhoAntes} -> ${tamanhoDepois}`
    );

    // devolve o tamanho para nao sujar o estado
    inputTamanho.value = '14';
    inputTamanho.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);
    await fecharModal();

    // ------------------------------------------------------ sessao serial --
    log.push('\n[sessao serial]');

    $('#btn-new-session').click();
    await waitFor(() => $('.modal-backdrop'), 'editor de sessao');

    const tipos = [...campo('Tipo').querySelectorAll('option')].map((o) => o.value);
    record(tipos.includes('serial'), 'o tipo Serial (COM) aparece na lista', tipos.join(', '));

    trocarSelect(campo('Tipo'), 'serial');
    await sleep(300);

    record(!!campo('Porta'), 'o editor mostra o campo de porta');
    record(!!campo('Velocidade (baud)'), 'o editor mostra a velocidade');

    const portas = [...campo('Porta').querySelectorAll('option')]
      .map((o) => o.value).filter(Boolean);
    record(true, `portas detectadas na maquina: ${portas.length ? portas.join(', ') : 'nenhuma'}`);

    const bauds = [...campo('Velocidade (baud)').querySelectorAll('option')].map((o) => o.value);
    record(bauds.includes('115200'), 'a lista de velocidades vem do processo principal');

    // Autenticacao e Tuneis nao fazem sentido numa serial.
    const abas = $$('.tabs-strip button').map((b) => b.textContent.trim());
    record(
      !abas.includes('Autenticacao') && !abas.includes('Tuneis'),
      'abas que nao se aplicam ao serial somem',
      abas.join(', ')
    );

    const abaAvancado = $$('.tabs-strip button').find((b) => b.textContent.trim() === 'Avancado');
    abaAvancado.click();
    await sleep(250);

    record(!!campo('Bits de dados'), 'a aba Avancado traz bits de dados');
    record(!!campo('Paridade'), 'a aba Avancado traz paridade');
    record(!!campo('Enter envia'), 'da para escolher o fim de linha (CR/LF/CRLF)');

    await fecharModal();
  } catch (err) {
    record(false, 'roteiro interrompido', err.message);
  }

  return { ok, log };
})()
