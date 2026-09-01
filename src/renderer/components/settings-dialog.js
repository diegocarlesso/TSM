'use strict';
/** Configurações, aparência, credenciais, import/export e janelas auxiliares. */
import { el, modal, toast, guard, checkbox, select, confirmDialog, promptDialog, formatDate, formatBytes } from './ui.js';
import {
  state, reloadSettings, reloadThemes, reloadVault, reloadIdentities, reloadTree, setting
} from './state.js';
import { refreshAppearance } from './terminal.js';

const CURSOR_STYLES = [
  { value: 'block', label: 'Bloco' },
  { value: 'underline', label: 'Sublinhado' },
  { value: 'bar', label: 'Barra' }
];

const RIGHT_CLICK = [
  { value: 'paste', label: 'Colar' },
  { value: 'menu', label: 'Abrir menu de contexto' }
];

// ------------------------------------------------------------ settings ----
export async function settingsDialog(initialTab = 'aparência') {
  let tab = initialTab;
  const body = el('div');
  const draft = { ...state.settings };

  const commit = async (key, value) => {
    draft[key] = value;
    state.settings[key] = value;
    await window.tsm.settings.set(key, value);
    if (key.startsWith('terminal.')) {
      refreshAppearance();
      atualizarPrevias();
    }
    if (key === 'ui.theme') applyUiTheme(value);
    if (key === 'ui.accent') document.documentElement.style.setProperty('--accent', value);
  };

  function rerender() {
    body.replaceChildren(strip(), panel());
  }

  /**
   * Reaplica tipografia e cores nas prévias já montadas, sem reconstruir o
   * painel: se remontassemos, o campo que o usuário esta digitando perderia o
   * foco a cada tecla.
   */
  function atualizarPrevias() {
    for (const node of body.querySelectorAll('.theme-preview')) {
      const tema = state.themes.find((t) => t.id === draft['terminal.theme']) || state.themes[0];
      if (!tema) continue;
      node.style.fontFamily = draft['terminal.fontFamily'] || '';
      node.style.fontSize = `${Number(draft['terminal.fontSize']) || 14}px`;
      node.style.lineHeight = String(Number(draft['terminal.lineHeight']) || 1.2);
      node.style.background = tema.data.background;
      node.style.color = tema.data.foreground;
      node.dataset.themeId = tema.id;
    }
  }

  function strip() {
    const node = el('div', { class: 'tabs-strip' });
    for (const [key, label] of [
      ['aparência', 'Aparência'], ['terminal', 'Terminal'],
      ['conexão', 'Conexão'], ['segurança', 'Segurança'], ['dados', 'Dados']
    ]) {
      node.append(el('button', {
        class: tab === key ? 'active' : '', text: label,
        onClick: () => { tab = key; rerender(); }
      }));
    }
    return node;
  }

  function panel() {
    const grid = el('div', { class: 'form-grid' });
    const add = (label, control, hint) => {
      grid.append(el('label', { text: label }), control);
      if (hint) grid.append(el('div', { class: 'hint', text: hint }));
    };
    const full = (n) => grid.append(el('div', { class: 'full' }, [n]));

    if (tab === 'aparência') {
      add('Tema da janela', select(
        state.uiThemes.map((t) => ({ value: t.id, label: t.name })),
        draft['ui.theme'] || 'dark',
        (v) => commit('ui.theme', v)
      ));
      add('Cor de destaque', el('input', {
        type: 'color', value: draft['ui.accent'] || '#2daaf4',
        onInput: (e) => commit('ui.accent', e.target.value)
      }));
      add('Tema do terminal', el('div', { class: 'inline' }, [
        select(
          state.themes.map((t) => ({ value: t.id, label: t.name })),
          draft['terminal.theme'] || 'tsm-dark',
          // `commit` sozinho não redesenhava a prévia: ela era montada uma vez,
          // na renderização do painel, e ficava mostrando o tema anterior.
          async (v) => { await commit('terminal.theme', v); rerender(); }
        ),
        el('button', { text: 'Editar temas…', onClick: () => themeEditor().then(rerender) })
      ]));
      full(themePreview(draft['terminal.theme'], draft));
    }

    if (tab === 'terminal') {
      add('Fonte', el('input', {
        type: 'text', value: draft['terminal.fontFamily'],
        onInput: (e) => commit('terminal.fontFamily', e.target.value)
      }), 'Lista CSS: a primeira fonte instalada é usada.');
      add('Tamanho', el('input', {
        type: 'number', value: draft['terminal.fontSize'], min: '6', max: '40',
        onInput: (e) => commit('terminal.fontSize', Number(e.target.value))
      }));
      add('Altura de linha', el('input', {
        type: 'number', step: '0.05', value: draft['terminal.lineHeight'],
        onInput: (e) => commit('terminal.lineHeight', Number(e.target.value))
      }));
      add('Espaçamento', el('input', {
        type: 'number', step: '0.1', value: draft['terminal.letterSpacing'],
        onInput: (e) => commit('terminal.letterSpacing', Number(e.target.value))
      }));
      add('Cursor', select(CURSOR_STYLES, draft['terminal.cursorStyle'], (v) => commit('terminal.cursorStyle', v)));
      full(checkbox('Cursor piscante', draft['terminal.cursorBlink'], (v) => commit('terminal.cursorBlink', v)));
      add('Histórico (linhas)', el('input', {
        type: 'number', value: draft['terminal.scrollback'], min: '100', step: '1000',
        onInput: (e) => commit('terminal.scrollback', Number(e.target.value))
      }), 'Quantas linhas ficam disponíveis para rolar. 100000 é confortável e barato em memória.');
      add('Botão direito', select(RIGHT_CLICK, draft['terminal.rightClick'], (v) => commit('terminal.rightClick', v)));
      full(checkbox('Copiar ao selecionar', draft['terminal.copyOnSelect'], (v) => commit('terminal.copyOnSelect', v)));
      add('Separadores de palavra', el('input', {
        type: 'text', value: draft['terminal.wordSeparators'],
        onInput: (e) => commit('terminal.wordSeparators', e.target.value)
      }), 'Usados no duplo clique.');
      // A mesma prévia aparece aqui, já que esta aba mexe em fonte e tamanho.
      full(themePreview(draft['terminal.theme'], draft));
    }

    if (tab === 'conexão') {
      full(checkbox('Confirmar antes de fechar uma aba conectada',
        draft['connection.confirmClose'], (v) => commit('connection.confirmClose', v)));
      full(checkbox('Reconectar automaticamente quando a conexão cair',
        draft['connection.reconnectOnDrop'], (v) => commit('connection.reconnectOnDrop', v)));
      grid.append(el('div', { class: 'full' }, [el('hr', { style: 'border-color:var(--border)' })]));
      full(checkbox('Verificar atualizações automaticamente (uma vez por semana)',
        draft['update.checkEnabled'] !== false, (v) => commit('update.checkEnabled', v)));
      full(el('button', { text: 'Verificar agora', onClick: () => checkForUpdateNow() }));
      grid.append(el('div', { class: 'hint full' }, [
        'A consulta sai do processo principal e pergunta ao GitHub só qual é a última versão publicada. '
        + 'Nenhum dado seu é enviado.'
      ]));
      grid.append(el('div', { class: 'full' }, [el('hr', { style: 'border-color:var(--border)' })]));
      full(el('button', { text: 'Chaves de host conhecidas…', onClick: () => knownHostsDialog() }));
      full(el('button', { text: 'Histórico de conexões…', onClick: () => historyDialog() }));
    }

    if (tab === 'segurança') {
      const v = state.vault;
      grid.append(el('div', { class: 'full muted' }, [
        el('p', {
          text: v.masterEnabled
            ? 'As credenciais estão cifradas com a sua senha mestra (AES-256-GCM + scrypt).'
            : v.scheme === 'safeStorage'
              ? 'As credenciais estão cifradas pelo cofre do sistema operacional (DPAPI/Keychain/libsecret).'
              : 'ATENÇÃO: o sistema não oferece cofre e não há senha mestra — não é possível salvar senhas.'
        })
      ]));

      full(el('button', {
        text: v.masterEnabled ? 'Trocar senha mestra…' : 'Definir senha mestra…',
        onClick: () => masterPasswordDialog(false).then(rerender)
      }));
      if (v.masterEnabled) {
        full(el('button', {
          text: 'Desativar senha mestra (voltar ao cofre do SO)',
          onClick: () => masterPasswordDialog(true).then(rerender)
        }));
        full(el('button', { text: 'Bloquear cofre agora', onClick: () => lockVault() }));
      }
      full(checkbox('Bloquear o cofre ao minimizar a janela',
        draft['security.lockOnMinimize'], (v2) => commit('security.lockOnMinimize', v2)));
      grid.append(el('div', { class: 'full' }, [el('hr', { style: 'border-color:var(--border)' })]));
      full(el('button', { text: 'Credenciais salvas…', onClick: () => identitiesDialog() }));
    }

    if (tab === 'dados') {
      add('Banco de dados', el('code', {
        text: state.info ? state.info.dbPath : '', style: 'user-select:text;font-size:11px;word-break:break-all'
      }));
      full(el('button', { text: 'Exportar sessões…', onClick: () => exportDialog() }));
      full(el('button', { text: 'Importar sessões…', onClick: () => importDialog() }));
      full(el('button', {
        text: 'Backup do banco (.db)…',
        onClick: () => guard(async () => {
          const res = await window.tsm.io.backupDb();
          if (!res.canceled) toast(`Backup salvo em ${res.filePath}`, 'ok');
        })
      }));
      grid.append(el('div', { class: 'full' }, [el('hr', { style: 'border-color:var(--border)' })]));
      full(el('button', {
        text: 'Restaurar temas embutidos',
        onClick: () => guard(async () => {
          await window.tsm.themes.resetBuiltins();
          await reloadThemes();
          toast('Temas restaurados', 'ok');
          rerender();
        })
      }));
    }

    return grid;
  }

  rerender();
  await modal({
    title: 'Configurações',
    width: 640,
    render: () => body,
    footer: (api) => [el('button', { class: 'primary', text: 'Fechar', onClick: () => api.close(true) })]
  });
  await reloadSettings();
}

/**
 * Prévia do tema do terminal. Recebe as preferências em uso para que fonte,
 * tamanho e altura de linha aparecam do jeito que ficarao de verdade — senão a
 * prévia mostra as cores certas com a tipografia errada.
 */
function themePreview(themeId, prefs = {}) {
  const t = state.themes.find((x) => x.id === themeId) || state.themes[0];
  if (!t) return el('div', { class: 'muted', text: 'Nenhum tema disponível.' });

  const d = t.data;
  const line = (color, text) => `<span style="color:${color}">${text}</span>`;
  const fonte = prefs['terminal.fontFamily'] || setting('terminal.fontFamily', 'monospace');
  const tamanho = Number(prefs['terminal.fontSize'] || setting('terminal.fontSize', 14));
  const altura = Number(prefs['terminal.lineHeight'] || setting('terminal.lineHeight', 1.2));

  return el('div', {
    class: 'theme-preview',
    dataset: { themeId: t.id },
    style: `background:${d.background};color:${d.foreground};font-family:${fonte};`
      + `font-size:${tamanho}px;line-height:${altura}`,
    html: [
      `${line(d.green, 'usuário@servidor')}:${line(d.blue, '~/projetos')}$ ls -la`,
      `${line(d.brightBlue, 'drwxr-xr-x')}  4 root root  4096 ${line(d.cyan, 'config/')}`,
      `${line(d.foreground, '-rw-r--r--')}  1 root root 12043 ${line(d.foreground, 'app.log')}`,
      `${line(d.red, 'erro:')} falha ao conectar  ${line(d.yellow, 'aviso:')} tentando de novo`,
      `${line(d.magenta, 'DEBUG')} pool=12 idle=3  ${line(d.brightGreen, 'OK')} 200`
    ].join('\n')
  });
}

// ------------------------------------------------------ nova versão -------
/** `1.3.2` e `v1.3.2` viram sempre `v1.3.2` — a tag do GitHub já pode vir com o v. */
export const updateVersionLabel = (v) => `v${String(v ?? '').replace(/^v/i, '')}`;

/**
 * Consulta forçada, usada pelo botão das Configurações e pelo item do menu
 * Ajuda. Fica aqui num lugar só para os dois caminhos não divergirem.
 */
export async function checkForUpdateNow() {
  return guard(async () => {
    const r = await window.tsm.update.check({ force: true });
    if (!r || r.error) {
      toast('Não deu para verificar agora — sem conexão?', 'err');
      return r;
    }
    if (r.hasUpdate) {
      const abrir = await confirmDialog({
        title: 'Nova versão disponível',
        message: `${updateVersionLabel(r.latest)} já está disponível `
          + `(você está na ${updateVersionLabel(r.current)}).`,
        detail: 'Deseja abrir a página de download no navegador?',
        confirmLabel: 'Abrir página'
      });
      if (abrir) window.tsm.app.openExternal(r.url);
    } else {
      toast('Você já está na última versão', 'ok');
    }
    return r;
  });
}

function applyUiTheme(value) {
  const dark = value === 'dark'
    || (value === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.body.classList.toggle('theme-dark', dark);
  document.body.classList.toggle('theme-light', !dark);
}

export { applyUiTheme };

// -------------------------------------------------------- editor de tema --
export async function themeEditor() {
  let current = state.themes.find((t) => t.id === setting('terminal.theme', 'tsm-dark')) || state.themes[0];
  let draft = structuredClone(current.data);
  let name = current.name;
  const body = el('div');

  const KEYS = [
    ['background', 'Fundo'], ['foreground', 'Texto'], ['cursor', 'Cursor'],
    ['selectionBackground', 'Seleção'],
    ['black', 'Preto'], ['red', 'Vermelho'], ['green', 'Verde'], ['yellow', 'Amarelo'],
    ['blue', 'Azul'], ['magenta', 'Magenta'], ['cyan', 'Ciano'], ['white', 'Branco'],
    ['brightBlack', 'Preto+'], ['brightRed', 'Vermelho+'], ['brightGreen', 'Verde+'],
    ['brightYellow', 'Amarelo+'], ['brightBlue', 'Azul+'], ['brightMagenta', 'Magenta+'],
    ['brightCyan', 'Ciano+'], ['brightWhite', 'Branco+']
  ];

  function rerender() {
    const picker = select(
      state.themes.map((t) => ({ value: t.id, label: `${t.name}${t.builtin ? ' (embutido)' : ''}` })),
      current.id,
      (v) => {
        current = state.themes.find((t) => t.id === v);
        draft = structuredClone(current.data);
        name = current.name;
        rerender();
      }
    );

    const swatches = el('div', { class: 'swatch-row' });
    for (const [key, label] of KEYS) {
      swatches.append(el('label', { class: 'swatch' }, [
        el('input', {
          type: 'color', value: draft[key] || '#000000',
          onInput: (e) => { draft[key] = e.target.value; updatePreview(); }
        }),
        label
      ]));
    }

    const preview = el('div', { class: 'theme-preview' });
    const updatePreview = () => {
      preview.style.background = draft.background;
      preview.style.color = draft.foreground;
      preview.innerHTML = [
        `<span style="color:${draft.green}">deploy@prod</span>:<span style="color:${draft.blue}">/var/log</span>$ tail -f app.log`,
        `<span style="color:${draft.cyan}">INFO</span>  serviço iniciado na porta 8080`,
        `<span style="color:${draft.yellow}">WARN</span>  latência acima do normal`,
        `<span style="color:${draft.red}">ERROR</span> conexão recusada`,
        `<span style="color:${draft.brightMagenta}">DEBUG</span> pool=12 idle=3`
      ].join('\n');
    };
    updatePreview();

    body.replaceChildren(el('div', {}, [
      el('div', { class: 'form-grid', style: 'margin-bottom:12px' }, [
        el('label', { text: 'Tema base' }), picker,
        el('label', { text: 'Nome' }),
        el('input', { type: 'text', value: name, onInput: (e) => { name = e.target.value; } })
      ]),
      swatches,
      el('div', { style: 'height:12px' }),
      preview
    ]));
  }

  rerender();

  const action = await modal({
    title: 'Editor de temas',
    width: 700,
    render: () => body,
    footer: (api) => [
      el('button', {
        text: 'Excluir', class: 'danger',
        onClick: () => api.close('delete')
      }),
      el('button', { text: 'Cancelar', onClick: () => api.close(undefined) }),
      el('button', { text: 'Salvar como novo', onClick: () => api.close('new') }),
      el('button', { class: 'primary', text: 'Salvar', onClick: () => api.close('save') })
    ]
  });

  if (!action) return;

  await guard(async () => {
    if (action === 'delete') {
      if (current.builtin) return toast('Temas embutidos não podem ser excluidos', 'warn');
      const ok = await confirmDialog({ title: 'Excluir tema', message: `Excluir "${current.name}"?`, danger: true });
      if (!ok) return;
      await window.tsm.themes.remove(current.id);
    } else if (action === 'new' || current.builtin) {
      const saved = await window.tsm.themes.upsert({ name: name || `${current.name} (copia)`, data: draft });
      await window.tsm.settings.set('terminal.theme', saved.id);
      state.settings['terminal.theme'] = saved.id;
    } else {
      await window.tsm.themes.upsert({ id: current.id, name, data: draft });
    }
    await reloadThemes();
    refreshAppearance();
    toast('Tema atualizado', 'ok');
  });
}

// ------------------------------------------------------------- cofre ------
async function masterPasswordDialog(disable) {
  const fields = { current: '', next: '', confirm: '' };
  const needCurrent = state.vault.masterEnabled;

  const ok = await modal({
    title: disable ? 'Desativar senha mestra' : (needCurrent ? 'Trocar senha mestra' : 'Definir senha mestra'),
    width: 460,
    render: () => {
      const grid = el('div', { class: 'form-grid' });
      if (needCurrent) {
        grid.append(el('label', { text: 'Senha atual' }), el('input', {
          type: 'password', autocomplete: 'current-password',
          onInput: (e) => { fields.current = e.target.value; }
        }));
      }
      if (!disable) {
        grid.append(el('label', { text: 'Nova senha' }), el('input', {
          type: 'password', autocomplete: 'new-password',
          onInput: (e) => { fields.next = e.target.value; }
        }));
        grid.append(el('label', { text: 'Confirmar' }), el('input', {
          type: 'password', autocomplete: 'new-password',
          onInput: (e) => { fields.confirm = e.target.value; }
        }));
        grid.append(el('div', { class: 'hint', text: 'Todas as credenciais já salvas serão re-cifradas com a nova chave. Não há recuperação: guarde a senha.' }));
      }
      return grid;
    },
    footer: (api) => [
      el('button', { text: 'Cancelar', onClick: () => api.close(false) }),
      el('button', { class: 'primary', text: 'Aplicar', onClick: () => api.close(true) })
    ]
  });

  if (!ok) return;
  if (!disable && fields.next !== fields.confirm) return toast('As senhas não conferem', 'err');
  if (!disable && fields.next.length < 8) return toast('Use pelo menos 8 caracteres', 'err');

  await guard(async () => {
    await window.tsm.vault.setMaster(disable ? null : fields.next, fields.current || null);
    await reloadVault();
    toast(disable ? 'Senha mestra desativada' : 'Senha mestra aplicada', 'ok');
  });
}

export async function lockVault() {
  await window.tsm.vault.lock();
  await reloadVault();
  toast('Cofre bloqueado', 'ok');
}

export async function unlockVaultDialog() {
  const pass = await promptDialog({
    title: 'Cofre bloqueado',
    label: 'Senha mestra',
    password: true,
    hint: 'Necessária para usar credenciais salvas.'
  });
  if (pass === undefined) return false;
  const ok = await window.tsm.vault.unlock(pass);
  await reloadVault();
  if (!ok) toast('Senha incorreta', 'err');
  return ok;
}

// -------------------------------------------------------- credenciais -----
export async function identitiesDialog() {
  const body = el('div');

  async function rerender() {
    await reloadIdentities();
    const table = el('table', { class: 'grid' });
    table.append(el('thead', {}, el('tr', {}, [
      el('th', { text: 'Nome' }), el('th', { text: 'Usuário' }),
      el('th', { text: 'Método' }), el('th', { text: '' })
    ])));
    const tbody = el('tbody');
    for (const i of state.identities) {
      tbody.append(el('tr', {}, [
        el('td', { text: i.name }),
        el('td', { text: i.username || '—' }),
        el('td', { text: i.auth_type }),
        el('td', {}, el('div', { class: 'inline' }, [
          el('button', { class: 'icon-btn', text: '✎', title: 'Editar', onClick: () => editIdentity(i).then(rerender) }),
          el('button', {
            class: 'icon-btn', text: '✕', title: 'Excluir',
            onClick: async () => {
              const ok = await confirmDialog({
                title: 'Excluir credencial', message: `Excluir "${i.name}"?`,
                detail: 'As sessões que a usam voltam a pedir senha.', danger: true
              });
              if (ok) {
                await window.tsm.identities.remove(i.id);
                await rerender();
              }
            }
          })
        ]))
      ]));
    }
    table.append(tbody);
    body.replaceChildren(
      table,
      el('div', { style: 'margin-top:12px' }, [
        el('button', { text: '+ Nova credencial', onClick: () => editIdentity(null).then(rerender) })
      ])
    );
  }

  await rerender();
  await modal({
    title: 'Credenciais salvas',
    width: 620,
    render: () => body,
    footer: (api) => [el('button', { class: 'primary', text: 'Fechar', onClick: () => api.close(true) })]
  });
}

async function editIdentity(identity) {
  const model = {
    name: identity ? identity.name : '',
    username: identity ? identity.username : '',
    authType: identity ? identity.auth_type : 'password',
    keyPath: identity ? identity.key_path : ''
  };
  const pending = { password: undefined, passphrase: undefined };
  const hasPassword = identity ? await window.tsm.secrets.has('identity', identity.id, 'password') : false;

  const ok = await modal({
    title: identity ? `Editar — ${identity.name}` : 'Nova credencial',
    width: 480,
    render: () => el('div', { class: 'form-grid' }, [
      el('label', { text: 'Nome' }),
      el('input', { type: 'text', value: model.name, onInput: (e) => { model.name = e.target.value; } }),
      el('label', { text: 'Usuário' }),
      el('input', { type: 'text', value: model.username, onInput: (e) => { model.username = e.target.value; } }),
      el('label', { text: 'Método' }),
      select(
        [{ value: 'password', label: 'Senha' }, { value: 'key', label: 'Chave privada' }],
        model.authType, (v) => { model.authType = v; }
      ),
      el('label', { text: 'Chave privada' }),
      el('input', { type: 'text', value: model.keyPath, placeholder: '~/.ssh/id_ed25519', onInput: (e) => { model.keyPath = e.target.value; } }),
      el('label', { text: 'Senha' }),
      el('input', {
        type: 'password',
        placeholder: hasPassword ? '•••••••• (guardada)' : 'não definida',
        autocomplete: 'new-password',
        onInput: (e) => { pending.password = e.target.value; }
      })
    ]),
    footer: (api) => [
      el('button', { text: 'Cancelar', onClick: () => api.close(false) }),
      el('button', { class: 'primary', text: 'Salvar', onClick: () => api.close(true) })
    ]
  });

  if (!ok || !model.name.trim()) return;
  await guard(async () => {
    const saved = identity
      ? await window.tsm.identities.update(identity.id, model)
      : await window.tsm.identities.create(model);
    for (const [field, value] of Object.entries(pending)) {
      if (value === undefined) continue;
      await window.tsm.secrets.set('identity', saved.id, field, value);
    }
    toast('Credencial salva', 'ok');
  });
}

// ------------------------------------------------------- known hosts ------
export async function knownHostsDialog() {
  const body = el('div');
  async function rerender() {
    const hosts = await window.tsm.system.knownHosts();
    const table = el('table', { class: 'grid' });
    table.append(el('thead', {}, el('tr', {}, [
      el('th', { text: 'Host' }), el('th', { text: 'Porta' }),
      el('th', { text: 'Impressão digital' }), el('th', { text: 'Visto em' }), el('th', { text: '' })
    ])));
    const tbody = el('tbody');
    for (const h of hosts) {
      tbody.append(el('tr', {}, [
        el('td', { text: h.host }),
        el('td', { text: h.port }),
        el('td', { text: h.fingerprint, style: 'font-family:var(--font-mono);font-size:11px' }),
        el('td', { text: formatDate(h.first_seen) }),
        el('td', {}, el('button', {
          class: 'icon-btn', text: '✕', title: 'Esquecer',
          onClick: async () => {
            await window.tsm.system.forgetHost(h.host, h.port, h.key_type);
            await rerender();
          }
        }))
      ]));
    }
    table.append(tbody);
    body.replaceChildren(hosts.length ? table : el('p', { class: 'muted', text: 'Nenhum host memorizado ainda.' }));
  }
  await rerender();
  await modal({
    title: 'Chaves de host conhecidas',
    width: 720,
    render: () => body,
    footer: (api) => [el('button', { class: 'primary', text: 'Fechar', onClick: () => api.close(true) })]
  });
}

// ---------------------------------------------------------- histórico -----
export async function historyDialog() {
  const rows = await window.tsm.system.log(300);
  const table = el('table', { class: 'grid' });
  table.append(el('thead', {}, el('tr', {}, [
    el('th', { text: 'Início' }), el('th', { text: 'Sessão' }), el('th', { text: 'Tipo' }),
    el('th', { text: 'Destino' }), el('th', { text: 'Duração' }), el('th', { text: 'Status' })
  ])));
  const tbody = el('tbody');
  for (const r of rows) {
    const dur = r.ended_at ? `${Math.round((r.ended_at - r.started_at) / 1000)}s` : 'em curso';
    tbody.append(el('tr', { title: r.error || '' }, [
      el('td', { text: formatDate(r.started_at) }),
      el('td', { text: r.name }),
      el('td', { text: r.type }),
      el('td', { text: r.target }),
      el('td', { text: dur }),
      el('td', { text: r.status, style: r.status === 'error' ? 'color:var(--err)' : '' })
    ]));
  }
  table.append(tbody);

  const action = await modal({
    title: 'Histórico de conexões',
    width: 820,
    render: () => rows.length ? table : el('p', { class: 'muted', text: 'Nada por aqui ainda.' }),
    footer: (api) => [
      el('button', { class: 'danger', text: 'Limpar histórico', onClick: () => api.close('clear') }),
      el('button', { class: 'primary', text: 'Fechar', onClick: () => api.close(true) })
    ]
  });
  if (action === 'clear') {
    await window.tsm.system.clearLog();
    toast('Histórico limpo', 'ok');
  }
}

// ------------------------------------------------------ import/export -----
export async function importDialog() {
  const filePath = await window.tsm.io.pickImport();
  if (!filePath) return;

  const preview = await guard(() => window.tsm.io.preview(filePath));
  if (!preview) return;

  let strategy = 'merge';
  let passphrase = '';

  const sourceLabel = {
    mobaxterm: 'MobaXterm', putty: 'PuTTY', tsm: 'Export do TSM'
  }[preview.source] || preview.source;

  const body = el('div', {}, [
    el('p', {}, [
      el('strong', { text: sourceLabel }), ' — ',
      `${preview.sessions.length} sessão(oes) e ${preview.folders.length} pasta(s) detectada(s).`
    ]),
    preview.detected ? el('p', {
      class: 'muted',
      text: 'Por tipo: ' + Object.entries(preview.detected.byType || {})
        .map(([k, v]) => `${k}=${v}`).join(', ')
    }) : null,
    el('div', { class: 'form-grid', style: 'margin:12px 0' }, [
      el('label', { text: 'Estratégia' }),
      select([
        { value: 'merge', label: 'Mesclar (mantem o que já existe)' },
        { value: 'replace', label: 'Substituir tudo (apaga as sessões atuais)' }
      ], strategy, (v) => { strategy = v; }),
      preview.encrypted ? el('label', { text: 'Senha do arquivo' }) : null,
      preview.encrypted ? el('input', {
        type: 'password', onInput: (e) => { passphrase = e.target.value; }
      }) : null
    ]),
    preview.warnings && preview.warnings.length
      ? el('details', { open: preview.warnings.length <= 6 }, [
        el('summary', { text: `${preview.warnings.length} aviso(s)` }),
        el('ul', { class: 'warn-list' }, preview.warnings.map((w) => el('li', { text: w })))
      ])
      : null,
    el('details', {}, [
      el('summary', { text: 'Ver sessões que serão importadas' }),
      el('ul', { style: 'max-height:200px;overflow:auto;font-size:12px' },
        preview.sessions.slice(0, 500).map((s) => el('li', {
          text: `${s.folderPath ? `${s.folderPath}/` : ''}${s.name} — ${s.type} ${s.config?.host || ''}`
        })))
    ])
  ]);

  const go = await modal({
    title: 'Importar sessões',
    width: 640,
    render: () => body,
    footer: (api) => [
      el('button', { text: 'Cancelar', onClick: () => api.close(false) }),
      el('button', { class: 'primary', text: 'Importar', onClick: () => api.close(true) })
    ]
  });
  if (!go) return;

  await guard(async () => {
    const res = await window.tsm.io.import(filePath, { strategy, passphrase });
    await reloadTree();
    await reloadThemes();
    const s = res.stats;
    toast(
      `Importado: ${s.sessions || 0} sessão(oes), ${s.folders || 0} pasta(s)` +
      (s.skipped ? `, ${s.skipped} ignorada(s)` : ''),
      'ok', 6000
    );
    if (res.warnings && res.warnings.length) {
      console.warn('[TSM] avisos de importação:', res.warnings);
    }
  });
}

export async function exportDialog() {
  let includeSecrets = false;
  let passphrase = '';
  let confirmPass = '';

  const body = el('div');
  const rerender = () => {
    body.replaceChildren(el('div', {}, [
      el('p', { text: `${state.sessions.length} sessão(oes) serão exportadas em JSON.` }),
      el('div', { class: 'full' }, [
        checkbox('Incluir credenciais salvas (cifradas no arquivo)', includeSecrets, (v) => {
          includeSecrets = v;
          rerender();
        })
      ]),
      includeSecrets ? el('div', { class: 'form-grid', style: 'margin-top:10px' }, [
        el('label', { text: 'Senha do arquivo' }),
        el('input', { type: 'password', onInput: (e) => { passphrase = e.target.value; } }),
        el('label', { text: 'Confirmar' }),
        el('input', { type: 'password', onInput: (e) => { confirmPass = e.target.value; } }),
        el('div', { class: 'hint', text: 'AES-256-GCM com chave derivada por scrypt. Sem essa senha, as credenciais do arquivo são irrecuperáveis.' })
      ]) : el('p', { class: 'muted', text: 'Sem as credenciais, o arquivo carrega só hosts, portas, usuários e preferências — pode ser versionado com tranquilidade.' })
    ]));
  };
  rerender();

  const go = await modal({
    title: 'Exportar sessões',
    width: 560,
    render: () => body,
    footer: (api) => [
      el('button', { text: 'Cancelar', onClick: () => api.close(false) }),
      el('button', { class: 'primary', text: 'Exportar', onClick: () => api.close(true) })
    ]
  });
  if (!go) return;

  if (includeSecrets) {
    if (passphrase.length < 8) return toast('Use uma senha de pelo menos 8 caracteres', 'err');
    if (passphrase !== confirmPass) return toast('As senhas não conferem', 'err');
  }

  await guard(async () => {
    const res = await window.tsm.io.export({ includeSecrets, passphrase: passphrase || null });
    if (res.canceled) return;
    toast(`${res.sessions} sessão(oes) exportadas para ${res.filePath}`, 'ok', 6000);
  });
}

// ------------------------------------------------------------- ajuda ------
export async function shortcutsDialog() {
  const rows = [
    ['Ctrl+N', 'Nova sessão'],
    ['Ctrl+Shift+N', 'Conexão rápida'],
    ['Ctrl+Shift+F', 'Nova pasta'],
    ['Ctrl+Shift+T', 'Shell local'],
    ['Ctrl+P', 'Buscar sessão (paleta)'],
    ['Ctrl+W', 'Fechar aba'],
    ['Ctrl+D', 'Duplicar aba'],
    ['Ctrl+R', 'Reconectar aba'],
    ['Ctrl+Tab', 'Próxima aba'],
    ['Ctrl+1..9', 'Ir para a aba N'],
    ['Ctrl+Shift+C / V', 'Copiar / colar no terminal'],
    ['Ctrl+F', 'Localizar no terminal'],
    ['Ctrl+K', 'Limpar terminal'],
    ['Ctrl+B', 'Mostrar/ocultar barra lateral'],
    ['Ctrl+Shift+E', 'Painel de arquivos (SFTP)'],
    ['Ctrl+= / Ctrl+-', 'Aumentar / diminuir a fonte'],
    ['Ctrl+L', 'Bloquear cofre'],
    ['Ctrl+Shift+M', 'MultiExec (digitar em todas as abas)']
  ];
  const table = el('table', { class: 'grid' });
  const tbody = el('tbody');
  for (const [key, desc] of rows) {
    tbody.append(el('tr', {}, [
      el('td', { text: key, style: 'font-family:var(--font-mono);width:150px' }),
      el('td', { text: desc })
    ]));
  }
  table.append(tbody);
  await modal({
    title: 'Atalhos de teclado',
    width: 520,
    render: () => table,
    footer: (api) => [el('button', { class: 'primary', text: 'Fechar', onClick: () => api.close(true) })]
  });
}

export async function aboutDialog() {
  const i = state.info || {};
  await modal({
    title: 'Sobre o Total Session Manager',
    width: 460,
    render: () => el('div', {}, [
      el('img', { class: 'about-logo', src: 'vendor/icon.png', alt: '' }),
      el('h2', { text: 'Total Session Manager', style: 'margin:0 0 4px' }),
      el('p', { class: 'muted', text: `Versão ${i.version || '?'} · Electron ${i.electron} · Node ${i.node}` }),
      el('p', { text: 'Gerenciador de sessões SSH, Telnet, Shell local e SFTP/SCP. Sem limite de sessões salvas.' }),
      el('p', { class: 'muted', text: `Plataforma: ${i.platform}/${i.arch}` }),
      el('p', { class: 'muted', text: `PTY local: ${i.hasPty ? 'disponível' : 'indisponível (modo pipe)'}` }),
      el('p', { class: 'muted', text: `Modo: ${i.portable ? 'portátil (dados ao lado do executável)' : 'perfil do usuário'}` }),
      el('p', { class: 'muted', text: `SQLite: ${i.sqliteEngine || '?'}` }),
      el('p', { class: 'muted', style: 'font-size:11px;word-break:break-all', text: `Dados: ${i.dataDir || ''}` })
    ]),
    footer: (api) => [el('button', { class: 'primary', text: 'Fechar', onClick: () => api.close(true) })]
  });
}
