import { createServer, type AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { fetchJson, UpstreamError } from '../../src/core/http';

const LIMITS = { timeoutMs: 1000, maxBytes: 64 } as const;

function respond(body: BodyInit | null, init: ResponseInit = {}) {
  return vi.fn<typeof fetch>(async () => new Response(body, init));
}

/** 不带 content-length、分块到达的响应体 */
function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

describe('fetchJson', () => {
  it('parses JSON and asks for JSON explicitly', async () => {
    const fetch = respond('["ok"]', { headers: { 'content-type': 'application/json; charset=utf-8' } });
    await expect(fetchJson('https://api.example/x', { ...LIMITS, fetch })).resolves.toEqual(['ok']);
    const init = fetch.mock.calls[0]![1]!;
    expect(new Headers(init.headers).get('accept')).toBe('application/json');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // 上游被攻破时也不能借重定向把服务端引到别的主机（包括内网）
    expect(init.redirect).toBe('error');
  });

  it('cancels unread bodies as soon as the response is rejected', async () => {
    const cancelled = vi.fn();
    const pending = () => new ReadableStream({ cancel: cancelled });
    const status = respond(pending(), { status: 503 });
    await expect(fetchJson('https://api.example/x', { ...LIMITS, fetch: status })).rejects.toThrow(/503/);
    const oversized = respond(pending(), { headers: { 'content-length': '999' } });
    await expect(fetchJson('https://api.example/x', { ...LIMITS, fetch: oversized })).rejects.toThrow(/64/);
    expect(cancelled).toHaveBeenCalledTimes(2);
  });

  it('decodes the charset declared by the upstream', async () => {
    const gbk = new Uint8Array([0x5b, 0x22, 0xcc, 0xec, 0xc6, 0xf8, 0x22, 0x5d]); // ["天气"]
    const fetch = respond(gbk, { headers: { 'content-type': 'application/json; charset=GBK' } });
    await expect(fetchJson('https://api.example/x', { ...LIMITS, fetch })).resolves.toEqual(['天气']);
  });

  it('falls back to UTF-8 for unknown charsets', async () => {
    const fetch = respond('["ok"]', { headers: { 'content-type': 'application/json; charset=x-nope' } });
    await expect(fetchJson('https://api.example/x', { ...LIMITS, fetch })).resolves.toEqual(['ok']);
  });

  it('rejects non-2xx responses with the status code', async () => {
    const fetch = respond('nope', { status: 503 });
    const error = await fetchJson('https://api.example/x', { ...LIMITS, fetch }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).toMatchObject({ status: 503, message: expect.stringContaining('api.example') });
  });

  it('rejects bodies over the byte limit, declared or streamed', async () => {
    const declared = respond('[]', { headers: { 'content-length': '999' } });
    await expect(fetchJson('https://api.example/x', { ...LIMITS, fetch: declared })).rejects.toThrow(UpstreamError);
    const streamed = respond(streamOf('["', 'x'.repeat(40), 'y'.repeat(40), '"]'));
    await expect(fetchJson('https://api.example/x', { ...LIMITS, fetch: streamed })).rejects.toThrow(/64/);
  });

  it('wraps invalid JSON, network failures and timeouts in UpstreamError', async () => {
    await expect(fetchJson('https://api.example/x', { ...LIMITS, fetch: respond('<html>') })).rejects.toThrow(
      /不是 JSON/,
    );
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(fetchJson('https://api.example/x', { ...LIMITS, fetch: offline })).rejects.toThrow(/fetch failed/);
    const hang = vi.fn<typeof fetch>(
      (_url, init) => new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason))),
    );
    await expect(fetchJson('https://api.example/x', { ...LIMITS, timeoutMs: 10, fetch: hang })).rejects.toThrow(/超时/);
  });
});

const TLS_HANDSHAKE = 22;
// 任何 IPv4 路径都必须接受的最小 MSS（RFC 879）：ClientHello 小于它就一定只占一个 TCP 分段
const MIN_IPV4_MSS = 536;

/** 本地 TCP 服务：只读客户端发来的第一个 TLS 记录头，拿到 ClientHello 的长度就断开 */
async function helloSink() {
  let resolveLength!: (length: number) => void;
  const length = new Promise<number>((resolve) => (resolveLength = resolve));
  const server = createServer((socket) => {
    socket.once('data', (chunk: Buffer) => {
      // 记录头：类型 1 字节、版本 2 字节、长度 2 字节
      resolveLength(chunk.length >= 5 && chunk[0] === TLS_HANDSHAKE ? chunk.readUInt16BE(3) : -1);
      socket.destroy();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, length, close: () => server.close() };
}

describe('outbound TLS', () => {
  it('sends a ClientHello that fits in a single TCP segment', async () => {
    // 默认的后量子混合密钥交换让 ClientHello 超过 1.5 KB、拆成两个分段，
    // 有些网络路径会丢掉后一段，握手一直挂到超时
    const sink = await helloSink();
    try {
      const request = fetchJson(`https://127.0.0.1:${sink.port}/`, { timeoutMs: 2000, maxBytes: 64 });
      const length = await sink.length;
      await request.catch(() => undefined); // 服务端断开，请求本身必然失败
      expect(length).toBeGreaterThan(0);
      expect(length).toBeLessThan(MIN_IPV4_MSS);
    } finally {
      sink.close();
    }
  });
});
