import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// 进浏览器的代码：.svelte 组件、src/client 下的脚本、.astro 里打包的 <script>。
// 顺着它们的值引用（import type 会被擦掉，不算）一路找下去，不能碰到只该在服务端跑的模块：
// 数据适配层（订阅地址、ICS 解析都在那里）、Node 内置模块、只在服务端用的依赖
const ROOT = path.resolve('src');
const ADAPTERS = path.join(ROOT, 'adapters') + path.sep;
const SERVER_PACKAGES = new Set(['ical.js', 'tyme4ts']);
const NODE_BUILTINS = new Set(builtinModules);
const CODE = ['.ts', '.js', '.svelte'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** 打包进浏览器的脚本：.astro 里不带 is:inline 的 <script>、.svelte 的 <script>，其余整个文件 */
function scripts(file: string): string {
  const source = readFileSync(file, 'utf8');
  if (!file.endsWith('.astro') && !file.endsWith('.svelte')) return source;
  const blocks = [...source.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  return blocks
    .filter(([, attrs = '']) => !/\bis:inline\b/.test(attrs))
    .map(([, , body]) => body)
    .join('\n');
}

/** 会留到运行时的引用：import / export … from、只为副作用的 import、动态 import() */
function valueImports(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const patterns = [
    /\b(?:import|export)\s+(?!type\s)[^;'"]*?\sfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  return patterns.flatMap((pattern) => [...code.matchAll(pattern)].map(([, specifier]) => specifier!));
}

function resolveLocal(from: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(from), specifier);
  const candidates = [base, ...CODE.map((ext) => base + ext), ...CODE.map((ext) => path.join(base, `index${ext}`))];
  return candidates.find((file) => CODE.some((ext) => file.endsWith(ext)) && existsSync(file));
}

function serverOnlyPackage(specifier: string): boolean {
  const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!;
  return specifier.startsWith('node:') || NODE_BUILTINS.has(name) || SERVER_PACKAGES.has(name);
}

const shown = (file: string) => path.relative(ROOT, file).replaceAll(path.sep, '/');

/** 从每个入口出发的引用链；链的最后一环是不该出现在浏览器里的模块 */
function violations(entries: readonly string[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const visit = (file: string, chain: readonly string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of valueImports(scripts(file))) {
      const local = specifier.startsWith('.') ? resolveLocal(file, specifier) : undefined;
      if (local?.startsWith(ADAPTERS) || (!specifier.startsWith('.') && serverOnlyPackage(specifier))) {
        found.push([...chain, shown(file), local ? shown(local) : specifier].join(' → '));
      } else if (local) {
        visit(local, [...chain, shown(file)]);
      }
    }
  };
  for (const entry of entries) visit(entry, []);
  return found;
}

describe('client bundle boundary', () => {
  it('never reaches server-only modules from code that runs in the browser', () => {
    const entries = walk(ROOT).filter(
      (file) => file.endsWith('.svelte') || file.endsWith('.astro') || file.startsWith(path.join(ROOT, 'client') + path.sep),
    );

    expect(entries.length).toBeGreaterThan(10);
    expect(violations(entries)).toEqual([]);
  });

  it('counts value imports and ignores type-only ones and comments', () => {
    const sample = `
      import type { A } from '../type-only';
      export type { B } from '../type-reexport';
      import { a, type C } from '../mixed';
      import {
        b,
      } from "../multiline";
      export { c } from '../reexport';
      import './side-effect.css';
      // import x from 'commented-out';
      const lazy = () => import('../lazy');
    `;

    expect(valueImports(sample).sort()).toEqual(['../lazy', '../mixed', '../multiline', '../reexport', './side-effect.css']);
  });
});
