// 覆盖 bgm-img 反向代理的 CORS 白名单、上游转发与边缘缓存行为
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
  return new Request("https://proxy.test/r/200/pic/cover/l/5b/e2/2785_5IaII.jpg", {
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

  // 真实上游 lain.bgm.tv 会下发 Access-Control-Allow-Origin: *，必须被清除而非透传
  function stubWildcardUpstream(cached?: Response): { stored: () => Response | undefined } {
    let stored: Response | undefined;
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response("img", {
          status: 200,
          headers: {
            "Content-Type": "image/jpeg",
            "Access-Control-Allow-Origin": "*",
          },
        }),
      ),
    );
    vi.stubGlobal("caches", {
      default: {
        match: async () => cached,
        put: async (_key: Request, value: Response) => {
          stored = value;
        },
      },
    });
    return { stored: () => stored };
  }

  function proxied(origin?: string): Request {
    return new Request("https://proxy.test/r/200/pic/cover/l/5b/e2/2785_5IaII.jpg", {
      headers: origin ? { Origin: origin } : {},
    });
  }

  it("上游的 Allow-Origin: * 不透传，白名单外的来源读不到响应", async () => {
    stubWildcardUpstream();

    const res = await worker.fetch(proxied("https://evil.com"), env, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Access-Control-Expose-Headers")).toBe("X-Cache, Cache-Control");
  });

  it("上游的 Allow-Origin: * 不透传，白名单内的来源回显自己的 Origin", async () => {
    stubWildcardUpstream();

    const res = await worker.fetch(proxied("https://kanochan.net"), env, ctx);

    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://kanochan.net");
  });

  it("上游的 Allow-Origin: * 不透传，无 Origin 的请求不返回 Allow-Origin", async () => {
    stubWildcardUpstream();

    const res = await worker.fetch(proxied(), env, ctx);

    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("历史缓存里残留的上游 Allow-Origin: * 在命中时被清除", async () => {
    stubWildcardUpstream(
      new Response("cached", { headers: { "Access-Control-Allow-Origin": "*" } }),
    );

    const res = await worker.fetch(proxied("https://evil.com"), env, ctx);

    expect(res.headers.get("X-Cache")).toBe("HIT");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("上游 CORS 头不写入边缘缓存", async () => {
    const { stored } = stubWildcardUpstream();

    const res = await worker.fetch(proxied("https://kanochan.net"), env, ctx);
    await res.text();

    const cached = stored();
    expect(cached).toBeDefined();
    expect(cached!.headers.get("Access-Control-Allow-Origin")).toBeNull();
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

  function stubFetch(
    impl?: (url: string, init: RequestInit) => Response | Promise<Response>,
  ): Array<{ url: string; init: RequestInit }> {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push({ url, init: init ?? {} });
      return Promise.resolve(
        impl
          ? impl(url, init ?? {})
          : new Response("img", {
              status: 200,
              headers: { "Content-Type": "image/jpeg" },
            }),
      );
    });
    return calls;
  }

  it("GET 路径透明转发到 lain.bgm.tv，响应写入缓存", async () => {
    const calls = stubFetch();
    const putKeys = stubCaches();

    const res = await worker.fetch(
      new Request("https://proxy.test/r/200/pic/cover/l/5b/e2/2785_5IaII.jpg", {
        headers: {
          Origin: "https://kanochan.net",
          "if-none-match": '"abc"',
          "cf-ray": "def",
          Cookie: "secret=1",
        },
      }),
      env,
      ctx,
    );

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://lain.bgm.tv/r/200/pic/cover/l/5b/e2/2785_5IaII.jpg");
    const upstreamHeaders = new Headers(calls[0]!.init.headers);
    expect(upstreamHeaders.get("User-Agent")).toContain("bgm-img-proxy");
    expect(upstreamHeaders.get("Accept-Encoding")).toBe("gzip");
    expect(upstreamHeaders.get("if-none-match")).toBe('"abc"');
    expect(upstreamHeaders.get("cf-ray")).toBeNull();
    expect(upstreamHeaders.get("Cookie")).toBeNull();
    expect(res.headers.get("X-Cache")).toBe("MISS");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=2592000");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://kanochan.net");
    expect(putKeys).toHaveLength(1);
    expect(putKeys[0]).toBe("https://lain.bgm.tv/r/200/pic/cover/l/5b/e2/2785_5IaII.jpg");
    expect(await res.text()).toBe("img");
  });

  it("查询字符串一并透传", async () => {
    const calls = stubFetch();
    stubCaches();

    await worker.fetch(new Request("https://proxy.test/pic/cover/a.jpg?v=2"), env, ctx);

    expect(calls[0]!.url).toBe("https://lain.bgm.tv/pic/cover/a.jpg?v=2");
  });

  it("缓存命中时不再回源", async () => {
    const calls = stubFetch();
    stubCaches(new Response("cached", { headers: { "Content-Type": "image/jpeg" } }));

    const res = await worker.fetch(
      new Request("https://proxy.test/r/200/pic/cover/l/5b/e2/2785_5IaII.jpg"),
      env,
      ctx,
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("cached");
    expect(res.headers.get("X-Cache")).toBe("HIT");
    expect(calls).toHaveLength(0);
  });

  it("HEAD 无响应体，且与 GET 共用同一缓存键", async () => {
    const calls = stubFetch();
    const putKeys = stubCaches();

    const res = await worker.fetch(
      new Request("https://proxy.test/pic/cover/a.jpg", { method: "HEAD" }),
      env,
      ctx,
    );

    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
    expect(calls[0]!.init.method).toBe("GET");
    expect(putKeys).toHaveLength(1);
    expect(putKeys[0]).toBe("https://lain.bgm.tv/pic/cover/a.jpg");
  });

  it("非 200 响应透传且不写缓存", async () => {
    stubFetch(() => new Response("not found", { status: 404 }));
    const putKeys = stubCaches();

    const res = await worker.fetch(
      new Request("https://proxy.test/pic/cover/missing.jpg"),
      env,
      ctx,
    );

    expect(res.status).toBe(404);
    expect(res.headers.get("X-Cache")).toBe("MISS");
    expect(putKeys).toHaveLength(0);
  });

  it("GET/HEAD 以外的方法返回 405", async () => {
    const calls = stubFetch();
    stubCaches();

    const res = await worker.fetch(
      new Request("https://proxy.test/pic/cover/a.jpg", { method: "POST" }),
      env,
      ctx,
    );

    expect(res.status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  it("上游异常返回 502 JSON", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("network down")));
    stubCaches();

    const res = await worker.fetch(new Request("https://proxy.test/pic/cover/a.jpg"), env, ctx);

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("bad_gateway");
  });

  it("GET / 返回服务信息", async () => {
    stubCaches();

    const res = await worker.fetch(new Request("https://proxy.test/"), env, ctx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { upstream: string };
    expect(body.upstream).toBe("https://lain.bgm.tv");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Vary")).toBe("Origin");
  });
});
