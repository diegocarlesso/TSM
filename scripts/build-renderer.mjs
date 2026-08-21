import esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

// xterm ships its stylesheet separately; copy it next to the bundle.
mkdirSync(resolve(root, 'src/renderer/vendor'), { recursive: true });
copyFileSync(
  resolve(root, 'node_modules/@xterm/xterm/css/xterm.css'),
  resolve(root, 'src/renderer/vendor/xterm.css')
);

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
