# Total Session Manager (TSM)

Gerenciador de sessões remotas multiplataforma — **Windows, Linux e macOS** — para **SSH,
Telnet, Shell local e SFTP/SCP**, com organização em pastas, temas, import/export e
**sem limite de sessões salvas**.

O TSM é software original, escrito do zero. Ele **interopera** com o MobaXterm (lê
`MobaXterm.ini` e `.mxtsessions`) e com o PuTTY (lê `.reg` e `~/.putty/sessions`), mas não
reutiliza, modifica nem contorna nada do produto da Mobatek.

---

## Recursos

### Conexões
- **SSH** com senha, chave privada (OpenSSH), agente (`ssh-agent` / Pageant),
  teclado-interativo (2FA/OTP), compressão, keepalive e X11 forwarding.
- **Jump host / gateway** (equivalente ao `ssh -J`), incluindo credencial própria do gateway.
- **Túneis de porta** locais (`-L`) e remotos (`-R`), configurados por sessão e abertos
  automaticamente na conexão.
- **Telnet** com negociação real de opções (ECHO, SGA, NAWS, TERMINAL-TYPE, BINARY) e
  auto-login opcional por regex de prompt — funciona com switches, OLTs e equipamentos legados.
- **Shell local** com PTY de verdade (`node-pty`): PowerShell 7, Windows PowerShell, cmd,
  Git Bash, WSL, bash/zsh. Cai para modo pipe se o módulo nativo não estiver disponível.
- **Algoritmos legados** opcionais por sessão, para equipamentos antigos que ainda falam
  `diffie-hellman-group1-sha1` e afins.

### Organização
- Árvore de **pastas aninhadas** com drag & drop, cores, contagem e busca incremental.
- Etiquetas, notas por sessão, cor de aba, histórico de uso e "sessões recentes".
- **Paleta de comandos** (`Ctrl+P`) para pular para qualquer sessão digitando.
- **Sem teto de sessões** — o limite é o disco.

### Arquivos
- Painel **SFTP/SCP** montado sobre a *mesma* conexão SSH já autenticada (sem segunda senha).
- Upload por arrastar-e-soltar, download recursivo de pastas, renomear, `chmod`, excluir,
  editor de texto embutido para configs rápidas, barra de progresso.

### Aparência
- 9 temas de terminal embutidos (TSM Dark, MobaXterm Classic, Solarized, Dracula, Nord,
  Gruvbox, One Light, Campbell) + **editor de temas** com pré-visualização ao vivo.
- Tema por sessão ou global; fonte, tamanho, altura de linha, espaçamento, estilo de cursor.
- Interface clara/escura ou seguindo o sistema, cor de destaque configurável.

### Produtividade
- **MultiExec** (`Ctrl+Shift+M`): digita um comando e envia para todas as abas conectadas.
- **Biblioteca de comandos** (`Ctrl+Shift+S`): guarde o que você repete todo dia, por
  categoria, e dispare na aba ativa ou em todas de uma vez. Cada comando escolhe se executa
  na hora ou só digita, para você revisar antes.
- **Gravação de sessão em arquivo**: liga e desliga por aba, com modelo de nome
  (`%name%_%Y%%M%%D%_%h%%m%%s%.log`), remoção de códigos ANSI e carimbo de hora por linha.
  A gravação roda no processo principal, então continua com a aba em segundo plano.
- **Gerenciador de túneis ao vivo**: abre e fecha encaminhamentos `-L`/`-R` numa sessão já
  conectada, com estado de cada um.
- **Gerador de chaves SSH** (Ed25519, ECDSA, RSA) no formato OpenSSH, com senha opcional,
  fingerprint SHA256 e a chave pública pronta para colar no `authorized_keys`.
- Busca dentro do terminal (`Ctrl+F`), copiar-ao-selecionar, colar com botão direito,
  confirmação ao colar múltiplas linhas.
- Reconexão automática opcional quando a conexão cai.
- Histórico de conexões e gerenciamento de chaves de host conhecidas.

### Segurança
- Credenciais cifradas pelo **cofre do sistema** (DPAPI no Windows, Keychain no macOS,
  libsecret/kwallet no Linux) **ou** por **senha mestra** (AES-256-GCM com chave derivada
  por scrypt), à sua escolha.
- Verificação de **chave de host** com alerta explícito quando a chave muda.
- O processo de interface roda com `contextIsolation`, sem Node e sob CSP restritiva.
  Nenhuma senha em claro atravessa a ponte para a interface.

### Interoperabilidade
- **Importa** de MobaXterm (`.ini`, `.mxtsessions`), PuTTY (`.reg`, `~/.putty/sessions`)
  e do próprio TSM (`.tsm.json`).
- **Exporta** em JSON legível, com as credenciais **de fora** (seguro para versionar) ou
  num bloco cifrado com senha própria.
- Backup do banco SQLite em um clique.

---

## Instalação a partir do código

Requisito único: **Node.js 20+**. **Não é preciso instalar compilador** — nem Visual Studio
Build Tools, nem Xcode, nem `build-essential`. O SQLite roda em WebAssembly e o PTY vem
como binário Node-API pré-compilado.

```bash
git clone https://github.com/diegocarlesso/TSM.git
```

```bash
cd TSM && npm install
```

```bash
npm start
```

### Opcional: SQLite nativo

O motor WASM é suficiente para uso normal. Se você tiver um catálogo muito grande e quiser
o SQLite nativo (mais rápido), instale-o — o TSM detecta e passa a usar automaticamente:

```bash
npm run sqlite:native
```

Isso exige as ferramentas de compilação da plataforma (VS Build Tools no Windows,
`build-essential` no Debian/Ubuntu, `xcode-select --install` no macOS). Se a compilação
falhar, o TSM continua funcionando com o WASM.

## Empacotamento (portátil)

O TSM **não tem instalador**. Cada build produz um executável que roda de onde estiver —
disco local, pendrive, pasta de rede.

```bash
npm run dist:win
```

```bash
npm run dist:linux
```

```bash
npm run dist:mac
```

O que sai em `dist/`:

| Plataforma | Artefato | Como usar |
|---|---|---|
| Windows | `win-unpacked/` | Pasta pronta com `Total Session Manager.exe` e os arquivos de apoio. Copie a pasta inteira e execute. |
| Windows | `TSM-1.0.0-portable-x64.exe` | Executável único que se auto-extrai e roda. |
| Linux | `TSM-1.0.0-x64.AppImage` | Um arquivo só: `chmod +x` e execute. |
| Linux | `linux-unpacked/`, `.tar.gz` | Pasta com o binário e as bibliotecas. |
| macOS | `mac/Total Session Manager.app` | Arraste para onde quiser e abra. |
| macOS | `.dmg` / `.zip` | Envelope para distribuir o `.app`. |

### Onde ficam os dados

Por padrão o TSM é **portátil**: o banco, os logs de sessão e as chaves geradas ficam numa
pasta `data/` **ao lado do executável**.

```
TSM/
├── Total Session Manager.exe
├── resources/
└── data/
    ├── tsm.db          ← sessões, pastas, temas, credenciais cifradas
    ├── logs/           ← gravações de sessão
    └── keys/           ← chaves SSH geradas aqui
```

Copiar a pasta (ou o pendrive) leva tudo junto — sessões, preferências e credenciais.

A ordem de resolução é: `TSM_DATA_DIR` → pasta do executável → perfil do usuário. O último
caso só acontece se a pasta do executável for somente leitura (por exemplo, o `.app` dentro
de `/Applications`). *Ferramentas → Sobre* mostra qual está em uso.

Para apontar outra pasta:

```bash
TSM_DATA_DIR=/mnt/pendrive/tsm ./TSM.AppImage
```

> **Atenção ao modo portátil com credenciais:** no esquema padrão as senhas são cifradas
> pelo cofre do sistema operacional, que é atrelado ao *seu usuário naquela máquina*. Levando
> o `data/` para outro computador, o banco abre mas as senhas não. Se você vai usar o mesmo
> `data/` em máquinas diferentes, defina uma **senha mestra** em *Configurações → Segurança*:
> aí a chave vem da sua senha, não do SO.

---

## Importando do MobaXterm

1. No MobaXterm: **Sessions → Export sessions** para gerar um `.mxtsessions`, ou localize o
   `MobaXterm.ini` (versão portátil: ao lado do `.exe`; instalada: `%APPDATA%\MobaXterm\`).
2. No TSM: **Sessões → Importar sessões…**, escolha o arquivo.
3. A tela de prévia mostra o que foi reconhecido, o que será ignorado e por quê — nada é
   gravado antes de você confirmar.

**O que é importado:** nome, pasta (hierarquia `SubRep`), tipo, host, porta, usuário,
caminho de chave privada, gateway/jump host, flags de X11 e compressão, e o esquema de
cores da seção `[Colors]`.

**O que não é:** senhas (ficam cifradas no cofre do MobaXterm — recadastre-as no TSM) e os
tipos que o TSM ainda não abre (RDP, VNC, FTP, Serial, XDMCP, Mosh, S3). Essas sessões são
listadas nos avisos, não silenciosamente descartadas.

> O formato do MobaXterm não é documentado pela Mobatek; o parser do TSM é deliberadamente
> tolerante e guarda a linha original em `config.raw`, de modo que nenhum dado se perde
> mesmo nos campos que ainda não sabemos interpretar.

---

## Atalhos

| Atalho | Ação |
|---|---|
| `Ctrl+N` | Nova sessão |
| `Ctrl+Shift+N` | Conexão rápida |
| `Ctrl+Shift+T` | Shell local |
| `Ctrl+P` | Buscar sessão (paleta) |
| `Ctrl+W` / `Ctrl+D` / `Ctrl+R` | Fechar / duplicar / reconectar aba |
| `Ctrl+Tab` / `Ctrl+1..9` | Navegar entre abas |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | Copiar / colar no terminal |
| `Ctrl+F` / `Ctrl+K` | Localizar / limpar terminal |
| `Ctrl+B` / `Ctrl+Shift+E` | Barra lateral / painel de arquivos |
| `Ctrl+Shift+M` | MultiExec |
| `Ctrl+Shift+S` | Biblioteca de comandos |
| `Ctrl+L` | Bloquear cofre |

---

## Arquitetura

Veja [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Testes

```bash
node scripts/smoke.js
```

Exercita banco, migrações, cofre, importadores, export/import, negociação Telnet, gravação
de sessão e geração de chaves — 43 verificações, sem abrir a interface. Inclui um teto de
tempo para a inserção em lote, que já pegou uma regressão real de desempenho.

Para validar que a janela sobe de verdade:

```bash
TSM_SMOKE=1 npx electron .
```

## Licença

MIT.
