import type { AlbumInfo, Profile, Profiles } from "./types";
import apiJson from "./profiles/api.json";
import kanoJson from "./profiles/kano.json";

/** 两个入口的配置注册表（profiles/*.json 由 refactor-php 的 PHP 配置提取） */
export const profiles: Profiles = {
  api: parseProfile(apiJson, "api"),
  kano: parseProfile(kanoJson, "kano"),
};

function parseProfile(raw: unknown, name: string): Profile {
  const o = asRecord(raw, name);
  const output = asString(o.output, `${name}.output`);
  if (output !== "cdn" && output !== "pass") {
    throw new Error(`${name}.output: 期望 "cdn" 或 "pass"`);
  }

  const cdnList: Record<string, string> = {};
  for (const [key, value] of Object.entries(asRecord(o.cdnList, `${name}.cdnList`))) {
    cdnList[key] = asString(value, `${name}.cdnList.${key}`);
  }

  const albums: Record<string, AlbumInfo> = {};
  for (const [key, value] of Object.entries(asRecord(o.albums, `${name}.albums`))) {
    const albumObj = asRecord(value, `${name}.albums.${key}`);
    const images = asStringArray(albumObj.images, `${name}.albums.${key}.images`);
    if (images.length === 0) {
      throw new Error(`${name}.albums.${key}.images: 图集为空`);
    }
    albums[key] = {
      cdnDir: asString(albumObj.cdnDir, `${name}.albums.${key}.cdnDir`),
      images,
    };
  }

  const defaultAlbum = asString(o.defaultAlbum, `${name}.defaultAlbum`);
  const mobileDefaultAlbum = asString(o.mobileDefaultAlbum, `${name}.mobileDefaultAlbum`);
  for (const albumName of [defaultAlbum, mobileDefaultAlbum]) {
    if (!Object.hasOwn(albums, albumName)) {
      throw new Error(`${name}: 默认图集 "${albumName}" 不在 albums 中`);
    }
  }

  const cdnChoose = asString(o.cdnChoose, `${name}.cdnChoose`);
  if (cdnList[cdnChoose] === undefined) {
    throw new Error(`${name}: cdnChoose "${cdnChoose}" 不在 cdnList 中`);
  }

  return {
    output,
    cdnChoose,
    defaultAlbum,
    mobileDefaultAlbum,
    diffDomain: o.diffDomain === true,
    refererList: asStringArray(o.refererList, `${name}.refererList`),
    passOrigin: asString(o.passOrigin, `${name}.passOrigin`),
    cdnList,
    albums,
  };
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path}: 期望对象`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path}: 期望字符串`);
  return value;
}

function asStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path}: 期望数组`);
  return value.map((item, index) => asString(item, `${path}[${index}]`));
}
