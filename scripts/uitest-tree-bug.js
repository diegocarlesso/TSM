/**
 * Reproduz dois problemas relatados na árvore de sessões:
 *   1. Ações do menu de contexto (Conectar, Editar, Duplicar...) não fazem nada.
 *   2. Expandir/recolher pastas fica errático — clicar numa pasta afeta outras.
 *
 *   TSM_DATA_DIR=./demo node scripts/seed-demo.js
 *   TSM_SMOKE=1 TSM_UITEST=scripts/uitest-tree-bug.js TSM_DATA_DIR=./demo npx electron .
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

  const folderRows = () => $$('#tree .node.folder');
  const isOpen = (row) => row.querySelector('.twisty').textContent === '▾';

  try {
    log.push('\n[árvore — menu de contexto e expandir/recolher]');

    await waitFor(() => folderRows().length >= 3, 'pastas carregadas na árvore');

    // --- expandir/recolher: uma pasta não pode afetar as outras -------------
    const antes = folderRows().map((r) => ({ id: r.dataset.id, aberta: isOpen(r) }));
    log.push(`  info  estado inicial: ${antes.map((f) => `${f.id.slice(0, 4)}=${f.aberta ? 'aberta' : 'fechada'}`).join(' ')}`);

    const alvo = folderRows()[0];
    const idAlvo = alvo.dataset.id;
    const estadoAntesDoAlvo = isOpen(alvo);
    alvo.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(150);

    const depois = folderRows().filter((r) => r.dataset.id !== idAlvo)
      .map((r) => ({ id: r.dataset.id, aberta: isOpen(r) }));
    const outrasAntes = antes.filter((f) => f.id !== idAlvo);
    const mudouOutra = depois.some((f) => {
      const original = outrasAntes.find((o) => o.id === f.id);
      return original && original.aberta !== f.aberta;
    });
    record(!mudouOutra, 'clicar numa pasta não muda o estado de outras pastas',
      mudouOutra ? `antes: ${JSON.stringify(outrasAntes)} depois: ${JSON.stringify(depois)}` : undefined);

    const alvoDepois = folderRows().find((r) => r.dataset.id === idAlvo);
    record(isOpen(alvoDepois) !== estadoAntesDoAlvo, 'a pasta clicada trocou de estado',
      `antes=${estadoAntesDoAlvo} depois=${isOpen(alvoDepois)}`);

    // Clica de novo para voltar ao estado original e confere estabilidade.
    alvoDepois.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(150);
    const volta = folderRows().find((r) => r.dataset.id === idAlvo);
    record(isOpen(volta) === estadoAntesDoAlvo, 'clicar de novo volta a pasta ao estado original',
      `esperado=${estadoAntesDoAlvo} obtido=${isOpen(volta)}`);

    // --- menu de contexto: Conectar precisa abrir um painel de verdade ------
    const sessao = await waitFor(() => $('#tree .node.session'), 'uma sessão na árvore');
    const rect = sessao.getBoundingClientRect();
    sessao.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: rect.left + 10, clientY: rect.top + 5
    }));
    const menu = await waitFor(() => $('.context-menu'), 'menu de contexto da sessão');
    const itens = $$('.context-menu .item').map((n) => n.textContent);
    record(itens.some((t) => t.includes('Conectar')), 'item "Conectar" presente no menu', itens.join(' | '));

    const itemConectar = $$('.context-menu .item').find((n) => n.textContent.startsWith('Conectar') && !n.textContent.includes('nova aba'));
    const abasAntes = $$('#tabs .tab').length;

    // Clique de mouse de verdade no ponto do item (mousedown+mouseup+click),
    // não .click() direto — reproduz o que o usuário realmente faz.
    const ir = itemConectar.getBoundingClientRect();
    for (const type of ['mousedown', 'mouseup', 'click']) {
      itemConectar.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, clientX: ir.left + 10, clientY: ir.top + 5
      }));
    }

    const abriu = await waitFor(() => $$('#tabs .tab').length > abasAntes, 'nova aba abrir depois de "Conectar"', 5000)
      .then(() => true).catch(() => false);
    record(abriu, 'clicar em "Conectar" no menu de contexto abre uma aba',
      abriu ? undefined : `abas antes=${abasAntes} depois=${$$('#tabs .tab').length}`);
  } catch (err) {
    record(false, 'roteiro interrompido', err.message + '\n' + (err.stack || ''));
  }

  return { ok, log };
})()
