# AGENTS.md

在本仓库工作的 Agent 约定。

## 开始修改前

- **先拉取最新改动**：每次开始修改前执行 `git fetch origin`，再执行 `git pull --rebase origin main`（或 `git pull --rebase`），确认工作区基于最新的 `origin/main`。
- 工作区有未提交改动时，先提交到本地分支或 `git stash`，拉取完成后再继续；不要带着未提交改动直接 `git pull`。
- 拉取后如果 `docs/` 或 `packages/` 有变化，重新检查受影响的页面与测试，不要假设本地副本仍是最新。
- 遇到合并或变基冲突时，不要强行覆盖远端改动；解决冲突后重新验证再继续。

## 提交前

- 只提交本次任务相关的文件。
- 检查 `git status`，不要把截图、调试产物、本地预览缓存等临时文件带入提交。
- 涉及官网 `docs/` 的改动，至少验证 HTML 结构、meta 与 JSON-LD、相对链接，并确认 `sitemap.xml` 与实际页面一致。

## 推送

- 推送前再次 `git pull --rebase`，确认本地领先且没有分叉。
- 推送到 `main` 会触发 GitHub Pages 重建；推送后确认 Pages 构建成功。
