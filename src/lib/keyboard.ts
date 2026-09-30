/** 键盘事件的公共判断 */

// Safari 结束输入法组合的那次 keydown 在 compositionend 之后触发，isComposing 为 false，只能看 keyCode 229
export function isComposing(event: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>): boolean {
  return event.isComposing || event.keyCode === 229;
}
