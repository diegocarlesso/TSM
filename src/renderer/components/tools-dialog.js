'use strict';
/** Ferramentas: biblioteca de comandos, tuneis, gravacao de sessao e chaves SSH. */
import {
  el, modal, toast, guard, checkbox, select, confirmDialog, promptDialog, formatBytes
} from './ui.js';
import { state, activePane } from './state.js';

// ------------------------------------------- biblioteca de comandos -------
/**
 * Comandos guardados que podem ser disparados na aba ativa ou em todas.
 * `run: true` acrescenta Enter; `false` so digita, para o usuario revisar.
 */
export async function snippetsDialog({ onSend } = {}) {
  const body = el('div');
  let filter = '';

  async function rerender() {
    const all = await window.tsm.snippets.list();
    const term = filter.trim().toLowerCase();
    const items = term
      ? all.filter((s) => `${s.name} ${s.content} ${s.category}`.toLowerCase().includes(term))
      : all;

    const search = el('input', {
      type: 'search', value: filter, placeholder: 'Filtrar comandos…',
      style: 'width:100%;padding:6px 8px;background:var(--bg-1);border:1px solid var(--border);' +
             'border-radius:6px;outline:none;user-select:text;margin-bottom:10px',
      onInput: (e) => { filter = e.target.value; rerender(); }
    });

    const list = el('div', { style: 'max-height:46vh;overflow:auto' });
    let lastCategory = null;
    for (const s of items) {
      if (s.category !== lastCategory) {
        lastCategory = s.category;
        list.append(el('div', {
          class: 'muted',
          style: 'margin:10px 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.5px',
          text: s.category || 'Sem categoria'
        }));
      }
      list.append(el('div', { class: 'node', style: 'align-items:flex-start' }, [
        el('span', { class: 'glyph', text: s.run ? '▶' : '✎' }),
        el('div', { style: 'flex:1;min-width:0' }, [
          el('div', { text: s.name }),
          el('code', {
            class: 'muted',
            style: 'font-size:11px;white-space:pre-wrap;word-break:break-all;user-select:text',
            text: s.content
          })
        ]),
        el('div', { class: 'inline' }, [
          el('button', {
            class: 'icon-btn', text: '↵', title: 'Enviar para a aba ativa',
            onClick: () => send(s, false)
          }),
          el('button', {
            class: 'icon-btn', text: '⇉', title: 'Enviar para TODAS as abas conectadas',
            onClick: () => send(s, true)
          }),
          el('button', {
            class: 'icon-btn', text: '✎', title: 'Editar',
            onClick: () => editSnippet(s).then(rerender)
          }),
          el('button', {
            class: 'icon-btn', text: '✕', title: 'Excluir',
            onClick: async () => {
              const ok = await confirmDialog({
                title: 'Excluir comando', message: `Excluir "${s.name}"?`, danger: true
              });
              if (ok) {
                await window.tsm.snippets.remove(s.id);
                await rerender();
              }
            }
          })
        ])
      ]));
    }

    if (!items.length) {
      list.append(el('p', {
        class: 'muted',
        text: all.length
          ? 'Nenhum comando bate com o filtro.'
          : 'Nenhum comando guardado ainda. Guarde os que voce repete todo dia.'
      }));
    }

    body.replaceChildren(search, list, el('div', { style: 'margin-top:12px' }, [
      el('button', { text: '+ Novo comando', onClick: () => editSnippet(null).then(rerender) })
    ]));
  }

  function send(snippet, broadcastAll) {
    const text = snippet.content + (snippet.run ? '\n' : '');
    if (onSend) onSend(text, broadcastAll);
  }

  await rerender();
  await modal({
    title: 'Biblioteca de comandos',
    width: 700,
    render: () => body,
    footer: (api) => [el('button', { class: 'primary', text: 'Fechar', onClick: () => api.close(true) })]
  });
}

async function editSnippet(snippet) {
  const model = {
    name: snippet ? snippet.name : '',
    content: snippet ? snippet.content : '',
    category: snippet ? snippet.category : '',
    run: snippet ? snippet.run : true
  };

  const ok = await modal({
    title: snippet ? `Editar — ${snippet.name}` : 'Novo comando',
    width: 560,
    render: () => el('div', { class: 'form-grid' }, [
      el('label', { text: 'Nome' }),
      el('input', { type: 'text', value: model.name, onInput: (e) => { model.name = e.target.value; } }),
      el('label', { text: 'Categoria' }),
      el('input', {
        type: 'text', value: model.category, placeholder: 'Diagnostico, Deploy, Rede…',
        onInput: (e) => { model.category = e.target.value; }
      }),
      el('label', { text: 'Comando' }),
      el('textarea', {
        value: model.content, placeholder: 'journalctl -u nginx -n 200 --no-pager',
        onInput: (e) => { model.content = e.target.value; }
      }),
      el('div', { class: 'full' }, [
        checkbox('Executar ao enviar (acrescenta Enter)', model.run, (v) => { model.run = v; })
      ]),
      el('div', { class: 'hint', text: 'Desmarcado, o comando so e digitado — voce revisa antes de rodar.' })
    ]),
    footer: (api) => [
      el('button', { text: 'Cancelar', onClick: () => api.close(false) }),
      el('button', { class: 'primary', text: 'Salvar', onClick: () => api.close(true) })
    ]
  });

  if (!ok) return;
  if (!model.name.trim() || !model.content.trim()) return toast('Nome e comando sao obrigatorios', 'err');

  await guard(async () => {
    if (snippet) await window.tsm.snippets.update(snippet.id, model);
    else await window.tsm.snippets.create(model);
    toast('Comando salvo', 'ok');
  });
}

// ------------------------------------------------------------- tuneis ----
export async function tunnelsDialog(pane) {
  const target = pane || activePane();
  if (!target || !target.connectionId) return toast('Abra uma sessao conectada primeiro', 'warn');

  const body = el('div');

  async function rerender() {
    const forwards = await window.tsm.conn.forwards(target.connectionId).catch(() => []);
    const table = el('table', { class: 'grid' });
    table.append(el('thead', {}, el('tr', {}, [
      el('th', { text: 'Sentido' }), el('th', { text: 'Escuta em' }),
      el('th', { text: 'Encaminha para' }), el('th', { text: 'Estado' }), el('th', { text: '' })
    ])));
    const tbody = el('tbody');
    for (const f of forwards) {
      tbody.append(el('tr', {}, [
        el('td', { text: f.type === 'local' ? 'Local → Remoto' : 'Remoto → Local' }),
        el('td', { text: `${f.localHost}:${f.localPort}`, style: 'font-family:var(--font-mono)' }),
        el('td', { text: `${f.remoteHost}:${f.remotePort}`, style: 'font-family:var(--font-mono)' }),
        el('td', {
          text: f.status,
          style: /erro/.test(f.status) ? 'color:var(--err)'
            : f.status === 'ativo' ? 'color:var(--ok)' : ''
        }),
        el('td', {}, el('button', {
          class: 'icon-btn', text: '✕', title: 'Fechar tunel',
          onClick: async () => {
            await guard(() => window.tsm.conn.removeForward(target.connectionId, f.id));
            await rerender();
          }
        }))
      ]));
    }
    table.append(tbody);

    body.replaceChildren(
      el('p', { class: 'muted', text: `Sessao: ${target.name} (${target.target || ''})` }),
      forwards.length ? table : el('p', { class: 'muted', text: 'Nenhum tunel aberto nesta sessao.' }),
      el('div', { style: 'margin-top:12px' }, [
        el('button', { text: '+ Abrir tunel', onClick: () => addTunnel(target).then(rerender) })
      ])
    );
  }

  await rerender();
  await modal({
    title: 'Tuneis (encaminhamento de portas)',
    width: 700,
    render: () => body,
    footer: (api) => [el('button', { class: 'primary', text: 'Fechar', onClick: () => api.close(true) })]
  });
}

async function addTunnel(pane) {
  const model = {
    type: 'local', localHost: '127.0.0.1', localPort: '', remoteHost: '', remotePort: ''
  };

  const ok = await modal({
    title: 'Novo tunel',
    width: 520,
    render: () => {
      const hint = el('div', { class: 'hint' });
      const refresh = () => {
        hint.textContent = model.type === 'local'
          ? 'Abre uma porta NESTA maquina que sai pelo servidor (equivale a ssh -L).'
          : 'Abre uma porta NO SERVIDOR que volta para esta maquina (equivale a ssh -R).';
      };
      refresh();
      return el('div', { class: 'form-grid' }, [
        el('label', { text: 'Sentido' }),
        select([
          { value: 'local', label: 'Local → Remoto (-L)' },
          { value: 'remote', label: 'Remoto → Local (-R)' }
        ], model.type, (v) => { model.type = v; refresh(); }),
        hint,
        el('label', { text: 'Escuta em (host)' }),
        el('input', {
          type: 'text', value: model.localHost,
          onInput: (e) => { model.localHost = e.target.value.trim(); }
        }),
        el('label', { text: 'Escuta em (porta)' }),
        el('input', { type: 'number', onInput: (e) => { model.localPort = e.target.value; } }),
        el('label', { text: 'Destino (host)' }),
        el('input', {
          type: 'text', placeholder: 'localhost',
          onInput: (e) => { model.remoteHost = e.target.value.trim(); }
        }),
        el('label', { text: 'Destino (porta)' }),
        el('input', { type: 'number', onInput: (e) => { model.remotePort = e.target.value; } })
      ]);
    },
    footer: (api) => [
      el('button', { text: 'Cancelar', onClick: () => api.close(false) }),
      el('button', { class: 'primary', text: 'Abrir', onClick: () => api.close(true) })
    ]
  });

  if (!ok) return;
  const localPort = Number(model.localPort);
  const remotePort = Number(model.remotePort);
  if (!localPort || !remotePort || !model.remoteHost) return toast('Preencha host e portas', 'err');

  await guard(() => window.tsm.conn.addForward(pane.connectionId, {
    type: model.type,
    localHost: model.localHost || '127.0.0.1',
    localPort,
    remoteHost: model.remoteHost,
    remotePort
  }));
}

// ------------------------------------------------- gravacao de sessao ----
export async function sessionLogDialog(pane) {
  const target = pane || activePane();
  if (!target || !target.connectionId) return toast('Abra uma sessao conectada primeiro', 'warn');

  const status = await window.tsm.conn.logStatus(target.connectionId).catch(() => ({ active: false }));
  const logsDir = await window.tsm.system.logsDir().catch(() => '');

  if (status.active) {
    const parar = await confirmDialog({
      title: 'Gravacao em andamento',
      message: `Gravando "${target.name}" em:`,
      detail: `${status.filePath}\n\n${formatBytes(status.bytes)} gravados ate agora.`,
      confirmLabel: 'Parar gravacao',
      danger: true
    });
    if (parar) {
      const res = await guard(() => window.tsm.conn.stopLog(target.connectionId));
      if (res) toast(`Log salvo: ${res.filePath}`, 'ok', 6000);
    }
    return;
  }

  const model = {
    template: '%name%_%Y%%M%%D%_%h%%m%%s%.log',
    stripAnsi: true,
    timestamp: false,
    append: false
  };

  const ok = await modal({
    title: `Gravar sessao — ${target.name}`,
    width: 580,
    render: () => el('div', { class: 'form-grid' }, [
      el('label', { text: 'Arquivo' }),
      el('input', {
        type: 'text', value: model.template,
        onInput: (e) => { model.template = e.target.value; }
      }),
      el('div', {
        class: 'hint',
        text: 'Marcadores: %name% %host% %user% %type% %Y% %M% %D% %h% %m% %s%. ' +
              `Caminho relativo vai para ${logsDir}`
      }),
      el('div', { class: 'full' }, [
        checkbox('Remover codigos de cor ANSI (log legivel em editor)',
          model.stripAnsi, (v) => { model.stripAnsi = v; })
      ]),
      el('div', { class: 'full' }, [
        checkbox('Carimbar data/hora em cada linha', model.timestamp, (v) => { model.timestamp = v; })
      ]),
      el('div', { class: 'full' }, [
        checkbox('Acrescentar ao arquivo se ja existir', model.append, (v) => { model.append = v; })
      ])
    ]),
    footer: (api) => [
      el('button', { text: 'Cancelar', onClick: () => api.close(false) }),
      el('button', { class: 'primary', text: 'Comecar a gravar', onClick: () => api.close(true) })
    ]
  });

  if (!ok) return;
  const res = await guard(() => window.tsm.conn.startLog(target.connectionId, model));
  if (res) toast(`Gravando em ${res.filePath}`, 'ok', 6000);
}

// ---------------------------------------------------------- chaves SSH ---
export async function keysDialog() {
  const body = el('div');

  async function rerender() {
    const keys = await window.tsm.keys.list().catch(() => []);
    const table = el('table', { class: 'grid' });
    table.append(el('thead', {}, el('tr', {}, [
      el('th', { text: 'Arquivo' }), el('th', { text: 'Tipo' }),
      el('th', { text: 'Impressao digital' }), el('th', { text: '' })
    ])));
    const tbody = el('tbody');
    for (const k of keys) {
      tbody.append(el('tr', { title: k.path }, [
        el('td', { text: k.name }),
        el('td', { text: k.type || '—' }),
        el('td', {
          text: k.fingerprint || (k.encrypted ? '(protegida por senha)' : '—'),
          style: 'font-family:var(--font-mono);font-size:11px'
        }),
        el('td', {}, el('div', { class: 'inline' }, [
          el('button', {
            class: 'icon-btn', text: '⧉', title: 'Copiar chave publica',
            disabled: !k.fingerprint,
            onClick: async () => {
              const pub = k.publicKey || (await window.tsm.keys.inspect(k.path).catch(() => null))?.publicKey;
              if (pub) {
                window.tsm.app.copy(pub);
                toast('Chave publica copiada', 'ok');
              } else {
                toast('Nao foi possivel ler a chave publica', 'warn');
              }
            }
          }),
          el('button', {
            class: 'icon-btn', text: '🗀', title: 'Mostrar na pasta',
            onClick: () => window.tsm.app.showItemInFolder(k.path)
          })
        ]))
      ]));
    }
    table.append(tbody);

    body.replaceChildren(
      keys.length ? table : el('p', { class: 'muted', text: 'Nenhuma chave encontrada em data/keys nem em ~/.ssh.' }),
      el('div', { style: 'margin-top:12px' }, [
        el('button', { text: '+ Gerar par de chaves', onClick: () => generateKey().then(rerender) })
      ])
    );
  }

  await rerender();
  await modal({
    title: 'Chaves SSH',
    width: 760,
    render: () => body,
    footer: (api) => [el('button', { class: 'primary', text: 'Fechar', onClick: () => api.close(true) })]
  });
}

async function generateKey() {
  const model = { type: 'ed25519', bits: 4096, comment: '', name: '', passphrase: '', confirm: '' };

  const ok = await modal({
    title: 'Gerar par de chaves SSH',
    width: 560,
    render: () => {
      const bitsRow = el('div');
      const grid = el('div', { class: 'form-grid' }, [
        el('label', { text: 'Algoritmo' }),
        select([
          { value: 'ed25519', label: 'Ed25519 (recomendado)' },
          { value: 'ecdsa', label: 'ECDSA' },
          { value: 'rsa', label: 'RSA' }
        ], model.type, (v) => {
          model.type = v;
          bitsRow.style.display = v === 'ed25519' ? 'none' : '';
        }),
        el('label', { text: 'Tamanho' }),
        bitsRow,
        el('label', { text: 'Nome do arquivo' }),
        el('input', {
          type: 'text', placeholder: 'id_ed25519',
          onInput: (e) => { model.name = e.target.value.trim(); }
        }),
        el('label', { text: 'Comentario' }),
        el('input', {
          type: 'text', placeholder: 'diego@notebook',
          onInput: (e) => { model.comment = e.target.value; }
        }),
        el('label', { text: 'Senha da chave' }),
        el('input', {
          type: 'password', autocomplete: 'new-password',
          onInput: (e) => { model.passphrase = e.target.value; }
        }),
        el('label', { text: 'Confirmar' }),
        el('input', {
          type: 'password', autocomplete: 'new-password',
          onInput: (e) => { model.confirm = e.target.value; }
        }),
        el('div', {
          class: 'hint',
          text: 'Sem senha a chave funciona sozinha — pratico para automacao, ' +
                'mas quem copiar o arquivo entra nos seus servidores.'
        })
      ]);
      bitsRow.append(select(
        [{ value: '2048', label: '2048 bits' }, { value: '3072', label: '3072 bits' },
         { value: '4096', label: '4096 bits' }],
        String(model.bits), (v) => { model.bits = Number(v); }
      ));
      bitsRow.style.display = 'none';
      return grid;
    },
    footer: (api) => [
      el('button', { text: 'Cancelar', onClick: () => api.close(false) }),
      el('button', { class: 'primary', text: 'Gerar', onClick: () => api.close(true) })
    ]
  });

  if (!ok) return;
  if (model.passphrase !== model.confirm) return toast('As senhas nao conferem', 'err');

  const res = await guard(() => window.tsm.keys.generate({
    type: model.type,
    bits: model.bits,
    comment: model.comment,
    name: model.name || undefined,
    passphrase: model.passphrase
  }));
  if (!res) return;

  await modal({
    title: 'Chave gerada',
    width: 640,
    render: () => el('div', {}, [
      el('p', {}, [el('strong', { text: 'Privada: ' }), el('code', { text: res.privatePath, style: 'user-select:text' })]),
      el('p', {}, [el('strong', { text: 'Publica: ' }), el('code', { text: res.publicPath, style: 'user-select:text' })]),
      el('p', {}, [el('strong', { text: 'Fingerprint: ' }), el('code', { text: res.fingerprint, style: 'user-select:text' })]),
      el('p', { class: 'muted', text: 'Copie a chave publica abaixo para o ~/.ssh/authorized_keys do servidor:' }),
      el('textarea', {
        value: res.publicKey, readonly: 'readonly',
        style: 'width:100%;min-height:80px;font-family:var(--font-mono);font-size:11px;' +
               'background:var(--bg-1);border:1px solid var(--border);border-radius:6px;' +
               'padding:8px;color:var(--text);user-select:text'
      })
    ]),
    footer: (api) => [
      el('button', {
        text: 'Copiar chave publica',
        onClick: () => { window.tsm.app.copy(res.publicKey); toast('Copiado', 'ok'); }
      }),
      el('button', { class: 'primary', text: 'Fechar', onClick: () => api.close(true) })
    ]
  });
}
