import { z } from 'astro/zod';
import { SUGGESTION_LIMITS, type Suggestion } from '../lib/suggestions';

/** 建议的校验（纯逻辑）：提交、标记时的输入，以及从文件里读回来的每一条 */

const { body: BODY_MAX, count: MAX_COUNT } = SUGGESTION_LIMITS;

// 换行统一成 \n，首尾空白去掉；中间的空行照留
export const SuggestionInput = z.object({
  body: z
    .string({ error: '请写下你的建议' })
    .transform((value) => value.replace(/\r\n?/g, '\n').trim())
    .pipe(z.string().min(1, '请写下你的建议').max(BODY_MAX, `建议最多 ${BODY_MAX} 个字`)),
});

export type SuggestionInput = z.infer<typeof SuggestionInput>;

/** 提交时还要带上验证码：领到的题号和看图填的答案，核对完只把 body 交给存储 */
export const SuggestionSubmit = SuggestionInput.extend({
  captchaId: z.string({ error: '请先填写验证码' }).max(64),
  captcha: z.string({ error: '请先填写验证码' }).max(16),
});

export const SuggestionPatch = z.object({ done: z.boolean({ error: '缺少 done' }) });

/** id 由服务端生成（UUID），接口路径里只认这个形状 */
export const SUGGESTION_ID = /^[0-9a-f-]{36}$/;

const Stored = z.object({
  id: z.string().regex(SUGGESTION_ID),
  body: z.string().min(1).max(BODY_MAX),
  username: z.string().max(64),
  author: z.string().max(64),
  createdAt: z.number().int().nonnegative(),
  done: z.boolean().catch(false),
});

/** 文件里的列表：读不懂的条目跳过，新的在前，最多 MAX_COUNT 条 */
export function parseSuggestions(raw: unknown): readonly Suggestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((item) => {
      const parsed = Stored.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_COUNT);
}

/** 新的一条放最前面，超出上限的旧条目挤掉 */
export function withSuggestion(list: readonly Suggestion[], item: Suggestion): readonly Suggestion[] {
  return [item, ...list.filter((existing) => existing.id !== item.id)].slice(0, MAX_COUNT);
}

export function withDone(list: readonly Suggestion[], id: string, done: boolean): readonly Suggestion[] {
  return list.map((item) => (item.id === id ? { ...item, done } : item));
}
