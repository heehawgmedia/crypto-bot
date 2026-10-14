// Builds Barndo Planner into ONE self-contained HTML file (dist-single/barndo-planner.html)
// that opens straight from disk by double-clicking: no server, no Node.js needed to use it.
// Also writes barndo-planner.fragment.html (same page without the document skeleton) for
// hosts that wrap the page themselves.
import { build } from 'vite';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outDir = 'dist-single';
const bundleDir = path.join(outDir, 'bundle');

await build({
  configFile: false,
  base: './',
  logLevel: 'warn',
  build: {
    outDir: bundleDir,
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});

const assetDir = path.join(bundleDir, 'assets');
const files = await readdir(assetDir);
const jsFile = files.find((f) => f.endsWith('.js'));
const cssFile = files.find((f) => f.endsWith('.css'));
if (!jsFile || !cssFile) throw new Error(`unexpected build output: ${files.join(', ')}`);
const js = (await readFile(path.join(assetDir, jsFile), 'utf8')).replaceAll('</script', '<\\/script');
const css = (await readFile(path.join(assetDir, cssFile), 'utf8')).replaceAll('</style', '<\\/style');
const indexHtml = await readFile(path.join(bundleDir, 'index.html'), 'utf8');
const icon = indexHtml.match(/<link rel="icon"[^>]*>/)?.[0] ?? '';

const body = `<div id="app"></div>\n<script type="module">\n${js}\n</script>\n`;
const standalone = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Interactive 3D barndominium planner: edit the floor plan, walk room to room, and watch the build estimate update." />
    <title>Barndo Planner</title>
    ${icon}
    <style>
${css}
    </style>
  </head>
  <body>
${body}  </body>
</html>
`;
const fragment = `<title>Barndo Planner</title>\n<style>\n${css}\n</style>\n${body}`;

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'barndo-planner.html'), standalone);
await writeFile(path.join(outDir, 'barndo-planner.fragment.html'), fragment);
await rm(bundleDir, { recursive: true, force: true });
const kb = Math.round(Buffer.byteLength(standalone) / 1024);
console.log(`wrote ${outDir}/barndo-planner.html (${kb} KB) and ${outDir}/barndo-planner.fragment.html`);
