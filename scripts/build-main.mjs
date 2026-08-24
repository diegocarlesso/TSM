import esbuild from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// `packages: 'external'` é o ponto central deste build: o esbuild junta só os
// arquivos do proprio projeto (os `require('./algo')` de `src/main/**`) num
// unico arquivo e deixa TUDO que vem de `node_modules` de fora, resolvido
// normalmente em tempo de execucao. Isso protege os modulos com binding nativo
// — `@lydell/node-pty`, `serialport`, `node-sqlite3-wasm`, e as dependencias
// opcionais do `ssh2` (`cpu-features`) —, que ja quebraram o app mais de uma vez
// quando empacotados. Nao troque por uma lista manual de `external`.
//
// O arquivo sai na MESMA pasta do entry point: `paths.js` e a resolucao do modo
// portatil fazem contas relativas a `__dirname`, entao mover o bundle para outro
// diretorio mudaria silenciosamente onde o app procura os dados.
await esbuild.build({
  entryPoints: [resolve(root, 'src/main/index.js')],
  outfile: resolve(root, 'src/main/main.bundle.js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info'
});
