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
