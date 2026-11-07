// 随机图片 API（refactor-php 迁移）：行为矩阵见 refactor-php/REFACTOR-PLAN.md §2
import { describe, it, expect, afterEach, vi } from "vite-plus/test";
import worker from "./worker";
import { handle } from "./core/handle";
import { isMobile, resolveAlbum, resolveProfileName, selectCdn } from "./core/router";
import { profiles } from "./core/registry";
import type { Profile, Profiles } from "./core/types";

const PC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  const base: Profile = {
    output: "cdn",
    cdnChoose: "kksk",
    defaultAlbum: "default-album",
    mobileDefaultAlbum: "mobile-album",
    diffDomain: false,
    refererList: ["kanochan.net"],
    passOrigin: "https://p.kksk.ltd/library-small",
    cdnList: {
      local: "https://local.example/library",
      cloudflare: "https://cf.example/library",
      kksk: "https://p.kksk.ltd/library-small",
    },
    albums: {
      "default-album": { cdnDir: "/default/", images: ["d1.webp", "d2.webp"] },
      "mobile-album": { cdnDir: "/mobile/", images: ["m1.webp"] },
      yuri: { cdnDir: "/yuri/", images: ["y1.webp"] },
    },
  };
  return { ...base, ...overrides };
}

function makeProfiles(overrides: Partial<Profile> = {}): Profiles {
  return { api: makeProfile(overrides), kano: makeProfile() };
}

function makeRequest(pathAndQuery: string, headers?: Record<string, string>) {
  const init: RequestInit = headers === undefined ? {} : { headers };
  return new Request(`https://img.api.kksk.ltd${pathAndQuery}`, init);
}

function stubFetch(respond: (url: string) => Response | Promise<Response>): string[] {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    return Promise.resolve(respond(url));
  });
  return calls;
}

describe("路径映射（REFACTOR-PLAN §5.4）", () => {
  it("全部旧 .php 文件名与别名映射到对应 profile", () => {
    expect(resolveProfileName("/api.php")).toBe("api");
    expect(resolveProfileName("/article-cover.php")).toBe("api");
    expect(resolveProfileName("/article-cover")).toBe("api");
    expect(resolveProfileName("/api")).toBe("api");
    expect(resolveProfileName("/kano.php")).toBe("kano");
    expect(resolveProfileName("/kano")).toBe("kano");
    expect(resolveProfileName("/kano-mobile.php")).toBe("kano");
    expect(resolveProfileName("/kano-mobile")).toBe("kano");
    expect(resolveProfileName("/kano-pc.php")).toBe("kano");
    expect(resolveProfileName("/kano-pc")).toBe("kano");
  });

  it("映射表之外的路径返回 null（404）", () => {
    expect(resolveProfileName("/")).toBeNull();
    expect(resolveProfileName("/x.php")).toBeNull();
    expect(resolveProfileName("/api.php/extra")).toBeNull();
    expect(resolveProfileName("/API.PHP")).toBeNull();
    expect(resolveProfileName("/kano.php/")).toBeNull();
  });
});

describe("图集选择（REFACTOR-PLAN §2）", () => {
  const profile = makeProfile();

  it("type=bg 且 album 有效 -> album（桌面与移动端一致）", () => {
    for (const ua of [PC_UA, MOBILE_UA, null]) {
      expect(resolveAlbum(profile, new URLSearchParams("type=bg&album=yuri"), ua)).toBe("yuri");
    }
  });

  it("type=bg 且 album 缺失/无效 -> 移动端/桌面默认图集", () => {
    expect(resolveAlbum(profile, new URLSearchParams("type=bg"), PC_UA)).toBe("default-album");
    expect(resolveAlbum(profile, new URLSearchParams("type=bg"), MOBILE_UA)).toBe("mobile-album");
    expect(resolveAlbum(profile, new URLSearchParams("type=bg"), null)).toBe("default-album");
    expect(resolveAlbum(profile, new URLSearchParams("type=bg&album=not-exist"), MOBILE_UA)).toBe(
      "mobile-album",
    );
    expect(resolveAlbum(profile, new URLSearchParams("type=bg&album="), PC_UA)).toBe(
      "default-album",
    );
  });

  it("无 type=bg 且 album 有效 -> album", () => {
    expect(resolveAlbum(profile, new URLSearchParams("album=yuri"), PC_UA)).toBe("yuri");
    expect(resolveAlbum(profile, new URLSearchParams("type=other&album=yuri"), PC_UA)).toBe("yuri");
  });

  it("其余 -> 默认图集", () => {
    expect(resolveAlbum(profile, new URLSearchParams(""), PC_UA)).toBe("default-album");
    expect(resolveAlbum(profile, new URLSearchParams("album=not-exist"), PC_UA)).toBe(
      "default-album",
    );
    expect(resolveAlbum(profile, new URLSearchParams("type=other"), MOBILE_UA)).toBe(
      "default-album",
    );
  });
});

describe("CDN 选择（REFACTOR-PLAN §2）", () => {
  it("diffDomain=false -> 恒返回 cdnChoose 的 CDN", () => {
    const profile = makeProfile({ diffDomain: false });
    expect(selectCdn(profile, null)).toBe("https://p.kksk.ltd/library-small");
    expect(selectCdn(profile, "https://evil.example/")).toBe("https://p.kksk.ltd/library-small");
  });

  it("diffDomain=true 且无 Referer -> cloudflare", () => {
    const profile = makeProfile({ diffDomain: true });
    expect(selectCdn(profile, null)).toBe("https://cf.example/library");
  });

  it("diffDomain=true 且 Referer 在白名单 -> cdnChoose", () => {
    const profile = makeProfile({ diffDomain: true });
    expect(selectCdn(profile, "https://kanochan.net/page")).toBe(
      "https://p.kksk.ltd/library-small",
    );
    expect(selectCdn(profile, "https://kanochan.net:8443/page")).toBe(
      "https://p.kksk.ltd/library-small",
    );
    expect(selectCdn(profile, "https://www.kanochan.net/")).toBe("https://local.example/library");
  });

  it("diffDomain=true 且 Referer 不在白名单或无法解析 -> local", () => {
    const profile = makeProfile({ diffDomain: true });
    expect(selectCdn(profile, "https://evil.example/")).toBe("https://local.example/library");
    expect(selectCdn(profile, "not a url")).toBe("https://local.example/library");
  });
});

describe("UA 判定", () => {
  it("UA 含移动端关键字 -> 移动端（与旧 PHP strpos 一致，区分大小写）", () => {
    expect(isMobile(MOBILE_UA)).toBe(true);
    expect(isMobile("Mozilla/5.0 (Linux; Android 14) Chrome/120")).toBe(true);
    expect(isMobile("Opera Mobile/12")).toBe(true);
    expect(isMobile("Opera Mobi/12")).toBe(false);
    expect(isMobile(PC_UA)).toBe(false);
    expect(isMobile(null)).toBe(false);
    expect(isMobile("android")).toBe(false);
  });
});

describe("请求处理（真实 profiles）", () => {
  it("/api.php?album=yuri -> 302 到 api profile 的 kksk CDN 随机图", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const res = await worker.fetch(makeRequest("/api.php?album=yuri"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://p.kksk.ltd/tr:w-3840/library-small/yuri/83928473_p0.webp",
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("/?type=bg 桌面端 -> 默认图集 yuri", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const res = await worker.fetch(makeRequest("/api.php?type=bg", { "user-agent": PC_UA }));
    expect(res.headers.get("location")).toContain("/yuri/");
  });

  it("/?type=bg 移动端 -> 默认图集 kano-vertical", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const res = await worker.fetch(makeRequest("/api.php?type=bg", { "user-agent": MOBILE_UA }));
    expect(res.headers.get("location")).toBe(
      "https://p.kksk.ltd/tr:w-3840/library-small/kano/vertical/kano_mobile_05.webp",
    );
  });

  it("/kano.php -> kano profile，默认图集 kano-horizontal", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const res = await worker.fetch(makeRequest("/kano.php"));
    expect(res.headers.get("location")).toBe(
      "https://p.kksk.ltd/library-small/kano/horizontal/kano_pc_28.webp",
    );
  });

  it("无效 album -> 回退默认图集", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const res = await worker.fetch(makeRequest("/api.php?album=not-exist"));
    expect(res.headers.get("location")).toContain("/yuri/");
  });

  it("恶意 album 参数不能路径逃逸", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const res = await worker.fetch(makeRequest("/api.php?album=..%2F..%2Fetc%2Fpasswd"));
    expect(res.headers.get("location")).toContain("/yuri/");
  });

  it("旧入口别名 /article-cover.php 可用", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const res = await worker.fetch(makeRequest("/article-cover.php?album=yuri"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/yuri/");
  });

  it("映射表之外的路径 -> 404", async () => {
    const res = await worker.fetch(makeRequest("/x.php"));
    expect(res.status).toBe(404);
  });
});

describe("pass 模式（代理回源 p.kksk.ltd）", () => {
  it("从 passOrigin 拉流并透传 Content-Type", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const calls = stubFetch(
      () => new Response("img-bytes", { headers: { "content-type": "image/webp" } }),
    );
    const res = await handle(makeRequest("/api.php?album=yuri"), makeProfiles({ output: "pass" }));
    expect(calls).toEqual(["https://p.kksk.ltd/library-small/yuri/y1.webp"]);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(await res.text()).toBe("img-bytes");
  });

  it("上游非 2xx -> 502", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    stubFetch(() => new Response("missing", { status: 404 }));
    const res = await handle(makeRequest("/api.php?album=yuri"), makeProfiles({ output: "pass" }));
    expect(res.status).toBe(502);
  });

  it("上游请求异常 -> 502", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    stubFetch(() => {
      throw new Error("network down");
    });
    const res = await handle(makeRequest("/api.php?album=yuri"), makeProfiles({ output: "pass" }));
    expect(res.status).toBe(502);
  });
});

describe("配置加载（core/registry）", () => {
  it("api / kano 配置与 PHP 源一致", () => {
    expect(profiles.api.output).toBe("cdn");
    expect(profiles.api.cdnChoose).toBe("kksk");
    expect(profiles.api.defaultAlbum).toBe("yuri");
    expect(profiles.api.mobileDefaultAlbum).toBe("kano-vertical");
    expect(profiles.api.diffDomain).toBe(false);
    expect(profiles.api.passOrigin).toBe("https://p.kksk.ltd/tr:w-3840/library-small");
    expect(Object.keys(profiles.api.cdnList)).toHaveLength(3);
    expect(profiles.kano.defaultAlbum).toBe("kano-horizontal");
    expect(profiles.kano.passOrigin).toBe("https://p.kksk.ltd/library-small");
    expect(Object.keys(profiles.kano.cdnList)).toHaveLength(8);
    for (const profile of [profiles.api, profiles.kano]) {
      expect(Object.keys(profile.albums).sort()).toEqual(
        ["Genshin-Impact", "kano-horizontal", "kano-vertical", "yuri"].sort(),
      );
    }
  });
});
