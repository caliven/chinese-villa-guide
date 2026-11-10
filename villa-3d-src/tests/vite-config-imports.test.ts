import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Vite `configLoader: 'native'` 会解析 vite.config 及其依赖链；
 * 相对导入缺扩展名会在启动时告警。本测试锁定该依赖图，防止回归。
 * 不要用 VITE_CONFIG_NATIVE_IGNORE_WARNING 压制。
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = ["vite.config.ts", "vite-plugin-data-save.ts", "vite-plugin-scheme-save.ts", "vite-plugin-repo-root.ts"];
const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[^'"\n]+from\s+)?["'](\.[^"']+)["']/g;

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.mts`, `${base}.js`, path.join(base, "index.ts")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* continue */
    }
  }
  return null;
}

function missingExtensionsInConfigGraph(): { file: string; spec: string; line: number }[] {
  const visited = new Set<string>();
  const missing: { file: string; spec: string; line: number }[] = [];
  const queue = [...ENTRY];
  while (queue.length) {
    const rel = queue.shift()!;
    const abs = path.resolve(root, rel);
    if (visited.has(abs)) continue;
    visited.add(abs);
    let src: string;
    try {
      src = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    for (const match of src.matchAll(IMPORT_RE)) {
      const spec = match[1]!;
      const resolved = resolveImport(abs, spec);
      if (!resolved) continue;
      if (!path.extname(spec) && /\.(ts|mts|js|mjs)$/.test(resolved)) {
        missing.push({
          file: path.relative(root, abs),
          spec,
          line: src.slice(0, match.index).split("\n").length,
        });
      }
      const relResolved = path.relative(root, resolved);
      if (relResolved.startsWith("src/") || relResolved.startsWith("vite")) queue.push(relResolved);
    }
  }
  return missing;
}

test("vite.config 依赖链上的相对导入必须带文件扩展名", () => {
  const missing = missingExtensionsInConfigGraph();
  assert.deepEqual(
    missing,
    [],
    missing.map(row => `${row.file}:${row.line}  ${row.spec}`).join("\n"),
  );
});
