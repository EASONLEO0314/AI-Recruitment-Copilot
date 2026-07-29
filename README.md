# AI Recruitment Copilot

AI Recruitment Copilot 是一个本地优先的招聘辅助工具。当前仓库处于 **M1 代码实现及自动化验证完成、人工 Chrome 验收待执行** 的框架演示阶段：Chrome 网页悬浮窗通过扩展 Service Worker 连接本机 FastAPI 服务，展示由后端确定性计算的演示评估，并提供折叠、证据展开、话术切换和手动复制交互。

> 当前所有候选人、岗位、分数、证据和话术均为明确标注的演示数据。M1 尚未读取真实 BOSS 简历，未调用 LLM，未接入 SQLite，也不会点击、填写或发送网页内容。

## 运行方式与平台边界

当前代码采用本地验证方式：Chrome 扩展连接 Windows 电脑上运行的 FastAPI 服务。这套方式用于 M1 开发和功能验收，不是 HR 最终在 Mac 上的使用方式。

功能验证通过后，计划把 FastAPI、数据库和 LLM 调用迁移到阿里云。届时 HR 的 Mac 只需要 Chrome、已安装的扩展和网络连接，不需要安装 Node.js、Python、SQLite，也不需要手动启动本地服务。

> 阿里云部署和 Mac 端真实验收目前尚未实现。迁移时仍需完成 HTTPS、服务端鉴权、限流、日志脱敏和招聘数据保留策略，不能直接把当前本机接口暴露到公网。

## 当前 M1 本地验证环境（已实现）

以下安装和启动步骤仅适用于当前 Windows 本地验证流程：

- Windows 10/11
- Chrome
- Node.js 24 和 npm
- Python 3.14（可通过 `py -3.14` 调用）

## 计划中的 HR 使用环境（尚未实现）

- macOS
- Chrome
- AI Recruitment Copilot 扩展
- 可访问阿里云服务的网络连接

目标数据流为：扩展在 HR 的 Chrome 中读取当前页面并执行字段筛选和 PII 脱敏，只把业务所需的结构化结果通过 HTTPS 发送到阿里云；评分、LLM 调用和持久化由服务器统一处理。同一扩展构建产物能否在 HR 的实际 Mac 和 BOSS 页面稳定运行，必须经过真实环境验收后才能标记为通过。

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

## 人工 Chrome 验收清单

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
- [ ] 停止后端，再点击在线状态下的“刷新连接”，悬浮窗清除旧结果并显示本机服务未连接及启动命令。
- [ ] 恢复后端后点击“重新连接”，悬浮窗重新显示在线状态和演示评估。

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

最近一次完整自动验证记录为 2026-07-29：后端 12 项测试通过，扩展 23 项测试通过，TypeScript 类型检查和 `content.js` / `background.js` 双入口构建通过。自动验证不替代前述尚未完成的真实 Chrome 人工验收。

## M1 当前已实现的代码范围（人工验收待执行）

- FastAPI 健康检查与请求编号。
- 明确标注为 demo 的评估接口。
- 后端确定性权重校验和总分计算。
- Chrome Manifest V3 构建产物。
- 只允许两个固定本机端点的 MV3 Service Worker 网络代理。
- Shadow DOM 隔离的网页悬浮窗和折叠条。
- 在线、连接中、离线及重试状态。
- 在线状态可手动刷新连接；刷新开始时清除旧评估，连接失败后显示离线说明，恢复服务后可重新连接。
- 分项分数、置信度、理由、证据、亮点、风险和待确认问题展示。
- 三类演示沟通话术的手动切换与复制。

## 尚未实现

- 真实 BOSS 候选人页面解析和列表采集。
- 真实岗位创建、权重编辑和版本保存。
- LLM 评分、证据分析或话术生成。
- SQLite 持久化。
- 账号、权限、云端部署和多人协作。
- Mac HR 端安装包、阿里云 API 地址、HTTPS 鉴权和真实跨平台验收。
- 自动打开候选人、自动翻页、自动填写或自动发送消息。

技术设计见 [`docs/superpowers/specs/2026-07-28-ai-recruitment-copilot-design.md`](docs/superpowers/specs/2026-07-28-ai-recruitment-copilot-design.md)，M1 实施计划见 [`docs/superpowers/plans/2026-07-28-m1-framework-demo.md`](docs/superpowers/plans/2026-07-28-m1-framework-demo.md)。
