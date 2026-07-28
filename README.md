# AI Recruitment Copilot

AI Recruitment Copilot 是一个本地优先的招聘辅助工具。当前仓库处于 **M1 框架演示阶段**：Chrome 网页悬浮窗可以连接本机 FastAPI 服务，展示由后端确定性计算的演示评估，并提供折叠、证据展开、话术切换和手动复制交互。

> 当前所有候选人、岗位、分数、证据和话术均为明确标注的演示数据。M1 尚未读取真实 BOSS 简历，未调用 LLM，未接入 SQLite，也不会点击、填写或发送网页内容。

## 环境要求

- Windows 10/11
- Chrome
- Node.js 24 和 npm
- Python 3.14（可通过 `py -3.14` 调用）

## 首次安装

在项目根目录打开 PowerShell：

```powershell
npm.cmd install
py -3.14 -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
```

项目使用 `scripts\python.cmd` 调用 Python。这个入口会加载 `.venv` 中的依赖，同时兼容包含中文字符的项目路径。

## 启动本机服务

```powershell
npm.cmd run start:backend
```

看到 Uvicorn 启动信息后不要关闭这个窗口。可在浏览器访问：

- 健康检查：<http://127.0.0.1:8765/healthz>
- API 文档及扩展验收页：<http://127.0.0.1:8765/docs>

服务只监听 `127.0.0.1:8765`，不会暴露到局域网。

## 构建并加载 Chrome 扩展

另开一个 PowerShell 窗口，在项目根目录运行：

```powershell
npm.cmd run build:extension
```

然后在 Chrome 中：

1. 打开 `chrome://extensions`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目的 `extension\dist` 目录。
5. 打开或刷新 <http://127.0.0.1:8765/docs>。

页面右侧应出现 `AI Recruitment Copilot` 悬浮窗。以后重新构建后，需要在 `chrome://extensions` 中点击该扩展的刷新按钮，再刷新验收页面。

## 明日验收清单

按顺序检查并只记录实际观察到的结果：

- [ ] `http://127.0.0.1:8765/healthz` 返回 `status: ok`。
- [ ] `/docs` 页面右侧出现悬浮窗，原页面仍能滚动和点击。
- [ ] 顶部显示“本机服务在线”，主体显示“演示数据”。
- [ ] 总分显示 `92%`，建议显示“非常匹配，建议联系”。
- [ ] 点击任一匹配维度后，可以展开理由和参考证据。
- [ ] 可以看到候选人亮点、风险提示和建议确认问题。
- [ ] 三个沟通建议标签可以切换。
- [ ] 页面初次展示和切换标签时不会自动复制、填写或发送任何内容。
- [ ] 点击“复制话术”后出现“已复制”，粘贴板内容与当前话术一致。
- [ ] 点击顶部折叠按钮后变为右侧窄条，点击箭头可恢复。
- [ ] 停止后端，再点击“重新连接”，悬浮窗显示本机服务未连接及启动命令。

## 自动验证

在后端未运行时执行以下命令即可完成自动测试、类型检查和生产构建：

```powershell
npm.cmd run verify
```

单独运行各项：

```powershell
npm.cmd run test:backend
npm.cmd run test:extension
npm.cmd run typecheck:extension
npm.cmd run build:extension
```

## M1 已实现

- FastAPI 健康检查与请求编号。
- 明确标注为 demo 的评估接口。
- 后端确定性权重校验和总分计算。
- Chrome Manifest V3 构建产物。
- Shadow DOM 隔离的网页悬浮窗和折叠条。
- 在线、连接中、离线及重试状态。
- 分项分数、置信度、理由、证据、亮点、风险和待确认问题展示。
- 三类演示沟通话术的手动切换与复制。

## 尚未实现

- 真实 BOSS 候选人页面解析和列表采集。
- 真实岗位创建、权重编辑和版本保存。
- LLM 评分、证据分析或话术生成。
- SQLite 持久化。
- 账号、权限、云端部署和多人协作。
- 自动打开候选人、自动翻页、自动填写或自动发送消息。

技术设计见 [`docs/superpowers/specs/2026-07-28-ai-recruitment-copilot-design.md`](docs/superpowers/specs/2026-07-28-ai-recruitment-copilot-design.md)，M1 实施计划见 [`docs/superpowers/plans/2026-07-28-m1-framework-demo.md`](docs/superpowers/plans/2026-07-28-m1-framework-demo.md)。
