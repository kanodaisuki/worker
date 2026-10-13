# Cloudflare Worker 仓库

所有 Worker 均使用 TypeScript 编写，类型来自 [@cloudflare/workers-types](https://www.npmjs.com/package/@cloudflare/workers-types)，类型检查配置见 [tsconfig.json](./tsconfig.json)。代码质量工具链使用 [vite-plus](https://viteplus.dev/)（Oxfmt 格式化 + Oxlint lint + tsgo 类型检查），配置见 [vite.config.ts](./vite.config.ts)。

| 目录                                         | 说明                                         |
| -------------------------------------------- | -------------------------------------------- |
| [src/bgm-api](./src/bgm-api)                 | Bangumi API 反向代理                         |
| [src/bgm-img](./src/bgm-img)                 | Bangumi 图片（封面）反向代理                 |
| [src/transformations](./src/transformations) | ImageKit `/tr:w-N/` → Cloudflare Images 变换 |

```bash
pnpm install                    # 安装依赖
pnpm check                      # 格式化 + 代码检查 + 类型检查（pnpm check:fix 自动修复）
pnpm test                       # 运行测试
pnpm deploy                     # 一键部署全部 Worker（首次使用先 pnpm exec wrangler login）
pnpm deploy:bgm-api             # 只部署 bgm-api
pnpm deploy:bgm-img             # 只部署 bgm-img
pnpm deploy:transformations     # 只部署 transformations
```

各 Worker 的配置、路由、行为与使用说明见各自目录下的文档：

- [src/bgm-api/README.md](./src/bgm-api/README.md) — Bangumi API 反向代理：CORS 白名单、边缘缓存、图片地址改写、自定义域名绑定
- [src/bgm-img/README.md](./src/bgm-img/README.md) — Bangumi 图片反向代理：CORS 白名单、30 天边缘缓存、自定义域名绑定
- [src/transformations/README.md](./src/transformations/README.md) — 图片变换：宽度阶梯、WebP 输出、失败回退
