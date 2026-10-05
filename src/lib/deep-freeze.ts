/** 递归冻结并返回同一个引用。用于跨请求共享的只读数据，防止某次渲染悄悄改掉它 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
