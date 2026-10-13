// Regression tests for: typescript@5.5.0 upgrade
// 覆盖 bgm-api 反向代理的 CORS 白名单、上游转发与边缘缓存行为
import { describe, it, expect, afterEach, vi } from "vite-plus/test";
import worker from "./worker";

const env = { CORS_ALLOWED_ORIGINS: "https://kanochan.net,https://kanochan.com" };
// 测试桩：用例只依赖 waitUntil
const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

afterEach(() => {
  vi.unstubAllGlobals();
});

function preflight(origin?: string): Request {
  return new Request("https://proxy.test/", {
    method: "OPTIONS",
    headers: origin ? { Origin: origin } : {},
  });
}

describe("CORS 白名单", () => {
  it("预检请求回显白名单内的来源", async () => {
    const res = await worker.fetch(preflight("https://kanochan.net"), env, ctx);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://kanochan.net");
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("白名单外的来源不返回 Allow-Origin", async () => {
    const res = await worker.fetch(preflight("https://evil.com"), env, ctx);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("来源比较忽略大小写与尾斜杠，回显规范化值", async () => {
    const res = await worker.fetch(preflight("https://KANOCHAN.NET/"), env, ctx);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://kanochan.net");
  });

  it("环境变量 CORS_ALLOWED_ORIGINS 覆盖默认白名单", async () => {
    const res = await worker.fetch(
      preflight("https://other.com"),
      { CORS_ALLOWED_ORIGINS: "https://other.com" },
      ctx,
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://other.com");
  });

  it("无 Origin 的请求正常响应且不带 Allow-Origin", async () => {
    const res = await worker.fetch(new Request("https://proxy.test/"), env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Vary")).toBe("Origin");
  });
});

describe("上游转发与边缘缓存", () => {
  function stubCaches(cached?: Response) {
    const putKeys: string[] = [];
    vi.stubGlobal("caches", {
      default: {
        match: async () => cached,
        put: async (key: Request) => {
          putKeys.push(key.url);
        },
      },
    });
    return putKeys;
  }

  it("GET 转发到 api.bgm.tv，带标识 UA，响应写入缓存", async () => {
    const requests: Array<{ url: string; headers: Headers }> = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: input instanceof Request ? input.url : String(input),
        headers: new Headers(init?.headers),
      });
      return Promise.resolve(
        new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json", Vary: "Accept-Encoding" },
        }),
      );
    });
    const putKeys = stubCaches();

    const res = await worker.fetch(
      new Request("https://proxy.test/v0/subjects/2585", {
        headers: { Origin: "https://kanochan.net", "cf-ray": "abc" },
      }),
      env,
      ctx,
    );

    expect(res.status).toBe(200);
    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.url).toBe("https://api.bgm.tv/v0/subjects/2585");
    expect(req.headers.get("User-Agent")).toContain("bgm-api-proxy");
    expect(req.headers.get("cf-ray")).toBeNull();
    expect(res.headers.get("X-Cache")).toBe("MISS");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(res.headers.get("Vary")).toBe("Accept-Encoding, Origin");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://kanochan.net");
    expect(putKeys).toHaveLength(1);
  });

  it("缓存命中时不再回源", async () => {
    const fetchCalls: unknown[] = [];
    vi.stubGlobal("fetch", (input: unknown) => {
      fetchCalls.push(input);
      return Promise.resolve(new Response("origin"));
    });
    stubCaches(new Response("cached"));

    const res = await worker.fetch(new Request("https://proxy.test/v0/subjects/2585"), env, ctx);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("cached");
    expect(res.headers.get("X-Cache")).toBe("HIT");
    expect(fetchCalls).toHaveLength(0);
  });

  it("POST 搜索按 URL + 请求体哈希缓存，不同请求体产生不同缓存键", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
      ),
    );
    const putKeys = stubCaches();

    for (const keyword of ["命运石之门", "Clannad"]) {
      const res = await worker.fetch(
        new Request("https://proxy.test/v0/search/subjects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword }),
        }),
        env,
        ctx,
      );
      expect(res.status).toBe(200);
    }

    expect(putKeys).toHaveLength(2);
    expect(putKeys[0]).toContain("/v0/search/subjects?__proxy_cache=");
    expect(putKeys[0]).not.toBe(putKeys[1]);
  });

  it("非搜索 POST 不缓存", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("{}", { status: 200 })));
    const putKeys = stubCaches();

    const res = await worker.fetch(
      new Request("https://proxy.test/v0/users/me/collections", { method: "POST", body: "{}" }),
      env,
      ctx,
    );

    expect(res.status).toBe(200);
    expect(putKeys).toHaveLength(0);
  });

  it("上游异常返回 502 JSON", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("network down")));
    stubCaches();

    const res = await worker.fetch(new Request("https://proxy.test/calendar"), env, ctx);

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("bad_gateway");
  });
});

describe("图片地址改写", () => {
  function stubUpstream(response: Response): void {
    vi.stubGlobal("fetch", () => Promise.resolve(response));
  }

  function jsonUpstream(body: string, status = 200): Response {
    return new Response(body, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  function stubCaches(): { putKeys: string[]; stored: () => Response | undefined } {
    const putKeys: string[] = [];
    let cached: Response | undefined;
    vi.stubGlobal("caches", {
      default: {
        match: async () => null,
        put: async (key: Request, value: Response) => {
          putKeys.push(key.url);
          cached = value;
        },
      },
    });
    return { putKeys, stored: () => cached };
  }

  it("JSON 里的图片地址改写为图片代理地址（含转义斜杠与嵌入文本的 URL）", async () => {
    // 上游真实格式：http 协议 + JSON 转义斜杠（\/）
    stubUpstream(
      jsonUpstream(
        '{"images":{"large":"http:\\/\\/lain.bgm.tv\\/pic\\/cover\\/l\\/390200_Z9jPp.jpg",' +
          '"medium":"https://lain.bgm.tv/pic/cover/m/390200_Z9jPp.jpg"},' +
          '"url":"http://bgm.tv/subject/390200",' +
          '"summary":"封面见 http://lain.bgm.tv/pic/cover/s/390200_Z9jPp.jpg"}',
      ),
    );
    stubCaches();

    const res = await worker.fetch(new Request("https://proxy.test/v0/subjects/390200"), env, ctx);

    const body = (await res.json()) as {
      images: { large: string; medium: string };
      url: string;
      summary: string;
    };
    expect(body.images.large).toBe("https://bgm-img.kanochan.net/pic/cover/l/390200_Z9jPp.jpg");
    expect(body.images.medium).toBe("https://bgm-img.kanochan.net/pic/cover/m/390200_Z9jPp.jpg");
    expect(body.summary).toBe("封面见 https://bgm-img.kanochan.net/pic/cover/s/390200_Z9jPp.jpg");
    // bgm.tv 是条目网页地址而非图片，保持不变
    expect(body.url).toBe("http://bgm.tv/subject/390200");
  });

  it("协议相对地址也改写，统一为 https 代理地址", async () => {
    stubUpstream(jsonUpstream('{"u":"//lain.bgm.tv/pic/x.jpg"}'));
    stubCaches();

    const res = await worker.fetch(new Request("https://proxy.test/v0/subjects/1"), env, ctx);

    const body = (await res.json()) as { u: string };
    expect(body.u).toBe("https://bgm-img.kanochan.net/pic/x.jpg");
  });

  it("非 JSON 响应原样透传，保留 Content-Encoding", async () => {
    const upstream = new Response("raw lain.bgm.tv", {
      status: 200,
      headers: { "Content-Type": "text/plain", "Content-Encoding": "gzip" },
    });
    stubUpstream(upstream);
    stubCaches();

    const res = await worker.fetch(new Request("https://proxy.test/v0/subjects/1"), env, ctx);

    expect(await res.text()).toBe("raw lain.bgm.tv");
    expect(res.headers.get("Content-Encoding")).toBe("gzip");
  });

  it("非 200 响应不改写", async () => {
    stubUpstream(jsonUpstream('{"cover":"http://lain.bgm.tv/x.jpg"}', 404));
    const { putKeys } = stubCaches();

    const res = await worker.fetch(new Request("https://proxy.test/v0/subjects/1"), env, ctx);

    expect(res.status).toBe(404);
    const body = (await res.json()) as { cover: string };
    expect(body.cover).toBe("http://lain.bgm.tv/x.jpg");
    expect(putKeys).toHaveLength(0);
  });

  it("非法 JSON 原文返回", async () => {
    stubUpstream(jsonUpstream("{invalid"));
    stubCaches();

    const res = await worker.fetch(new Request("https://proxy.test/v0/subjects/1"), env, ctx);

    expect(await res.text()).toBe("{invalid");
  });

  it("改写后删除 Content-Encoding 与 Content-Length", async () => {
    const upstream = new Response('{"cover":"http://lain.bgm.tv/x.jpg"}', {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        "Content-Length": "123",
      },
    });
    stubUpstream(upstream);
    stubCaches();

    const res = await worker.fetch(new Request("https://proxy.test/v0/subjects/1"), env, ctx);

    expect(res.headers.get("Content-Encoding")).toBeNull();
    expect(res.headers.get("Content-Length")).toBeNull();
    const body = (await res.json()) as { cover: string };
    expect(body.cover).toBe("https://bgm-img.kanochan.net/x.jpg");
  });

  it("边缘缓存写入改写后的正文", async () => {
    stubUpstream(jsonUpstream('{"cover":"http://lain.bgm.tv/pic/cover/a.jpg"}'));
    const { stored } = stubCaches();

    const res = await worker.fetch(new Request("https://proxy.test/v0/subjects/1"), env, ctx);
    await res.text();

    const cached = stored();
    expect(cached).toBeDefined();
    const cachedText = await cached!.text();
    expect(cachedText).toContain("https://bgm-img.kanochan.net/pic/cover/a.jpg");
    expect(cachedText).not.toContain("lain.bgm.tv");
  });

  it("环境变量 IMAGE_PROXY_ORIGIN 覆盖默认代理地址（尾斜杠被规整）", async () => {
    stubUpstream(jsonUpstream('{"u":"http://lain.bgm.tv/x.jpg"}'));
    stubCaches();

    const res = await worker.fetch(
      new Request("https://proxy.test/v0/subjects/1"),
      { ...env, IMAGE_PROXY_ORIGIN: "https://img.example.com/" },
      ctx,
    );

    const body = (await res.json()) as { u: string };
    expect(body.u).toBe("https://img.example.com/x.jpg");
  });

  it("IMAGE_PROXY_ORIGIN 置空禁用改写", async () => {
    stubUpstream(jsonUpstream('{"u":"http://lain.bgm.tv/x.jpg"}'));
    stubCaches();

    const res = await worker.fetch(
      new Request("https://proxy.test/v0/subjects/1"),
      { ...env, IMAGE_PROXY_ORIGIN: "" },
      ctx,
    );

    const body = (await res.json()) as { u: string };
    expect(body.u).toBe("http://lain.bgm.tv/x.jpg");
  });

  it("304 无响应体透传且不写缓存", async () => {
    stubUpstream(new Response(null, { status: 304 }));
    const { putKeys } = stubCaches();

    const res = await worker.fetch(new Request("https://proxy.test/v0/subjects/1"), env, ctx);

    expect(res.status).toBe(304);
    expect(putKeys).toHaveLength(0);
  });
});
