# Total Session Manager (TSM)

Gerenciador de sessões remotas multiplataforma — **Windows, Linux e macOS** — para **SSH,
Telnet, Shell local e SFTP/SCP**, com organização em pastas, temas, import/export e
**sem limite de sessões salvas**.

O TSM é software original, escrito do zero. Ele **interopera** com o MobaXterm (lê
`MobaXterm.ini` e `.mxtsessions`) e com o PuTTY (lê `.reg` e `~/.putty/sessions`), mas não
reutiliza, modifica nem contorna nada do produto da Mobatek.

---

## Download

Última versão: [**v1.5.0**](https://github.com/diegocarlesso/TSM/releases/tag/v1.5.0) — nenhum instalador, é só baixar e rodar.

| Sistema | Arquivo | Como usar |
|---|---|---|
| Windows | [TSM-1.5.0-win-x64.zip](https://github.com/diegocarlesso/TSM/releases/download/v1.5.0/TSM-1.5.0-win-x64.zip) | **Recomendado.** Extraia uma vez, abre na hora dali em diante. |
| Windows | [TSM-1.5.0-win-portable-x64.exe](https://github.com/diegocarlesso/TSM/releases/download/v1.5.0/TSM-1.5.0-win-portable-x64.exe) | Executável único, mais lento para abrir (autoextrai a cada execução). |
| Linux | [TSM-1.5.0-linux-x86_64.AppImage](https://github.com/diegocarlesso/TSM/releases/download/v1.5.0/TSM-1.5.0-linux-x86_64.AppImage) | `chmod +x` e execute. |
| Linux | [TSM-1.5.0-linux-x64.tar.gz](https://github.com/diegocarlesso/TSM/releases/download/v1.5.0/TSM-1.5.0-linux-x64.tar.gz) | Pasta com o binário, se preferir extrair. |
| macOS (Apple Silicon) | [TSM-1.5.0-mac-arm64.dmg](https://github.com/diegocarlesso/TSM/releases/download/v1.5.0/TSM-1.5.0-mac-arm64.dmg) | M1/M2/M3/M4. |
| macOS (Intel) | [TSM-1.5.0-mac-x64.dmg](https://github.com/diegocarlesso/TSM/releases/download/v1.5.0/TSM-1.5.0-mac-x64.dmg) | Macs Intel. |

> **macOS:** binários sem assinatura (o projeto não tem certificado Apple). Na primeira abertura: botão direito no app → **Abrir** → **Abrir**.
> **Windows:** o `.exe` portátil é um autoextraível — ele descompacta para uma pasta temporária a cada execução, o que o torna mais lento para abrir e mais sujeito a alertas do SmartScreen/Defender do que um binário assinado. Veja [Empacotamento (portátil)](#empacotamento-portátil) para a alternativa em pasta, mais rápida.

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
- **Serial (COM/tty)** com baud, bits de dados, paridade, bits de parada, controle de fluxo,
  escolha do que a tecla Enter envia (CR, LF ou CR+LF), eco local opcional e sinal de
  **break**. A porta e a velocidade são campos **digitáveis com sugestões**, no estilo do
  PuTTY: as portas detectadas aparecem na lista, mas você pode digitar uma que ainda não
  existe (adaptador desconectado) ou que fugiu da enumeração.
- **Shell local** com PTY de verdade (`node-pty`): PowerShell 7, Windows PowerShell, cmd,
  Git Bash, WSL, bash/zsh. Cai para modo pipe se o módulo nativo não estiver disponível.
- **Algoritmos legados** opcionais por sessão, para equipamentos antigos que ainda falam
  `diffie-hellman-group1-sha1` e afins.

### Abas e painéis
- **Split de painéis dentro da aba**: divida à direita ou abaixo quantas vezes quiser —
  o layout é uma árvore aninhada (como tmux e Windows Terminal), não um conjunto de
  layouts prontos. Divisórias arrastáveis, foco destacado e navegação com `Alt`+setas.
- Fechar um painel desfaz a divisão sozinho; fechar a aba encerra todos de uma vez, com
  uma confirmação só.
- Dividir **não recria** o terminal já aberto: o buffer e o scroll continuam intactos.

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
- **Automações estilo Expect** (`Ctrl+Shift+R` na aba ativa, ou menu Ferramentas): roteiros
  de "espera este padrão → manda este comando", passo a passo, para repetir a mesma sequência
  em muitos equipamentos sem digitar tudo de novo em cada aba. Barra de progresso com botão
  de parar caso um passo trave esperando algo que não chega.
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
- **Aviso de nova versão** disponível no GitHub Releases — checagem roda inteiramente no
  processo principal (a interface continua sem fazer nenhuma chamada de rede própria),
  uma vez por dia, com opção de desligar em Configurações.

### Segurança
- Credenciais cifradas pelo **cofre do sistema** (DPAPI no Windows, Keychain no macOS,
  libsecret/kwallet no Linux) **ou** por **senha mestra** (AES-256-GCM com chave derivada
  por scrypt), à sua escolha.
- **Credenciais reutilizáveis** (Ferramentas → Credenciais): escolher uma no editor de
  sessão preenche o usuário na hora e a senha entra como fallback na conexão — sem
  precisar cadastrar de novo em cada sessão. A senha nunca aparece em claro na interface,
  só um aviso de que ela "vem da credencial salva".
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

> `dist:mac` e `dist:linux` **só funcionam rodando no próprio sistema**: o `.icns`, o `.dmg`
> e o AppImage dependem de ferramentas que não existem no Windows. Para gerar os três a
> partir de qualquer máquina, use o fluxo de CI:
>
> ```bash
> gh workflow run "Build portátil"
> ```
>
> Ele compila Windows, Linux e macOS em paralelo nos runners do GitHub e publica os
> artefatos. Empurrar uma tag `vX.Y.Z` faz o mesmo e ainda anexa tudo ao release.
>
> Os binários de macOS saem **sem assinatura** (não há certificado de desenvolvedor no
> projeto): na primeira abertura, use botão direito → Abrir.

O que sai em `dist/`:

| Plataforma | Artefato | Como usar |
|---|---|---|
| Windows | `win-unpacked/` | Pasta pronta com `Total Session Manager.exe` e os arquivos de apoio. Copie a pasta inteira e execute. |
| Windows | `TSM-1.5.0-win-x64.zip` | **Recomendado.** Mesma pasta do `win-unpacked`, zipada. Extraia uma vez e o app abre na hora dali em diante. |
| Windows | `TSM-1.5.0-win-portable-x64.exe` | Executável único (~86 MB), no estilo do MobaXterm Portable. Mais conveniente para levar num pendrive, mas mais lento: é um autoextraível NSIS que descompacta tudo para uma pasta temporária **toda vez que abre** — isso soma alguns segundos de espera e é parte do motivo dele chamar mais atenção do SmartScreen/Defender. |
| Linux | `TSM-1.5.0-linux-x86_64.AppImage` | Um arquivo só: `chmod +x` e execute. |
| Linux | `linux-unpacked/`, `.tar.gz` | Pasta com o binário e as bibliotecas. |
| macOS | `mac/Total Session Manager.app` | Arraste para onde quiser e abra. |
| macOS | `.dmg` / `.zip` | Envelope para distribuir o `.app`. |

### Sobre a demora para abrir e o aviso do SmartScreen no Windows

Dois efeitos distintos, ambos ligados ao fato de o executável **não ter assinatura digital**
(um certificado de assinatura de código custa na faixa de algumas centenas de dólares por
ano — o projeto não tem um):

- **Demora para abrir:** só acontece com o `.exe` portátil. Ele é um autoextraível NSIS —
  toda vez que você dá duplo clique, ele descompacta os ~86 MB da aplicação para uma pasta
  temporária antes de rodar, e isso é refeito do zero a cada execução. Use o
  `TSM-${versão}-win-x64.zip` (extraia uma vez, rode o `.exe` de dentro da pasta extraída)
  se a demora incomodar — o app é o mesmo, só a forma de distribuição muda.
- **Aviso do SmartScreen ("Windows protegeu o computador"):** o SmartScreen decide pela
  reputação do arquivo — quantas vezes ele já foi baixado e executado por outras pessoas.
  Um binário nosso, recém-publicado e sem assinatura, começa sempre do zero nessa reputação;
  não tem configuração de build que remova esse aviso. As opções reais são: (1) clicar em
  **Mais informações → Executar assim mesmo** (o binário é buildado neste repositório pelo
  GitHub Actions, a partir do código-fonte público — dá para conferir); ou (2) comprar um
  certificado de assinatura de código (EV ou OV) e assinar o build no CI, o que reduz drasticamente
  o aviso depois de algum volume de execuções assinadas. Não fizemos (2) porque tem custo
  recorrente e o projeto não tem esse orçamento hoje.

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
| `Ctrl+Shift+→` / `Ctrl+Shift+↓` | Dividir o painel à direita / abaixo |
| `Alt+←` `Alt+→` `Alt+↑` `Alt+↓` | Mover o foco entre painéis |
| `Ctrl+Shift+W` | Fechar só o painel em foco |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | Copiar / colar no terminal |
| `Ctrl+F` / `Ctrl+K` | Localizar / limpar terminal |
| `Ctrl+B` / `Ctrl+Shift+E` | Barra lateral / painel de arquivos |
| `Ctrl+Shift+M` | MultiExec |
| `Ctrl+Shift+S` | Biblioteca de comandos |
| `Ctrl+Shift+R` | Rodar automação na aba ativa |
| `Ctrl+L` | Bloquear cofre |

---

## Arquitetura

Veja [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Aparência

A identidade visual sai de `assets/icon.png`: a paleta da interface (azul `#0090f0` → lima
`#a8f018`, sobre o navy `#003060` dessaturado) e o tema de terminal padrão são derivados
dele, e o mesmo arquivo vira o ícone da janela, do executável e da tela inicial.

`assets/` é a fonte da verdade — trocar o `icon.png` e o `app.ico` ali é o suficiente:

```bash
npm run build:renderer
```

O script copia o ícone para junto do bundle (a CSP exige mesma origem) e regenera nada
mais. Os tamanhos auxiliares (`icon-512.png` e companhia) existem porque o macOS não gera
`.icns` a partir de imagem menor que 512×512.

Isso tudo é o **padrão** — o usuário continua podendo trocar tema, cor de destaque e fonte
em *Configurações → Aparência*, e essas escolhas nunca são sobrescritas.

## Testes

```bash
node scripts/smoke.js
```

66 verificações do processo principal em ~7 s, sem abrir a interface: banco, migrações,
cofre, importadores, export/import, negociação Telnet, gravação de sessão, geração de
chaves, o motor de automação (expect/send, contra uma conexão simulada) e o aviso de nova
versão (com rede simulada — sucesso, cache, falha, rate-limit). Inclui um teto de tempo na
inserção em lote, que já pegou uma regressão real de desempenho.

```bash
TSM_SMOKE=1 TSM_UITEST=scripts/uitest-split.js npx electron .
```

21 verificações na interface de verdade — abre a janela e dirige tudo por clique e teclado
(nenhuma porta de teste no código de produção): identidade visual, split, divisórias
arrastáveis, navegação entre painéis e fechamento.

```bash
TSM_SMOKE=1 TSM_UITEST=scripts/uitest-config.js npx electron .
```

Mais 17 verificações sobre a prévia de personalização e o editor de sessão serial.

```bash
TSM_DATA_DIR=./telecom node scripts/seed-telecom-repro.js
```

```bash
TSM_SMOKE=1 TSM_UITEST=scripts/uitest-telecom-repro.js TSM_DATA_DIR=./telecom npx electron .
```

Semeia uma pasta com 50+ sessões de nomes e alvos longos (o formato de uma importação real
do MobaXterm) e confere que a árvore rola em vez de estourar a janela, que o nome da sessão
continua legível ao lado do host/usuário, e que "Editar…" no menu de contexto abre o
diálogo com os dados certos.

```bash
TSM_SMOKE=1 TSM_UITEST=scripts/uitest-welcome-repro.js npx electron .
```

Confere, num banco vazio (sem sessões, sem abas — o estado em que a tela inicial aparece),
que um clique no ponto exato do botão "Nova sessão" chega até o botão em vez de ser
interceptado pelo `#panes` vazio por cima dele, e que o diálogo abre de verdade.

```bash
TSM_DATA_DIR=./demo node scripts/seed-demo.js
TSM_SMOKE=1 TSM_UITEST=scripts/uitest-tree-bug.js TSM_DATA_DIR=./demo npx electron .
```

Com várias pastas abertas, confere que clicar numa não muda o estado de nenhuma outra
(reproduz um bug real onde um clique colapsava pastas sem relação nenhuma) e que "Conectar"
no menu de contexto de uma sessão abre uma aba de verdade, com clique simulado no ponto real
do item (não `.click()` direto no nó).

```bash
TSM_SMOKE=1 TSM_UITEST=scripts/uitest-automations.js npx electron .
```

17 verificações de ponta a ponta das automações: cadastra um roteiro, abre um shell local de
verdade, dispara pelo menu de contexto da aba, confere que cada passo casa e manda o comando
certo na ordem certa, a barra de progresso, e o editor de passos (adicionar/cancelar).

```bash
TSM_SMOKE=1 TSM_UITEST=scripts/uitest-cr-real.js npx electron .
```

Confere — contra um PowerShell **de verdade** (não simulado), sem nenhum `\r` digitado à
mão — que o padrão (`sendEnter`/`run` = true) confirma o comando de fato, tanto pela
Biblioteca de comandos quanto por uma automação. `\n` sozinho não submete no PSReadLine; é
o teste que teria pego essa regressão se ela voltasse.

```bash
TSM_SMOKE=1 TSM_UITEST=scripts/uitest-terminal-shortcuts.js npx electron .
```

Confere que Ctrl+Shift+seta, Ctrl+Shift+W e Ctrl+W disparados no MESMO elemento que o
xterm.js escuta de verdade (não em `window` diretamente, o que não reproduziria o bug)
chegam até o app em vez de morrer dentro do terminal.

```bash
TSM_DATA_DIR=./ident node scripts/seed-identity.js
```

```bash
TSM_SMOKE=1 TSM_UITEST=scripts/uitest-identity-autofill.js TSM_DATA_DIR=./ident npx electron .
```

Confere o preenchimento automático ao escolher "Credencial salva" no editor de sessão:
a credencial aparece no dropdown, escolher preenche o usuário, e o placeholder da senha
avisa que ela vem da credencial — sem nunca mostrar o valor em claro.

```bash
TSM_DATA_DIR=./serial node scripts/seed-serial.js
```

```bash
TSM_SMOKE=1 TSM_UITEST=scripts/uitest-serial-real.js TSM_DATA_DIR=./serial npx electron .
```

Abre uma porta serial **real** da máquina e confere a abertura com os parâmetros pedidos, a
saída de bytes e o erro do sistema ao tentar abrir a mesma porta duas vezes. Sem equipamento
na outra ponta nada retorna — para testar a recepção é preciso um loopback nos pinos 2 e 3
do DB9, ou um aparelho conectado.

Para gerar um banco de demonstração e uma captura de tela:

```bash
TSM_DATA_DIR=./demo node scripts/seed-demo.js
```

```bash
TSM_SMOKE=1 TSM_UITEST=scripts/uitest-shot.js TSM_SHOT=tela.png TSM_DATA_DIR=./demo npx electron .
```

```bash
TSM_SMOKE=1 TSM_UITEST=scripts/uitest-tabbar-buttons.js npx electron .
```

Confere os botões "Sessão" e "Shell" na barra de abas (ao lado do "+" de conexão
rápida): que existem, que "Sessão" abre o diálogo de nova sessão e que "Shell" abre
uma aba de shell local — inclusive quando há mais de um shell instalado e aparece o
menu de escolha antes.

## Licença

MIT.
