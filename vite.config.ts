import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    ignorePatterns: ["node_modules/**", "dist/**", ".wrangler/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    semi: true,
    singleQuote: false,
  },
  // 提交前对暂存文件执行的检查，由 .vite-hooks/pre-commit 调用 `vp staged` 触发
  staged: {
    // 代码文件：格式化 + lint + 类型检查，并自动修复格式与可自动修复的 lint 问题
    "*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}": "vp check --fix",
    // 其余可格式化文件：仅自动格式化
    "*.{json,jsonc,md,mdx,yaml,yml,css,html}": "vp fmt",
  },
});
