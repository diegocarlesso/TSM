import esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

// O xterm distribui a folha de estilo separada; e o icone precisa ficar sob a
// mesma origem do documento por causa da CSP (`img-src 'self'`). Os dois viram
// vizinhos do bundle.
mkdirSync(resolve(root, 'src/renderer/vendor'), { recursive: true });
copyFileSync(
  resolve(root, 'node_modules/@xterm/xterm/css/xterm.css'),
  resolve(root, 'src/renderer/vendor/xterm.css')
);
copyFileSync(resolve(root, 'assets/icon.png'), resolve(root, 'src/renderer/vendor/icon.png'));

const options = {
  entryPoints: [resolve(root, 'src/renderer/app.js')],
  outfile: resolve(root, 'src/renderer/app.bundle.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  sourcemap: true,
  logLevel: 'info'
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[tsm] renderer em modo watch');
} else {
  await esbuild.build(options);
}
