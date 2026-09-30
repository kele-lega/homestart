/**
 * 浏览器端调用 Widget 操作接口（/api/widgets/<id>/<action>）的唯一入口：读数据用 fetchAction（GET），改设置用 sendAction。
 * 服务端校验请求时也用这里的请求头约定，所以这个模块不能引用服务端代码。
 */

/**
 * 同源脚本请求带上的自定义头。接口不返回任何 CORS 头，其它站点的页面加不上它
 * （自定义头会触发预检，而预检一定失败），服务端据此在浏览器没带 Sec-Fetch-Site 时识别同源请求。
 */
export const CLIENT_HEADER = 'x-home-client';
export const CLIENT_HEADER_VALUE = '1';

type Query = Readonly<Record<string, string>>;

export function actionUrl(id: string, action: string, query: Query = {}): string {
  const path = `/api/widgets/${encodeURIComponent(id)}/${encodeURIComponent(action)}`;
  const search = new URLSearchParams(query).toString();
  return search ? `${path}?${search}` : path;
}

/** 返回解析后的响应体（{ success, data, error }）；网络错误、非 JSON 响应与取消照常抛出 */
export async function fetchAction(id: string, action: string, query: Query, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(actionUrl(id, action, query), {
    headers: { [CLIENT_HEADER]: CLIENT_HEADER_VALUE },
    signal,
  });
  return response.json();
}

export interface SendOptions {
  readonly method: 'POST' | 'PUT' | 'DELETE';
  /** JSON 请求体；不传就不带请求体 */
  readonly body?: unknown;
}

/** 修改数据的操作（保存、删除设置等）。返回值与出错方式同 fetchAction */
export async function sendAction(id: string, action: string, { method, body }: SendOptions, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(actionUrl(id, action), {
    method,
    headers: {
      [CLIENT_HEADER]: CLIENT_HEADER_VALUE,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  return response.json();
}
