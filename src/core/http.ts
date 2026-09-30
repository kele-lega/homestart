/**
 * 服务端访问外部 API 的唯一出口：固定超时、响应体大小上限、按声明的编码解码。
 * 所有失败都包装成 UpstreamError，调用方据此返回 502，而不是把内部异常暴露给前端。
 */
import tls from 'node:tls';

/**
 * 出站 TLS 只用经典的密钥交换组。Node 24 自带的 OpenSSL 3.5 默认附带后量子混合密钥（X25519MLKEM768），
 * ClientHello 因此超过 1.5 KB、拆成两个 TCP 分段，有些网络路径会丢掉后一段，握手一直挂到超时
 * （实测访问 Open-Meteo 约一半请求超时，而对方本来也只协商 X25519）。
 * 这是进程级设置：经典密钥交换对现有攻击依然安全，放弃的只是对“先截获、将来用量子计算机解密”的防护，
 * 对天气、联想词这类数据可以接受。外部请求都经过本模块，导入时设置就能赶在第一次握手之前生效。
 */
tls.DEFAULT_ECDH_CURVE = 'X25519:prime256v1:secp384r1';

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export interface FetchJsonOptions {
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly headers?: Readonly<Record<string, string>>;
  /** 测试时注入 */
  readonly fetch?: typeof fetch;
}

const CHARSET = /charset\s*=\s*"?([\w-]+)/i;

/** 不读的响应体立即取消，连接马上释放，而不是等到超时 */
export function discard(response: Pick<Response, 'body'>): void {
  response.body?.cancel().catch(() => {
    // 取消失败说明流已经结束或出错，连接同样会被释放
  });
}

/**
 * 读完响应体；声明的 content-length 或实际流量超过 maxBytes 时取消读取、返回 undefined，
 * 由调用方用自己的措辞报告“太大”。
 */
export async function readUpTo(
  response: Pick<Response, 'headers' | 'body'>,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > maxBytes) {
    discard(response);
    return undefined;
  }
  if (!response.body) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    // 提前离开 for await 会取消流，剩下的数据不再下载
    if (total > maxBytes) return undefined;
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const bytes = await readUpTo(response, maxBytes);
  if (!bytes) throw new UpstreamError(`响应超过 ${maxBytes} 字节`);
  return bytes;
}

export function decode(bytes: Uint8Array, contentType: string | null): string {
  const charset = contentType?.match(CHARSET)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    // 未知编码名会抛 RangeError，按 UTF-8 处理
    return new TextDecoder().decode(bytes);
  }
}

function describe(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return '请求超时';
  return error instanceof Error ? error.message : String(error);
}

export async function fetchJson(url: string, options: FetchJsonOptions): Promise<unknown> {
  const { host } = new URL(url);
  const doFetch = options.fetch ?? fetch;
  try {
    const response = await doFetch(url, {
      headers: { accept: 'application/json', ...options.headers },
      signal: AbortSignal.timeout(options.timeoutMs),
      // 上游只该直接返回数据；跟随重定向可能被引到任意主机（包括内网）
      redirect: 'error',
    });
    if (!response.ok) {
      discard(response);
      throw new UpstreamError(`${host} 返回 HTTP ${response.status}`, response.status);
    }
    const text = decode(await readLimited(response, options.maxBytes), response.headers.get('content-type'));
    try {
      return JSON.parse(text);
    } catch {
      throw new UpstreamError(`${host} 返回的内容不是 JSON`);
    }
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    throw new UpstreamError(`${host}：${describe(error)}`);
  }
}
