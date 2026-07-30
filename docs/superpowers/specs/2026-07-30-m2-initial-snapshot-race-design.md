# M2 初始页面快照竞态修复设计

日期：2026-07-30  
状态：已审阅，用户决定不实施；当前版本保留人工“重新读取页面”步骤

## 背景与根因

M2 构建正确加载后，未登录的 BOSS 首页首次显示“等待页面读取”。人工点击“重新读取页面”后，状态立即变为“BOSS 当前未登录”。这证明页面分类、background 路由、frame 协调器和面板渲染链路都能工作。

当前初始化顺序是：top frame 挂载 React 面板，然后立即启动 parser coordinator；coordinator 同步生成并发送首个快照，而 React 的 `useEffect` 要到面板提交后才注册 `ARC_PARSER_RELAY` 监听器。首条 relay 因此可能在订阅建立前到达并丢失。background 当前不缓存快照，客户端也不会在订阅后主动索取现状，所以 UI 会一直等待到 DOM 变化或人工刷新。

## 目标

- 新加载或刷新页面时，面板无需人工点击即可收到首个页面快照。
- 消息监听器必须先建立，初始读取请求随后才发送。
- 保持 parser 只读：不得点击、滚动、导航、输入、登录、打开候选人或调用 BOSS 接口。
- 保留现有人工“重新读取页面”入口。
- 初始请求失败时不伪造页面状态，也不影响本机演示服务和演示评估。

## 非目标

- 不增加 background 快照持久化或跨 Service Worker 生命周期恢复。
- 不改变 BOSS DOM 分类器和字段选择器。
- 不隐藏或替换当前明确标注的 M1 演示评估。
- 不处理登录后真实页面准确率；该验收仍需用户手动登录并授权。

## 方案比较

### 方案 A：订阅后请求一次初始快照（采用）

面板 effect 先调用 `subscribeToParserRelays`，随后调用现有 `requestParserRefresh`。background 将固定的 refresh command 广播到当前 tab 的 content frames，各 coordinator 对当前 DOM 做一次只读解析并返回快照。

优点是复用现有协议、改动小、顺序确定，也不引入延时猜测。代价是页面初始化时多执行一次轻量 DOM 读取。

### 方案 B：background 缓存并回放最后快照

background 按 tab、frame 和 document 保存最后快照，面板启动时查询缓存。它能避免重新解析，但会引入缓存清理、文档切换和 Service Worker 重启语义，超出本次缺陷所需范围。

### 方案 C：延迟 coordinator 首次发送

用 timeout 等待面板监听器。实现最少，但没有可靠的先后关系，慢机器或 React 调度变化仍可能复现，因此不采用。

## 组件与数据流

1. `CopilotPanel` 挂载。
2. parser relay effect 同步注册唯一的 runtime listener。
3. 同一 effect 在 listener 注册完成后发出一次 `ARC_PARSER_REFRESH`。
4. background 只接受来自 frame 0 的 refresh request，并向同一 tab 发送 `ARC_PARSER_REFRESH_COMMAND`。
5. 各 frame coordinator 强制生成一次当前快照；top frame 的 logged-out 快照具有安全优先级。
6. 已注册的 listener 接收 relay，继续使用 `acceptParserRelay` 的时间戳、水位线和 shell/candidate 优先规则更新 UI。
7. effect 卸载时移除同一个 listener；异步请求完成后不得更新已卸载组件。

现有人工按钮仍调用同一个 `requestParserRefresh`，每次点击只新增一次请求。
自动初始请求不设置人工按钮使用的 `parserRefreshing` 状态，因此即使 background 确认请求但没有返回 relay，人工重试入口也不会被永久禁用。

## 状态与失败处理

- 初始请求开始时不显示虚假的 candidate 或 logged-out 状态；在首条合法 relay 到达前保持“等待页面读取”。
- 初始请求失败时继续显示等待状态并保留可用的人工重试按钮；错误在组件边界内收敛，不展示底层 transport 细节。
- 非法 ACK、runtime rejection 或组件已卸载都不得产生未处理 Promise rejection。
- 初始请求和人工请求不得触发剪贴板、scroll、focus、click、navigation 或 BOSS 网络请求。
- 本机 API 在线/离线状态与页面读取状态继续独立显示。

## 测试设计

先新增失败测试，再修改实现：

1. 渲染 `CopilotPanel` 后，验证 relay subscription 已建立，并自动调用一次 `requestParserRefresh`。
2. 用调用顺序断言确认 subscription 早于 initial refresh。
3. initial refresh rejection 不产生未处理异常，人工重试按钮保持可用。
4. 用户点击“重新读取页面”后，调用总数从一次增加到两次，证明人工操作没有被自动初始化吞掉或重复执行。
5. 现有 logged-out、partial profile、水位线、路由、安全副作用和完整扩展测试继续通过。

## 验收标准

- 重新构建并重新加载正确的 M2 `extension/dist` 后，刷新未登录 BOSS 首页，不点击面板即可显示“BOSS 当前未登录”。
- 页面只出现一个悬浮窗。
- 观察 60 秒无自动刷新、跳转或其他页面操作。
- 人工点击“重新读取页面”一次仍能返回 logged-out 状态。
- DevTools Network 中 parser 不发起 BOSS 请求；现有 localhost health 请求允许出现。
- 登录后五个匿名样本和 95% 字段准确率仍是独立的后续 gate。

## 记录边界

验证日志只记录匿名状态、命令结果和安全观察，不保存候选人字段值、HTML、截图、姓名、电话、邮箱或简历正文。
