# random-img · 阿里云 ESA 部署

使用官方 [esa-cli](https://github.com/aliyun/alibabacloud-esa-cli)（仓库 devDependency，`pnpm exec esa-cli`，需 Node.js 18+）部署到 ESA「函数和Pages」。项目配置见 [esa.jsonc](./esa.jsonc)，入口 [entry.ts](./entry.ts)（默认导出 `worker.fetch(request)`，与 CF Worker 同构）。

## 首次

```bash
pnpm exec esa-cli login                  # AK/SK 或交互登录，亦支持 ESA_* / ALIBABA_CLOUD_* 环境变量
pnpm exec esa-cli dev                    # 本地调试（默认 http://localhost:18080）
```

本地验证：

```bash
curl -i "http://localhost:18080/api.php?album=yuri"
curl -i "http://localhost:18080/kano.php?type=bg"
```

## 发布

```bash
pnpm exec esa-cli deploy --environment staging    # 发测试环境（生成版本并发布）
# 按测试环境 IP 配置 Host 后用真实客户端跑 README 的验收清单，再发生产：
pnpm exec esa-cli deploy --environment production
pnpm exec esa-cli domain add                      # 绑定域名（旧域名 img.api.kksk.ltd 整域绑定）
```

也可以从仓库根目录执行 `pnpm deploy:random-img:esa`（等价于本目录下 `esa-cli deploy`）。

灰度与回滚：

```bash
pnpm exec esa-cli deploy --versions v1:80,v2:20 --environment production   # 百分比灰度
pnpm exec esa-cli deployments list                                        # 查历史版本
pnpm exec esa-cli deploy --version <VERSION_ID> --environment production   # 回滚到旧版本
```

切换上线：DNS 从 PHP 服务器切到 ESA 函数域名（TTL 提前调低），观察即时日志/指标后下线 PHP。回滚 = ESA 版本回滚 + DNS 切回。

注意：函数单次执行最多 4 个子请求（fetch），当前 pass 模式仅 1 个，勿在单请求内多次回源。
