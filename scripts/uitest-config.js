/**
 * Roteiro de teste da prévia de personalização e da sessão serial.
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

  /** Acha o controle que fica na célula seguinte a um rotulo do formulario. */
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
    // ------------------------------------------- prévia de personalização --
    log.push('\n[prévia de personalização]');

    $('#btn-settings').click();
    await waitFor(() => $('.modal-backdrop'), 'diálogo de configurações');
    const previa = await waitFor(() => $('.theme-preview'), 'prévia do tema');
    record(true, 'o botão de configurações abre o diálogo com a prévia');

    const temas = [...campo('Tema do terminal').querySelectorAll('select option')]
      .map((o) => o.value);
    record(temas.length > 1, `a lista traz ${temas.length} temas`);

    const fundoAntes = getComputedStyle(previa).backgroundColor;
    const temaAtual = previa.dataset.themeId;
    const outro = temas.find((t) => t !== temaAtual);

    trocarSelect(campo('Tema do terminal'), outro);
    await sleep(350);

    const previaDepois = await waitFor(() => $('.theme-preview'), 'prévia redesenhada');
    const fundoDepois = getComputedStyle(previaDepois).backgroundColor;
    record(
      fundoDepois !== fundoAntes && previaDepois.dataset.themeId === outro,
      'trocar o tema redesenha a prévia',
      `tema ${temaAtual} -> ${previaDepois.dataset.themeId}; fundo ${fundoAntes} -> ${fundoDepois}`
    );

    // a prévia também precisa refletir a tipografia
    const abaTerminal = $$('.tabs-strip button').find((b) => b.textContent.trim() === 'Terminal');
    abaTerminal.click();
    await sleep(200);

    const previaTerminal = await waitFor(() => $('.theme-preview'), 'prévia na aba Terminal');
    const tamanhoAntes = getComputedStyle(previaTerminal).fontSize;
    const inputTamanho = campo('Tamanho');
    inputTamanho.value = '22';
    inputTamanho.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(350);

    const tamanhoDepois = getComputedStyle($('.theme-preview')).fontSize;
    record(
      tamanhoDepois !== tamanhoAntes && tamanhoDepois.startsWith('22'),
      'mudar o tamanho da fonte aparece na prévia',
      `${tamanhoAntes} -> ${tamanhoDepois}`
    );

    // devolve o tamanho para não sujar o estado
    inputTamanho.value = '14';
    inputTamanho.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);
    await fecharModal();

    // ------------------------------------------------------ sessão serial --
    log.push('\n[sessão serial]');

    $('#btn-new-session').click();
    await waitFor(() => $('.modal-backdrop'), 'editor de sessão');

    const tipos = [...campo('Tipo').querySelectorAll('option')].map((o) => o.value);
    record(tipos.includes('serial'), 'o tipo Serial (COM) aparece na lista', tipos.join(', '));

    trocarSelect(campo('Tipo'), 'serial');
    await sleep(300);

    const campoPorta = campo('Porta');
    record(!!campoPorta, 'o editor mostra o campo de porta');
    record(!!campo('Velocidade (baud)'), 'o editor mostra a velocidade');

    // No estilo do PuTTY: da para DIGITAR a porta, nao so escolher da lista.
    const inputPorta = campoPorta.querySelector('input[list]');
    record(!!inputPorta, 'a porta e um campo digitavel com sugestoes, nao uma lista fechada');
    if (inputPorta) {
      inputPorta.value = '/dev/ttyUSB9';
      inputPorta.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(150);
      record(inputPorta.value === '/dev/ttyUSB9',
        'aceita uma porta que o sistema nao enumerou');
      inputPorta.value = '';
      inputPorta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    record(
      !!campo('Velocidade (baud)').querySelector('input[list]'),
      'a velocidade tambem aceita valor digitado'
    );

    const portas = [...campo('Porta').querySelectorAll('option')]
      .map((o) => o.value).filter(Boolean);
    record(true, `portas detectadas na máquina: ${portas.length ? portas.join(', ') : 'nenhuma'}`);

    const bauds = [...campo('Velocidade (baud)').querySelectorAll('option')].map((o) => o.value);
    record(bauds.includes('115200'), 'a lista de velocidades vem do processo principal');

    // Autenticação e Túneis não fazem sentido numa serial.
    const abas = $$('.tabs-strip button').map((b) => b.textContent.trim());
    record(
      !abas.includes('Autenticação') && !abas.includes('Túneis'),
      'abas que não se aplicam ao serial somem',
      abas.join(', ')
    );

    const abaAvancado = $$('.tabs-strip button').find((b) => b.textContent.trim() === 'Avançado');
    abaAvancado.click();
    await sleep(250);

    record(!!campo('Bits de dados'), 'a aba Avançado traz bits de dados');
    record(!!campo('Paridade'), 'a aba Avançado traz paridade');
    record(!!campo('Controle de fluxo'), 'controle de fluxo num campo so, como no PuTTY');
    record(!!campo('Enter envia'), 'dá para escolher o fim de linha (CR/LF/CRLF)');

    await fecharModal();
  } catch (err) {
    record(false, 'roteiro interrompido', err.message);
  }

  return { ok, log };
})()
