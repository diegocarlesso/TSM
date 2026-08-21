'use strict';
/**
 * Árvore de layout de uma aba.
 *
 * Uma aba deixa de ser "um terminal" e passa a ser uma árvore:
 *
 *   folha  -> { kind: 'leaf', paneId }
 *   divisão-> { kind: 'split', dir: 'row' | 'col', children: [no, no], sizes: [f, f] }
 *
 * Cada divisão tem exatamente dois filhos; layouts mais complexos saem do
 * aninhamento (que é como tmux, Windows Terminal e Tabby fazem). Duas divisões
 * aninhadas cobrem 3 painéis, três cobrem 4, e assim por diante — sem precisar
 * de uma tabela de layouts prontos.
 *
 * `sizes` guarda frações que somam 1, para o layout sobreviver a redimensionar
 * a janela.
 */

export const leaf = (paneId) => ({ kind: 'leaf', paneId });

/** Percorre a árvore aplicando `fn` a cada folha. */
export function eachLeaf(node, fn) {
  if (!node) return;
  if (node.kind === 'leaf') return fn(node);
  for (const child of node.children) eachLeaf(child, fn);
}

export function leafIds(node) {
  const out = [];
  eachLeaf(node, (l) => out.push(l.paneId));
  return out;
}

export function countLeaves(node) {
  return leafIds(node).length;
}

export function findLeaf(node, paneId) {
  let hit = null;
  eachLeaf(node, (l) => { if (l.paneId === paneId) hit = l; });
  return hit;
}

/** Devolve `{ parent, index }` do no informado, ou null se for a raiz. */
function locate(root, target, parent = null, index = -1) {
  if (root === target) return { parent, index };
  if (root.kind !== 'split') return null;
  for (let i = 0; i < root.children.length; i++) {
    const found = locate(root.children[i], target, root, i);
    if (found) return found;
  }
  return null;
}

/**
 * Divide a folha de `paneId`, colocando `newPaneId` ao lado.
 * `dir`: 'row' divide lado a lado; 'col' divide um sobre o outro.
 * Devolve a nova raiz (pode ser a mesma referência).
 */
export function splitLeaf(root, paneId, newPaneId, dir, before = false) {
  const target = findLeaf(root, paneId);
  if (!target) return root;

  const existing = leaf(target.paneId);
  const added = leaf(newPaneId);
  const split = {
    kind: 'split',
    dir,
    children: before ? [added, existing] : [existing, added],
    sizes: [0.5, 0.5]
  };

  if (root === target) return split;

  const spot = locate(root, target);
  if (!spot) return root;
  spot.parent.children[spot.index] = split;
  return root;
}

/**
 * Remove a folha. Quando uma divisão fica com um filho só, ela some e o filho
 * sobe no lugar dela — senão a árvore acumularia níveis vazios.
 * Devolve a nova raiz, ou null se a aba ficou sem nenhum painel.
 */
export function removeLeaf(root, paneId) {
  const target = findLeaf(root, paneId);
  if (!target) return root;
  if (root === target) return null;

  const spot = locate(root, target);
  if (!spot) return root;

  const parent = spot.parent;
  const survivorIndex = spot.index === 0 ? 1 : 0;
  const survivor = parent.children[survivorIndex];

  if (parent === root) return survivor;

  const grand = locate(root, parent);
  if (!grand) return survivor;
  grand.parent.children[grand.index] = survivor;
  return root;
}

/** Ordem visual das folhas — usadá para "próximo painel". */
export function orderedLeaves(root) {
  return leafIds(root);
}

/**
 * Impressão digital da ESTRUTURA da árvore (não dos tamanhos nem do foco).
 *
 * O renderizador só reconstrói o DOM quando essa assinatura muda. Sem isso,
 * qualquer mudança de status reconstruiria a árvore e arrancaria os elementos
 * do xterm do documento a cada evento — caro e visivelmente instável.
 */
export function signature(node) {
  if (!node) return '';
  if (node.kind === 'leaf') return node.paneId;
  return `(${node.dir}:${node.children.map(signature).join(',')})`;
}

/**
 * Vizinho geométrico na direção pedida ('left'|'right'|'up'|'down').
 * Sobe na árvore até achar uma divisão no eixo certo e desce pelo lado oposto,
 * o que dá a navegação "natural" com Alt+setas.
 */
export function neighbor(root, paneId, direction) {
  const axis = (direction === 'left' || direction === 'right') ? 'row' : 'col';
  const forward = (direction === 'right' || direction === 'down');

  let node = findLeaf(root, paneId);
  if (!node) return null;

  while (node !== root) {
    const spot = locate(root, node);
    if (!spot) return null;
    const { parent, index } = spot;

    if (parent.dir === axis) {
      const nextIndex = forward ? index + 1 : index - 1;
      if (nextIndex >= 0 && nextIndex < parent.children.length) {
        return firstLeafToward(parent.children[nextIndex], axis, !forward);
      }
    }
    node = parent;
  }
  return null;
}

/** Desce até uma folha, preferindo o lado indicado quando o eixo bate. */
function firstLeafToward(node, axis, preferFirst) {
  let cur = node;
  while (cur.kind === 'split') {
    cur = cur.dir === axis
      ? cur.children[preferFirst ? 0 : cur.children.length - 1]
      : cur.children[0];
  }
  return cur.paneId;
}

/**
 * Monta o DOM da árvore dentro de `container`.
 * `mount(paneId)` devolve o elemento do terminal daquele painel — o elemento é
 * reaproveitado (nunca recriado), então o buffer e o scroll do terminal
 * sobrevivem a qualquer mudança de layout.
 */
export function renderTree(container, root, { mount, activePaneId, onResize }) {
  container.replaceChildren();
  if (root) container.append(buildNode(root, { mount, activePaneId, onResize }));
}

function buildNode(node, ctx) {
  if (node.kind === 'leaf') {
    const el = document.createElement('div');
    el.className = 'leaf' + (node.paneId === ctx.activePaneId ? ' focused' : '');
    el.dataset.paneId = node.paneId;
    const paneEl = ctx.mount(node.paneId);
    if (paneEl) el.append(paneEl);
    return el;
  }

  const wrap = document.createElement('div');
  wrap.className = `split ${node.dir}`;

  node.children.forEach((child, i) => {
    if (i > 0) wrap.append(buildHandle(node, i - 1, wrap, ctx));
    const childEl = buildNode(child, ctx);
    childEl.style.flex = `${node.sizes[i] ?? 1} 1 0`;
    childEl.style.minWidth = '0';
    childEl.style.minHeight = '0';
    wrap.append(childEl);
  });

  return wrap;
}

/** Divisoria arrastável entre `index` e `index + 1`. */
function buildHandle(node, index, wrap, ctx) {
  const handle = document.createElement('div');
  handle.className = `split-handle ${node.dir}`;
  handle.title = 'Arraste para redimensionar';

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const horizontal = node.dir === 'row';
    const rect = wrap.getBoundingClientRect();
    const total = horizontal ? rect.width : rect.height;
    const start = horizontal ? e.clientX : e.clientY;
    const a0 = node.sizes[index];
    const b0 = node.sizes[index + 1];
    const pair = a0 + b0;

    // Enquanto arrasta, mexemos só no style: reconstruir a árvore a cada
    // mousemove destruiria os terminais.
    const children = [...wrap.children].filter((c) => !c.classList.contains('split-handle'));
    const elA = children[index];
    const elB = children[index + 1];

    const onMove = (ev) => {
      const delta = ((horizontal ? ev.clientX : ev.clientY) - start) / total;
      const a = Math.max(0.08, Math.min(pair - 0.08, a0 + delta));
      const b = pair - a;
      node.sizes[index] = a;
      node.sizes[index + 1] = b;
      elA.style.flex = `${a} 1 0`;
      elB.style.flex = `${b} 1 0`;
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      if (ctx.onResize) ctx.onResize();
    };

    document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  return handle;
}
