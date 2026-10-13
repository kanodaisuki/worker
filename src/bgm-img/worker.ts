/**
 * Bangumi 图片反向代理：把任意路径透明转发到 https://lain.bgm.tv，
 * 并附加 CORS 白名单与长时边缘缓存，用于动画封面等图片的跨域加载。
 */

/** Worker 环境变量（wrangler.toml 的 [vars]） */
interface Env {
  /** CORS 白名单，逗号分隔；未设置时回退到 DEFAULT_ALLOWED_ORIGINS */
  CORS_ALLOWED_ORIGINS?: string;
}

const UPSTREAM_ORIGIN = "https://lain.bgm.tv";

// Bangumi Fair Use 要求可识别的 User-Agent，请替换为你的项目名和联系方式
const USER_AGENT = "bgm-img-proxy/1.0 (https://github.com/kanodaisuki/worker)";

// CORS 白名单：只允许这些来源跨域访问
// 也可用 wrangler.toml 的 [vars].CORS_ALLOWED_ORIGINS 覆盖（逗号分隔，优先级更高）
const DEFAULT_ALLOWED_ORIGINS = ["https://kanochan.net", "https://kanochan.com"];

// 上游响应自带的 CORS 头：lain.bgm.tv 会下发 Access-Control-Allow-Origin: *，
// 透传会绕过白名单（白名单外的来源也能读到响应），进缓存与出站前必须清除，再由 applyCors 按白名单重建
const UPSTREAM_CORS_HEADERS = [
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "access-control-expose-headers",
  "access-control-max-age",
];

// 封面图基本不变，缓存 30 天以最大化命中率
const CACHE_TTL = 2592000;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return json(405, { error: "method_not_allowed" }, request, env);
    }

    const url = new URL(request.url);
    if (url.pathname === "/") {
      return json(
        200,
        {
          name: "Bangumi image proxy",
          upstream: UPSTREAM_ORIGIN,
          examples: [
            "/r/200/pic/cover/l/5b/e2/2785_5IaII.jpg",
            "/pic/cover/l/5b/e2/2785_5IaII.jpg",
          ],
        },
        request,
        env,
      );
    }

    try {
      return await proxy(request, env, ctx);
    } catch (err) {
      return json(502, { error: "bad_gateway", message: String(err) }, request, env);
    }
  },
} satisfies ExportedHandler<Env>;

async function proxy(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  // pathname 恒以 / 开头，拼接后主机固定为 lain.bgm.tv，无法逃逸到其它源站
  const upstreamUrl = UPSTREAM_ORIGIN + url.pathname + url.search;

  // 只转发条件请求头，其余（Cookie / Accept 等）一律丢弃：
  //   - 不转发 Accept → 缓存表示不随 Accept 分桶
  //   - 不转发 Cookie → 避免泄漏与缓存旁路
  const headers = new Headers();
  for (const name of ["if-none-match", "if-modified-since"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("User-Agent", USER_AGENT);
  // 固定压缩算法，保证缓存里的响应表示对所有客户端一致
  headers.set("Accept-Encoding", "gzip");

  // GET/HEAD 共用同一缓存键（HEAD 归入 GET）
  const cacheKey = new Request(upstreamUrl, { method: "GET" });
  const cache = caches.default;
  // HEAD 请求不携带响应体
  const body = (source: Response): Response["body"] =>
    request.method === "HEAD" ? null : source.body;

  let response = await cache.match(cacheKey);
  if (response) {
    response = new Response(body(response), response);
    response.headers.set("X-Cache", "HIT");
  } else {
    const upstreamResponse = await fetch(upstreamUrl, { method: "GET", headers });
    response = new Response(body(upstreamResponse), upstreamResponse);
    stripUpstreamCors(response.headers);
    response.headers.set("X-Cache", "MISS");

    // 只缓存 200；404/304 等透传不缓存，避免瞬时故障被长期固化
    if (upstreamResponse.status === 200) {
      response.headers.set("Cache-Control", `public, max-age=${CACHE_TTL}`);
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }
  }

  applyCors(response.headers, request, env);
  return response;
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers":
      request.headers.get("Access-Control-Request-Headers") || "If-None-Match, If-Modified-Since",
    "Access-Control-Expose-Headers": "X-Cache, Cache-Control",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  const origin = request.headers.get("Origin");
  // 只给白名单内的来源回显具体的 Origin，其余请求不带该头，由浏览器拦截
  if (origin) {
    const match = allowedOrigins(env).find((o) => o === normalizeOrigin(origin));
    if (match) headers["Access-Control-Allow-Origin"] = match;
  }
  return headers;
}

function stripUpstreamCors(headers: Headers): void {
  for (const name of UPSTREAM_CORS_HEADERS) headers.delete(name);
}

function applyCors(headers: Headers, request: Request, env: Env): void {
  // 出站前先清除上游 CORS 头：历史缓存里可能残留 Access-Control-Allow-Origin: *（命中路径原样复制），
  // 不清除会让白名单外的来源读到响应，白名单形同虚设
  stripUpstreamCors(headers);
  const existingVary = headers.get("Vary");
  for (const [name, value] of Object.entries(corsHeaders(request, env))) {
    headers.set(name, value);
  }
  if (existingVary) {
    headers.set(
      "Vary",
      existingVary.toLowerCase().includes("origin") ? existingVary : `${existingVary}, Origin`,
    );
  }
}

function allowedOrigins(env: Env): string[] {
  const raw = env && env.CORS_ALLOWED_ORIGINS;
  const list = raw ? raw.split(",") : DEFAULT_ALLOWED_ORIGINS;
  return list.map(normalizeOrigin).filter(Boolean);
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function json(status: number, body: unknown, request: Request, env: Env): Response {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
  applyCors(headers, request, env);
  return new Response(JSON.stringify(body, null, 2), { status, headers });
}
