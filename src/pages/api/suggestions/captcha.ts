import type { APIRoute } from 'astro';
import { json, ok } from '../../../core/api';
import { rejectCaptchaIssue, suggestionCaptcha } from '../../../core/suggestions-api';

/** GET：领一道提交建议用的验证码 { id, image }。每次都是新题，只有登录用户能领，按账号限流 */
export const GET: APIRoute = async (context) => {
  const rejected = rejectCaptchaIssue(context);
  if (rejected) return rejected;
  return json(200, ok(suggestionCaptcha.issue(context.locals.auth!.username)));
};
