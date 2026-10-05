import type { APIRoute } from 'astro';
import { siteCounts, subscribeCounts } from '../../../adapters/site-stats';
import { fail, isCrossSite, json } from '../../../core/api';
import type { SiteCounts } from '../../../lib/site-stats';

/**
 * GET /api/site/stream：首页「本站」的计数实时推送（Server-Sent Events）。连上先发一次当前计数，
 * 之后谁点开网站、搜索一次，几百毫秒内推到每个开着的页面；每 25 秒一行注释保活，反代不会当成空闲断开。
 * 连接数有上限，超出时 503，页面退回轮询。和 /api/site/stats 一样所有人都能连，只拦跨站
 */

const MAX_STREAMS = 500;
const KEEPALIVE_MS = 25_000;
/** 断线后浏览器隔多久重连 */
const RETRY_MS = 3_000;

let open = 0;

const encoder = new TextEncoder();
const event = (counts: SiteCounts) => encoder.encode(`data: ${JSON.stringify(counts)}\n\n`);

export const GET: APIRoute = async ({ request }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  if (open >= MAX_STREAMS) return json(503, fail('连接太多，请稍后再试'));
  open += 1;

  let cleanup = () => {};
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          cleanup();
        }
      };
      const unsubscribe = subscribeCounts((counts) => send(event(counts)));
      const keepalive = setInterval(() => send(encoder.encode(': ping\n\n')), KEEPALIVE_MS);
      cleanup = () => {
        if (closed) return;
        closed = true;
        open -= 1;
        unsubscribe();
        clearInterval(keepalive);
        request.signal.removeEventListener('abort', cleanup);
      };
      // 浏览器关掉页面、断网：适配器在连接断开时中止 request.signal，也会取消读这条流
      request.signal.addEventListener('abort', cleanup, { once: true });
      if (request.signal.aborted) {
        cleanup();
        return;
      }
      send(encoder.encode(`retry: ${RETRY_MS}\n\n`));
      send(event(await siteCounts().catch(() => ({ nav: 0, search: 0 }))));
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      // 反代（nginx 一类）不要攒着，来一条转一条；Caddy 对 text/event-stream 本来就立即转发
      'x-accel-buffering': 'no',
    },
  });
};
