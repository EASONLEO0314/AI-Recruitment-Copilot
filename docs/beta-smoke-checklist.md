# AI Recruitment Copilot Beta Smoke Checklist

版本：0.2.0-beta.1
日期：2026-08-14

## 发布前准备

- 确认 `.env` 已配置本机需要的 LLM key，且 `.env` 不提交到 Git。
- 重新生成岗位知识库：

```bash
.venv/bin/python scripts/build_job_knowledge_base.py /Users/eason/Documents/招聘信息表.xlsx
```

- 启动本机服务：

```bash
.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8765
```

- 构建插件：

```bash
npm run build:extension
```

- 在 `chrome://extensions` 刷新 AI Recruitment Copilot 扩展，再刷新 BOSS 页面。

## 冒烟流程

1. 打开候选人页面，确认插件显示“评分服务在线”。
2. 切换岗位下拉框，确认真实规则评分区域显示当前岗位。
3. 点击“重新读取页面”，确认候选人姓名、经验、教育、工作、项目和覆盖率刷新。
4. 点击“读取当前简历”，确认页面读取卡片可以展开和收起。
5. 点击“分析候选人”，确认评分不再显示演示数据，且结果随候选人变化。
6. 等待 AI 解释或降级提示，确认规则评分仍可用。
7. 查看“AI 个性化追问”，确认问题与候选人证据相关。
8. 点击单条复制和复制全部，确认剪贴板内容正确。
9. 切换另一个候选人，确认旧评分不会残留。
10. 折叠插件面板，拖动折叠 rail 到左侧和右侧，确认可展开。
11. 展开插件面板，拖动顶部栏到左侧和右侧，确认位置保存。
12. 打开“后台”，确认导入质量能显示缺关键词岗位和建议关键词。

## 已知限制

- DeepSeek 首次响应可能较慢，超时后会保留规则评分和规则解释。
- 本机开发默认监听 `127.0.0.1:8765`；服务器版安装和分发见 `docs/server-deployment-and-plugin-use.md`。
- 原始岗位表仍有岗位缺少“岗位关键词（必备技能）”，管理页会显示岗位和建议补词。
- OCR 读取只在用户点击“读取当前简历”时触发，并只发送到评分服务。
- 若修改扩展源码，必须重新构建并在 `chrome://extensions` 刷新扩展。

## 自动验证

```bash
PYTHONPYCACHEPREFIX=/private/tmp/arc-pycache .venv/bin/python -m pytest backend/tests -q
npm run test:extension
npm run typecheck:extension
npm run build:extension
git diff --check
```
