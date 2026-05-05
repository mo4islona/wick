// Verifies that every component in the React API manifest has an identical
// prop set in the Vue and Svelte source. This is the safety net that keeps
// the multi-framework docs honest — if a Vue or Svelte file ever drifts from
// React, this script fails CI with a precise diff.
//
// What "identical" means here:
//   - same set of prop NAMES
//   - same OPTIONALITY per prop
//   - same TYPE STRING after normalisation (whitespace collapse, sorted unions)
//
// Vue is parsed via `@vue/compiler-sfc` (extracts `<script setup>`, then
// the TS compiler reads `defineProps<{...}>()`). Svelte is parsed via
// `svelte/compiler` (walks the instance script for `export let` decls).
// Both compilers ship as transitive deps of vite plugins already installed.
//
// Run via `pnpm api:check`.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Resolve the Vue SFC compiler from inside @vitejs/plugin-vue's deps. pnpm
// hoists transitive deps into the store, not into the top-level node_modules,
// so a bare `import '@vue/compiler-sfc'` doesn't work without adding it as
// a direct devDep. Going through createRequire keeps this script self-
// contained against the existing dep graph.
const requireFromVue = createRequire(createRequire(import.meta.url).resolve('@vitejs/plugin-vue'));
const { parse: parseVueSfc } = requireFromVue('@vue/compiler-sfc');

// We *don't* use svelte/compiler here. Svelte 4 requires a TS preprocessor
// to parse `.svelte` files with `<script lang="ts">` — but every Svelte file
// in this repo puts its prop declarations inside a single `<script lang="ts">`
// block, which is plain TypeScript. We extract that block with a regex and
// hand it to the TypeScript compiler API directly. Robust, zero-config, no
// preprocessor dance.

/** Components that intentionally exist only in @wick-charts/react. */
const REACT_ONLY = new Set(['Sparkline']);

/**
 * Props on the React side that don't have a direct prop equivalent in
 * Vue/Svelte because the framework uses a different convention:
 *
 * - `children` → React render-prop / element children. Vue uses named slots
 *   (declared via `defineSlots`, not `defineProps`); Svelte uses `<slot>`.
 *   The Slots section of the API page documents the parallel surface.
 * - `className` / `style` → React idiomatic. Vue/Svelte pass these through
 *   as fall-through attributes (`class=` / `style=`) without declaring them
 *   in `defineProps` / `export let`.
 * - `sub` (Title only) → React accepts `ReactNode`; Vue/Svelte expose it as a
 *   named slot (`<slot name="sub">`) so consumers can pass arbitrary markup
 *   without a string-only ceiling.
 *
 * These keys are skipped on the Vue/Svelte side of the diff. Real prop
 * additions or renames still trip the checker.
 */
const FRAMEWORK_CONVENTION_PROPS = new Set(['children', 'className', 'style', 'sub']);

/**
 * Allowed type-name aliases — when a prop's React type and Vue/Svelte type
 * are different identifiers but resolve to the same shape in `@wick-charts/core`,
 * register them here so the checker doesn't flag a structural drift as a
 * surface drift. Each entry is a *normalised* type string from React → set
 * of accepted Vue/Svelte equivalents.
 */
const TYPE_ALIASES = {
  TooltipSort: new Set(['SnapshotSort']),
};

/** React-source path → sibling resolver for Vue and Svelte. */
function siblings(reactPath) {
  const vue = reactPath.replace('/packages/react/', '/packages/vue/').replace(/\.tsx$/, '.vue');
  const svelte = reactPath.replace('/packages/react/', '/packages/svelte/').replace(/\.tsx$/, '.svelte');

  return { vue, svelte };
}

/** Compress whitespace + sort union members so equivalent type strings compare equal. */
function normaliseType(s) {
  if (!s) return '';
  // `member.type.getText()` preserves source trivia, including JSDoc/line
  // comments on inline object members. Strip those so per-field JSDoc on a
  // React inline type doesn't get flagged as a Vue/Svelte drift.
  const stripped = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // Trailing `;` before `}` is a stylistic difference between single-line
  // (`{ x: number }`) and multi-line (`{ x: number; }`) source forms — same
  // shape, no surface drift.
  const collapsed = stripped.replace(/\s+/g, ' ').replace(/;\s*}/g, ' }').trim();
  // Only attempt to sort top-level unions. Nested unions stay where they are —
  // the type printer is consistent enough that they line up between
  // frameworks.
  if (!collapsed.includes('|')) return collapsed;
  // Don't try to split unions inside generic brackets / object types.
  if (/[<({[]/.test(collapsed)) return collapsed;

  return collapsed
    .split('|')
    .map((p) => p.trim())
    .sort()
    .join(' | ');
}

/** Read prop members from a TypeScript type-literal node. */
function propsFromTypeLiteral(typeLiteralNode) {
  const out = [];
  for (const member of typeLiteralNode.members) {
    if (!ts.isPropertySignature(member) || !member.name) continue;

    const name = member.name.getText();
    const optional = !!member.questionToken;
    const typeText = member.type ? member.type.getText() : 'unknown';

    out.push({ name, optional, type: normaliseType(typeText) });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Extract React props from a `${Component}Props` interface in the source file. */
function extractReactProps(filePath, componentName) {
  const source = readFileSync(filePath, 'utf-8');
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const propsName = `${componentName}Props`;

  let result = [];
  ts.forEachChild(sf, (node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.getText() === propsName) {
      result = propsFromInterface(node);
    }
  });

  return result;
}

function propsFromInterface(interfaceNode) {
  const out = [];
  for (const member of interfaceNode.members) {
    if (!ts.isPropertySignature(member) || !member.name) continue;

    const name = member.name.getText();
    const optional = !!member.questionToken;
    const typeText = member.type ? member.type.getText() : 'unknown';

    out.push({ name, optional, type: normaliseType(typeText) });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Vue SFC → prop list, by parsing `defineProps<...>()` (handles withDefaults wrap). */
function extractVueProps(filePath) {
  const source = readFileSync(filePath, 'utf-8');
  const { descriptor } = parseVueSfc(source);
  const script = descriptor.scriptSetup ?? descriptor.script;
  if (!script) return null;

  const sf = ts.createSourceFile(filePath, script.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  // Walk for `defineProps<T>()` — possibly wrapped in `withDefaults(...)`.
  let typeArgNode = null;
  const visit = (node) => {
    if (typeArgNode) return;

    if (ts.isCallExpression(node) && node.expression.getText() === 'defineProps' && node.typeArguments?.length === 1) {
      typeArgNode = node.typeArguments[0];

      return;
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (!typeArgNode) return [];

  if (ts.isTypeLiteralNode(typeArgNode)) return propsFromTypeLiteral(typeArgNode);

  // Allow `defineProps<MyProps>()` — resolve the named interface in the same
  // script block.
  if (ts.isTypeReferenceNode(typeArgNode)) {
    const name = typeArgNode.typeName.getText();
    let found = null;
    ts.forEachChild(sf, (node) => {
      if (ts.isInterfaceDeclaration(node) && node.name.getText() === name) found = propsFromInterface(node);
    });

    return found ?? [];
  }

  return [];
}

/** Svelte file → prop list, by parsing the *instance* `<script lang="ts">` block as TS. */
function extractSvelteProps(filePath) {
  const source = readFileSync(filePath, 'utf-8');
  // Walk every <script> block. Skip `<script context="module">` — that's
  // where module-scoped type aliases live; props are in the instance script.
  const scriptRegex = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let scriptContent = null;

  for (const match of source.matchAll(scriptRegex)) {
    const attrs = match[1] ?? '';
    if (/context\s*=\s*['"]module['"]/.test(attrs)) continue;
    scriptContent = match[2];

    break;
  }

  if (!scriptContent) return [];
  const sf = ts.createSourceFile(filePath, scriptContent, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const out = [];
  ts.forEachChild(sf, (node) => {
    // `export let foo: T = default` parses as a VariableStatement with an
    // `export` modifier and `let` declaration list.
    if (
      !ts.isVariableStatement(node) ||
      !node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ||
      !(node.declarationList.flags & ts.NodeFlags.Let)
    ) {
      return;
    }

    for (const d of node.declarationList.declarations) {
      if (!ts.isIdentifier(d.name)) continue;
      const name = d.name.getText();
      const typeText = d.type ? d.type.getText() : 'unknown';
      const hasInit = d.initializer !== undefined;
      // Svelte's prop-as-optional convention: either explicit `| undefined` in
      // the type annotation, or any default initializer (since consumers can
      // omit the prop and let the default apply).
      const includesUndefined = /(?:^|\W)undefined(?:\W|$)/.test(typeText);
      const optional = hasInit || includesUndefined;

      out.push({ name, optional, type: normaliseType(typeText) });
    }
  });

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Produce a diff between two prop lists. Returns an array of issue strings —
 * empty array means "identical".
 */
function diffProps(reactProps, otherProps, otherFw) {
  const issues = [];
  const reactByName = new Map(reactProps.map((p) => [p.name, p]));
  const otherByName = new Map(otherProps.map((p) => [p.name, p]));

  for (const [name, reactProp] of reactByName) {
    if (FRAMEWORK_CONVENTION_PROPS.has(name)) continue;

    const otherProp = otherByName.get(name);
    if (!otherProp) {
      issues.push(`- missing in ${otherFw}: ${name}`);
      continue;
    }

    if (reactProp.optional !== otherProp.optional) {
      issues.push(
        `~ optionality drift on ${name}: react ${reactProp.optional ? 'optional' : 'required'} vs ${otherFw} ${otherProp.optional ? 'optional' : 'required'}`,
      );
    }

    // Vue/Svelte sometimes append `| undefined` to their declared types when
    // the prop has a default. Treat those as equivalent to React's `?`.
    const reactType = normaliseType(reactProp.type);
    const otherType = normaliseType(stripTrailingUndefined(otherProp.type));
    if (!typesEquivalent(reactType, otherType)) {
      issues.push(`~ type drift on ${name}: react \`${reactProp.type}\` vs ${otherFw} \`${otherProp.type}\``);
    }
  }

  for (const name of otherByName.keys()) {
    if (FRAMEWORK_CONVENTION_PROPS.has(name)) continue;
    if (!reactByName.has(name)) issues.push(`+ extra in ${otherFw}: ${name}`);
  }

  return issues;
}

function typesEquivalent(reactType, otherType) {
  if (reactType === otherType) return true;
  const aliasSet = TYPE_ALIASES[reactType];

  return aliasSet?.has(otherType) === true;
}

function stripTrailingUndefined(type) {
  const stripped = type
    .replace(/\s*\|\s*undefined\s*$/, '')
    .replace(/^\s*undefined\s*\|\s*/, '')
    .trim();

  return stripOuterParens(stripped);
}

/**
 * Drop a single layer of balanced outer parens. Function-typed optional
 * props in Svelte are declared as `((arg: T) => R) | undefined = undefined`
 * — the outer parens are mandatory to bind `| undefined` to the arrow type
 * (without them the union would parse as `R | undefined`). After
 * `stripTrailingUndefined` removes the union, the parens are noise that
 * make the type string disagree with React's bare `(arg: T) => R`. Only
 * the outermost paren pair is unwrapped; nested parens (e.g. tuple types)
 * stay.
 */
function stripOuterParens(type) {
  if (!type.startsWith('(') || !type.endsWith(')')) return type;

  let depth = 0;
  for (let i = 0; i < type.length; i++) {
    if (type[i] === '(') {
      depth++;
    } else if (type[i] === ')') {
      depth--;
      // Closed before the final char → opening `(` doesn't pair with the
      // closing `)`, parens are not the outermost wrapping.
      if (depth === 0 && i < type.length - 1) return type;
    }
  }

  return type.slice(1, -1).trim();
}

// ── main ─────────────────────────────────────────────────────────

const manifestPath = resolve(ROOT, 'docs/data/api-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

let totalIssues = 0;
const componentResults = [];

for (const [name, entry] of Object.entries(manifest.components)) {
  if (REACT_ONLY.has(name)) {
    componentResults.push({ name, status: 'react-only' });
    continue;
  }

  const reactPath = resolve(ROOT, entry.file);
  const { vue: vuePath, svelte: sveltePath } = siblings(reactPath);

  const reactProps = extractReactProps(reactPath, name);
  let vueProps;
  let svelteProps;

  try {
    vueProps = extractVueProps(vuePath);
  } catch (err) {
    componentResults.push({ name, status: 'error', issues: [`vue parse failed at ${vuePath}: ${err.message}`] });
    totalIssues++;
    continue;
  }

  try {
    svelteProps = extractSvelteProps(sveltePath);
  } catch (err) {
    componentResults.push({ name, status: 'error', issues: [`svelte parse failed at ${sveltePath}: ${err.message}`] });
    totalIssues++;
    continue;
  }

  const issues = [...diffProps(reactProps, vueProps, 'vue'), ...diffProps(reactProps, svelteProps, 'svelte')];

  if (issues.length === 0) {
    componentResults.push({ name, status: 'ok' });
  } else {
    componentResults.push({ name, status: 'drift', issues });
    totalIssues += issues.length;
  }
}

// ── reporting ────────────────────────────────────────────────────

let allOk = true;
for (const result of componentResults) {
  if (result.status === 'ok') {
    console.log(`✓ ${result.name}`);
  } else if (result.status === 'react-only') {
    console.log(`· ${result.name} (react-only)`);
  } else {
    allOk = false;
    console.log(`✗ ${result.name}`);
    for (const issue of result.issues) console.log(`    ${issue}`);
  }
}

console.log('');
if (allOk) {
  console.log(`All ${componentResults.length} components in parity across react / vue / svelte.`);
  process.exit(0);
} else {
  console.error(`${totalIssues} parity issue(s) detected.`);
  process.exit(1);
}
