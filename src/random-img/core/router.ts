import type { AlbumInfo, Profile, ProfileName } from "./types";

// 入口路径别名（REFACTOR-PLAN §5.4）：旧 PHP 部署下 refactor-php 内全部 .php 文件名均可能被直接访问
const PROFILE_PATHS: Record<string, ProfileName> = {
  "/api": "api",
  "/api.php": "api",
  "/article-cover": "api",
  "/article-cover.php": "api",
  "/kano": "kano",
  "/kano.php": "kano",
  "/kano-mobile": "kano",
  "/kano-mobile.php": "kano",
  "/kano-pc": "kano",
  "/kano-pc.php": "kano",
};

/** 与旧 PHP is_mobile 一致：UA 子串区分大小写匹配 */
const MOBILE_UA_AGENTS = [
  "iPhone",
  "iPod",
  "Android",
  "Windows Phone",
  "BlackBerry",
  "webOS",
  "Mobile",
  "Tablet",
];

/** 入口路径 -> profile 名；映射表之外的路径返回 null（404） */
export function resolveProfileName(pathname: string): ProfileName | null {
  return PROFILE_PATHS[pathname] ?? null;
}

/** 判断客户端是否是移动端 */
export function isMobile(userAgent: string | null): boolean {
  if (userAgent === null) return false;
  return MOBILE_UA_AGENTS.some((agent) => userAgent.includes(agent));
}

/**
 * 图集选择（REFACTOR-PLAN §2）：
 * type=bg 且 album 有效 -> album；type=bg 且 album 缺失/无效 -> 移动端/桌面默认图集；
 * 无 type=bg 且 album 有效 -> album；其余 -> 默认图集
 */
export function resolveAlbum(
  profile: Profile,
  params: URLSearchParams,
  userAgent: string | null,
): string {
  const album = params.get("album");
  const validAlbum = album !== null && Object.hasOwn(profile.albums, album) ? album : null;
  if (params.get("type") === "bg") {
    return validAlbum ?? (isMobile(userAgent) ? profile.mobileDefaultAlbum : profile.defaultAlbum);
  }
  return validAlbum ?? profile.defaultAlbum;
}

/** CDN 选择（REFACTOR-PLAN §2）：diffDomain 时按 Referer 主机名分流 */
export function selectCdn(profile: Profile, referer: string | null): string {
  if (!profile.diffDomain) return requireCdn(profile, profile.cdnChoose);
  if (referer === null) return requireCdn(profile, "cloudflare");
  let host: string | null = null;
  try {
    host = new URL(referer).hostname;
  } catch {
    host = null;
  }
  if (host !== null && profile.refererList.includes(host)) {
    return requireCdn(profile, profile.cdnChoose);
  }
  return requireCdn(profile, "local");
}

/** 从图集中随机取一个图片文件名 */
export function pickImageName(album: AlbumInfo): string {
  const pick = album.images[Math.floor(Math.random() * album.images.length)];
  if (pick === undefined) throw new Error("图集为空");
  return pick;
}

/** 拼接图片 URL：`{base}{cdnDir}{file}` */
export function buildImageUrl(base: string, album: AlbumInfo, fileName: string): string {
  return base + album.cdnDir + fileName;
}

function requireCdn(profile: Profile, name: string): string {
  const url = profile.cdnList[name];
  if (url === undefined) throw new Error(`cdnList 缺少 "${name}"`);
  return url;
}
