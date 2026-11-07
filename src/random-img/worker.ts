/**
 * 随机图片 API（refactor-php 迁移）：Cloudflare Workers 入口（预留，未来迁移用）。
 * 业务逻辑在 core/（平台无关），阿里云 ESA 入口见 esa/entry.ts。
 */
import { handle } from "./core/handle";
import { profiles } from "./core/registry";

export default {
  fetch(request: Request): Promise<Response> {
    return handle(request, profiles);
  },
} satisfies ExportedHandler;
