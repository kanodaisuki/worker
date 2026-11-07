import type { Profiles } from "./types";
import {
  buildImageUrl,
  pickImageName,
  resolveAlbum,
  resolveProfileName,
  selectCdn,
} from "./router";

/**
 * 请求处理核心（平台无关，标准 Web API）：
 * 映射表之外的路径 404；cdn 模式 302 到随机图（Cache-Control: no-store）；
 * pass 模式从 passOrigin（p.kksk.ltd 图源）代理回源输出图片二进制
 */
export async function handle(request: Request, profiles: Profiles): Promise<Response> {
  const url = new URL(request.url);
  const name = resolveProfileName(url.pathname);
  if (name === null) return text(404, "Not Found");

  try {
    const profile = profiles[name];
    const albumName = resolveAlbum(profile, url.searchParams, request.headers.get("user-agent"));
    const album = profile.albums[albumName];
    if (album === undefined) return text(500, "Invalid album config");
    const fileName = pickImageName(album);

    if (profile.output === "pass") {
      const originUrl = buildImageUrl(profile.passOrigin, album, fileName);
      try {
        const upstream = await fetch(originUrl);
        if (!upstream.ok) return text(502, "Bad Gateway");
        const headers = new Headers();
        const contentType = upstream.headers.get("content-type");
        if (contentType !== null) headers.set("content-type", contentType);
        return new Response(upstream.body, { status: 200, headers });
      } catch {
        return text(502, "Bad Gateway");
      }
    }

    const base = selectCdn(profile, request.headers.get("referer"));
    return new Response(null, {
      status: 302,
      headers: {
        location: buildImageUrl(base, album, fileName),
        "cache-control": "no-store",
      },
    });
  } catch {
    return text(500, "Internal Server Error");
  }
}

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
