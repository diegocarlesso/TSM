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

## Empacotamento

```bash
npm run dist:win
```

```bash
npm run dist:linux
```

```bash
npm run dist:mac
```

Gera instaladores em `dist/`: NSIS + portátil no Windows; AppImage, `.deb`, `.rpm` e
`.tar.gz` no Linux; `.dmg` e `.zip` no macOS.

## Modo portátil

Defina `TSM_DATA_DIR` para guardar o banco junto do executável (pendrive, pasta de rede):

```bash
TSM_DATA_DIR=./dados npm start
```

No Windows, com o executável portátil:

```bash
set TSM_DATA_DIR=.\dados && TSM.exe
```

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
| `Ctrl+L` | Bloquear cofre |

---

## Arquitetura

Veja [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Licença

MIT.
