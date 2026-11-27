import { fetchMe } from '../../lib/auth-api';

/**
 * 从往返缓存（bfcache）里恢复页面时问一次登录状态，和渲染时的账号对不上就刷新
 * （在个人中心登出后按「后退」，顶上不会还挂着旧账号的字）
 */
const account = document.querySelector<HTMLElement>('[data-account]');

addEventListener('pageshow', (event) => {
  if (!event.persisted || !account) return;
  const rendered = account.dataset.user ?? '';
  void fetchMe()
    .then((result) => {
      if ((result.data?.username ?? '') !== rendered) location.reload();
    })
    .catch(() => undefined);
});
