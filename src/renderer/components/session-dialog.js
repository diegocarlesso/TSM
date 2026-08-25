'use strict';
/** Editor de sessão (SSH / Telnet / Shell / SFTP) e conexão rápida. */
import { el, modal, toast, guard, checkbox, select, comboBox, promptDialog } from './ui.js';
import { state, reloadTree, setting } from './state.js';

const TYPES = [
  { value: 'ssh', label: 'SSH' },
  { value: 'telnet', label: 'Telnet' },
  { value: 'serial', label: 'Serial (COM)' },
  { value: 'shell', label: 'Shell local' },
  { value: 'sftp', label: 'SFTP (somente arquivos)' }
];

const PARIDADES = [
  { value: 'none', label: 'Nenhuma' },
  { value: 'even', label: 'Par' },
  { value: 'odd', label: 'Ímpar' },
  { value: 'mark', label: 'Mark' },
  { value: 'space', label: 'Space' }
];

const CONTROLE_DE_FLUXO = [
  { value: 'none', label: 'Nenhum' },
  { value: 'xonxoff', label: 'XON/XOFF (software)' },
  { value: 'rtscts', label: 'RTS/CTS (hardware)' }
];

const FIM_DE_LINHA = [
  { value: 'cr', label: 'CR - padrão em equipamento de rede' },
  { value: 'lf', label: 'LF - padrão em Unix' },
  { value: 'crlf', label: 'CR+LF' }
];

const AUTH_TYPES = [
  { value: 'password', label: 'Senha' },
  { value: 'key', label: 'Chave privada' },
  { value: 'agent', label: 'Agente SSH (pageant / ssh-agent)' },
  { value: 'key+password', label: 'Chave + senha' }
];

function defaultConfig(type) {
  if (type === 'telnet') return { host: '', port: 23, username: '', autoLogin: false, terminalType: 'xterm-256color' };
  if (type === 'shell') return { shellPath: '', cwd: '', terminalType: 'xterm-256color' };
  if (type === 'serial') {
    return {
      path: '', baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none',
      rtscts: false, xon: false, xoff: false, newline: 'cr', localEcho: false
    };
  }
  return {
    host: '', port: 22, username: '', authType: 'password',
    privateKeyPath: '', compression: false, x11Forward: false,
    keepalive: true, terminalType: 'xterm-256color', legacyAlgorithms: false
  };
}

/**
 * Abre o editor. `session` nulo cria uma nova.
 * Devolve a sessão salva ou `undefined` se o usuário cancelou.
 */
export async function sessionDialog(session, { folderId = null } = {}) {
  const isNew = !session;
  const model = {
    id: session ? session.id : null,
    name: session ? session.name : '',
    type: session ? session.type : 'ssh',
    folderId: session ? session.folder_id : folderId,
    themeId: session ? session.theme_id : null,
    color: session ? session.color : null,
    tags: session ? [...(session.tags || [])] : [],
    notes: session ? session.notes : '',
    identityId: session ? session.identity_id : null,
    config: session ? structuredClone(session.config || {}) : defaultConfig('ssh')
  };

  // Senhas nunca voltam do main; só sabemos se existem.
  const hasPassword = session ? await window.tsm.secrets.has('session', session.id, 'password').catch(() => false) : false;
  const hasPassphrase = session ? await window.tsm.secrets.has('session', session.id, 'passphrase').catch(() => false) : false;
  const pending = { password: undefined, passphrase: undefined, jumpPassword: undefined };

  // Idem para a senha/frase-secreta da credencial vinculada — só usada como
  // indicação no placeholder (o fallback de verdade acontece na conexão, em
  // manager.js). Recalculado sempre que o dropdown de credencial muda.
  model.identityHasPassword = false;
  model.identityHasPassphrase = false;
  if (model.identityId) {
    model.identityHasPassword = await window.tsm.secrets.has('identity', model.identityId, 'password').catch(() => false);
    model.identityHasPassphrase = await window.tsm.secrets.has('identity', model.identityId, 'passphrase').catch(() => false);
  }

  let activeTab = 'geral';
  const body = el('div');

  const shells = await window.tsm.system.shells().catch(() => []);
  let portasSeriais = await window.tsm.serial.list().catch(() => []);
  const infoSerial = await window.tsm.serial.info().catch(() => ({ available: false, baudRates: [] }));

  function rerender() {
    body.replaceChildren(buildTabs(), buildPanel());
  }

  function buildTabs() {
    const strip = el('div', { class: 'tabs-strip' });
    const tabs = [
      ['geral', 'Geral'],
      ['auth', 'Autenticação'],
      ['avançado', 'Avançado'],
      ['túneis', 'Túneis'],
      ['aparência', 'Aparência'],
      ['notas', 'Notas']
    ];
    for (const [key, label] of tabs) {
      if (model.type === 'shell' && (key === 'auth' || key === 'túneis')) continue;
      if (model.type === 'serial' && (key === 'auth' || key === 'túneis')) continue;
      strip.append(el('button', {
        class: activeTab === key ? 'active' : '',
        text: label,
        onClick: () => { activeTab = key; rerender(); }
      }));
    }
    return strip;
  }

  function buildPanel() {
    const grid = el('div', { class: 'form-grid' });
    const c = model.config;

    const add = (label, control, hint) => {
      grid.append(el('label', { text: label }), control);
      if (hint) grid.append(el('div', { class: 'hint', text: hint }));
    };
    const addFull = (node) => grid.append(el('div', { class: 'full' }, [node]));

    if (activeTab === 'geral') {
      add('Nome', el('input', {
        type: 'text', value: model.name, placeholder: 'srv-web-01',
        onInput: (e) => { model.name = e.target.value; }
      }));

      add('Tipo', select(TYPES, model.type, (v) => {
        model.type = v;
        model.config = { ...defaultConfig(v), ...model.config };
        rerender();
      }));

      const folderOptions = [{ value: '', label: '(raiz)' }, ...folderPaths()];
      add('Pasta', select(folderOptions, model.folderId || '', (v) => { model.folderId = v || null; }));

      if (model.type === 'serial') {
        const opcoesPorta = portasSeriais.map((porta) => ({
          value: porta.path,
          label: porta.friendlyName || porta.manufacturer || porta.path
        }));

        add('Porta', el('div', { class: 'inline' }, [
          comboBox(opcoesPorta, c.path || '', (v) => { c.path = v; }, {
            placeholder: (state.info && state.info.platform) === 'win32' ? 'COM3' : '/dev/ttyUSB0'
          }),
          el('button', {
            text: 'Atualizar',
            title: 'Reler as portas disponíveis',
            onClick: async () => {
              portasSeriais = await window.tsm.serial.list().catch(() => []);
              rerender();
            }
          })
        ]), portasSeriais.length
          ? `Detectadas: ${portasSeriais.map((p) => p.path).join(', ')}. Você pode digitar outra.`
          : 'Nenhuma porta detectada agora — digite o nome mesmo assim se souber qual é.');

        const bauds = (infoSerial.baudRates || [9600, 115200]).map((b) => ({
          value: String(b), label: String(b)
        }));
        // Velocidade também é digitável: há equipamento com baud fora da tabela.
        add('Velocidade (baud)', comboBox(bauds, String(c.baudRate || 9600), (v) => {
          c.baudRate = Number(v) || 9600;
        }, { placeholder: '9600' }));
      } else if (model.type === 'shell') {
        const shellOptions = [
          { value: '', label: '(shell padrão do sistema)' },
          ...shells.map((s) => ({ value: s.path, label: `${s.label} — ${s.path}` }))
        ];
        add('Shell', select(shellOptions, c.shellPath || '', (v) => {
          c.shellPath = v;
          const found = shells.find((s) => s.path === v);
          c.shellArgs = found ? found.args : [];
        }));
        add('Diretório inicial', pathPicker(c.cwd || '', (v) => { c.cwd = v; }, true));
      } else {
        add('Host', el('input', {
          type: 'text', value: c.host || '', placeholder: '192.168.0.10 ou servidor.exemplo.com',
          onInput: (e) => { c.host = e.target.value.trim(); }
        }));
        add('Porta', el('input', {
          type: 'number', value: c.port || (model.type === 'telnet' ? 23 : 22), min: '1', max: '65535',
          onInput: (e) => { c.port = Number(e.target.value); }
        }));
        add('Usuário', el('input', {
          type: 'text', value: c.username || '',
          onInput: (e) => { c.username = e.target.value.trim(); }
        }));
      }

      add('Cor da aba', el('div', { class: 'inline' }, [
        el('input', {
          type: 'color', value: model.color || '#4f9cf9',
          onInput: (e) => { model.color = e.target.value; }
        }),
        el('button', { text: 'Sem cor', onClick: () => { model.color = null; rerender(); } })
      ]));

      add('Etiquetas', el('input', {
        type: 'text', value: model.tags.join(', '), placeholder: 'produção, cliente-x',
        onInput: (e) => { model.tags = e.target.value.split(',').map((t) => t.trim()).filter(Boolean); }
      }), 'Separadas por virgula. Entram na busca.');
    }

    if (activeTab === 'auth' && model.type !== 'shell') {
      if (model.type === 'ssh' || model.type === 'sftp') {
        add('Método', select(AUTH_TYPES, c.authType || 'password', (v) => { c.authType = v; rerender(); }));

        const identOptions = [
          { value: '', label: '(nenhuma — usar os campos abaixo)' },
          ...state.identities.map((i) => ({ value: i.id, label: `${i.name} (${i.username || 'sem usuário'})` }))
        ];
        add('Credencial salva', select(identOptions, model.identityId || '', async (v) => {
          model.identityId = v || null;
          const ident = state.identities.find((i) => i.id === v);
          if (ident && ident.username) c.username = ident.username;
          model.identityHasPassword = false;
          model.identityHasPassphrase = false;
          rerender();
          if (v) {
            model.identityHasPassword = await window.tsm.secrets.has('identity', v, 'password').catch(() => false);
            model.identityHasPassphrase = await window.tsm.secrets.has('identity', v, 'passphrase').catch(() => false);
            rerender();
          }
        }), 'Reaproveita uma senha/chave cadastrada em Ferramentas > Credenciais — preenche o usuário na hora.');

        if (c.authType === 'key' || c.authType === 'key+password') {
          add('Chave privada', pathPicker(c.privateKeyPath || '', (v) => { c.privateKeyPath = v; }, false,
            [{ name: 'Chaves', extensions: ['pem', 'key', 'rsa', 'ed25519', ''] }]));
          add('Senha da chave', secretInput('passphrase', hasPassphrase, pending, model.identityHasPassphrase),
            'Guardada cifrada no cofre; nunca sai em claro.');
        }
        if (c.authType !== 'agent') {
          add('Senha', secretInput('password', hasPassword, pending, model.identityHasPassword));
        }
      }

      if (model.type === 'telnet') {
        addFull(checkbox('Fazer login automático (envia usuário e senha nos prompts)',
          !!c.autoLogin, (v) => { c.autoLogin = v; rerender(); }));
        if (c.autoLogin) {
          add('Senha', secretInput('password', hasPassword, pending));
          add('Regex do prompt de usuário', el('input', {
            type: 'text', value: c.loginPrompt || '', placeholder: '(login|username)\\s*:\\s*$',
            onInput: (e) => { c.loginPrompt = e.target.value; }
          }), 'Deixe vazio para usar o padrão.');
          add('Regex do prompt de senha', el('input', {
            type: 'text', value: c.passwordPrompt || '', placeholder: '(password|senha)\\s*:\\s*$',
            onInput: (e) => { c.passwordPrompt = e.target.value; }
          }));
        }
      }
    }

    if (activeTab === 'avançado') {
      // Numa serial não existe terminal remoto para anunciar tipo.
      if (model.type !== 'serial') add('Tipo de terminal', el('input', {
        type: 'text', value: c.terminalType || 'xterm-256color',
        onInput: (e) => { c.terminalType = e.target.value; }
      }));
      add('Comando ao conectar', el('input', {
        type: 'text', value: c.initialCommand || '', placeholder: 'sudo -i',
        onInput: (e) => { c.initialCommand = e.target.value; }
      }), 'Enviado ao terminal logo após a conexão.');

      if (model.type === 'ssh' || model.type === 'sftp') {
        addFull(checkbox('Compressão (-C)', !!c.compression, (v) => { c.compression = v; }));
        addFull(checkbox('Encaminhamento X11 (-X)', !!c.x11Forward, (v) => { c.x11Forward = v; }));
        addFull(checkbox('Manter conexão viva (keepalive)', c.keepalive !== false, (v) => { c.keepalive = v; }));
        addFull(checkbox('Encaminhar agente SSH (-A)', !!c.agentForward, (v) => { c.agentForward = v; }));
        addFull(checkbox('Permitir algoritmos legados (equipamentos antigos)',
          !!c.legacyAlgorithms, (v) => { c.legacyAlgorithms = v; }));

        const jump = c.jump || {};
        grid.append(el('div', { class: 'full' }, [el('hr', { style: 'border-color:var(--border)' })]));
        add('Gateway (jump host)', el('input', {
          type: 'text', value: jump.host || '', placeholder: 'bastion.exemplo.com',
          onInput: (e) => {
            c.jump = { ...(c.jump || {}), host: e.target.value.trim() };
            if (!c.jump.host) delete c.jump;
          }
        }), 'Conecta ao destino através deste servidor (equivale ao -J do OpenSSH).');
        add('Usuário do gateway', el('input', {
          type: 'text', value: jump.username || '',
          onInput: (e) => { c.jump = { ...(c.jump || {}), username: e.target.value.trim() }; }
        }));
        add('Porta do gateway', el('input', {
          type: 'number', value: jump.port || 22,
          onInput: (e) => { c.jump = { ...(c.jump || {}), port: Number(e.target.value) }; }
        }));
        add('Senha do gateway', secretInput('jumpPassword', false, pending));
      }

      if (model.type === 'serial') {
        add('Bits de dados', select(
          [{ value: '8', label: '8' }, { value: '7', label: '7' },
           { value: '6', label: '6' }, { value: '5', label: '5' }],
          String(c.dataBits || 8), (v) => { c.dataBits = Number(v); }
        ));
        add('Bits de parada', select(
          [{ value: '1', label: '1' }, { value: '2', label: '2' }],
          String(c.stopBits || 1), (v) => { c.stopBits = Number(v); }
        ));
        add('Paridade', select(PARIDADES, c.parity || 'none', (v) => { c.parity = v; }));
        const fluxoAtual = c.rtscts ? 'rtscts' : (c.xon || c.xoff) ? 'xonxoff' : 'none';
        add('Controle de fluxo', select(CONTROLE_DE_FLUXO, fluxoAtual, (v) => {
          c.rtscts = v === 'rtscts';
          c.xon = v === 'xonxoff';
          c.xoff = v === 'xonxoff';
        }));
        add('Enter envia', select(FIM_DE_LINHA, c.newline || 'cr', (v) => { c.newline = v; }),
          'Mandar o fim de linha errado é a causa mais comum de "conecta mas não responde".');
        addFull(checkbox('Eco local (mostrar o que você digita)',
          !!c.localEcho, (v) => { c.localEcho = v; }));
        grid.append(el('div', {
          class: 'hint full',
          text: 'Ligue o eco local só quando o equipamento não devolve o que você digita.'
        }));
        add('Codificação', select(
          [{ value: 'utf8', label: 'UTF-8' }, { value: 'latin1', label: 'ISO-8859-1 (latin1)' },
           { value: 'ascii', label: 'ASCII' }],
          c.encoding || 'utf8', (v) => { c.encoding = v; }
        ));
      }

      if (model.type === 'telnet') {
        add('Codificação', select(
          [{ value: 'utf8', label: 'UTF-8' }, { value: 'latin1', label: 'ISO-8859-1 (latin1)' }],
          c.encoding || 'utf8', (v) => { c.encoding = v; }
        ));
      }
    }

    if (activeTab === 'túneis' && model.type !== 'shell' && model.type !== 'telnet') {
      const forwards = c.portForwards || (c.portForwards = []);
      const table = el('table', { class: 'grid' });
      table.append(el('thead', {}, el('tr', {}, [
        el('th', { text: 'Tipo' }), el('th', { text: 'Local' }),
        el('th', { text: 'Destino' }), el('th', { text: '' })
      ])));
      const tbody = el('tbody');
      forwards.forEach((f, i) => {
        tbody.append(el('tr', {}, [
          el('td', { text: f.type === 'local' ? 'Local → Remoto' : 'Remoto → Local' }),
          el('td', { text: `${f.localHost || '127.0.0.1'}:${f.localPort}` }),
          el('td', { text: `${f.remoteHost}:${f.remotePort}` }),
          el('td', {}, el('button', {
            text: '✕', class: 'icon-btn',
            onClick: () => { forwards.splice(i, 1); rerender(); }
          }))
        ]));
      });
      table.append(tbody);
      addFull(table);
      addFull(el('button', {
        text: '+ Adicionar túnel',
        onClick: async () => {
          const spec = await promptDialog({
            title: 'Novo túnel',
            label: 'Especificação',
            placeholder: 'L 8080 localhost 80',
            hint: 'Formato: L|R <portaLocal> <hostDestino> <portaDestino>. Ex.: L 5432 db.interno 5432'
          });
          if (!spec) return;
          const m = spec.trim().split(/\s+/);
          if (m.length !== 4) return toast('Formato inválido', 'err');
          forwards.push({
            type: m[0].toUpperCase() === 'R' ? 'remote' : 'local',
            localHost: '127.0.0.1',
            localPort: Number(m[1]),
            remoteHost: m[2],
            remotePort: Number(m[3])
          });
          rerender();
        }
      }));
    }

    if (activeTab === 'aparência') {
      const themeOptions = [
        { value: '', label: '(usar o tema global)' },
        ...state.themes.map((t) => ({ value: t.id, label: t.name }))
      ];
      add('Tema do terminal', select(themeOptions, model.themeId || '', (v) => { model.themeId = v || null; }));
      add('Colunas iniciais', el('input', {
        type: 'number', value: c.cols || '', placeholder: 'auto',
        onInput: (e) => { c.cols = Number(e.target.value) || undefined; }
      }));
      add('Linhas iniciais', el('input', {
        type: 'number', value: c.rows || '', placeholder: 'auto',
        onInput: (e) => { c.rows = Number(e.target.value) || undefined; }
      }));
    }

    if (activeTab === 'notas') {
      addFull(el('textarea', {
        value: model.notes || '',
        placeholder: 'Contexto, chamados, contatos, procedimento de manutenção…',
        onInput: (e) => { model.notes = e.target.value; }
      }));
      if (model.config.raw) {
        addFull(el('div', { class: 'muted', style: 'margin-top:10px' }, [
          el('div', { text: 'Linha original importada do MobaXterm:' }),
          el('code', { text: model.config.raw, style: 'font-size:11px;word-break:break-all;user-select:text' })
        ]));
      }
    }

    return grid;
  }

  rerender();

  const result = await modal({
    title: isNew ? 'Nova sessão' : `Editar — ${session.name}`,
    width: 640,
    render: () => body,
    footer: (api) => [
      el('button', { text: 'Cancelar', onClick: () => api.close(undefined) }),
      el('button', { class: 'primary', text: isNew ? 'Criar' : 'Salvar', onClick: () => api.close('save') })
    ]
  });

  if (result !== 'save') return undefined;
  return persist(model, pending, isNew);
}

async function persist(model, pending, isNew) {
  if (!model.name.trim()) {
    toast('Informe um nome para a sessão', 'err');
    return undefined;
  }
  if (model.type === 'serial' && !model.config.path) {
    toast('Escolha a porta serial', 'err');
    return undefined;
  }
  if (model.type !== 'shell' && model.type !== 'serial' && !model.config.host) {
    toast('Informe o host', 'err');
    return undefined;
  }

  return guard(async () => {
    const payload = {
      name: model.name.trim(),
      type: model.type,
      folderId: model.folderId,
      config: model.config,
      themeId: model.themeId,
      color: model.color,
      tags: model.tags,
      notes: model.notes,
      identityId: model.identityId
    };

    const saved = isNew
      ? await window.tsm.sessions.create(payload)
      : await window.tsm.sessions.update(model.id, payload);

    for (const [field, value] of Object.entries(pending)) {
      if (value === undefined) continue;                    // não mexeu no campo
      if (value === null) await window.tsm.secrets.clear('session', saved.id, field);
      else await window.tsm.secrets.set('session', saved.id, field, value);
    }

    await reloadTree();
    toast(isNew ? 'Sessão criada' : 'Sessão salva', 'ok');
    return saved;
  });
}

// ------------------------------------------------------------ widgets -----
/** Campo de senha que distingue "não mexi", "limpar" e "novo valor". */
function secretInput(field, alreadySet, pending, fromIdentity) {
  const placeholder = alreadySet
    ? '•••••••• (guardada)'
    : fromIdentity ? '•••••••• (vem da credencial salva)' : 'não definida';
  const input = el('input', {
    type: 'password',
    placeholder,
    autocomplete: 'new-password',
    onInput: (e) => { pending[field] = e.target.value; }
  });
  const clear = el('button', {
    text: 'Remover',
    title: 'Apagar a credencial guardada',
    onClick: () => {
      pending[field] = null;
      input.value = '';
      input.placeholder = '(será removida ao salvar)';
    }
  });
  return el('div', { class: 'inline' }, [input, alreadySet ? clear : null]);
}

function pathPicker(value, onChange, directory, filters) {
  const input = el('input', {
    type: 'text', value, onInput: (e) => onChange(e.target.value)
  });
  const btn = el('button', {
    text: '…',
    onClick: async () => {
      const picked = await window.tsm.io.pickFile({ directory, filters });
      if (picked) {
        input.value = picked;
        onChange(picked);
      }
    }
  });
  return el('div', { class: 'inline' }, [input, btn]);
}

function folderPaths() {
  const byId = new Map(state.folders.map((f) => [f.id, f]));
  const label = (f) => {
    const parts = [f.name];
    let cur = f;
    let guardCount = 0;
    while (cur.parent_id && byId.has(cur.parent_id) && guardCount++ < 64) {
      cur = byId.get(cur.parent_id);
      parts.unshift(cur.name);
    }
    return parts.join(' / ');
  };
  return state.folders
    .map((f) => ({ value: f.id, label: label(f) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

// ------------------------------------------------------ conexão rápida ----
/** Barra estilo "ssh user@host -p 22" — conecta sem salvar. */
export async function quickConnectDialog() {
  let text = '';
  let type = 'ssh';
  let save = false;

  const input = el('input', {
    type: 'text', placeholder: 'usuário@host:porta   ou   host',
    style: 'font-family:var(--font-mono)',
    onInput: (e) => { text = e.target.value; }
  });

  const res = await modal({
    title: 'Conexão rápida',
    width: 520,
    render: (api) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); api.close('go'); }
      });
      return el('div', { class: 'form-grid' }, [
        el('label', { text: 'Destino' }), input,
        el('div', { class: 'hint', text: 'Aceita "root@10.0.0.1:2222". A porta padrão vem do protocolo.' }),
        el('label', { text: 'Protocolo' }),
        select(TYPES.filter((t) => !['shell', 'serial'].includes(t.value)), type, (v) => { type = v; }),
        el('div', { class: 'full' }, [checkbox('Salvar como sessão depois de conectar', false, (v) => { save = v; })])
      ]);
    },
    footer: (api) => [
      el('button', { text: 'Cancelar', onClick: () => api.close(undefined) }),
      el('button', { class: 'primary', text: 'Conectar', onClick: () => api.close('go') })
    ]
  });

  if (res !== 'go' || !text.trim()) return undefined;

  const parsed = parseTarget(text.trim(), type);
  if (!parsed.host) {
    toast('Destino inválido', 'err');
    return undefined;
  }
  return { type, config: parsed, save, name: `${parsed.username ? `${parsed.username}@` : ''}${parsed.host}` };
}

export function parseTarget(text, type) {
  let rest = text;
  let username = '';
  const at = rest.lastIndexOf('@');
  if (at !== -1) {
    username = rest.slice(0, at);
    rest = rest.slice(at + 1);
  }
  let host = rest;
  let port = type === 'telnet' ? 23 : 22;

  // IPv6 entre colchetes: [::1]:2222
  const v6 = rest.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (v6) {
    host = v6[1];
    if (v6[2]) port = Number(v6[2]);
  } else {
    const idx = rest.lastIndexOf(':');
    if (idx !== -1 && /^\d+$/.test(rest.slice(idx + 1))) {
      host = rest.slice(0, idx);
      port = Number(rest.slice(idx + 1));
    }
  }
  return { host: host.trim(), port, username: username.trim(), terminalType: 'xterm-256color' };
}
