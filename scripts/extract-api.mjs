// Extracts the public component API surface from the React package via the
// TypeScript compiler API and emits docs/data/api-manifest.json.
//
// Source of truth for the auto-generated half of every API page (props table,
// types, JSDoc descriptions, defaults). The hand-written prose intro lives
// alongside in docs/pages/api/<name>.tsx.
//
// Re-run after changing component prop types:
//   pnpm api:extract

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/**
 * Component → source file. Order in this map = order in sidebar.
 * `kind` controls how docs render the page.
 */
const COMPONENTS = [
  // chart series — under "Components" in the sidebar
  { name: 'LineSeries', file: 'packages/react/src/LineSeries.tsx', kind: 'chart' },
  { name: 'BarSeries', file: 'packages/react/src/BarSeries.tsx', kind: 'chart' },
  { name: 'CandlestickSeries', file: 'packages/react/src/CandlestickSeries.tsx', kind: 'chart' },
  { name: 'PieSeries', file: 'packages/react/src/PieSeries.tsx', kind: 'chart' },

  // composite chart — own playground but lives under Components
  { name: 'Sparkline', file: 'packages/react/src/ui/Sparkline.tsx', kind: 'chart' },

  // container & subcomponents — under "API"
  { name: 'ChartContainer', file: 'packages/react/src/ChartContainer.tsx', kind: 'subcomponent' },
  { name: 'TimeAxis', file: 'packages/react/src/ui/TimeAxis.tsx', kind: 'subcomponent', alias: 'XAxis' },
  { name: 'YAxis', file: 'packages/react/src/ui/YAxis.tsx', kind: 'subcomponent' },
  { name: 'Tooltip', file: 'packages/react/src/ui/Tooltip.tsx', kind: 'subcomponent' },
  { name: 'Crosshair', file: 'packages/react/src/ui/Crosshair.tsx', kind: 'subcomponent' },
  { name: 'Legend', file: 'packages/react/src/ui/Legend.tsx', kind: 'subcomponent' },
  { name: 'Navigator', file: 'packages/react/src/ui/Navigator.tsx', kind: 'subcomponent' },
  { name: 'Title', file: 'packages/react/src/ui/Title.tsx', kind: 'subcomponent' },
  { name: 'InfoBar', file: 'packages/react/src/ui/InfoBar.tsx', kind: 'subcomponent' },
  { name: 'PieLegend', file: 'packages/react/src/ui/PieLegend.tsx', kind: 'subcomponent' },
  { name: 'PieTooltip', file: 'packages/react/src/ui/PieTooltip.tsx', kind: 'subcomponent' },
  { name: 'NumberFlow', file: 'packages/react/src/ui/NumberFlow.tsx', kind: 'subcomponent' },
  { name: 'YLabel', file: 'packages/react/src/ui/YLabel.tsx', kind: 'subcomponent' },
];

const tsconfigPath = resolve(ROOT, 'tsconfig.json');
const { config } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config, ts.sys, ROOT);

const program = ts.createProgram({
  rootNames: COMPONENTS.map((c) => resolve(ROOT, c.file)),
  options: { ...parsed.options, noEmit: true },
});
const checker = program.getTypeChecker();

/** Compress whitespace in a printed type so the table column stays readable. */
function compactType(s) {
  // `decl.type.getText()` preserves source trivia, including JSDoc/line
  // comments on inline object members. Strip those before whitespace
  // collapse, otherwise the comment text leaks into the rendered type.
  // Multi-line union types in source (`| 'a' | 'b'` on its own line) leave a
  // leading `|` after collapse; strip it so the rendered type doesn't open
  // with a stray pipe.
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\|\s*/, '');
}

/**
 * Pull a default value out of a leading `Default: …` sentence in the JSDoc
 * description. Conservative on purpose — anything ambiguous (containing
 * decimals, `e.g.`, complex expressions) needs an explicit `@default` tag.
 *
 * Cases handled:
 *   - "Default: `'grow'`."        → 'grow'           (backticked literal)
 *   - "Default: 'grow'."          → 'grow'           (single-quoted)
 *   - "Default: \"grow\"."        → "grow"           (double-quoted)
 *   - "Default: 1.15."            → 1.15             (numeric with decimals)
 *   - "Default: 600 ms."          → 600 ms           (bare token)
 *   - "Default: { visible: true }." → { visible: true } (balanced braces)
 *   - "Default: `'both'` (e.g. ...)." → 'both'        (parenthetical ignored)
 */
function parseLeadingDefault(description) {
  // Match the first `Default:` / `Defaults:` token anywhere in the
  // description — many props embed it mid-sentence ("What to display per
  // label. Default: `'both'`."). The token-based parser below then trims
  // any trailing context (parentheticals, sentence period) cleanly.
  const m = description.match(/\bDefaults?:\s+([\s\S]+)/);
  if (!m) return null;
  const body = m[1];

  // Backticked: capture between the first matching pair, drop the markers
  // (the renderer applies its own code styling).
  if (body.startsWith('`')) {
    const end = body.indexOf('`', 1);
    if (end > 0) return body.slice(1, end);
  }

  // Single- or double-quoted: keep the quotes, they're part of the value.
  if (body[0] === "'" || body[0] === '"') {
    const q = body[0];
    const end = body.indexOf(q, 1);
    if (end > 0) return body.slice(0, end + 1);
  }

  // Object literal: balance braces so we don't truncate at the first inner `;`.
  if (body.startsWith('{')) {
    let depth = 0;
    for (let i = 0; i < body.length; i++) {
      if (body[i] === '{') depth++;
      else if (body[i] === '}') {
        depth--;
        if (depth === 0) return body.slice(0, i + 1);
      }
    }
  }

  // Bare value: stop at the first comma, opening paren, period followed by
  // whitespace, or a period at end-of-line. This protects decimals (`1.15`)
  // and "e.g." asides while still trimming the trailing sentence period.
  const stop = body.search(/,|\(|\.\s|\.$/);
  const captured = stop >= 0 ? body.slice(0, stop) : body;

  return captured.trim() || null;
}

function getJsDocInfo(symbol) {
  const description = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
  const tags = symbol.getJsDocTags(checker);

  let defaultValue = null;
  let deprecated = null;
  const see = [];

  for (const tag of tags) {
    const text = ts.displayPartsToString(tag.text).trim();
    if (tag.name === 'default' || tag.name === 'defaultValue') {
      // Strip surrounding backticks — the renderer applies its own code
      // styling, matching `parseLeadingDefault`'s behaviour.
      defaultValue = text.replace(/^`([\s\S]+)`$/, '$1');
    } else if (tag.name === 'deprecated') deprecated = text || true;
    else if (tag.name === 'see') see.push(text);
  }

  // Fallback: leading "Default: …" sentence in the description. Common in
  // this codebase. Only used when there's no explicit @default tag.
  if (!defaultValue && description) {
    defaultValue = parseLeadingDefault(description);
  }

  return { description, defaultValue, deprecated, see };
}

/** Format a property's declared type as a single-line string. */
function printPropType(prop, decl) {
  // Prefer the type from the declaration node — preserves union order and
  // type aliases (e.g. `LineEntryAnimation`) instead of expanding them.
  if (decl && ts.isPropertySignature(decl) && decl.type) {
    return compactType(decl.type.getText());
  }

  const type = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration ?? decl);

  return compactType(checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation));
}

/**
 * Resolve `Partial<T>`, a bare named type, or an inline object type literal
 * → the members we can expand into a nested table. Named types come back as
 * `{ kind: 'named', symbol, name }`; inline `{ ... }` types come back as
 * `{ kind: 'inline', members }` with no name (the renderer omits the suffix).
 *
 * Used by `options?: Partial<LineSeriesOptions>` (named) and
 * `padding?: { top?: number; ... }` (inline).
 */
function resolveExpandable(decl) {
  if (!decl || !ts.isPropertySignature(decl) || !decl.type) return null;

  const t = decl.type;
  if (ts.isTypeReferenceNode(t)) {
    const name = t.typeName.getText();
    if (name === 'Partial' && t.typeArguments?.length === 1) {
      return resolveTypeName(t.typeArguments[0]);
    }

    return resolveTypeName(t);
  }

  if (ts.isTypeLiteralNode(t)) {
    return { kind: 'inline', members: t.members };
  }

  return null;
}

function resolveTypeName(typeNode) {
  if (!ts.isTypeReferenceNode(typeNode)) return null;

  const symbol = checker.getSymbolAtLocation(typeNode.typeName);
  if (!symbol) return null;

  const aliased = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const decls = aliased.getDeclarations() ?? [];

  for (const d of decls) {
    if (ts.isInterfaceDeclaration(d)) {
      if (['Partial', 'Pick', 'Omit', 'Record'].includes(aliased.getName())) return null;

      return { kind: 'named', symbol: aliased, name: aliased.getName() };
    }
    // Type aliases that resolve to object literals are expandable; unions /
    // string literals are not — they belong inline as the type column.
    if (ts.isTypeAliasDeclaration(d) && ts.isTypeLiteralNode(d.type)) {
      return { kind: 'named', symbol: aliased, name: aliased.getName() };
    }
  }

  return null;
}

function extractMembers(members) {
  const props = [];
  for (const prop of members ?? []) {
    if (!ts.isPropertySignature(prop) || !prop.name) continue;

    const propSymbol = checker.getSymbolAtLocation(prop.name);
    if (!propSymbol) continue;

    const name = prop.name.getText();
    const optional = !!prop.questionToken;
    const typeStr = printPropType(propSymbol, prop);
    const jsDoc = getJsDocInfo(propSymbol);

    const expanded = resolveExpandable(prop);
    let nested = null;
    if (expanded?.kind === 'named') {
      nested = { name: expanded.name, props: extractInterface(expanded.symbol) };
    } else if (expanded?.kind === 'inline') {
      // Anonymous shape — leave the name empty so the renderer omits the
      // `· TypeName` suffix on the toggle button.
      nested = { name: '', props: extractMembers(expanded.members) };
    }

    props.push({
      name,
      type: typeStr,
      optional,
      defaultValue: jsDoc.defaultValue,
      deprecated: jsDoc.deprecated,
      description: jsDoc.description,
      see: jsDoc.see,
      ...(nested ? { nested } : {}),
    });
  }

  return props;
}

function extractInterface(symbol) {
  return extractMembers(symbol.getDeclarations()?.[0]?.members);
}

function getComponentDescription(sourceFile, componentName) {
  // Pull the JSDoc immediately preceding `export function ${componentName}`.
  let result = '';
  ts.forEachChild(sourceFile, (node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.getText() === componentName &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      const sym = checker.getSymbolAtLocation(node.name);
      if (sym) result = ts.displayPartsToString(sym.getDocumentationComment(checker)).trim();
    }
  });

  return result;
}

function findInterfaceSymbol(sourceFile, name) {
  let found = null;
  ts.forEachChild(sourceFile, (node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.getText() === name) {
      found = checker.getSymbolAtLocation(node.name);
    }
  });

  return found;
}

const manifest = { components: {} };

for (const entry of COMPONENTS) {
  const sf = program.getSourceFile(resolve(ROOT, entry.file));
  if (!sf) {
    console.error(`[extract-api] could not load ${entry.file}`);
    continue;
  }

  const propsName = `${entry.name}Props`;
  const propsSymbol = findInterfaceSymbol(sf, propsName);
  const description = getComponentDescription(sf, entry.name);

  manifest.components[entry.name] = {
    kind: entry.kind,
    file: entry.file,
    alias: entry.alias ?? null,
    description,
    props: propsSymbol ? extractInterface(propsSymbol) : [],
  };
}

const outPath = resolve(ROOT, 'docs/data/api-manifest.json');
writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[extract-api] wrote ${outPath}`);
console.log(`[extract-api] ${Object.keys(manifest.components).length} components`);
