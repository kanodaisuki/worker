# bgm-api — Bangumi API 反向代理

把任意 Bangumi API 请求透明转发到 `https://api.bgm.tv`，并附加 CORS 白名单、User-Agent 和边缘缓存，用于信息检索。返回值中的图片地址会被改写为 [bgm-img](../bgm-img) 反向代理地址。

## 部署

从仓库根目录执行：

```bash
pnpm deploy:bgm-api     # 只部署 bgm-api（首次使用先 pnpm exec wrangler login）
```

也可以直接把 [worker.ts](./worker.ts) 的内容粘贴到 Cloudflare Dashboard 的 Workers 编辑器（新建 `worker.ts`）中保存。

> 部署前请修改 [worker.ts](./worker.ts) 中的 `USER_AGENT`，填入你的项目名和联系方式（Bangumi API Fair Use 要求）。

### 绑定自定义域名

编辑 [wrangler.toml](./wrangler.toml) 中的 `routes` 并改成你的域名（Custom Domain 由 Cloudflare 自动配置 DNS 与证书），随后重新部署：

```toml
# routes 等顶层配置必须写在 [vars] 之前，否则会被 TOML 解析成 [vars] 表里的环境变量
routes = [{ pattern = "bgm-api.kanochan.net", custom_domain = true }]

[vars]
CORS_ALLOWED_ORIGINS = "https://kanochan.net,https://kanochan.com"
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
- **图片地址改写**：JSON 成功响应中的图片地址（`lain.bgm.tv`，含 `http://`、`https://`、`//` 三种形式与 JSON 转义斜杠）统一改写为图片反向代理地址（默认 `https://bgm-img.kanochan.net`），并升级为 `https`；`bgm.tv` 是条目网页地址而非图片，保持不变。改写在写入缓存之前完成，缓存命中即改写后的正文。
- **缓存**：GET 按 URL 缓存；搜索接口 `POST /v0/search/subjects` 按 URL + 请求体哈希缓存。响应头 `X-Cache: HIT/MISS` 表示是否命中边缘缓存；搜索结果缓存 5 分钟，条目/人物/角色详情（`/v0/(subjects|persons|characters)/<id>`）缓存 1 小时，成功响应附 `Cache-Control: public, max-age=...`。
- **转发**：剔除逐跳与平台注入的请求头（`cf-ray`、`x-forwarded-for` 等），固定 `Accept-Encoding: gzip` 保证缓存表示对所有客户端一致；上游异常返回 502。改写路径下正文已解压并重新序列化，`Content-Encoding`/`Content-Length` 会被删除（平台自动重新压缩）；非 JSON、非 200 等其余响应按压缩流原样透传。

## 故障监测

链路依赖本 Worker 的 `IMAGE_URL_PATTERN` 与 [bgm-img](../bgm-img) 的 `UPSTREAM_ORIGIN` 两个常量，上游图片主机一旦变化全链路会静默失效。两层防护：

- **运行时哨兵**：改写时按图片字段（`images` 各值、`image`、`avatar`）校验主机，发现改写规则外的主机即输出一条结构化告警日志（每响应一条，不刷屏）；地址保留原值不改写，避免错误代理：

  ```json
  {
    "event": "image_host_unrecognized",
    "path": "/v0/subjects/2585",
    "hosts": ["img.bgm.tv"],
    "field": "images.large",
    "sample": "https://img.bgm.tv/..."
  }
  ```

- **链路自检**：`GET /health` 与 Cron（每 10 分钟）执行四段校验——上游样本（`/v0/subjects/2585`）→ 图片主机规则 → 改写结果 → 经 bgm-img 实取图片（200 + `image/*`）。成功返回 `200 {ok:true}` 并记 `health_check` 日志；失败返回 `503 {ok:false,failed:[...]}` 并输出同名告警日志。`failed` 取值：`upstream`/`upstream_body`/`image_field_missing`/`image_host`/`rewrite`/`image_fetch`。

告警记录：`console.error` 日志 → [Workers Issues](https://developers.cloudflare.com/workers/observability/issues/)（异常、5xx、error 日志自动聚合，免费公测）。直接在 Workers 的 **Issues** 面板查看即可，[wrangler.toml](./wrangler.toml) 的 `[observability.issues]` 已开启，无需额外配置。

如需外部推送，可在 **Issues → Automations** 配置 Generic webhook / Chat 等目的地（注意：目的地不支持邮件，面板中没有邮件选项）。

**恢复手册**（收到 `image_host_unrecognized` / `image_host` 告警时）：

1. `curl https://api.bgm.tv/v0/subjects/2585` 确认新的图片主机
2. 修改 [worker.ts](./worker.ts) 的 `IMAGE_URL_PATTERN` 与 `IMAGE_URL_PREFIX`，以及 [../bgm-img/worker.ts](../bgm-img/worker.ts) 的 `UPSTREAM_ORIGIN`
3. `pnpm deploy` 后 `curl https://bgm-api.kanochan.net/health` 验证

## 配置

| 位置                             | 项                            | 说明                                        |
| -------------------------------- | ----------------------------- | ------------------------------------------- |
| [wrangler.toml](./wrangler.toml) | `[vars].CORS_ALLOWED_ORIGINS` | CORS 白名单，逗号分隔，优先级高于代码默认值 |
| [wrangler.toml](./wrangler.toml) | `[vars].IMAGE_PROXY_ORIGIN`   | 图片代理源站，置空字符串禁用改写            |
| [worker.ts](./worker.ts)         | `DEFAULT_ALLOWED_ORIGINS`     | 白名单默认值                                |
| [worker.ts](./worker.ts)         | `DEFAULT_IMAGE_PROXY_ORIGIN`  | 图片代理源站默认值                          |
| [worker.ts](./worker.ts)         | `USER_AGENT`                  | 上游 User-Agent（Fair Use 要求可识别）      |

测试见 [worker.spec.ts](./worker.spec.ts)（仓库根目录 `pnpm test` 运行）。

API 文档：https://bangumi.github.io/api/
