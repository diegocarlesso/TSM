# Arquitetura do TSM

## Visão geral

O TSM é um aplicativo Electron com separação estrita entre os dois processos:

```
┌──────────────────────────── processo principal (Node) ────────────────────────────┐
│                                                                                   │
│  index.js ── janela, menu, CSP, ciclo de vida                                     │
│  ipc.js ──── superfície de API (~80 canais), todos com tratamento de erro         │
│  paths.js ── onde ficam os dados (modo portátil)                                  │
│                                                                                   │
│  store/     db.js (SQLite + migrações) · sqlite.js (adaptador de 2 motores)       │
│             repo.js (pastas, sessões, temas, snippets, log)                       │
│  security/  vault.js (safeStorage ou AES-256-GCM + scrypt)                        │
│  transports/ ssh.js · telnet.js · shell.js · manager.js (registro de conexões)    │
│  sftp.js    navegação e transferência sobre a conexão SSH existente               │
│  logger.js  gravação da saída das sessões em arquivo                              │
│  keygen.js  geração e inspeção de chaves SSH (OpenSSH)                            │
│  importers/ mobaxterm.js · putty.js       portability.js (import/export nativo)   │
└───────────────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │  contextBridge — superfície explícita,
                                    │  sem Node no renderer, sem segredo em claro
                                    ▼
┌────────────────────────────── renderer (Chromium) ────────────────────────────────┐
│  app.js ────── orquestração, abas, atalhos, paleta, MultiExec                     │
│  components/  state.js · tree.js · terminal.js · sftp.js                          │
│               session-dialog.js · settings-dialog.js · tools-dialog.js · ui.js    │
│  xterm.js + addons (fit, search, web-links, unicode11)                            │
└───────────────────────────────────────────────────────────────────────────────────┘
```

**Regra que organiza tudo:** o renderer nunca toca em socket, arquivo ou credencial. Ele
fala por *id de conexão* e recebe eventos. Isso mantém a superfície de ataque pequena e
permite ligar `contextIsolation` sem exceções.

---

## Onde ficam os dados (modo portátil)

O TSM não tem instalador. `paths.js` resolve a pasta de dados nesta ordem:

1. `TSM_DATA_DIR` — controle explícito;
2. `PORTABLE_EXECUTABLE_DIR` — definida pelo `.exe` portátil, que se auto-extrai num
   diretório temporário (então `process.execPath` apontaria para o lugar errado);
3. `<pasta do executável>/data`, se der para escrever;
4. `userData` do sistema, como último recurso.

Em desenvolvimento a "pasta do executável" é a raiz do projeto — `process.execPath` seria o
electron dentro de `node_modules`. No macOS, sobe do `TSM.app/Contents/MacOS/` até a pasta
que contém o `.app`.

O passo 4 existe porque a pasta do executável pode ser somente leitura (`.app` em
`/Applications`, AppImage num sistema montado read-only). Escrever é testado de fato — com
um arquivo de teste — em vez de inferir das permissões.

---

## Persistência

SQLite em `<pasta de dados>/tsm.db` (ou em `$TSM_DATA_DIR` no modo portátil), com chaves
estrangeiras ativas e migrações versionadas por `PRAGMA user_version`.

`store/sqlite.js` é um adaptador que expõe **uma única API** sobre dois motores:

1. `better-sqlite3` — nativo, usado se estiver compilado na máquina;
2. `node-sqlite3-wasm` — SQLite em WebAssembly com I/O de arquivo real, **sem node-gyp**.

O padrão é o WASM, porque instalar não pode depender de o usuário ter Visual Studio ou
Xcode. `repo.js` não sabe qual está ativo. O adaptador cuida das diferenças: statements
ficam em cache por SQL (criá-los é caro no WASM), `transaction()` vira `BEGIN`/`COMMIT`
com `SAVEPOINT` no aninhamento, `pragma()` traduz para `PRAGMA` cru, booleanos viram
inteiros e `Buffer` vira `Uint8Array` na ligação de parâmetros.

| Tabela | Papel |
|---|---|
| `folders` | árvore de pastas (auto-referência `parent_id`, `sort_order`) |
| `sessions` | sessões; a config específica de cada tipo vive num JSON em `config` |
| `identities` | credenciais reutilizáveis entre sessões |
| `secrets` | ciphertext das senhas — nunca há coluna em claro |
| `settings` | preferências (chave/valor JSON) |
| `themes` | temas de terminal, embutidos e do usuário |
| `known_hosts` | impressões digitais aceitas |
| `connection_log` | histórico de conexões, com duração e erro |

O modelo híbrido (colunas para o que é consultado + JSON para o que é específico do tipo)
evita 40 colunas quase sempre nulas e continua permitindo índices e busca por `LIKE` sobre
`config`. Pastas usam CTE recursiva (`WITH RECURSIVE`) para descendentes e detecção de
ciclo ao mover.

**Não há limite de sessões.** Nenhum ponto do código conta sessões para restringir; a
contagem que aparece na barra lateral é informativa.

### Transações não são opcionais

No motor WASM cada commit custa um `fsync` de ~120 ms. Isso não aparece em uma escrita
avulsa, mas destrói qualquer laço: gravar 500 sessões uma a uma levava **86 s**; as mesmas
500 dentro de uma transação levam **~250 ms** — 340× mais rápido. Um import de 500 sessões
caiu de 179 s para menos de um segundo pelo mesmo motivo.

Por isso todo laço de escrita passa por `repo.tx(fn)`, e o teste de fumaça tem um teto de
tempo explícito na inserção em lote: se alguém remover a transação, o teste falha em vez de
o app ficar silenciosamente lento.

---

## Segurança de credenciais

Duas estratégias, escolhidas pelo usuário em *Configurações → Segurança*:

1. **`safeStorage` (padrão)** — delega ao SO: DPAPI (Windows), Keychain (macOS),
   libsecret/kwallet (Linux). Sem senha para digitar; a chave é do perfil do usuário.
2. **`aes-256-gcm`** — senha mestra do TSM, derivada com `scrypt` (N=2^15, r=8, p=1).
   Envelope: `MAGIC | salt(16) | iv(12) | tag(16) | ciphertext`. Necessária no modo
   portátil ou em Linux sem keyring.

Trocar a senha mestra **re-cifra todos os segredos** dentro de uma transação. A chave
derivada existe só em memória e é zerada ao bloquear o cofre.

Na exportação, credenciais ou ficam de fora do arquivo, ou vão num bloco cifrado com uma
senha independente digitada na hora. **Nunca em claro.**

---

## Transportes

Todos implementam a mesma interface — `connect()`, `write(data)`, `resize(cols, rows)`,
`close()` e os eventos `data` / `ready` / `close` / `error` — então `manager.js` os trata
de forma uniforme e a UI não sabe a diferença.

- **`ssh.js`** — `ssh2`. Cuida de: autenticação (senha, chave, agente, keyboard-interactive
  com passagem automática da senha conhecida e pergunta só no 2FA), verificação de host key
  contra `known_hosts`, jump host via `forwardOut`, túneis `-L`/`-R`, e um handle SFTP
  reaproveitando o mesmo canal.
- **`telnet.js`** — implementação própria da RFC 854/855. Faz o parse do fluxo IAC
  separando comandos de texto, negocia ECHO/SGA/NAWS/TERMINAL-TYPE/BINARY, escapa `0xFF`
  na escrita e trata chunks parciais (um `IAC SB … IAC SE` pode chegar dividido).
- **`shell.js`** — `@lydell/node-pty` (binários Node-API pré-compilados por plataforma,
  sem compilação) com `node-pty` clássico como segunda opção. Detecta os shells reais da
  máquina. Se nenhum módulo carregar, degrada para `child_process` com pipes e avisa no
  terminal, em vez de falhar a abertura do app.

---

## Importação do MobaXterm

O formato não é documentado pela Mobatek; o que existe é engenharia reversa da comunidade.
O parser reflete isso:

- Mapeia com confiança o que é consenso: seções `[Bookmarks*]`, `SubRep` (hierarquia),
  `ImgNum`, o código de tipo e os três primeiros campos (host, porta, usuário).
- Usa **heurística** — não posição fixa — para chave privada e gateway, porque os offsets
  variam entre versões.
- **Preserva a linha original** em `config.raw`. Nenhum dado é descartado; se o mapeamento
  melhorar depois, dá para reprocessar.
- Qualquer linha que não case vira um **aviso na prévia**, nunca um erro fatal nem um
  descarte silencioso.

Tipos ainda não suportados pelo TSM (RDP, VNC, FTP, Serial, XDMCP, Mosh, S3) são
explicitamente relatados como não importados.

---

## Renderer

Sem framework: um store de ~120 linhas com pub/sub e renderização direta de DOM. Para uma
árvore e um punhado de diálogos, um framework custaria mais em build e dependências do que
economizaria em código.

- **`state.js`** — estado + `buildTree()`, que monta a hierarquia e aplica o filtro,
  mantendo pastas visíveis quando algum descendente casa com a busca.
- **`terminal.js`** — um `Terminal` do xterm.js por aba, com `FitAddon` sob
  `ResizeObserver`. Cada aba é um `.pane` posicionado em `inset: 0`; trocar de aba é trocar
  a classe `.active`, o que preserva o buffer e o scroll sem re-render.
- **`tree.js`** — drag & drop com três zonas por linha (acima / dentro / abaixo). O drop
  recalcula a ordem dos irmãos e grava tudo numa transação.

---

## Decisões e alternativas descartadas

| Decisão | Por quê |
|---|---|
| Electron + xterm.js | É o que dá emulação de terminal correta (sequências ANSI, unicode largo, ligaduras) em três plataformas sem reescrever um emulador. Tabby e VS Code usam a mesma base. |
| SQLite em WASM por padrão | `better-sqlite3` exige node-gyp; numa máquina Windows sem Visual Studio o `npm install` simplesmente falha. Um app que não instala não tem desempenho nenhum. O nativo continua sendo usado quando existe. |
| PTY com prebuilds Node-API | Mesmo motivo: Node-API é ABI-estável entre versões de Node e Electron, então o mesmo `.node` serve sem rebuild a cada upgrade. |
| SQLite em vez de JSON | Transações no drag & drop e no import, consultas por recência/busca, e crescimento sem reescrever o arquivo inteiro a cada mudança. |
| `ssh2` puro JS | Sem depender de `ssh.exe` no PATH; controle fino sobre autenticação, host key e túneis. |
| Telnet próprio | Nenhuma biblioteca de Telnet no npm negocia NAWS e TERMINAL-TYPE de forma confiável para equipamento de rede. |
| Sem framework de UI | Uma árvore e ~10 diálogos não justificam React + bundler pesado. |
| Módulos nativos opcionais | `node-pty` degrada para pipes. Um app que não abre é pior que um app com uma função reduzida. |

---

## Onde mexer

| Quero… | Vá em |
|---|---|
| Adicionar um protocolo | `src/main/transports/` + `manager.js:build()` + `TYPES` em `session-dialog.js` |
| Mudar o esquema do banco | acrescente uma função ao array `MIGRATIONS` em `store/db.js` — nunca edite uma migração já lançada |
| Novo campo de sessão | `session-dialog.js` (UI) → grava em `config` (JSON); nada de DDL |
| Novo importador | `src/main/importers/` devolvendo `{folders, sessions, warnings}` + registrar em `portability.js` |
| Novo tema embutido | `src/shared/themes.js` |
| Gravar algo em lote | envolva em `repo.tx()` — veja a seção de transações |
| Mudar onde os dados ficam | `src/main/paths.js` |
