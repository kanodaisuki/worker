# transformations — ImageKit 风格图片变换

把 ImageKit 风格的 `/tr:w-<width>/<path>` 翻译为 Cloudflare Images 变换参数，用于 `image.kanochan.net` 的图片缩放。

## 部署

从仓库根目录执行：

```bash
pnpm deploy:transformations    # 只部署 transformations（首次使用先 pnpm exec wrangler login）
```

Worker 绑定在 zone `kanochan.net` 的路由 `image.kanochan.net/tr:w-*`（见 [wrangler.toml](./wrangler.toml)），只接管 `/tr:w-` 前缀的路径。

## 前置条件

1. URL Rewrite 规则需排除 `/tr:` 前缀，否则请求不会到达本 Worker：

   ```
   (http.host eq "image.kanochan.net") and (not (starts_with(http.request.uri.path, "/tr:")))
   ```

2. 该主机上保留原有隐藏 B2 桶路径的重写规则（本 Worker 依赖它解析公开路径）。

## 行为说明

- **宽度取整**：请求宽度向上取整到最近的阶梯档位（`100 / 320 / 480 / 640 / 800 / 1080 / 1440 / 1920 / 2880 / 3840`，超出取 3840），防止任意宽度造成缓存碎片与变换配额浪费；`fit: scale-down` 不放大。
- **输出固定 WebP**（quality 85）：与 `siteConfig.imageOptimization.formats` 一致，每个（图, 宽度）只产生 1 次唯一变换，响应不随 `Accept` 变化。
- **请求头**：只转发条件请求头（`If-None-Match` / `If-Modified-Since`）；刻意不转发 `Accept` / `Cookie` / `Authorization`，避免缓存按 `Accept` 分桶以及泄漏、缓存旁路。响应 `Vary` 中剔除 `accept`，避免 CDN/浏览器缓存碎片。
- **失败回退**：变换失败（非 2xx/304）时 307 跳回原图公开路径（`Cache-Control: public, max-age=60`，避免瞬时失败被长期缓存），由站内重写规则映射到 B2。
- 非 `/tr:w-N/` 路径原样透传（路由已收窄，正常不会到达）；非法宽度返回 400，非法源路径返回 400。

## 与站点配置同步

宽度阶梯与质量必须与站点配置保持一致（见 [worker.ts](./worker.ts)）：

- `WIDTHS` ↔ `siteConfig.imageOptimization.imagekit.transforms`
- `QUALITY`（85）↔ `siteConfig.imageOptimization.quality`

修改任一侧时记得同步另一侧。

测试见 [worker.spec.ts](./worker.spec.ts)（仓库根目录 `pnpm test` 运行）。
