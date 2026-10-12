/**
 * 将 ImageKit 风格的 /tr:w-<width>/<path> 翻译为 Cloudflare Images 变换。
 *
 * 部署：zone `kanochan.net`，路由 `image.kanochan.net/tr:w-*`
 *
 * 前置条件：
 *   1. URL Rewrite 规则需排除 /tr: 前缀
 *      (http.host eq "image.kanochan.net") and (not (starts_with(http.request.uri.path, "/tr:")))
 *   2. 该主机上保留原有隐藏 B2 桶路径的重写规则（本 Worker 依赖它解析公开路径）
 *
 * 输出格式固定为 WebP（与 siteConfig.imageOptimization.formats 一致），
 * 因此每个（图, 宽度）只产生 1 次唯一变换，响应也不随 Accept 变化。
 */

/** 本 Worker 不使用环境变量 */
interface Env {}

/** 宽度阶梯：必须与 siteConfig.imageOptimization.imagekit.transforms 保持一致 */
const WIDTHS = [100, 320, 480, 640, 800, 1080, 1440, 1920, 2880, 3840];

/** 超出阶梯上限时落到的最大宽度 */
const MAX_WIDTH = Math.max(...WIDTHS);

/** 与之同步：siteConfig.imageOptimization.quality */
const QUALITY = 85;

/** 匹配 /tr:w-<width>/<path>，允许前缀存在 */
const TR_PATTERN = /\/tr:w-(?<width>\d+)\/(?<path>.+)$/;

/** 向上取整到最近的允许宽度，防止任意宽度造成缓存碎片与变换配额浪费 */
function snapWidth(width: number): number {
  return WIDTHS.find((w) => w >= width) ?? MAX_WIDTH;
}

/**
 * 只转发条件请求头。
 * 刻意不转发 Accept / Cookie / Authorization：
 *   - 不转发 Accept → 子请求缓存不再按 Accept 分桶（format 已固定）
 *   - 不转发 Cookie → 避免泄漏与缓存旁路
 */
function forwardHeaders(request: Request): Headers {
  const out = new Headers();
  for (const name of ["if-none-match", "if-modified-since"]) {
    const value = request.headers.get(name);
    if (value) out.set(name, value);
  }
  return out;
}

/** 从 Vary 中剔除 accept（保留其它标记），避免 ESA / 浏览器缓存碎片 */
function stripAcceptFromVary(headers: Headers): void {
  const vary = headers.get("Vary");
  if (!vary) return;
  const kept = vary
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token && token.toLowerCase() !== "accept");
  if (kept.length > 0) headers.set("Vary", kept.join(", "));
  else headers.delete("Vary");
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const groups = url.pathname.match(TR_PATTERN)?.groups;
    const widthStr = groups?.width;
    const pathStr = groups?.path;

    // 非 /tr:w-N/ 路径（路由已收窄，正常不会到达），保险透传
    if (widthStr === undefined || pathStr === undefined) return fetch(request);

    const requested = Number.parseInt(widthStr, 10);
    if (!Number.isFinite(requested) || requested < 1) {
      return new Response("Bad width", { status: 400 });
    }

    // 源站校验（阻断 //host 形式）
    const sourceUrl = new URL(`/${pathStr}`, url.origin);
    if (sourceUrl.origin !== url.origin) {
      return new Response("Bad source path", { status: 400 });
    }

    const response = await fetch(
      new Request(sourceUrl, {
        method: request.method,
        headers: forwardHeaders(request),
      }),
      {
        cf: {
          image: {
            width: snapWidth(requested),
            fit: "scale-down", // 不放大
            format: "webp",
            quality: QUALITY,
          },
        },
      },
    );

    // 变换失败 → 回退到原图公开路径（会被站内重写规则映射到 B2）
    if (!response.ok && response.status !== 304 && !response.redirected) {
      console.log(`image-transform fallback ${response.status}: ${url.pathname}`);
      return new Response(null, {
        status: 307,
        headers: {
          Location: sourceUrl.toString(),
          // 短 TTL：避免瞬时失败被长期缓存，同时吸收突发重试
          "Cache-Control": "public, max-age=60",
        },
      });
    }

    const out = new Response(response.body, response);
    stripAcceptFromVary(out.headers);
    return out;
  },
} satisfies ExportedHandler<Env>;
