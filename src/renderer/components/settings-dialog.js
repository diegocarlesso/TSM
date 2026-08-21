'use strict';
/** Configuracoes, aparencia, credenciais, import/export e janelas auxiliares. */
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
export async function settingsDialog(initialTab = 'aparencia') {
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
   * Reaplica tipografia e cores nas previas ja montadas, sem reconstruir o
   * painel: se remontassemos, o campo que o usuario esta digitando perderia o
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
      ['aparencia', 'Aparencia'], ['terminal', 'Terminal'],
      ['conexao', 'Conexao'], ['seguranca', 'Seguranca'], ['dados', 'Dados']
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

    if (tab === 'aparencia') {
      add('Tema da janela', select(
        state.uiThemes.map((t) => ({ value: t.id, label: t.name })),
        draft['ui.theme'] || 'dark',
        (v) => commit('ui.theme', v)
      ));
      add('Cor de destaque', el('input', {
        type: 'color', value: draft['ui.accent'] || '#0090f0',
        onInput: (e) => commit('ui.accent', e.target.value)
      }));
      add('Tema do terminal', el('div', { class: 'inline' }, [
        select(
          state.themes.map((t) => ({ value: t.id, label: t.name })),
          draft['terminal.theme'] || 'tsm-dark',
          // `commit` sozinho nao redesenhava a previa: ela era montada uma vez,
          // na renderizacao do painel, e ficava mostrando o tema anterior.
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
      }), 'Lista CSS: a primeira fonte instalada e usada.');
      add('Tamanho', el('input', {
        type: 'number', value: draft['terminal.fontSize'], min: '6', max: '40',
        onInput: (e) => commit('terminal.fontSize', Number(e.target.value))
      }));
      add('Altura de linha', el('input', {
        type: 'number', step: '0.05', value: draft['terminal.lineHeight'],
        onInput: (e) => commit('terminal.lineHeight', Number(e.target.value))
      }));
      add('Espacamento', el('input', {
        type: 'number', step: '0.1', value: draft['terminal.letterSpacing'],
        onInput: (e) => commit('terminal.letterSpacing', Number(e.target.value))
      }));
      add('Cursor', select(CURSOR_STYLES, draft['terminal.cursorStyle'], (v) => commit('terminal.cursorStyle', v)));
      full(checkbox('Cursor piscante', draft['terminal.cursorBlink'], (v) => commit('terminal.cursorBlink', v)));
      add('Historico (linhas)', el('input', {
        type: 'number', value: draft['terminal.scrollback'], min: '100', step: '1000',
        onInput: (e) => commit('terminal.scrollback', Number(e.target.value))
      }), 'Quantas linhas ficam disponiveis para rolar. 100000 é confortável e barato em memória.');
      add('Botao direito', select(RIGHT_CLICK, draft['terminal.rightClick'], (v) => commit('terminal.rightClick', v)));
      full(checkbox('Copiar ao selecionar', draft['terminal.copyOnSelect'], (v) => commit('terminal.copyOnSelect', v)));
      add('Separadores de palavra', el('input', {
        type: 'text', value: draft['terminal.wordSeparators'],
        onInput: (e) => commit('terminal.wordSeparators', e.target.value)
      }), 'Usados no duplo clique.');
      // A mesma previa aparece aqui, ja que esta aba mexe em fonte e tamanho.
      full(themePreview(draft['terminal.theme'], draft));
    }

    if (tab === 'conexao') {
      full(checkbox('Confirmar antes de fechar uma aba conectada',
        draft['connection.confirmClose'], (v) => commit('connection.confirmClose', v)));
      full(checkbox('Reconectar automaticamente quando a conexao cair',
        draft['connection.reconnectOnDrop'], (v) => commit('connection.reconnectOnDrop', v)));
      grid.append(el('div', { class: 'full' }, [el('hr', { style: 'border-color:var(--border)' })]));
      full(el('button', { text: 'Chaves de host conhecidas…', onClick: () => knownHostsDialog() }));
      full(el('button', { text: 'Historico de conexoes…', onClick: () => historyDialog() }));
    }

    if (tab === 'seguranca') {
      const v = state.vault;
      grid.append(el('div', { class: 'full muted' }, [
        el('p', {
          text: v.masterEnabled
            ? 'As credenciais estao cifradas com a sua senha mestra (AES-256-GCM + scrypt).'
            : v.scheme === 'safeStorage'
              ? 'As credenciais estao cifradas pelo cofre do sistema operacional (DPAPI/Keychain/libsecret).'
              : 'ATENCAO: o sistema nao oferece cofre e nao ha senha mestra — nao e possivel salvar senhas.'
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
      full(el('button', { text: 'Exportar sessoes…', onClick: () => exportDialog() }));
      full(el('button', { text: 'Importar sessoes…', onClick: () => importDialog() }));
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
    title: 'Configuracoes',
    width: 640,
    render: () => body,
    footer: (api) => [el('button', { class: 'primary', text: 'Fechar', onClick: () => api.close(true) })]
  });
  await reloadSettings();
}

/**
 * Previa do tema do terminal. Recebe as preferencias em uso para que fonte,
 * tamanho e altura de linha aparecam do jeito que ficarao de verdade — senao a
 * previa mostra as cores certas com a tipografia errada.
 */
function themePreview(themeId, prefs = {}) {
  const t = state.themes.find((x) => x.id === themeId) || state.themes[0];
  if (!t) return el('div', { class: 'muted', text: 'Nenhum tema disponivel.' });

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
      `${line(d.green, 'usuario@servidor')}:${line(d.blue, '~/projetos')}$ ls -la`,
      `${line(d.brightBlue, 'drwxr-xr-x')}  4 root root  4096 ${line(d.cyan, 'config/')}`,
      `${line(d.foreground, '-rw-r--r--')}  1 root root 12043 ${line(d.foreground, 'app.log')}`,
      `${line(d.red, 'erro:')} falha ao conectar  ${line(d.yellow, 'aviso:')} tentando de novo`,
      `${line(d.magenta, 'DEBUG')} pool=12 idle=3  ${line(d.brightGreen, 'OK')} 200`
    ].join('\n')
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
    ['selectionBackground', 'Selecao'],
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
        `<span style="color:${draft.cyan}">INFO</span>  servico iniciado na porta 8080`,
        `<span style="color:${draft.yellow}">WARN</span>  latencia acima do normal`,
        `<span style="color:${draft.red}">ERROR</span> conexao recusada`,
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
      if (current.builtin) return toast('Temas embutidos nao podem ser excluidos', 'warn');
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
        grid.append(el('div', { class: 'hint', text: 'Todas as credenciais ja salvas serao re-cifradas com a nova chave. Nao ha recuperacao: guarde a senha.' }));
      }
      return grid;
    },
    footer: (api) => [
      el('button', { text: 'Cancelar', onClick: () => api.close(false) }),
      el('button', { class: 'primary', text: 'Aplicar', onClick: () => api.close(true) })
    ]
  });

  if (!ok) return;
  if (!disable && fields.next !== fields.confirm) return toast('As senhas nao conferem', 'err');
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
    hint: 'Necessaria para usar credenciais salvas.'
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
      el('th', { text: 'Nome' }), el('th', { text: 'Usuario' }),
      el('th', { text: 'Metodo' }), el('th', { text: '' })
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
                detail: 'As sessoes que a usam voltam a pedir senha.', danger: true
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
      el('label', { text: 'Usuario' }),
      el('input', { type: 'text', value: model.username, onInput: (e) => { model.username = e.target.value; } }),
      el('label', { text: 'Metodo' }),
      select(
        [{ value: 'password', label: 'Senha' }, { value: 'key', label: 'Chave privada' }],
        model.authType, (v) => { model.authType = v; }
      ),
      el('label', { text: 'Chave privada' }),
      el('input', { type: 'text', value: model.keyPath, placeholder: '~/.ssh/id_ed25519', onInput: (e) => { model.keyPath = e.target.value; } }),
      el('label', { text: 'Senha' }),
      el('input', {
        type: 'password',
        placeholder: hasPassword ? '•••••••• (guardada)' : 'nao definida',
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
      el('th', { text: 'Impressao digital' }), el('th', { text: 'Visto em' }), el('th', { text: '' })
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

// ---------------------------------------------------------- historico -----
export async function historyDialog() {
  const rows = await window.tsm.system.log(300);
  const table = el('table', { class: 'grid' });
  table.append(el('thead', {}, el('tr', {}, [
    el('th', { text: 'Inicio' }), el('th', { text: 'Sessao' }), el('th', { text: 'Tipo' }),
    el('th', { text: 'Destino' }), el('th', { text: 'Duracao' }), el('th', { text: 'Status' })
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
    title: 'Historico de conexoes',
    width: 820,
    render: () => rows.length ? table : el('p', { class: 'muted', text: 'Nada por aqui ainda.' }),
    footer: (api) => [
      el('button', { class: 'danger', text: 'Limpar historico', onClick: () => api.close('clear') }),
      el('button', { class: 'primary', text: 'Fechar', onClick: () => api.close(true) })
    ]
  });
  if (action === 'clear') {
    await window.tsm.system.clearLog();
    toast('Historico limpo', 'ok');
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
      `${preview.sessions.length} sessao(oes) e ${preview.folders.length} pasta(s) detectada(s).`
    ]),
    preview.detected ? el('p', {
      class: 'muted',
      text: 'Por tipo: ' + Object.entries(preview.detected.byType || {})
        .map(([k, v]) => `${k}=${v}`).join(', ')
    }) : null,
    el('div', { class: 'form-grid', style: 'margin:12px 0' }, [
      el('label', { text: 'Estrategia' }),
      select([
        { value: 'merge', label: 'Mesclar (mantem o que ja existe)' },
        { value: 'replace', label: 'Substituir tudo (apaga as sessoes atuais)' }
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
      el('summary', { text: 'Ver sessoes que serao importadas' }),
      el('ul', { style: 'max-height:200px;overflow:auto;font-size:12px' },
        preview.sessions.slice(0, 500).map((s) => el('li', {
          text: `${s.folderPath ? `${s.folderPath}/` : ''}${s.name} — ${s.type} ${s.config?.host || ''}`
        })))
    ])
  ]);

  const go = await modal({
    title: 'Importar sessoes',
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
      `Importado: ${s.sessions || 0} sessao(oes), ${s.folders || 0} pasta(s)` +
      (s.skipped ? `, ${s.skipped} ignorada(s)` : ''),
      'ok', 6000
    );
    if (res.warnings && res.warnings.length) {
      console.warn('[TSM] avisos de importacao:', res.warnings);
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
      el('p', { text: `${state.sessions.length} sessao(oes) serao exportadas em JSON.` }),
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
        el('div', { class: 'hint', text: 'AES-256-GCM com chave derivada por scrypt. Sem essa senha, as credenciais do arquivo sao irrecuperaveis.' })
      ]) : el('p', { class: 'muted', text: 'Sem as credenciais, o arquivo carrega so hosts, portas, usuarios e preferencias — pode ser versionado com tranquilidade.' })
    ]));
  };
  rerender();

  const go = await modal({
    title: 'Exportar sessoes',
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
    if (passphrase !== confirmPass) return toast('As senhas nao conferem', 'err');
  }

  await guard(async () => {
    const res = await window.tsm.io.export({ includeSecrets, passphrase: passphrase || null });
    if (res.canceled) return;
    toast(`${res.sessions} sessao(oes) exportadas para ${res.filePath}`, 'ok', 6000);
  });
}

// ------------------------------------------------------------- ajuda ------
export async function shortcutsDialog() {
  const rows = [
    ['Ctrl+N', 'Nova sessao'],
    ['Ctrl+Shift+N', 'Conexao rapida'],
    ['Ctrl+Shift+F', 'Nova pasta'],
    ['Ctrl+Shift+T', 'Shell local'],
    ['Ctrl+P', 'Buscar sessao (paleta)'],
    ['Ctrl+W', 'Fechar aba'],
    ['Ctrl+D', 'Duplicar aba'],
    ['Ctrl+R', 'Reconectar aba'],
    ['Ctrl+Tab', 'Proxima aba'],
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
      el('p', { class: 'muted', text: `Versao ${i.version || '?'} · Electron ${i.electron} · Node ${i.node}` }),
      el('p', { text: 'Gerenciador de sessoes SSH, Telnet, Shell local e SFTP/SCP. Sem limite de sessoes salvas.' }),
      el('p', { class: 'muted', text: `Plataforma: ${i.platform}/${i.arch}` }),
      el('p', { class: 'muted', text: `PTY local: ${i.hasPty ? 'disponivel' : 'indisponivel (modo pipe)'}` }),
      el('p', { class: 'muted', text: `Modo: ${i.portable ? 'portatil (dados ao lado do executavel)' : 'perfil do usuario'}` }),
      el('p', { class: 'muted', text: `SQLite: ${i.sqliteEngine || '?'}` }),
      el('p', { class: 'muted', style: 'font-size:11px;word-break:break-all', text: `Dados: ${i.dataDir || ''}` })
    ]),
    footer: (api) => [el('button', { class: 'primary', text: 'Fechar', onClick: () => api.close(true) })]
  });
}
