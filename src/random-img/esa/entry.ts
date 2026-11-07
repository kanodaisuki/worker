/**
 * 随机图片 API（refactor-php 迁移）：阿里云 ESA「函数和Pages」入口。
 * ESA 链路以默认导出的 `worker.fetch(request)` 调用（与 CF Worker 同构），
 * 业务逻辑在 core/（平台无关）。
 */
import { handle } from "../core/handle";
import { profiles } from "../core/registry";

export default {
  fetch(request: Request): Promise<Response> {
    return handle(request, profiles);
  },
};
