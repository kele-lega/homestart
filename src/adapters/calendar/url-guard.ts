/**
 * 订阅地址的出站检查（防 SSRF）：保存时检查一次，每次抓取前、每一跳重定向前再各检查一次。
 * 只允许 https（私密订阅地址本身就是访问凭据，不能明文传输）、不带账号密码，
 * 主机名解析出的每个地址都必须是公网地址。
 *
 * 已知并接受的缺口（DNS 重绑定）：这里解析一次、fetch 再自己解析一次，
 * 恶意域名可以在两次之间换成内网地址。完整的防护要把校验过的 IP 钉进连接，
 * 对只有自己在用的主页来说代价过高；这里挡住的是误填和最常见的探测。
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

export interface ResolvedAddress {
  readonly address: string;
  readonly family: number;
}

/** 主机名 → 全部地址；测试注入假的解析器，不碰真实网络 */
export type LookupFn = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export type UrlCheck =
  | { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly reason: 'invalid' | 'blocked' | 'dns'; readonly message: string };

export interface CheckUrlOptions {
  readonly lookup?: LookupFn;
  readonly signal?: AbortSignal;
}

export const MAX_URL_LENGTH = 2048;

const MESSAGES = {
  invalid: '请填写完整的 https:// 订阅地址',
  tooLong: `地址太长（最多 ${MAX_URL_LENGTH} 个字符）`,
  control: '地址里有不可见的控制字符，请重新复制',
  webcal: 'webcal:// 地址请把开头改成 https:// 再保存',
  insecure: 'http:// 会把私密地址明文发出去，请改用 https:// 开头的地址',
  protocol: '只支持 https:// 开头的地址',
  userinfo: '地址里不能包含用户名或密码',
  blocked: '不能使用本机或内网地址',
  dns: '无法解析这个地址的主机名',
} as const;

// C0、DEL 和 C1 控制字符：复制粘贴时混进来的换行、制表符等
const CONTROL = /\p{Cc}/u;

function reject(reason: 'invalid' | 'blocked' | 'dns', message: string): UrlCheck {
  return { ok: false, reason, message };
}

/** 主机名去掉 IPv6 方括号、结尾的点和 %zone，转成小写，便于比较 */
function bareHost(hostname: string): string {
  return hostname
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/\.+$/, '')
    .replace(/%.*$/, '')
    .toLowerCase();
}

/** 只看地址本身、不做 DNS 解析的检查；保存时的快速反馈和取主机名都用它 */
export function checkUrlSyntax(input: string): UrlCheck {
  const raw = input.trim();
  if (raw.length > MAX_URL_LENGTH) return reject('invalid', MESSAGES.tooLong);
  if (CONTROL.test(raw)) return reject('invalid', MESSAGES.control);

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return reject('invalid', MESSAGES.invalid);
  }
  if (url.protocol === 'webcal:' || url.protocol === 'webcals:') return reject('invalid', MESSAGES.webcal);
  if (url.protocol === 'http:') return reject('invalid', MESSAGES.insecure);
  if (url.protocol !== 'https:') return reject('invalid', MESSAGES.protocol);
  if (url.username || url.password) return reject('invalid', MESSAGES.userinfo);
  // 规范化（百分号编码、IDN 转 punycode）后可能变长
  if (url.href.length > MAX_URL_LENGTH) return reject('invalid', MESSAGES.tooLong);

  const host = bareHost(url.hostname);
  if (!host) return reject('invalid', MESSAGES.invalid);
  if (host === 'localhost' || host.endsWith('.localhost')) return reject('blocked', MESSAGES.blocked);
  // 十六进制、整数等写法的 IPv4 已被 URL 解析成点分十进制，IPv6 也已压缩成规范形式
  if (isIP(host) && isBlockedAddress(host)) return reject('blocked', MESSAGES.blocked);
  return { ok: true, url };
}

/**
 * 不允许访问的 IPv4 网段。故意不含 198.18.0.0/15（基准测试网段）：
 * Clash 等代理的 fake-ip 模式把所有域名都解析到这里，拦掉它，开着代理的机器一个日历都取不到。
 */
const BLOCKED_V4: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8], // “本网络”
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // 运营商级 NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // 链路本地，含云主机的元数据服务
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24], // 文档示例
  ['192.168.0.0', 16],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // 组播
  ['240.0.0.0', 4], // 保留，含 255.255.255.255 广播
];

const BLOCKED_V6: readonly (readonly [string, number])[] = [
  ['::', 128],
  ['::1', 128],
  ['100::', 64], // 丢弃前缀
  ['2001::', 32], // Teredo 隧道
  ['2001:2::', 48], // 基准测试
  ['2001:10::', 28], // ORCHID
  ['2001:20::', 28], // ORCHIDv2
  ['2001:db8::', 32], // 文档示例
  ['2002::', 16], // 6to4：嵌着的 IPv4 由公共中继转发，终点无从确认
  ['3fff::', 20], // 文档示例（RFC 9637）
  ['64:ff9b:1::', 48], // 本地用途的 NAT64，嵌入的 IPv4 无从确认
  ['fc00::', 7], // 唯一本地地址
  ['fe80::', 10], // 链路本地
  ['fec0::', 10], // 已废弃的站点本地
  ['ff00::', 8], // 组播
];

const BLOCKED = new BlockList();
for (const [net, prefix] of BLOCKED_V4) BLOCKED.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of BLOCKED_V6) BLOCKED.addSubnet(net, prefix, 'ipv6');

// 公网 IPv6 都在全球单播 2000::/3 里；其余是保留网段，或是 SIIT（::ffff:0:a.b.c.d）这类翻译写法
const GLOBAL_UNICAST = new BlockList();
GLOBAL_UNICAST.addSubnet('2000::', 3, 'ipv6');

/** IPv6 → 8 组 16 位数；借 URL 解析器做规范化，点分写法的 IPv4 尾巴也会被转成十六进制 */
function hextets(address: string): number[] | undefined {
  let canonical: string;
  try {
    canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  } catch {
    return undefined;
  }
  const [head = '', tail] = canonical.split('::');
  const parse = (part: string) => (part ? part.split(':').map((group) => parseInt(group, 16)) : []);
  const left = parse(head);
  if (tail === undefined) return left;
  const right = parse(tail);
  return [...left, ...Array<number>(Math.max(0, 8 - left.length - right.length)).fill(0), ...right];
}

/** IPv4 映射（::ffff:a.b.c.d）、IPv4 兼容（::a.b.c.d）和 NAT64（64:ff9b::a.b.c.d）里嵌着的 IPv4 */
function embeddedV4(groups: readonly number[]): string | undefined {
  const [a, b, c, d, e, f, g = 0, h = 0] = groups;
  const zeroHead = a === 0 && b === 0 && c === 0 && d === 0 && e === 0;
  const nat64 = a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0;
  if (!(zeroHead && (f === 0 || f === 0xffff)) && !nat64) return undefined;
  return [g >> 8, g & 0xff, h >> 8, h & 0xff].join('.');
}

/** 字面 IP 是否落在禁止的网段；认不出的写法一律当作禁止 */
export function isBlockedAddress(input: string): boolean {
  const address = input.replace(/%.*$/, '');
  const family = isIP(address);
  if (family === 4) return BLOCKED.check(address, 'ipv4');
  if (family !== 6) return true;
  if (BLOCKED.check(address, 'ipv6')) return true;
  const groups = hextets(address);
  if (!groups || groups.length !== 8) return true;
  const v4 = embeddedV4(groups);
  // 嵌着 IPv4 的几种写法按里面的 IPv4 判断，其余只接受全球单播
  if (v4 !== undefined) return BLOCKED.check(v4, 'ipv4');
  return !GLOBAL_UNICAST.check(address, 'ipv6');
}

/** 系统解析器可能卡很久；保存设置时也不能让请求一直挂着 */
const LOOKUP_TIMEOUT_MS = 5000;

const systemLookup: LookupFn = (hostname) => dnsLookup(hostname, { all: true });

/** dns.lookup 本身取消不了：信号触发时先放弃等待，解析结果到了就丢掉 */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * 完整检查：语法 + 解析主机名，任何一个地址落在禁止的网段就拒绝，解析失败也拒绝。
 * 用环境代理（NODE_USE_ENV_PROXY=1 + HTTPS_PROXY）时，真正连上游的是代理，
 * 这里的解析仍在本机进行：挡住的是“地址本身指向内网”，而不是代理替我们看到的结果。
 * 调用方的 signal 触发时抛出它的 reason，由调用方决定怎么报告。
 */
export async function checkUrl(input: string, options: CheckUrlOptions = {}): Promise<UrlCheck> {
  const syntax = checkUrlSyntax(input);
  if (!syntax.ok) return syntax;
  const host = bareHost(syntax.url.hostname);
  // 字面 IP 在语法检查里已经判过
  if (isIP(host)) return syntax;

  const lookup = options.lookup ?? systemLookup;
  const timeout = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let addresses: readonly ResolvedAddress[];
  try {
    addresses = await abortable(lookup(host), signal);
  } catch {
    if (options.signal?.aborted) throw options.signal.reason;
    return reject('dns', MESSAGES.dns);
  }
  if (!Array.isArray(addresses) || addresses.length === 0) return reject('dns', MESSAGES.dns);
  if (addresses.some(({ address }) => isBlockedAddress(address))) return reject('blocked', MESSAGES.blocked);
  return syntax;
}
