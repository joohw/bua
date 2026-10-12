# 人工提交清单

最后一步无法自动化 —— 需要你的 Google 账号、2FA 与开发者注册费。以下按顺序做即可。

预计耗时：**首次约 40 分钟**（含注册），之后更新版本约 10 分钟。

---

## 阶段 0：确认提交物（已由脚本完成）

```sh
cd packages/extension
pnpm run build                 # 构建
node scripts/preflight.mjs     # 上架前自检 —— 必须全绿
node scripts/pack.mjs          # 生成 zip + SHA256
```

产出：

```
packages/extension/release/bua-extension-v0.1.0.zip
packages/extension/release/bua-extension-v0.1.0.zip.sha256
```

✅ 当前状态：自检 **10 项全过**，zip 已生成并验证可被标准工具解压。

**上传前请重新跑一次 `preflight.mjs`** —— 它的每一项都对应一条官方政策，任何一项变红都不要提交。

---

## 阶段 1：注册开发者账号（一次性）

1. 打开 https://chrome.google.com/webstore/devconsole
2. 用你的 Google 账号登录
3. 接受开发者协议
4. **支付一次性注册费 $5**（USD，不接受退款）
5. 填写发布者名称（会公开显示）与联系邮箱
6. **开启两步验证** —— 未开启 2FA 的账号无法发布

> 联系邮箱建议用能收到 Google 邮件的常用邮箱：审核问询会发到这里。

---

## 阶段 2：创建条目并上传

1. Dashboard → **Add new item**
2. 上传 `bua-extension-v0.1.0.zip`
3. 等待上传解析（会读出 manifest）

> 若提示 manifest 错误，回到阶段 0 重跑 `preflight.mjs`。

---

## 阶段 3：填写 Store listing

按 [listing.md](listing.md) 逐项填：

- [ ] Name：`BUA — Browser Use Agent`
- [ ] Summary：短描述（清单里有现成文案，41 字符）
- [ ] Description：详细描述（清单里有完整中文版）
- [ ] Category：`Developer Tools`
- [ ] Language：中文（简体）
- [ ] Store icon：128×128（直接取 `dist/icons/icon-128.png`）
- [ ] **Screenshots：至少 1 张，1280×800**
- [ ] Homepage URL：`https://github.com/joohw/bua`
- [ ] Support URL

### 截图需要你手动准备

用**真实运行状态**截，不要用设计稿 —— 审核员会与实际行为对照。建议三张：

| # | 内容 | 为什么 |
|---|---|---|
| 1 | 引导页（风险告知 + 同意勾选框） | 证明**显著披露确实存在于扩展 UI 内**，这是合规硬要求 |
| 2 | 标签页泛光 + 点击图标弹出的操作流水 | 展示核心功能与透明度 |
| 3 | （可选）琥珀色降级状态 | 展示企业策略下的降级行为 |

准备步骤：

```sh
# 终端 1
cd packages/sdk && pnpm run build
node ../server/dist/cli.js --port 17432

# 然后在 Chrome 里加载 packages/extension/dist，完成引导页授权，
# 用一个网页做几次操作，截图。
```

---

## 阶段 4：填写 Privacy（最关键的一步）

按 [justifications.md](justifications.md) 填：

### 4.1 Single purpose

- [ ] 粘贴清单 §1 的单用途说明

### 4.2 ⚠️ Remote Code —— 必须选 Yes

- [ ] 选 **`Yes, I am using remote code`**
- [ ] 理由粘贴清单 §2 的说明

> **这是最容易踩的坑。** 官方原文：
> *"Extensions that call remote code and **do not declare and justify it** using the field shown
> above **will be rejected**."*
>
> 用 `chrome.debugger.sendCommand` 执行 `Runtime.evaluate` 就是执行远程代码。它属于 MV3
> 明确允许的例外（Debugger API 是官方列出的两个例外之一），但**必须如实申报**。
> 谎选「No」被发现 = 直接拒审。

### 4.3 Permissions justification

- [ ] 逐项粘贴清单 §3 的四段说明（debugger / tabs / storage / scripting / activeTab）

> 审核员一定会问「为什么不用 chrome.scripting」。清单里已正面回答。

### 4.4 Data usage

- [ ] 按清单 §4 勾选
- [ ] **Website content 要勾选**并在说明里写清「在设备上处理、不上传」
- [ ] 底部三个认证项全部勾选

### 4.5 Privacy policy URL

- [x] **已托管** —— 页面已做好并部署到 GitHub Pages：

  ```
  https://joohw.github.io/bua/privacy.html
  ```

  直接把这一行填进 Dashboard 的 Privacy policy URL 字段。

  页面是**自包含 HTML**（内联样式、无外部资源、含深色模式），审核员打开即完整渲染，
  不依赖任何网络资源。源码在 [`docs/privacy.html`](../../../docs/privacy.html)。

  若要改内容：编辑 `docs/privacy.html` → commit → push → Pages 约 40 秒后自动重建。

> ⚠️ **三方一致性**：隐私政策文本、Dashboard 勾选、代码实际行为必须一致。
> 官方明确三者不一致可能导致**整个发布者账号被封**，不只是这一个扩展下架。

---

## 阶段 5：Distribution 与提交

- [ ] Visibility：`Public`（或先 `Unlisted` 灰度）
- [ ] Pricing：Free
- [ ] Regions：按需（建议全选）
- [ ] 点 **Submit for review**

---

## 阶段 6：等待审核

预期：**首次提交 + 敏感权限（debugger）⇒ 人工审核**，官方口径「几天到几周」。

> 建议**预算 1–3 周**。新开发者 + 新扩展 + 高危权限三者叠加，是最慢的组合。

超过 3 周未出结果可以联系支持：https://support.google.com/chrome_webstore/contact/one_stop_support

### 审核期间不要做的事

- ❌ 不要重复提交（会重置排队）
- ❌ 不要为了「补充说明」而上传新版本（除非确实要改代码）
- ✅ 收到问询时按 [justifications.md](justifications.md) §7 的三个问答要点回复

---

## 阶段 7：被拒怎么办

按违规 ID 处理，见 [justifications.md](justifications.md) §8：

| 违规 ID | 应对 |
|---|---|
| `Purple Potassium` | 声明的权限未真实使用 → 从 manifest 删除该权限。**先怀疑 `activeTab`** |
| `Blue Argon` | 远程托管代码 → 跑 `preflight.mjs`，它会直接报出远端 import / eval |

**退路**（按推荐度）：

1. **Edge Add-ons** —— 隐私字段与 Chrome 几乎一一对应，材料可复用，边际成本最低
2. **企业自托管** —— `ExtensionInstallForcelist` + `update_url`，免商店审核
3. **开发者模式分发** —— 零审核，但 Chrome 134+ 要求开发者模式常开，体验差

> **Firefox 不可行**：没有 `chrome.debugger` 等价 API，且 AMO 政策无 debugger 豁免。

---

## 附：版本更新流程

后续更新只需：

1. 改 `packages/extension/package.json` 与 `manifest.json` 里的 version
2. `pnpm run build && node scripts/preflight.mjs && node scripts/pack.mjs`
3. Dashboard → 该条目 → Package → Upload new package
4. 填写「What's new」
5. Submit for review

> 敏感权限的变更（新增/删除权限）会重新触发完整人工审核；纯代码改动通常更快。
