/**
 * 自动抓网站图标：打开网站首页，读 <link rel="icon"> 之类的标签挑一张，都不行再试 /favicon.ico。
 * 抓到的图片交给 ./store 存进本站，之后首页显示图标不再连外网。
 *
 * 地址是用户填的，服务端去连它，所以和日历订阅一样过 url-guard（防 SSRF）：只走 https、不连本机和内网，
 * 重定向手动跟随、每一跳都重新检查。http:// 的网站按 https:// 去抓，抓不到就算了。
 * 只读首页开头一段（<head> 里就够了），图片最多 MAX_ICON_BYTES
 */
import { decode, discard, UpstreamError } from '../../core/http';
import { USER_AGENT } from '../calendar/fetch-ics';
import { checkUrl, type LookupFn } from '../calendar/url-guard';
import { MAX_ICON_BYTES, sniffIcon } from './store';

const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
/** 首页只读这么多：图标标签都在 <head> 里 */
const MAX_PAGE_BYTES = 256 * 1024;
/** 候选太多时只试前几个 */
const MAX_CANDIDATES = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class IconFetchError extends UpstreamError {
  constructor(message: string) {
    super(message);
    this.name = 'IconFetchError';
  }
}

export interface FetchIconOptions {
  /** 测试时注入 */
  readonly fetch?: typeof fetch;
  readonly lookup?: LookupFn;
  readonly signal?: AbortSignal;
}

/** 读到 maxBytes 为止；超出的部分不要（不是报错：首页只要开头） */
async function readHead(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    const room = maxBytes - total;
    chunks.push(chunk.byteLength > room ? chunk.subarray(0, room) : chunk);
    total += Math.min(chunk.byteLength, room);
    // 提前离开 for await 会取消流，剩下的不再下载
    if (total >= maxBytes) break;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

interface Fetched {
  readonly url: URL;
  readonly bytes: Uint8Array;
  readonly contentType: string | null;
  /** 图片超过上限时为 true：bytes 只是开头，不能用 */
  readonly truncated: boolean;
}

/** 过 url-guard 的 GET；跟随重定向，每一跳重新检查。非 2xx、地址被拦都抛 IconFetchError */
async function guardedGet(url: string, maxBytes: number, accept: string, options: FetchIconOptions, signal: AbortSignal): Promise<Fetched> {
  const doFetch = options.fetch ?? fetch;
  let current = url;
  for (let hop = 0; ; hop++) {
    const check = await checkUrl(current, { lookup: options.lookup, signal });
    if (!check.ok) throw new IconFetchError(check.reason === 'blocked' ? '不能抓取本机或内网地址的图标' : '这个网址抓不了图标');
    const response = await doFetch(check.url.href, {
      headers: { 'user-agent': USER_AGENT, accept },
      signal,
      redirect: 'manual',
    });
    if (REDIRECT_STATUSES.has(response.status)) {
      discard(response);
      const location = response.headers.get('location');
      if (!location || hop >= MAX_REDIRECTS) throw new IconFetchError('网站的重定向太多');
      current = new URL(location, check.url).href;
      continue;
    }
    if (!response.ok) {
      discard(response);
      throw new IconFetchError(`网站返回 HTTP ${response.status}`);
    }
    const bytes = await readHead(response, maxBytes + 1);
    return {
      url: check.url,
      bytes: bytes.byteLength > maxBytes ? bytes.subarray(0, maxBytes) : bytes,
      contentType: response.headers.get('content-type'),
      truncated: bytes.byteLength > maxBytes,
    };
  }
}

const LINK_TAG = /<link\b[^>]*>/gi;
const ATTRIBUTE = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

function attributesOf(tag: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const [, name, double, single, bare] of tag.matchAll(ATTRIBUTE)) {
    const value = (double ?? single ?? bare ?? '').replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, entity: string) => ENTITIES[entity]!);
    result.set(name!.toLowerCase(), value.trim());
  }
  return result;
}

/** 声明的尺寸里最大的边长；any（矢量图）当作很大 */
function declaredSize(sizes: string | undefined): number {
  if (!sizes) return 0;
  if (/\bany\b/i.test(sizes)) return 1024;
  return Math.max(0, ...[...sizes.matchAll(/(\d+)\s*x\s*(\d+)/gi)].map(([, w]) => Number(w)));
}

/**
 * 从首页 HTML 里挑候选图标地址，好的在前：尺寸大的、SVG、apple-touch-icon（一般 180px）优先，
 * 最后补一个 /favicon.ico。mask-icon 是单色剪影，不要
 */
export function iconCandidates(html: string, base: URL): readonly string[] {
  const found: { readonly href: string; readonly score: number }[] = [];
  for (const [tag] of html.matchAll(LINK_TAG)) {
    const attributes = attributesOf(tag);
    const rel = (attributes.get('rel') ?? '').toLowerCase().split(/\s+/);
    const href = attributes.get('href');
    if (!href || rel.includes('mask-icon')) continue;
    const touch = rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed');
    if (!touch && !rel.includes('icon')) continue;
    let resolved: URL;
    try {
      resolved = new URL(href, base);
    } catch {
      continue;
    }
    if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:' && resolved.protocol !== 'data:') continue;
    const svg = attributes.get('type') === 'image/svg+xml' || /\.svg(?:$|\?)/i.test(resolved.pathname);
    const size = declaredSize(attributes.get('sizes')) || (touch ? 180 : svg ? 512 : 32);
    found.push({ href: resolved.href, score: size });
  }
  const ordered = found.sort((a, b) => b.score - a.score).map((candidate) => candidate.href);
  return [...new Set([...ordered, new URL('/favicon.ico', base).href])];
}

/** data: 地址里的图片（有些网站把图标直接内联在 HTML 里） */
function decodeDataUrl(href: string): Uint8Array | undefined {
  const match = /^data:[^;,]*(;base64)?,(.*)$/s.exec(href);
  if (!match) return undefined;
  try {
    return match[1] ? Uint8Array.from(Buffer.from(match[2]!, 'base64')) : new TextEncoder().encode(decodeURIComponent(match[2]!));
  } catch {
    return undefined;
  }
}

/** 网站地址 → 抓到的图标图片；所有候选都不行时抛 IconFetchError。调用方的 signal 触发时抛它的 reason */
export async function fetchSiteIcon(siteUrl: string, options: FetchIconOptions = {}): Promise<Uint8Array> {
  let site: URL;
  try {
    site = new URL(siteUrl);
  } catch {
    throw new IconFetchError('网址不对，抓不了图标');
  }
  // http:// 的网站也按 https:// 去抓：不明文连外站
  if (site.protocol === 'http:') site.protocol = 'https:';
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  try {
    // 首页打不开也没关系，还可以试 /favicon.ico
    const page = await guardedGet(site.href, MAX_PAGE_BYTES, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1', options, signal).catch(
      (error: unknown) => {
        if (signal.aborted) throw error;
        return undefined;
      },
    );
    const candidates = page
      ? iconCandidates(decode(page.bytes, page.contentType), page.url)
      : [new URL('/favicon.ico', site).href];

    for (const href of candidates.slice(0, MAX_CANDIDATES)) {
      if (href.startsWith('data:')) {
        const bytes = decodeDataUrl(href);
        if (bytes && bytes.byteLength <= MAX_ICON_BYTES && sniffIcon(bytes)) return bytes;
        continue;
      }
      const target = new URL(href);
      if (target.protocol === 'http:') target.protocol = 'https:';
      try {
        const image = await guardedGet(target.href, MAX_ICON_BYTES, 'image/*', options, signal);
        if (!image.truncated && sniffIcon(image.bytes)) return image.bytes;
      } catch (error) {
        if (signal.aborted) throw error;
        // 这个候选不行，试下一个
      }
    }
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    if (timeout.aborted) throw new IconFetchError('网站响应太慢，没抓到图标');
    if (error instanceof IconFetchError) throw error;
    throw new IconFetchError('连不上这个网站，没抓到图标');
  }
  throw new IconFetchError('这个网站没有找到可用的图标，可以自己上传一张');
}
