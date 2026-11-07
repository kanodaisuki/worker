/** 图集：CDN 目录与图片文件名清单（由 refactor-php 的 $image_info 提取） */
export interface AlbumInfo {
  /** CDN 目录，如 "/yuri/"，以 / 开头和结尾 */
  cdnDir: string;
  /** 图片文件名清单 */
  images: string[];
}

/** 单个入口的完整配置（由 refactor-php 的 $user_config / $cdn_list / $image_info 提取） */
export interface Profile {
  /** 输出模式："cdn" 302 重定向到 CDN；"pass" 代理回源输出图片二进制 */
  output: "cdn" | "pass";
  /** 选用的 CDN 条目名（cdnList 的键） */
  cdnChoose: string;
  /** 默认图集 */
  defaultAlbum: string;
  /** 移动端默认图集 */
  mobileDefaultAlbum: string;
  /** 是否启用按 Referer 分流 CDN */
  diffDomain: boolean;
  /** Referer 分流白名单（与 Referer 主机名精确匹配） */
  refererList: string[];
  /** pass 模式图片源，固定指向 p.kksk.ltd 图源 */
  passOrigin: string;
  /** CDN 条目表：名称 -> URL 前缀 */
  cdnList: Record<string, string>;
  /** 图集表：名称 -> 图集 */
  albums: Record<string, AlbumInfo>;
}

/** 入口名（REFACTOR-PLAN §5.4 路径映射） */
export type ProfileName = "api" | "kano";

export type Profiles = Record<ProfileName, Profile>;
