import type { APIRoute } from 'astro';
import { listSuggestions, submitSuggestion } from '../../adapters/suggestions';
import { fail, json, ok, readJsonBody } from '../../core/api';
import { formatIssues } from '../../core/config-error';
import { SuggestionSubmit } from '../../core/suggestions';
import {
  rejectSuggestionManage,
  rejectSuggestionSubmit,
  suggestionCaptcha,
  suggestionStoreFailed,
} from '../../core/suggestions-api';

/**
 * 建议：POST 站内登录的用户都能提交（不返回别人的建议），要带上验证码（./suggestions/captcha.ts 领题）；
 * GET 只有管理员能看整个列表。标记已处理、删除见 ./suggestions/[id].ts
 */

// 500 字的建议按 UTF-8 一个汉字 3 字节，再留点余量
const MAX_BODY_BYTES = 4096;

export const GET: APIRoute = async (context) => {
  const rejected = rejectSuggestionManage(context);
  if (rejected) return rejected;
  return json(200, ok(await listSuggestions()));
};

export const POST: APIRoute = async (context) => {
  const rejected = rejectSuggestionSubmit(context);
  if (rejected) return rejected;
  const read = await readJsonBody(context.request, MAX_BODY_BYTES);
  if (!read.ok) return json(read.status, fail(read.message));
  const parsed = SuggestionSubmit.safeParse(read.value);
  if (!parsed.success) return json(400, fail(formatIssues(parsed.error.issues).join('；')));

  const auth = context.locals.auth!;
  const { captchaId, captcha, ...input } = parsed.data;
  // 答错、过期、不是自己领的题都算没过；这道题已经作废，浏览器要重新领一张
  const verdict = suggestionCaptcha.verify(auth.username, captchaId, captcha);
  if (verdict !== 'ok') return json(400, fail(verdict === 'wrong' ? '验证码不对，请看新的图重新填写' : '验证码过期了，请看新的图重新填写'));
  try {
    await submitSuggestion(input, { username: auth.username, author: auth.displayName ?? auth.username });
    return json(200, ok({ submitted: true }));
  } catch (error) {
    return suggestionStoreFailed(context.logger, error);
  }
};
