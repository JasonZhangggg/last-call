// Bundles src/ into one inline module and emits:
//   dist/index.html     full document for static hosting (the Cloudflare Worker serves this)
//   dist/artifact.html  skeleton-less page for claude.ai Artifacts (they add the document shell)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const out = await build({
  entryPoints: ['src/main.js'], bundle: true, format: 'esm', minify: true, write: false,
  external: ['three', 'three/addons/*'], target: 'es2022', legalComments: 'none',
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const shell = readFileSync('index.html', 'utf8');
const tag = '<script type="module" src="./src/main.js"></script>';
if (!shell.includes(tag)) throw new Error('index.html is missing the dev entry script tag');
const page = shell.replace(tag, () => `<script type="module">${js}</script>`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/artifact.html', page);
writeFileSync('dist/index.html', `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Last Call: a bluffing card game with a six-chamber revolver, played in a candle-lit tavern. Built with three.js.">
</head>
<body>
${page}
</body>
</html>
`);
console.log(`dist/index.html ${(Buffer.byteLength(page) / 1024).toFixed(1)} KB (bundle ${(js.length / 1024).toFixed(1)} KB)`);
