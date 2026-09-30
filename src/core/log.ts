/**
 * 没有请求上下文时的服务端错误日志，例如缓存的后台刷新。有请求时用 Astro.logger；
 * 这里输出与它相同格式的一行，docker logs 里两者看起来一致。
 */

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 与 Astro 日志一致的 24 小时制 HH:MM:SS，不受系统语言影响 */
function timestamp(date: Date): string {
  return date.toTimeString().slice(0, 8);
}

export function logBackgroundError(label: string, message: string, error: unknown): void {
  // 有意的服务端错误输出，不是调试语句
  console.error(`${timestamp(new Date())} [ERROR] [${label}] ${message}：${describeError(error)}`);
}
