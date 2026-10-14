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

## 提交前自动检查

仓库已启用 Vite+ 的 Git 钩子：每次 `git commit` 会自动对**暂存文件**做格式化与代码检查，无法自动修复的问题会中断本次提交。

- 钩子脚本：[.vite-hooks/pre-commit](./.vite-hooks/pre-commit)（执行 `vp staged`），随 `pnpm install` 的 `prepare` 脚本自动安装到当前克隆
- 检查项配置：[vite.config.ts](./vite.config.ts) 的 `staged` 字段
  - `*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}` → `vp check --fix`（格式化 + lint + 类型检查，并自动修复）
  - `*.{json,jsonc,md,mdx,yaml,yml,css,html}` → `vp fmt`（仅格式化）
- 临时关闭当前克隆的钩子：`pnpm exec vp hooks disable`（重新启用 `pnpm exec vp hooks enable`，状态查询 `pnpm exec vp hooks status`）
- 单次提交跳过钩子：`VP_GIT_HOOKS=0 git commit -m "..."`

> `vp staged` 需要 Node.js 22.22.1+ 与 Git 2.32.0+。

## 目录与文档

各 Worker 的配置、路由、行为与使用说明见各自目录下的文档：

- [src/bgm-api/README.md](./src/bgm-api/README.md) — Bangumi API 反向代理：CORS 白名单、边缘缓存、图片地址改写、链路自检与故障监测
- [src/bgm-img/README.md](./src/bgm-img/README.md) — Bangumi 图片反向代理：CORS 白名单、30 天边缘缓存、自定义域名绑定
- [src/transformations/README.md](./src/transformations/README.md) — 图片变换：宽度阶梯、WebP 输出、失败回退
