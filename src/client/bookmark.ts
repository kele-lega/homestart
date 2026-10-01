import { fetchMe } from '../lib/auth-api';

/**
 * 书签由服务端按登录状态渲染。浏览器按「后退」从往返缓存（bfcache）里恢复页面时不会重新请求，
 * 登出后退回首页可能还挂着旧的名章：恢复时问一次登录状态，对不上就刷新
 */
addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  const rendered = document.querySelector<HTMLElement>('.bookmark')?.dataset.user ?? '';
  void fetchMe()
    .then((result) => {
      if ((result.data?.username ?? '') !== rendered) location.reload();
    })
    .catch(() => undefined);
});
