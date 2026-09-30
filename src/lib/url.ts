/** 显示用的站点名：https://www.bilibili.com/video → bilibili.com */
export function hostOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}
