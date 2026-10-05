import type { APIRoute } from 'astro';
import { MAX_PLACE_QUERY, searchPlaces } from '../../../adapters/geocoding';
import { ActionInputError } from '../../../core/widget';
import { settingsRoute } from '../../../core/settings-api';

/** GET /api/settings/places?q=坪山：天气地区的候选地点，经服务端转发，浏览器不直接连外站 */
export const GET: APIRoute = settingsRoute({
  run: async ({ context }) => {
    const query = (context.url.searchParams.get('q') ?? '').trim();
    if (query === '') throw new ActionInputError('请输入地名');
    if (query.length > MAX_PLACE_QUERY) throw new ActionInputError(`地名最多 ${MAX_PLACE_QUERY} 个字`);
    return searchPlaces(query);
  },
});
