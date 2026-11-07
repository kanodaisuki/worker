# random-img · 随机图片 API

从 [refactor-php](../../refactor-php/)（PHP）迁移的随机图片 API：按入口路径 / 请求参数 / UA 选择图集，随机取一张图，302 重定向到 CDN 或代理回源输出二进制。业务逻辑为平台无关的 TypeScript（`core/`），同时支持阿里云 ESA「函数和Pages」（主，现网）与 Cloudflare Workers（预留）。

重构方案与行为规格见 [refactor-php/REFACTOR-PLAN.md](../../refactor-php/REFACTOR-PLAN.md)。

## 使用

```
https://img.api.kksk.ltd/api.php?album=yuri
```

| 参数      | 说明                                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------------- |
| `album`   | 图集名，见 `core/profiles/*.json`（`Genshin-Impact` / `yuri` / `kano-horizontal` / `kano-vertical`） |
| `type=bg` | 背景模式：album 缺失/无效时按 UA 选移动端/桌面默认图集                                               |

- **cdn 模式**（默认）：302 `Location` 到 `{CDN基址}{CDN_dir}{随机文件名}`，附 `Cache-Control: no-store`
- **pass 模式**：从 `p.kksk.ltd` 图源（`passOrigin`）拉流返回图片，透传 `Content-Type`；上游异常返回 502

## 路径映射

旧 PHP 部署下 `refactor-php/` 内全部 `.php` 文件名均可能被直接访问，全部保留为别名：

| 请求路径                                                                             | profile |
| ------------------------------------------------------------------------------------ | ------- |
| `/api.php`、`/article-cover.php`、`/article-cover`、`/api`                           | api     |
| `/kano.php`、`/kano`、`/kano-mobile.php`、`/kano-pc.php`、`/kano-mobile`、`/kano-pc` | kano    |

映射表之外的路径返回 404。调用方零更改，切换仅需把域名解析/绑定指向函数。

## 配置

| 位置                      | 说明                                               |
| ------------------------- | -------------------------------------------------- |
| `core/profiles/api.json`  | `api` 入口配置（由 `refactor-php/api.php` 提取）   |
| `core/profiles/kano.json` | `kano` 入口配置（由 `refactor-php/kano.php` 提取） |

改图集清单 / CDN 列表直接编辑 JSON 后重新部署。`passOrigin` 为 pass 模式图片源，固定指向 `p.kksk.ltd` 图源（即各 profile 的 `cdnList.kksk`）。

## 部署

- **阿里云 ESA（主）**：见 [esa/README.md](./esa/README.md)，使用官方 [esa-cli](https://github.com/aliyun/alibabacloud-esa-cli) 部署
- **Cloudflare Workers（预留）**：`pnpm deploy:random-img`（`worker.ts` + `wrangler.toml`，迁移时绑定自定义域名后切 DNS）

## 与旧 PHP 的行为差异

1. 弃用 `convert_url_query` 的 `'undefined'` 占位怪癖，改用标准 `URLSearchParams`
2. 302 响应附加 `Cache-Control: no-store`，防止中间代理缓存重定向破坏随机性

其余行为（图集选择、CDN 分流、UA 判定、URL 拼接）与旧服务一致，规格与测试矩阵见 [worker.spec.ts](./worker.spec.ts)（仓库根目录 `pnpm test` 运行）。
