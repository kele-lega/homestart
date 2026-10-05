import { jsonHeaders } from '../../lib/widget-api';

/**
 * 点开网站时记一笔，下次首页的常用网站按它排。页面上带 data-visit 的链接都算：常用网站的格子、分类导航、
 * 搜索里选中的网站。只有登录了（页面上有 [data-link-visits]）才记。
 * 链接都在新标签页打开，当前页不变，格子也不跟着重排——刷新或下次打开首页才按新的顺序；
 * keepalive 保证当前页恰好被关掉、换走时请求照样发出去。记不上不影响打开网站，不提示
 */

export const VISIT_ENDPOINT = '/api/links/visit';

function report(event: MouseEvent): void {
  // 左键和中键（中键在新标签页打开，触发的是 auxclick）
  if (event.button !== 0 && event.button !== 1) return;
  const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-visit]') : null;
  if (!link) return;
  fetch(VISIT_ENDPOINT, {
    method: 'POST',
    headers: jsonHeaders('POST'),
    body: JSON.stringify({ url: link.href }),
    keepalive: true,
  }).catch(() => {
    // 断网之类：这次点击不算，下次照常记
  });
}

if (document.querySelector('[data-link-visits]')) {
  document.addEventListener('click', report);
  document.addEventListener('auxclick', report);
}
