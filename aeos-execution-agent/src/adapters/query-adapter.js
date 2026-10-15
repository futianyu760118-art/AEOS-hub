// 通用 HTTP 只读查询适配器：鉴权方式、端点白名单、响应映射全部可配置。
// 接入新系统 = 用本适配器 + 自己系统的 auth/endpoints/unwrap；不改 agent-core、不改本文件。
import { createHmac } from 'node:crypto';

function errorWithCode(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// config: {
//   baseUrl: string,
//   endpoints: Record<path, endpointCode | true>,   // 只放行表内的 path
//   auth: { type:'hmac', appKey, appSecret }         // HMAC-SHA256（timestamp+key+endpointCode+queryString）
//       | { type:'bearer', token }                    // 静态 Bearer Token
//       | { type:'none' }                             // 无鉴权
//       | { headers: (path, endpointCode, queryString) => headers }  // 自定义鉴权头
//   unwrap?: (body) => data,                          // 响应映射；默认原样返回
// }
export function createHttpQueryAdapter(config) {
  const baseUrl = (config.baseUrl || '').replace(/\/$/, '');
  const endpoints = config.endpoints || {};
  const auth = config.auth || {};
  const unwrap = config.unwrap || ((body) => body);

  function authHeaders(path, endpointCode, queryString) {
    if (typeof auth.headers === 'function') return auth.headers(path, endpointCode, queryString);
    if (auth.type === 'bearer') return { authorization: `Bearer ${auth.token}` };
    if (auth.type === 'hmac') {
      const appKey = auth.appKey || '';
      const appSecret = auth.appSecret || '';
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac('sha256', appSecret).update(`${timestamp}${appKey}${endpointCode}${queryString}`, 'utf8').digest('hex');
      return { 'X-App-Key': appKey, 'X-Timestamp': timestamp, 'X-Signature': signature };
    }
    return {};
  }

  return async function query(request, abortSignal) {
    const path = typeof request.path === 'string' ? request.path : '';
    const params = request.params && typeof request.params === 'object' ? request.params : {};
    if (!path) throw errorWithCode('INVALID_ARGUMENT', '查询输入缺少 path');
    if (!Object.prototype.hasOwnProperty.call(endpoints, path)) {
      throw errorWithCode('FORBIDDEN', `不在白名单内的查询 path: ${path}`);
    }
    const endpointCode = endpoints[path] === true ? path : String(endpoints[path] ?? '');
    const queryString = new URLSearchParams(
      Object.entries(params)
        .filter(([, value]) => value !== '' && value !== null && value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    ).toString();
    const url = `${baseUrl}${path}${queryString ? `?${queryString}` : ''}`;
    const response = await fetch(url, { headers: authHeaders(path, endpointCode, queryString), signal: abortSignal });
    if (response.status === 200) {
      return unwrap(await response.json());
    }
    throw errorWithCode(response.status >= 500 ? 'UPSTREAM_UNAVAILABLE' : 'UPSTREAM_ERROR', `上游返回 HTTP ${response.status}`);
  };
}
