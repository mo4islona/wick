#!/usr/bin/env node
// Bundle-size check.
//
// Two layers of measurement:
//   1. React tree-shake scenarios — synthetic ESM entrypoints consumed by
//      esbuild (minify, tree-shake, browser target). Reports what a real
//      consumer pays after bundling. React/ReactDOM external.
//   2. Per-package dist — raw size of every framework's built `index.js`
//      (core / react / vue / svelte). The Vue and Svelte ports can't be
//      tree-shaken via esbuild scenarios because their components are
//      compiled SFCs — measuring the shipped dist is the honest comparison.
//
// All sizes are reported raw + gzip (level 9) + brotli (default quality).

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';

import { build } from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i < process.argv.length - 1 ? process.argv[i + 1] : undefined;
}

const DIST = resolve(argValue('--dist') ?? resolve(ROOT, 'packages/react/dist/index.js'));
// Synthetic entrypoints must live inside the workspace so esbuild can resolve
// `@wick-charts/react` via node_modules traversal.
const TMP = resolve(ROOT, 'node_modules/.cache/bundle-size');

/** Entry source per scenario. Each imports from '@wick-charts/react' exactly
 *  as a consumer would. Pinning each symbol through a `globalThis` assignment
 *  keeps esbuild from treating the imports as side-effect-free and dropping
 *  them — plain `void [...]` gets folded away under `minify + sideEffects: false`. */
const SCENARIOS = [
  {
    name: 'candlestick-only',
    source: `
import { ChartContainer, CandlestickSeries, Crosshair, TimeAxis, YAxis, darkTheme } from '@wick-charts/react';
globalThis.__wickSizeProbe = { ChartContainer, CandlestickSeries, Crosshair, TimeAxis, YAxis, darkTheme };
`,
  },
  {
    name: 'line-only',
    source: `
import { ChartContainer, LineSeries, Crosshair, TimeAxis, YAxis, darkTheme } from '@wick-charts/react';
globalThis.__wickSizeProbe = { ChartContainer, LineSeries, Crosshair, TimeAxis, YAxis, darkTheme };
`,
  },
  {
    name: 'react-full',
    source: `
import * as WickCharts from '@wick-charts/react';
globalThis.__wickSizeProbe = WickCharts;
`,
  },
];

function ensureBuilt() {
  if (existsSync(DIST)) return;
  if (!process.argv.includes('--build')) {
    console.error(`error: ${DIST} not found. Run \`pnpm build\` first, or re-run with \`--build\`.`);
    process.exit(1);
  }
  console.log('Building @wick-charts/react...');
  execSync('pnpm --filter @wick-charts/react build', { cwd: ROOT, stdio: 'inherit' });
}

async function measure(scenario) {
  const entry = resolve(TMP, `${scenario.name}.mjs`);
  writeFileSync(entry, scenario.source);

  const result = await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    mainFields: ['module', 'main'],
    // `@wick-charts/react` isn't a dep of the workspace root, so alias the
    // bare specifier directly at its built ESM entry. This also guarantees we
    // measure what actually ships (dist), not the pnpm-symlinked source.
    alias: { '@wick-charts/react': DIST },
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    write: false,
    absWorkingDir: ROOT,
    logLevel: 'error',
  });

  const output = result.outputFiles[0].contents;
  return measureBytes(output);
}

function measureBytes(bytes) {
  const buf = bytes instanceof Buffer ? bytes : Buffer.from(bytes);
  return {
    raw: buf.byteLength,
    gzip: gzipSync(buf, { level: 9 }).byteLength,
    brotli: brotliCompressSync(buf).byteLength,
  };
}

const PACKAGES = [
  { name: '@wick-charts/core', file: resolve(ROOT, 'packages/core/dist/index.js') },
  { name: '@wick-charts/react', file: resolve(ROOT, 'packages/react/dist/index.js') },
  { name: '@wick-charts/vue', file: resolve(ROOT, 'packages/vue/dist/index.js') },
  { name: '@wick-charts/svelte', file: resolve(ROOT, 'packages/svelte/dist/index.js') },
];

function fmt(bytes) {
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${bytes} B`;
}

function padRight(s, w) {
  return s + ' '.repeat(Math.max(0, w - s.length));
}

function padLeft(s, w) {
  return ' '.repeat(Math.max(0, w - s.length)) + s;
}

function printTable(title, rows) {
  if (rows.length === 0) return;
  const nameW = Math.max(8, ...rows.map((r) => r.name.length));
  const rawW = Math.max(7, ...rows.map((r) => fmt(r.raw).length));
  const gzipW = Math.max(8, ...rows.map((r) => fmt(r.gzip).length));
  const brW = Math.max(7, ...rows.map((r) => fmt(r.brotli).length));

  const header = `${padRight(title, nameW)}  ${padLeft('raw', rawW)}  ${padLeft('gzip', gzipW)}  ${padLeft('brotli', brW)}`;
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const r of rows) {
    console.log(
      `${padRight(r.name, nameW)}  ${padLeft(fmt(r.raw), rawW)}  ${padLeft(fmt(r.gzip), gzipW)}  ${padLeft(fmt(r.brotli), brW)}`,
    );
  }
}

async function main() {
  ensureBuilt();
  mkdirSync(TMP, { recursive: true });

  const reactRows = [];
  for (const scenario of SCENARIOS) {
    const sizes = await measure(scenario);
    reactRows.push({ name: scenario.name, ...sizes });
  }

  const packageRows = [];
  for (const pkg of PACKAGES) {
    if (!existsSync(pkg.file)) continue;
    const bytes = readFileSync(pkg.file);
    packageRows.push({ name: pkg.name, ...measureBytes(bytes) });
  }

  printTable('react scenario', reactRows);
  if (packageRows.length > 0) {
    console.log();
    printTable('package dist', packageRows);
  }

  if (process.argv.includes('--json')) {
    console.log();
    console.log(JSON.stringify({ scenarios: reactRows, packages: packageRows }, null, 2));
  }

  rmSync(TMP, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
