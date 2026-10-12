/**
 * Bangumi API 反向代理：把任意路径透明转发到 https://api.bgm.tv，
 * 并附加 CORS 白名单、User-Agent 与边缘缓存，用于信息检索。
 */

/** Worker 环境变量（wrangler.toml 的 [vars]） */
interface Env {
  /** CORS 白名单，逗号分隔；未设置时回退到 DEFAULT_ALLOWED_ORIGINS */
  CORS_ALLOWED_ORIGINS?: string;
}

const UPSTREAM_ORIGIN = "https://api.bgm.tv";

// Bangumi API Fair Use 要求可识别的 User-Agent，请替换为你的项目名和联系方式
const USER_AGENT = "bgm-api-proxy/1.0 (https://github.com/kanodaisuki/worker)";

// CORS 白名单：只允许这些来源跨域访问
// 也可用 wrangler.toml 的 [vars].CORS_ALLOWED_ORIGINS 覆盖（逗号分隔，优先级更高）
const DEFAULT_ALLOWED_ORIGINS = ["https://kanochan.net", "https://kanochan.com"];

const DEFAULT_CACHE_TTL = 300;
const SEARCH_PATH = "/v0/search/subjects";

// 转发时丢弃的逐跳/平台注入头
const STRIPPED_HEADERS = [
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "cdn-loop",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-real-ip",
];

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return json(
        200,
        {
          name: "Bangumi API proxy",
          upstream: UPSTREAM_ORIGIN,
          docs: "https://bangumi.github.io/api/",
          examples: ["POST /v0/search/subjects", "GET /v0/subjects/2585", "GET /calendar"],
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
  const upstreamUrl = UPSTREAM_ORIGIN + url.pathname + url.search;

  const headers = new Headers(request.headers);
  for (const name of STRIPPED_HEADERS) headers.delete(name);
  headers.set("User-Agent", USER_AGENT);
  // 固定压缩算法，保证缓存里的响应表示对所有客户端一致
  headers.set("Accept-Encoding", "gzip");
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  const init: RequestInit = { method: request.method, headers };
  let body: ArrayBuffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.arrayBuffer();
    init.body = body;
  }

  const cacheKey = await buildCacheKey(upstreamUrl, request.method, body);
  const cache = caches.default;

  let response = cacheKey ? await cache.match(cacheKey) : null;
  if (response) {
    response = new Response(response.body, response);
    response.headers.set("X-Cache", "HIT");
  } else {
    const upstreamResponse = await fetch(upstreamUrl, init);
    response = new Response(upstreamResponse.body, upstreamResponse);
    response.headers.set("X-Cache", "MISS");

    const ttl = cacheTtl(url.pathname);
    if (cacheKey && upstreamResponse.status === 200 && ttl > 0) {
      response.headers.set("Cache-Control", `public, max-age=${ttl}`);
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }
  }

  applyCors(response.headers, request, env);
  return response;
}

// GET 直接按 URL 缓存；搜索接口是 POST，按 URL + 请求体哈希缓存
async function buildCacheKey(
  upstreamUrl: string,
  method: string,
  body?: ArrayBuffer,
): Promise<Request | null> {
  if (method === "GET" || method === "HEAD") {
    return new Request(upstreamUrl, { method: "GET" });
  }
  if (method === "POST" && new URL(upstreamUrl).pathname === SEARCH_PATH && body) {
    const digest = await crypto.subtle.digest("SHA-256", body);
    const hash = toHex(digest);
    const sep = upstreamUrl.includes("?") ? "&" : "?";
    return new Request(`${upstreamUrl}${sep}__proxy_cache=${hash}`, { method: "GET" });
  }
  return null;
}

function cacheTtl(pathname: string): number {
  // 条目/人物/角色详情变化少，缓存久一些
  if (/^\/v0\/(subjects|persons|characters)\/\d+$/.test(pathname)) return 3600;
  return DEFAULT_CACHE_TTL;
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      request.headers.get("Access-Control-Request-Headers") || "Authorization, Content-Type",
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

function applyCors(headers: Headers, request: Request, env: Env): void {
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

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
