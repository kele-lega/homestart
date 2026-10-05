import { fetchMe, logout } from '../../lib/auth-api';

/**
 * 页头工具栏的头像：面板的开合全靠 CSS（悬停、键盘聚焦），这里只补三件事。
 * - 浏览器按「后退」从往返缓存（bfcache）里恢复页面时不会重新请求，登出后退回首页可能还挂着旧的头像：恢复时问一次登录状态，对不上就刷新
 * - 面板开着时按 Esc 先收起来（data-dismissed），指针离开、焦点走开以后恢复
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

if (account) {
  const restore = () => delete account.dataset.dismissed;
  account.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || account.dataset.dismissed !== undefined) return;
    event.preventDefault();
    account.dataset.dismissed = '';
    // 焦点留在面板里会让它马上又展开：挪回头像上
    account.querySelector<HTMLElement>('.avatar')?.focus();
  });
  account.addEventListener('pointerleave', restore);
  account.addEventListener('focusout', (event) => {
    if (!(event.relatedTarget instanceof Node && account.contains(event.relatedTarget))) restore();
  });

  const signOut = account.querySelector<HTMLButtonElement>('[data-sign-out]');
  const label = account.querySelector<HTMLElement>('[data-sign-out-label]');
  signOut?.addEventListener('click', async () => {
    signOut.disabled = true;
    if (label) label.textContent = '正在退出…';
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
    if (label) label.textContent = '没能退出，再试一次';
  });
}
