'use strict';
/** Primitivas de interface: elementos, modais, menus de contexto e toasts. */

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') node.value = v;
    else if (k === 'checked') node.checked = !!v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ------------------------------------------------------------- toasts -----
export function toast(message, kind = 'info', ms = 4200) {
  const root = $('#toast-root');
  const node = el('div', { class: `toast ${kind}`, text: message });
  root.append(node);
  const remove = () => {
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 180);
  };
  node.addEventListener('click', remove);
  setTimeout(remove, ms);
  return node;
}

export const notifyError = (err) => toast(err && err.message ? err.message : String(err), 'err', 7000);

/** Executa e reporta a falha em toast em vez de morrer silenciosamente. */
export async function guard(fn) {
  try {
    return await fn();
  } catch (err) {
    notifyError(err);
    return undefined;
  }
}

// -------------------------------------------------------------- modais ----
let openModals = 0;

/**
 * Abre um modal. `render(api)` devolve o corpo; `api.close(result)` resolve.
 * A promise entrega `undefined` quando o usuário cancela.
 */
export function modal({ title, width, render, footer, onKeydown }) {
  return new Promise((resolve) => {
    const backdrop = el('div', { class: 'modal-backdrop' });
    const box = el('div', { class: 'modal' });
    if (width) box.style.minWidth = `${width}px`;

    let settled = false;
    const close = (value) => {
      if (settled) return;
      settled = true;
      openModals--;
      document.removeEventListener('keydown', keyHandler, true);
      backdrop.remove();
      resolve(value);
    };

    const api = { close, box };
    const body = el('div', { class: 'modal-body' });
    const content = render(api);
    body.append(content instanceof Node ? content : document.createTextNode(String(content)));

    const head = el('div', { class: 'modal-head' }, [
      el('span', { text: title || '' }),
      el('button', { class: 'icon-btn', text: '✕', onClick: () => close(undefined) })
    ]);

    box.append(head, body);
    if (footer) box.append(el('div', { class: 'modal-foot' }, footer(api)));
    backdrop.append(box);

    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) close(undefined);
    });

    const keyHandler = (e) => {
      if (openModals && e.key === 'Escape') {
        e.stopPropagation();
        close(undefined);
      } else if (onKeydown) {
        onKeydown(e, api);
      }
    };
    document.addEventListener('keydown', keyHandler, true);

    openModals++;
    $('#modal-root').append(backdrop);

    const focusable = box.querySelector('input, select, textarea, button.primary');
    if (focusable) setTimeout(() => focusable.focus(), 30);
  });
}

export function confirmDialog({ title, message, detail, confirmLabel = 'Confirmar', danger = false }) {
  return modal({
    title,
    width: 420,
    render: () => el('div', {}, [
      el('p', { text: message, style: 'margin-top:0' }),
      detail ? el('p', { class: 'muted', text: detail }) : null
    ]),
    footer: (api) => [
      el('button', { text: 'Cancelar', onClick: () => api.close(false) }),
      el('button', {
        class: danger ? 'danger' : 'primary',
        text: confirmLabel,
        onClick: () => api.close(true)
      })
    ]
  }).then((v) => v === true);
}

export function promptDialog({ title, label, value = '', password = false, placeholder = '', hint = '' }) {
  let input;
  return modal({
    title,
    width: 420,
    render: (api) => {
      input = el('input', {
        type: password ? 'password' : 'text',
        value,
        placeholder,
        onKeydown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); api.close(input.value); }
        }
      });
      return el('div', { class: 'form-grid' }, [
        el('label', { text: label }),
        input,
        hint ? el('div', { class: 'hint', text: hint }) : null
      ]);
    },
    footer: (api) => [
      el('button', { text: 'Cancelar', onClick: () => api.close(undefined) }),
      el('button', { class: 'primary', text: 'OK', onClick: () => api.close(input.value) })
    ]
  });
}

// ------------------------------------------------------ menu de contexto --
let activeMenu = null;

export function contextMenu(event, items) {
  event.preventDefault();
  closeContextMenu();

  const menu = el('div', { class: 'context-menu' });
  for (const item of items) {
    if (!item) continue;
    if (item.separator) { menu.append(el('div', { class: 'sep' })); continue; }
    if (item.hidden) continue;
    const node = el('div', {
      class: `item${item.danger ? ' danger' : ''}`,
      onClick: () => {
        closeContextMenu();
        item.onClick && item.onClick();
      }
    }, [
      el('span', { text: item.label }),
      item.key ? el('span', { class: 'key', text: item.key }) : null
    ]);
    if (item.disabled) {
      node.style.opacity = '.45';
      node.style.pointerEvents = 'none';
    }
    menu.append(node);
  }

  document.getElementById('context-root').append(menu);
  const rect = menu.getBoundingClientRect();
  const x = Math.min(event.clientX, window.innerWidth - rect.width - 6);
  const y = Math.min(event.clientY, window.innerHeight - rect.height - 6);
  menu.style.left = `${Math.max(4, x)}px`;
  menu.style.top = `${Math.max(4, y)}px`;

  activeMenu = menu;
  setTimeout(() => {
    document.addEventListener('mousedown', closeContextMenu, { once: true });
    document.addEventListener('keydown', escClose, { once: true });
  }, 0);
}

function escClose(e) {
  if (e.key === 'Escape') closeContextMenu();
}

export function closeContextMenu() {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
}

// ------------------------------------------------------------- helpers ----
export function field(labelText, control, hint) {
  const frag = document.createDocumentFragment();
  frag.append(el('label', { text: labelText }), control);
  if (hint) frag.append(el('div', { class: 'hint', text: hint }));
  return frag;
}

export function checkbox(labelText, checked, onChange) {
  const input = el('input', { type: 'checkbox', checked, onChange: (e) => onChange(e.target.checked) });
  return el('label', { class: 'inline', style: 'color:var(--text)' }, [input, labelText]);
}

export function select(options, value, onChange) {
  const node = el('select', { onChange: (e) => onChange(e.target.value) });
  for (const opt of options) {
    node.append(el('option', { value: opt.value, text: opt.label, selected: opt.value === value }));
  }
  node.value = value;
  return node;
}

export function formatBytes(n) {
  if (n === null || n === undefined) return '';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function formatDate(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString('pt-BR');
}
