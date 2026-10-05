import type { APIRoute } from 'astro';
import { markSuggestion, removeSuggestion } from '../../../adapters/suggestions';
import { fail, json, ok, readJsonBody } from '../../../core/api';
import { SUGGESTION_ID, SuggestionPatch } from '../../../core/suggestions';
import { rejectSuggestionManage, suggestionStoreFailed } from '../../../core/suggestions-api';

/** PATCH { done }：管理员把一条标成已处理 / 未处理；DELETE：删掉一条。已经不在了也照常返回改完后的整个列表 */

export const PATCH: APIRoute = async (context) => {
  const rejected = rejectSuggestionManage(context);
  if (rejected) return rejected;
  const id = context.params.id ?? '';
  if (!SUGGESTION_ID.test(id)) return json(404, fail('没有这条建议'));
  const read = await readJsonBody(context.request);
  if (!read.ok) return json(read.status, fail(read.message));
  const parsed = SuggestionPatch.safeParse(read.value);
  if (!parsed.success) return json(400, fail('缺少 done'));
  try {
    return json(200, ok(await markSuggestion(id, parsed.data.done)));
  } catch (error) {
    return suggestionStoreFailed(context.logger, error);
  }
};

export const DELETE: APIRoute = async (context) => {
  const rejected = rejectSuggestionManage(context);
  if (rejected) return rejected;
  const id = context.params.id ?? '';
  if (!SUGGESTION_ID.test(id)) return json(404, fail('没有这条建议'));
  try {
    return json(200, ok(await removeSuggestion(id)));
  } catch (error) {
    return suggestionStoreFailed(context.logger, error);
  }
};
