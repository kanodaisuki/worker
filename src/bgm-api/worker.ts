/**
 * Bangumi API 反向代理：把任意路径透明转发到 https://api.bgm.tv，
 * 并附加 CORS 白名单、User-Agent 与边缘缓存，用于信息检索。
 * JSON 成功响应里的图片地址（lain.bgm.tv）会被改写为图片反向代理地址。
 * 附带链路自检（GET /health 与 Cron）与图片主机哨兵，用于检测上游图片主机变化等故障。
 */

/** Worker 环境变量（wrangler.toml 的 [vars]） */
interface Env {
  /** CORS 白名单，逗号分隔；未设置时回退到 DEFAULT_ALLOWED_ORIGINS */
  CORS_ALLOWED_ORIGINS?: string;
  /** 图片反向代理源站，置空字符串禁用改写；未设置时回退到 DEFAULT_IMAGE_PROXY_ORIGIN */
  IMAGE_PROXY_ORIGIN?: string;
}

const UPSTREAM_ORIGIN = "https://api.bgm.tv";

// Bangumi API Fair Use 要求可识别的 User-Agent，请替换为你的项目名和联系方式
const USER_AGENT = "bgm-api-proxy/1.0 (https://github.com/kanodaisuki/worker)";

// CORS 白名单：只允许这些来源跨域访问
// 也可用 wrangler.toml 的 [vars].CORS_ALLOWED_ORIGINS 覆盖（逗号分隔，优先级更高）
// localhost / 127.0.0.1 / [::1] 的本地调试来源（端口不限）始终放行，不受白名单与覆盖影响
const DEFAULT_ALLOWED_ORIGINS = ["https://kanochan.net", "https://kanochan.com"];

// 图片反向代理源站（如 https://bgm-img.kanochan.net），响应体里的图片地址会改写为该地址
// 也可用 wrangler.toml 的 [vars].IMAGE_PROXY_ORIGIN 覆盖，置空字符串禁用改写
const DEFAULT_IMAGE_PROXY_ORIGIN = "https://bgm-img.kanochan.net";

// 图片主机：只改写该主机的地址（bgm.tv 是条目网页地址，不是图片，不改写）
// 同时覆盖 http://、https:// 与协议相对 // 三种形式；主机后须为路径/查询/结尾，防 lain.bgm.tv.evil.com 误伤
const IMAGE_URL_PATTERN = /(?:https?:)?\/\/lain\.bgm\.tv(?=[/?#]|$)/g;

// 与 IMAGE_URL_PATTERN 同边界，锚定字符串开头；不带 g，避免 test() 的 lastIndex 状态
const IMAGE_URL_PREFIX = /^(?:https?:)?\/\/lain\.bgm\.tv(?=[/?#]|$)/;

// URL 形态的字符串（含协议相对）
const URL_LIKE = /^(?:https?:)?\/\//;

// 图片字段：这些字段的值（含 images 对象的每个值）是图片地址，主机不在改写规则内时告警
const IMAGE_FIELDS = new Set(["image", "avatar"]);

// 链路自检的上游样本条目（稳定、长期存在）
const HEALTH_SUBJECT_ID = "2585";

const DEFAULT_CACHE_TTL = 300;
const SEARCH_PATH = "/v0/search/subjects";

// 上游响应自带的 CORS 头：api.bgm.tv 与 lain.bgm.tv 都会下发 Access-Control-Allow-Origin: *，
// 透传会绕过白名单（白名单外的来源也能读到响应），进缓存与出站前必须清除，再由 applyCors 按白名单重建
const UPSTREAM_CORS_HEADERS = [
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "access-control-expose-headers",
  "access-control-max-age",
];

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
          examples: [
            "POST /v0/search/subjects",
            "GET /v0/subjects/2585",
            "GET /calendar",
            "GET /health",
          ],
        },
        request,
        env,
      );
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return healthResponse(env, request);
    }

    try {
      return await proxy(request, env, ctx);
    } catch (err) {
      return json(502, { error: "bad_gateway", message: String(err) }, request, env);
    }
  },

  // Cron 定时链路自检（wrangler.toml 的 [triggers]），结果只记日志，由 Workers Issues 告警
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    logHealth(await healthCheck(env));
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
    response = await fromUpstream(upstreamResponse, imageProxyOrigin(env), url.pathname);
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

// 构造返回给客户端的响应：JSON 成功响应改写图片地址，其余压缩流原样透传
async function fromUpstream(
  upstreamResponse: Response,
  proxyOrigin: string,
  path: string,
): Promise<Response> {
  const contentType = upstreamResponse.headers.get("content-type") || "";
  const rewriteable =
    proxyOrigin !== "" &&
    upstreamResponse.status === 200 &&
    upstreamResponse.body !== null &&
    contentType.includes("json");
  if (!rewriteable) {
    const passthrough = new Response(upstreamResponse.body, upstreamResponse);
    stripUpstreamCors(passthrough.headers);
    return passthrough;
  }

  // 读取正文会触发 runtime 解压，改写后必须删除过期的编码/长度头（平台会自动重新压缩）
  const { text, unknownHosts } = rewriteImageUrls(await upstreamResponse.text(), proxyOrigin);
  // 层1 哨兵：图片字段出现改写规则外的主机（上游图片主机可能已变化），每响应一条结构化告警
  if (unknownHosts.length > 0) {
    console.error(
      JSON.stringify({
        event: "image_host_unrecognized",
        path,
        hosts: [...new Set(unknownHosts.map((u) => u.host))],
        field: unknownHosts[0]?.field,
        sample: unknownHosts[0]?.sample,
      }),
    );
  }
  const out = new Response(text, upstreamResponse);
  out.headers.delete("content-encoding");
  out.headers.delete("content-length");
  stripUpstreamCors(out.headers);
  return out;
}

/** 图片字段中的地址引用（images.<尺寸>、image、avatar） */
interface ImageUrlRef {
  field: string;
  url: string;
}

/** 图片字段中未被改写规则识别的地址 */
interface UnknownImageHost {
  field: string;
  host: string;
  sample: string;
}

/** 改写结果：改写后的正文与未识别的图片主机 */
interface RewriteOutcome {
  text: string;
  unknownHosts: UnknownImageHost[];
}

// JSON 解析 → 逐个字符串值改写 → 重新序列化。
// 解析会还原上游的 \/ 转义，因此无需关心上游的转义形式；非法 JSON 原样返回
function rewriteImageUrls(text: string, proxyOrigin: string): RewriteOutcome {
  try {
    const parsed: unknown = JSON.parse(text);
    return {
      text: JSON.stringify(replaceStrings(parsed, proxyOrigin)),
      unknownHosts: unrecognizedImageHosts(parsed),
    };
  } catch {
    return { text, unknownHosts: [] };
  }
}

function replaceStrings(value: unknown, proxyOrigin: string): unknown {
  if (typeof value === "string") return value.replace(IMAGE_URL_PATTERN, proxyOrigin);
  if (Array.isArray(value)) return value.map((item) => replaceStrings(item, proxyOrigin));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        replaceStrings(item, proxyOrigin),
      ]),
    );
  }
  return value;
}

// 递归收集图片字段里的地址：images 对象的每个值，以及 image / avatar 字段
function collectImageUrls(value: unknown, key = ""): ImageUrlRef[] {
  const out: ImageUrlRef[] = [];
  if (typeof value === "string") {
    if (IMAGE_FIELDS.has(key) && URL_LIKE.test(value)) out.push({ field: key, url: value });
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) out.push(...collectImageUrls(item, key));
    return out;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "images" && v !== null && typeof v === "object" && !Array.isArray(v)) {
        for (const [size, u] of Object.entries(v as Record<string, unknown>)) {
          if (typeof u === "string" && URL_LIKE.test(u)) {
            out.push({ field: `images.${size}`, url: u });
          }
        }
        continue;
      }
      out.push(...collectImageUrls(v, k));
    }
  }
  return out;
}

function unrecognizedImageHosts(parsed: unknown): UnknownImageHost[] {
  const out: UnknownImageHost[] = [];
  for (const { field, url } of collectImageUrls(parsed)) {
    if (!IMAGE_URL_PREFIX.test(url)) out.push({ field, host: imageUrlHost(url), sample: url });
  }
  return out;
}

function imageUrlHost(url: string): string {
  return /(?:https?:)?\/\/([^/?#]+)/.exec(url)?.[1] ?? "";
}

function imageProxyOrigin(env: Env): string {
  const raw =
    env && env.IMAGE_PROXY_ORIGIN !== undefined
      ? env.IMAGE_PROXY_ORIGIN
      : DEFAULT_IMAGE_PROXY_ORIGIN;
  return raw.trim().replace(/\/+$/, "");
}

/** 链路自检结果 */
interface HealthCheckResult {
  ok: boolean;
  /** 失败的检查项；空数组 = 全链路正常 */
  failed: string[];
  checks: Record<string, unknown>;
}

// 层2 链路自检：上游样本 → 图片主机规则 → 改写结果 → 经 bgm-img 实取图片
async function healthCheck(env: Env): Promise<HealthCheckResult> {
  const failed: string[] = [];
  const checks: Record<string, unknown> = {};
  const result = (): HealthCheckResult => ({ ok: failed.length === 0, failed, checks });

  // 1. 上游条目样本（直连，不经缓存与改写）
  let text = "";
  try {
    const res = await fetch(`${UPSTREAM_ORIGIN}/v0/subjects/${HEALTH_SUBJECT_ID}`, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        "Accept-Encoding": "gzip",
      },
    });
    checks.upstream = res.status;
    if (res.status === 200) text = await res.text();
  } catch (err) {
    checks.upstream = String(err);
  }
  if (!text) {
    failed.push("upstream");
    return result();
  }

  // 2. 图片地址规则：样本必须有图片字段，且主机都在改写规则内
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    failed.push("upstream_body");
    return result();
  }
  const imageUrls = collectImageUrls(parsed);
  checks.image_count = imageUrls.length;
  if (imageUrls.length === 0) {
    failed.push("image_field_missing");
    return result();
  }
  const unknown = unrecognizedImageHosts(parsed);
  if (unknown.length > 0) {
    checks.image_host_unknown = unknown[0];
    failed.push("image_host");
    return result();
  }

  // 改写禁用（IMAGE_PROXY_ORIGIN 为空）时跳过后续检查
  const proxyOrigin = imageProxyOrigin(env);
  if (proxyOrigin === "") {
    checks.rewrite = "disabled";
    return result();
  }

  // 3. 改写结果：首个图片地址应改写为代理地址
  const rewritten = imageUrls[0]?.url.replace(IMAGE_URL_PATTERN, proxyOrigin) ?? "";
  checks.rewrite_sample = rewritten;
  if (!rewritten.startsWith(proxyOrigin)) {
    failed.push("rewrite");
    return result();
  }

  // 4. 经 bgm-img 实取图片
  try {
    const img = await fetch(rewritten, { method: "HEAD" });
    const type = img.headers.get("content-type") || "";
    checks.image_fetch = `${img.status} ${type}`.trim();
    if (img.status !== 200 || !type.startsWith("image/")) failed.push("image_fetch");
  } catch (err) {
    checks.image_fetch = String(err);
    failed.push("image_fetch");
  }
  return result();
}

// 自检结果记入 Workers Logs（成功 console.log；失败 console.error → Workers Issues → Automation 告警）
function logHealth(result: HealthCheckResult): void {
  const entry = JSON.stringify({ event: "health_check", ...result });
  if (result.ok) console.log(entry);
  else console.error(entry);
}

async function healthResponse(env: Env, request: Request): Promise<Response> {
  const result = await healthCheck(env);
  logHealth(result);
  const res = json(result.ok ? 200 : 503, result, request, env);
  res.headers.set("Cache-Control", "no-store");
  return res;
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
  // 只给白名单内（或本地 localhost 调试来源）回显具体的 Origin，其余请求不带该头，由浏览器拦截
  if (origin && isAllowedOrigin(origin, env)) {
    headers["Access-Control-Allow-Origin"] = normalizeOrigin(origin);
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

// 本地调试来源：localhost / 127.0.0.1 / [::1]，端口不限，方便前端本地联调
function isLocalOrigin(value: string): boolean {
  let host: string;
  try {
    host = new URL(value).hostname;
  } catch {
    return false;
  }
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

// 白名单内的来源，或本地调试来源（不做端口限制）
function isAllowedOrigin(origin: string, env: Env): boolean {
  return allowedOrigins(env).includes(normalizeOrigin(origin)) || isLocalOrigin(origin);
}

function json(status: number, body: unknown, request: Request, env: Env): Response {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
  applyCors(headers, request, env);
  return new Response(JSON.stringify(body, null, 2), { status, headers });
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
