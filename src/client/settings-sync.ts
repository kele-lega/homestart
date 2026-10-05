import { SETTINGS_CHANGED_FLAG } from '../lib/settings-api';

/**
 * 首页按偏好在服务端渲染。在设置页改完按「后退」，浏览器可能从往返缓存（bfcache）里拿出改之前的首页：
 * 设置页存过东西会留一个标记，首页从缓存恢复时看到它就刷新。正常加载的首页已经是新的，顺手清掉标记
 */
function takeFlag(): boolean {
  try {
    const changed = sessionStorage.getItem(SETTINGS_CHANGED_FLAG) !== null;
    sessionStorage.removeItem(SETTINGS_CHANGED_FLAG);
    return changed;
  } catch {
    return false;
  }
}

addEventListener('pageshow', (event) => {
  if (takeFlag() && event.persisted) location.reload();
});
