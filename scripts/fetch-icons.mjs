#!/usr/bin/env node
/**
 * 把 links.yaml 里的外链图标下载到本地，并改写配置指向站内路径。
 *
 * 图标现在默认走 favicon.im 这类第三方服务，服务挂了或限流时图标就退回首字母。
 * 这个脚本把常用图标一次性抓下来存进 public/icons/fetched/，之后不再依赖外网。
 *
 *   npm run fetch-icons              # 用 config/ 里的 links.yaml
 *   CONFIG_DIR=/tmp/x npm run fetch-icons
 *
 * 行为：先备份 links.yaml 再改写；已存在的文件跳过（幂等）；单个下载失败只警告不中断。
 * 只处理 icon / iconDark 里以 https:// 开头的值，站内路径原样不动。
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const CONFIG_DIR = path.resolve(process.env.CONFIG_DIR ?? path.join(ROOT, 'config'));
const LINKS_FILE = path.join(CONFIG_DIR, 'links.yaml');
const OUT_DIR = path.join(ROOT, 'public', 'icons', 'fetched');
// 运行中的服务只读构建产物 dist/client/，不读 public/；同步一份过去才不用重新构建
const DIST_CLIENT = path.join(ROOT, 'dist', 'client');
const DIST_OUT_DIR = path.join(DIST_CLIENT, 'icons', 'fetched');

/** Content-Type -> 扩展名；认不出来时退回 URL 路径里的后缀 */
const EXT_BY_TYPE = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
  ['image/svg+xml', 'svg'],
  ['image/x-icon', 'ico'],
  ['image/vnd.microsoft.icon', 'ico'],
  ['image/ico', 'ico'],
  ['image/icon', 'ico'],
]);

const TIMEOUT_MS = 15_000;

function extensionOf(contentType, iconUrl) {
  const type = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
  const known = EXT_BY_TYPE.get(type);
  if (known) return known;
  const fromPath = path.extname(new URL(iconUrl).pathname).slice(1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(fromPath) ? fromPath : 'bin';
}

/** 文件名：图标地址的主机名 + 原地址的短哈希，保证同名站点不同链接不会互相覆盖 */
function nameFor(iconUrl, extension) {
  const host = new URL(iconUrl).hostname.replace(/[^a-z0-9.-]/gi, '-');
  const hash = createHash('sha1').update(iconUrl).digest('hex').slice(0, 8);
  return `${host}-${hash}.${extension}`;
}

async function download(iconUrl) {
  const response = await fetch(iconUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': 'homestart-fetch-icons' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) throw new Error('响应为空');
  if (buffer.byteLength > 1024 * 1024) throw new Error(`文件过大（${buffer.byteLength} 字节）`);
  return { buffer, extension: extensionOf(response.headers.get('content-type'), iconUrl) };
}

/** 已下载过的文件（扩展名预先不知道，逐个试） */
const KNOWN_EXTENSIONS = ['png', 'svg', 'ico', 'jpg', 'webp', 'gif', 'bin', 'tmp'];

function findExisting(host, hash) {
  return KNOWN_EXTENSIONS.map((ext) => `${host}-${hash}.${ext}`).find((name) => existsSync(path.join(OUT_DIR, name)));
}

/** 收集配置里所有外链图标；用 Set 去重 */
function externalIcons(text) {
  const config = parse(text);
  const urls = new Set();
  for (const link of config?.links ?? []) {
    for (const key of ['icon', 'iconDark']) {
      const value = link?.[key];
      if (typeof value === 'string' && value.startsWith('https://')) urls.add(value);
    }
  }
  return urls;
}

/**
 * 没填 icon 的链接，运行时才会按 faviconService 模板推导出图标地址。
 * 这里把同样的推导也做一遍，好让脚本能把它们一起下载下来——
 * 否则跑完脚本，省略 icon 的链接照样每次去请求外网。
 */
const DEFAULT_FAVICON_SERVICE = 'https://a.favicon.im/{host}?larger=true';

/**
 * 给省略了 icon 的链接补上一行 icon。
 *
 * 逐行改而不是用 yaml 的 Document 往返：后者会把整份文件重新排版
 * （`[diff]` 变成 `[ diff ]`、行内写法被展开成块），diff 一片红。
 * 这里按「文档顺序找到 url 相同的那一行」定位，块写法和行内写法都能处理。
 */
function withIconsInserted(text, ordered) {
  if (ordered.length === 0) return { text, inserted: 0 };

  const lines = text.split('\n');
  let cursor = 0;
  let inserted = 0;

  for (const { url, local } of ordered) {
    for (let i = cursor; i < lines.length; i += 1) {
      const line = lines[i];
      const match = line.match(/(^|[\s{,])url:\s*(\S+?)\s*(?=[,}]|$)/);
      if (!match || match[2] !== url) continue;

      if (line.includes('{') && line.includes('}')) {
        // 行内写法：塞在收尾的 } 前面（连带吞掉前面的空格，避免出现 `true , icon:`）
        lines[i] = line.replace(/\s*\}\s*$/, `, icon: ${local} }`);
      } else {
        // 块写法：另起一行，缩进对齐 url
        const indent = line.slice(0, line.length - line.trimStart().length);
        lines.splice(i + 1, 0, `${indent}icon: ${local}`);
      }
      cursor = i + 1;
      inserted += 1;
      break;
    }
  }

  return inserted > 0 ? { text: lines.join('\n'), inserted } : { text, inserted: 0 };
}

/**
 * 逐行改写：只替换 icon / iconDark 的值，其余行（注释、缩进、其它字段）原样保留。
 * 行内联写法（- { ..., icon: https://... }）和分块写法都能命中。
 */
function rewrite(text, mapping) {
  let replaced = 0;
  const lines = text.split('\n').map((line) =>
    line.replace(/(\bicon(?:Dark)?\s*:\s*)(['"]?)(https:\/\/\S+?)\2(?=\s*[,}\]]?\s*$|\s*,)/, (match, prefix, quote, url) => {
      const local = mapping.get(url);
      if (!local) return match;
      replaced += 1;
      return `${prefix}${quote}${local}${quote}`;
    }),
  );
  return { text: lines.join('\n'), replaced };
}

async function main() {
  if (!existsSync(LINKS_FILE)) {
    console.error(`找不到 ${LINKS_FILE}`);
    process.exit(1);
  }
  const original = readFileSync(LINKS_FILE, 'utf8');
  const config = parse(original);
  const icons = [...externalIcons(original)];

  if (icons.length === 0) {
    console.log('links.yaml 里没有外链图标，什么都不用做。');
    return;
  }

  // 省略 icon 的链接：运行时按 faviconService 推导出地址，这里一并下载。
  // 记下文档顺序，插入时按顺序找，避免多条同网址时错位。
  const ordered = [];
  for (const link of config?.links ?? []) {
    if (link?.icon || typeof link?.url !== 'string') continue;
    const service = config?.faviconService ?? DEFAULT_FAVICON_SERVICE;
    if (!service.includes('{host}')) continue;
    try {
      const derived = service.replace('{host}', new URL(link.url).hostname);
      ordered.push({ url: link.url, derived });
      icons.push(derived);
    } catch {
      // 网址不合法时交给应用自己的配置校验报错，这里跳过
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`找到 ${icons.length} 个外链图标，下载到 public/icons/fetched/`);

  const mapping = new Map();
  let failed = 0;
  let skipped = 0;

  for (const iconUrl of new Set(icons)) {
    try {
      const host = new URL(iconUrl).hostname.replace(/[^a-z0-9.-]/gi, '-');
      const hash = createHash('sha1').update(iconUrl).digest('hex').slice(0, 8);
      const existing = findExisting(host, hash);

      if (existing) {
        mapping.set(iconUrl, `/icons/fetched/${existing}`);
        skipped += 1;
        continue;
      }

      // 下载前还不知道扩展名，先拿到内容再按 Content-Type 定文件名
      const { buffer, extension } = await download(iconUrl);
      const finalName = nameFor(iconUrl, extension);
      writeFileSync(path.join(OUT_DIR, finalName), buffer);
      mapping.set(iconUrl, `/icons/fetched/${finalName}`);
      console.log(`  ✓ ${iconUrl} -> ${finalName} (${buffer.byteLength} 字节)`);
    } catch (error) {
      failed += 1;
      console.warn(`  ✗ ${iconUrl} 下载失败：${error.message}（保留原地址）`);
    }
  }

  // 已构建过就把图标同步进 dist/client，否则新文件要等下次 build 才能访问
  if (existsSync(DIST_CLIENT)) {
    mkdirSync(DIST_OUT_DIR, { recursive: true });
    for (const name of readdirSync(OUT_DIR)) copyFileSync(path.join(OUT_DIR, name), path.join(DIST_OUT_DIR, name));
  }

  if (mapping.size === 0) {
    console.log('没有任何图标下载成功，配置未改动。');
    process.exitCode = 1;
    return;
  }

  // 第一步：手填的外链地址就地替换。改写用逐行正则，保留注释和排版。
  const { text: replacedText, replaced } = rewrite(original, mapping);

  // 第二步：省略 icon 的链接，在 url 行后插入一行 icon
  const inserts = ordered
    .map(({ url, derived }) => ({ url, local: mapping.get(derived) }))
    .filter((entry) => entry.local);
  const { text, inserted } = withIconsInserted(replacedText, inserts);

  if (replaced === 0 && inserted === 0) {
    console.log('图标都下载好了，但没能在 links.yaml 里定位到对应行，配置未改动。');
    return;
  }

  const backup = `${LINKS_FILE}.bak-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
  copyFileSync(LINKS_FILE, backup);
  writeFileSync(LINKS_FILE, text);

  console.log(`\n替换 ${replaced} 处，新插 ${inserted} 处，跳过已存在 ${skipped} 个，失败 ${failed} 个`);
  console.log(`原配置已备份到 ${path.relative(ROOT, backup)}`);
  console.log('刷新页面即可生效（config 是运行时读取的，不用重新构建）。');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
