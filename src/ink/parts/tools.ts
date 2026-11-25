import { fetchMe, logout } from '../../lib/auth-api';

/**
 * 顶上工具的两件小事（popover 的开合是浏览器自己的）：
 * - 从往返缓存（bfcache）里恢复页面时问一次登录状态，和渲染时的账号对不上就刷新（登出后按「后退」不会还挂着旧账号）
 * - 「退出登录」：调登出接口，成功后替换掉当前这条历史回到首页
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

const signOut = document.querySelector<HTMLButtonElement>('[data-sign-out]');
signOut?.addEventListener('click', async () => {
  signOut.disabled = true;
  signOut.textContent = '正在退出…';
  try {
    const result = await logout();
    if (result.success) {
      location.replace('/');
      return;
    }
  } catch {
    // 落到下面的提示
  }
  signOut.disabled = false;
  signOut.textContent = '没能退出，再试一次';
});
