/**
 * 邮件验证码的输入清洗，前端输入框和服务端核对共用。
 * 用户常见的输入：全角数字（中文输入法）、复制时带上的空格或「，」、手机自动填充的「123 456」。
 * 这里只留下数字，再交给 6 位的规则判断，不让浏览器弹出「请与所请求的格式保持一致」
 */
export const CODE_LENGTH = 6;

/** 全角转半角，去掉所有非数字，最多留 CODE_LENGTH 位 */
export function cleanCode(raw: string): string {
  return raw
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/\D/g, '')
    .slice(0, CODE_LENGTH);
}

/** 绑在验证码输入框的 oninput 上：边输入边清洗，光标留在末尾 */
export function onCodeInput(event: Event): void {
  const input = event.currentTarget as HTMLInputElement;
  const cleaned = cleanCode(input.value);
  if (cleaned !== input.value) input.value = cleaned;
}
