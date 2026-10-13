# bgm-img — Bangumi 图片反向代理

把任意路径透明转发到 `https://lain.bgm.tv`，并附加 CORS 白名单与长时边缘缓存，用于动画封面等图片的跨域加载。

## 部署

从仓库根目录执行：

```bash
pnpm deploy:bgm-img     # 只部署 bgm-img（首次使用先 pnpm exec wrangler login）
```

也可以直接把 [worker.ts](./worker.ts) 的内容粘贴到 Cloudflare Dashboard 的 Workers 编辑器（新建 `worker.ts`）中保存。

> 部署前请修改 [worker.ts](./worker.ts) 中的 `USER_AGENT`，填入你的项目名和联系方式（Bangumi Fair Use 要求）。

### 绑定自定义域名

编辑 [wrangler.toml](./wrangler.toml) 中的 `routes` 并改成你的域名（Custom Domain 由 Cloudflare 自动配置 DNS 与证书），随后重新部署：

```toml
# routes 等顶层配置必须写在 [vars] 之前，否则会被 TOML 解析成 [vars] 表里的环境变量
routes = [{ pattern = "bgm-img.kanochan.net", custom_domain = true }]

[vars]
CORS_ALLOWED_ORIGINS = "https://kanochan.net,https://kanochan.com"
```

## 使用

部署后 Worker 会暴露 `https://<你的域名>/`，路径与 `lain.bgm.tv` 一一对应，把图片地址中的主机名替换掉即可：

```
https://lain.bgm.tv/r/200/pic/cover/l/5b/e2/2785_5IaII.jpg
                     ↓
https://bgm-img.kanochan.net/r/200/pic/cover/l/5b/e2/2785_5IaII.jpg
```

```bash
# 原图 / 指定宽度（/r/<width>/ 前缀由上游处理）
curl https://bgm-img.kanochan.net/pic/cover/l/5b/e2/2785_5IaII.jpg
curl https://bgm-img.kanochan.net/r/200/pic/cover/l/5b/e2/2785_5IaII.jpg
```

`GET /` 返回服务信息（上游地址与示例路径）。

## 行为说明

- **CORS**：浏览器端只能从白名单域名（`https://kanochan.net`、`https://kanochan.com`）跨域加载图片，白名单见下方配置；预检 `OPTIONS` 返回 204。
- **缓存**：GET/HEAD 按 URL 缓存（HEAD 归入 GET 键），成功响应缓存 30 天并附 `Cache-Control: public, max-age=2592000`；响应头 `X-Cache: HIT/MISS` 表示是否命中边缘缓存。非 200 响应（404 等）透传且不写缓存。
- **转发**：只透传条件请求头（`If-None-Match`、`If-Modified-Since`），固定 `Accept-Encoding: gzip` 保证缓存表示对所有客户端一致；Cookie 等其余请求头一律丢弃，避免泄漏与缓存旁路。仅支持 `GET`/`HEAD`，其余方法返回 405；上游异常返回 502。

## 配置

| 位置                             | 项                            | 说明                                        |
| -------------------------------- | ----------------------------- | ------------------------------------------- |
| [wrangler.toml](./wrangler.toml) | `[vars].CORS_ALLOWED_ORIGINS` | CORS 白名单，逗号分隔，优先级高于代码默认值 |
| [worker.ts](./worker.ts)         | `DEFAULT_ALLOWED_ORIGINS`     | 白名单默认值                                |
| [worker.ts](./worker.ts)         | `CACHE_TTL`                   | 边缘缓存时长（秒）                          |
| [worker.ts](./worker.ts)         | `USER_AGENT`                  | 上游 User-Agent（Fair Use 要求可识别）      |

测试见 [worker.spec.ts](./worker.spec.ts)（仓库根目录 `pnpm test` 运行）。
