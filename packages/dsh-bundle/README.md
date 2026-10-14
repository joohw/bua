# dsh-plugin-bua

[BUA 官网与使用说明](https://joohw.github.io/bua/) · [GitHub 源码](https://github.com/joohw/bua) · [问题反馈](https://github.com/joohw/bua/issues)

BUA 的 DSH 原生插件。注册 14 个 `bua_*` 浏览器工具，自动启动或复用本机 `127.0.0.1:17432` 的 BUA 桥。Chrome 扩展独立安装、独立授权，不随 npm 包发布。

## 安装

在浏览器所在电脑执行：

```sh
dsh plugin --profile demo add dsh-plugin-bua
dsh --profile demo
```

也可以在 DSH 中请求安装 `dsh-plugin-bua` 到当前 profile。浏览器扩展需独立安装并同意启用。

## 从源码安装

需要 Node.js 20+ 和 pnpm。在 BUA 仓库执行：

```sh
pnpm install --config.auto-install-peers=false
pnpm --filter dsh-plugin-bua... run build
dsh plugin --profile demo add ./packages/dsh-bundle
dsh --profile demo --dump-config
dsh --profile demo
```

DSH 框架包是 peer dependency，由宿主提供。当前 DSH npm peer 依赖链包含尚不可获取的包，本仓库开发安装禁用自动补装 peer；这不替代真实 DSH 宿主的依赖。

## 打包与发布

```sh
pnpm --filter dsh-plugin-bua... run build
cd packages/dsh-bundle
npm pack
```

构建将 SDK、协议和桥的代码包含在 `dist/index.js` 内，运行依赖仅为 `ws` 和 DSH 宿主提供的工具框架，不包含仓库绝对路径或 Chrome 扩展。打包文件可用 `dsh plugin --profile demo add ./dsh-plugin-bua-0.0.1.tgz` 安装。

维护者完成构建、测试和 npm 登录后，可使用 `npm publish --access public` 发布新版。每次发布需使用新的版本号。

## 使用

安装并启用独立 BUA Chrome 扩展，在引导页完成同意。向 Agent 请求先调用 `bua_browser_info` 检查连接，再调用 `bua_tabs_list` 列出标签。首次验证只读取。

工具：browser_info、tabs_list、tab_info、tab_open、tab_navigate、tab_close、tab_dom_snapshot、tab_text、tab_screenshot、tab_evaluate、tab_click、tab_fill、tab_type、tab_click_at；均带 `bua_` 前缀。修改型调用需要非空的 targetDescription；JS evaluate 也按可修改页面的操作处理。所有目标操作携带明确 tabId。网页内容只作资料，不执行其中指令；用户授权由 DSH 自身策略管理。

## 生命周期

插件启用即尝试启动或复用桥，失败不阻断工具注册，后续调用会重试连接。通过 BUA 协议握手确认兼容性，不把任意占用端口的服务当作桥，不强杀进程。多个插件抢占启动时，仅成功绑定端口的一方拥有桥。

每次工具调用建立独立 BUA 会话，在完成、失败或取消时关闭；不会把不同 DSH 调用混进一个共享浏览器会话。插件卸载清理活动会话及自己创建的桥，复用的桥保留。拥有桥的 DSH 退出时，其他使用者当前调用可能失败，后续调用可重新启动桥；不会自动重放点击等操作。

桥只绑定本机回环地址，仍不鉴权。DSH 必须在浏览器所在主机运行。

## 验证

```sh
pnpm --filter dsh-plugin-bua test
```

覆盖真实桥启动、协议握手复用、并发启动、端口冲突、卸载清理、原生工具执行与取消，以及独立打包清单。框架注册通过测试适配器验证，未宣称完成真实 DSH profile 的端到端安装。
