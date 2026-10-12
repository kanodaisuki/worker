# bgm-api — Bangumi API 反向代理

把任意 Bangumi API 请求透明转发到 `https://api.bgm.tv`，并附加 CORS 白名单、User-Agent 和边缘缓存，用于信息检索。

## 部署

从仓库根目录执行：

```bash
pnpm deploy:bgm-api     # 只部署 bgm-api（首次使用先 pnpm exec wrangler login）
```

也可以直接把 [worker.ts](./worker.ts) 的内容粘贴到 Cloudflare Dashboard 的 Workers 编辑器（新建 `worker.ts`）中保存。

> 部署前请修改 [worker.ts](./worker.ts) 中的 `USER_AGENT`，填入你的项目名和联系方式（Bangumi API Fair Use 要求）。

### 绑定自定义域名

编辑 [wrangler.toml](./wrangler.toml)，取消注释 `routes` 并改成你的域名（Custom Domain 由 Cloudflare 自动配置 DNS 与证书），随后重新部署：

```toml
routes = [{ pattern = "bgm-api.kanochan.net", custom_domain = true }]
```

## 使用

部署后 Worker 会暴露 `https://<你的域名>/`，路径与 Bangumi API 一一对应：

```bash
# 搜索条目
curl -X POST https://bgm-api.example.workers.dev/v0/search/subjects \
  -H "Content-Type: application/json" \
  -d '{"keyword":"命运石之门","filter":{"type":[2]}}'

# 条目详情 / 每日放送
curl https://bgm-api.example.workers.dev/v0/subjects/2585
curl https://bgm-api.example.workers.dev/calendar
```

`GET /` 返回服务信息（上游地址、API 文档与示例路径）。

## 行为说明

- **CORS**：浏览器端只能从白名单域名（`https://kanochan.net`、`https://kanochan.com`）跨域调用，白名单见下方配置；预检 `OPTIONS` 返回 204。
- **缓存**：GET 按 URL 缓存；搜索接口 `POST /v0/search/subjects` 按 URL + 请求体哈希缓存。响应头 `X-Cache: HIT/MISS` 表示是否命中边缘缓存；搜索结果缓存 5 分钟，条目/人物/角色详情（`/v0/(subjects|persons|characters)/<id>`）缓存 1 小时，成功响应附 `Cache-Control: public, max-age=...`。
- **转发**：剔除逐跳与平台注入的请求头（`cf-ray`、`x-forwarded-for` 等），固定 `Accept-Encoding: gzip` 保证缓存表示对所有客户端一致；上游异常返回 502。

## 配置

| 位置                             | 项                            | 说明                                        |
| -------------------------------- | ----------------------------- | ------------------------------------------- |
| [wrangler.toml](./wrangler.toml) | `[vars].CORS_ALLOWED_ORIGINS` | CORS 白名单，逗号分隔，优先级高于代码默认值 |
| [worker.ts](./worker.ts)         | `DEFAULT_ALLOWED_ORIGINS`     | 白名单默认值                                |
| [worker.ts](./worker.ts)         | `USER_AGENT`                  | 上游 User-Agent（Fair Use 要求可识别）      |

测试见 [worker.spec.ts](./worker.spec.ts)（仓库根目录 `pnpm test` 运行）。

API 文档：https://bangumi.github.io/api/
