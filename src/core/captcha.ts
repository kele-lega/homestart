import { randomInt, randomUUID } from 'node:crypto';
import { captchaSvg } from './captcha-image';

/**
 * 图片验证码：答案只留在服务端内存里（单实例部署），浏览器拿到的是 id 和一张图。
 * 每一题绑定领题的人、几分钟后过期、只能答一次（答错也作废），换个 id 重放、拿别人的题都不行
 */

export const CAPTCHA_LENGTH = 4;
export const CAPTCHA_TTL_MS = 5 * 60_000;

export interface CaptchaChallenge {
  readonly id: string;
  /** data:image/svg+xml，直接放进 <img src> */
  readonly image: string;
}

export type CaptchaVerdict = 'ok' | 'wrong' | 'missing';

export interface CaptchaStore {
  issue(owner: string): CaptchaChallenge;
  /** 不管答对答错，这一题都作废 */
  verify(owner: string, id: string, answer: string): CaptchaVerdict;
}

export interface CaptchaDeps {
  /** 单调时钟；测试时注入 */
  readonly now?: () => number;
  readonly newId?: () => string;
  readonly newCode?: () => string;
  /** 最多同时留多少道没答的题，超出时丢掉最早的 */
  readonly maxEntries?: number;
}

function randomCode(): string {
  return Array.from({ length: CAPTCHA_LENGTH }, () => String(randomInt(10))).join('');
}

/** 全角数字、首尾空白都认：输入法开着也能答对 */
export function normalizeAnswer(answer: string): string {
  return answer.trim().replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

export function createCaptchaStore({
  now = () => performance.now(),
  newId = randomUUID,
  newCode = randomCode,
  maxEntries = 2000,
}: CaptchaDeps = {}): CaptchaStore {
  const entries = new Map<string, { readonly owner: string; readonly code: string; readonly expires: number }>();

  function sweep(time: number): void {
    for (const [id, entry] of entries) if (entry.expires <= time) entries.delete(id);
  }

  return {
    issue(owner) {
      const time = now();
      sweep(time);
      const id = newId();
      const code = newCode();
      entries.set(id, { owner, code, expires: time + CAPTCHA_TTL_MS });
      if (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
      return { id, image: `data:image/svg+xml;base64,${Buffer.from(captchaSvg(code)).toString('base64')}` };
    },
    verify(owner, id, answer) {
      const entry = entries.get(id);
      entries.delete(id);
      if (!entry || entry.owner !== owner || entry.expires <= now()) return 'missing';
      return normalizeAnswer(answer) === entry.code ? 'ok' : 'wrong';
    },
  };
}
