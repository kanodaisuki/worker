// Regression tests for: typescript@5.5.0 upgrade
// 覆盖 /tr:w-N/ 变换转发、宽度取整、失败回退与 Vary 清理
import { describe, it, expect, afterEach, vi } from "vite-plus/test";
import worker from "./worker";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>,
): Array<{ url: string; headers: Headers; init: RequestInit }> {
  const calls: Array<{ url: string; headers: Headers; init: RequestInit }> = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = input instanceof Request ? input.headers : new Headers(init?.headers);
    const effectiveInit: RequestInit = init ?? {};
    calls.push({ url, headers, init: effectiveInit });
    return Promise.resolve(respond(url, effectiveInit));
  });
  return calls;
}

describe("transformations", () => {
  it("非 /tr:w-N/ 路径原样透传", async () => {
    const calls = stubFetch(() => new Response("ok"));
    const res = await worker.fetch(new Request("https://image.kanochan.net/normal.jpg"));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://image.kanochan.net/normal.jpg");
  });

  it("宽度向上取整到阶梯并固定 WebP 变换", async () => {
    const calls = stubFetch(() => new Response("img"));
    const res = await worker.fetch(
      new Request("https://image.kanochan.net/tr:w-500/album/cover.jpg"),
    );
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("https://image.kanochan.net/album/cover.jpg");
    const cf = (call.init as { cf?: { image?: Record<string, unknown> } }).cf;
    expect(cf?.image?.width).toBe(640);
    expect(cf?.image?.format).toBe("webp");
    expect(cf?.image?.quality).toBe(85);
    expect(cf?.image?.fit).toBe("scale-down");
  });

  it("只转发条件请求头，不转发 Cookie / Accept", async () => {
    const calls = stubFetch(() => new Response("img"));
    await worker.fetch(
      new Request("https://image.kanochan.net/tr:w-100/a.jpg", {
        headers: {
          "If-None-Match": 'W/"abc"',
          Cookie: "session=secret",
          Accept: "image/avif",
        },
      }),
    );
    const headers = calls[0]!.headers;
    expect(headers.get("If-None-Match")).toBe('W/"abc"');
    expect(headers.get("Cookie")).toBeNull();
    expect(headers.get("Accept")).toBeNull();
  });

  it("宽度非法返回 400", async () => {
    stubFetch(() => new Response("img"));
    const res = await worker.fetch(new Request("https://image.kanochan.net/tr:w-0/a.jpg"));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Bad width");
  });

  it("变换失败 307 回退到原图公开路径", async () => {
    stubFetch(() => new Response("nope", { status: 404 }));
    const res = await worker.fetch(new Request("https://image.kanochan.net/tr:w-320/a.jpg"));
    expect(res.status).toBe(307);
    expect(res.headers.get("Location")).toBe("https://image.kanochan.net/a.jpg");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("304 透传，不触发回退", async () => {
    stubFetch(() => new Response(null, { status: 304 }));
    const res = await worker.fetch(new Request("https://image.kanochan.net/tr:w-100/a.jpg"));
    expect(res.status).toBe(304);
  });

  it("成功响应从 Vary 中剔除 accept", async () => {
    stubFetch(() => new Response("img", { headers: { Vary: "Accept, Encoding" } }));
    const res = await worker.fetch(new Request("https://image.kanochan.net/tr:w-100/a.jpg"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Vary")).toBe("Encoding");
  });
});
