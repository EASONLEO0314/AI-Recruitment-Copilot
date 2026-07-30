# 未登录公开职位卡片临时探针设计

日期：2026-07-30
状态：设计已确认，等待书面设计审阅

## 背景

M2 扩展已经能在未登录的 BOSS 求职首页通过被动 DOM 读取识别登录状态。用户希望在登录 HR 账号前，进一步验证扩展是否能读取一个已经渲染且可见的公开职位卡片，并观察这次只读操作是否伴随验证码、自动刷新、跳转或访问限制。

本次目标是一次性安全诊断，不是产品功能。诊断结果只输出到当前页面的 DevTools Console，不进入候选人快照、background 路由、本机 API、演示评估或持久化。完成未登录观察并记录结果后，必须删除探针，再开始 HR 登录验收。

## 目标

- 仅在用户明确点击“重新读取页面”后，读取首个已经可见的公开职位卡片。
- 最多读取职位名、公司和地点三个字段。
- Console 输出结构化、限长、无链接和无标识符的诊断结果。
- 保持零自动页面操作和零 BOSS 主动网络请求。
- 能明确区分“读取成功”“部分字段缺失”和“未找到卡片”。
- 完成观察后从扩展代码中删除全部临时探针逻辑和日志。

## 非目标

- 不读取第二个或更多职位卡片。
- 不点击职位、不打开详情、不滚动页面、不翻页、不搜索。
- 不读取职位描述、薪资、标签、职位 ID、链接、公司详情或整张卡片文本。
- 不把公开职位映射到 `CandidateProfile`，也不改变现有 parser snapshot 协议。
- 不尝试绕过、规避或对抗 BOSS 风控。
- 不根据一次观察承诺后续 HR 登录绝对不会触发风控。

## 方案比较

### 方案一：扩展内一次性 Console 探针（采用）

在 top-frame coordinator 收到人工 refresh command 时调用临时纯 DOM 读取器。读取器返回限长结果，由注入页面的 content script 使用固定前缀输出一次 `console.info`。

这个方案验证的是真实扩展 content script 读取路径，触发时机可控，也不会污染候选人消息协议。代价是需要在验收后明确删除临时代码。

### 方案二：DevTools 手工粘贴脚本

不修改仓库，但只能证明页面自身 JavaScript 能读取 DOM，不能完整代表扩展 content script 的执行边界，并增加用户粘贴脚本的操作成本，因此不采用。

### 方案三：新增长期公开职位数据协议

将职位数据传到 background 或面板，便于长期使用，但需要新契约、验证和 UI，明显超出一次性安全诊断范围，因此不采用。

## 组件边界

### 临时公开职位读取器

新增一个独立、可测试的临时模块。它只接收 `Document`，不访问 `chrome`、`fetch`、storage、clipboard、timer 或全局导航 API。

读取顺序：

1. 查找可见的 `a[href*="/job_detail/"]`。
2. 只选择第一个可见匹配项。
3. 在该链接所属的最小职位卡片容器内，使用集中定义的有限 selector 集合查找职位名、公司和地点。
4. 每个结果执行空白规范化并截断到 80 个字符。
5. 不使用整页 `textContent`、`innerText` 或 HTML 作为回退。

读取结果类型固定为：

```ts
interface PublicJobProbeResult {
  status: 'success' | 'partial' | 'not_found';
  title?: string;
  company?: string;
  location?: string;
}
```

当三个字段都存在时为 `success`；至少一个字段存在但不完整时为 `partial`；找不到可见职位卡片或三个字段都缺失时为 `not_found`。

### Coordinator 触发边界

初始 `run()`、MutationObserver 和普通页面变化不得调用探针。只有同时满足以下条件时运行一次：

- 当前是 top frame；
- `page_kind` 为 `logged_out`；
- coordinator 收到 `ARC_PARSER_REFRESH_COMMAND`，即用户点击面板“重新读取页面”。

探针不影响原有 logged-out snapshot 的生成、去重、路由和 UI 状态。

### Console 输出边界

每次人工点击最多输出一条：

```text
[ARC public job probe] { status, title, company, location }
```

输出对象不得包含 URL、href、职位 ID、DOM、HTML、整卡文本、Cookie、storage、账号信息或候选人信息。底层异常被转换为 `{ status: 'not_found' }`，不得把异常内容或页面内容写入 Console。

## 安全约束

- 不调用 `fetch`、XHR、WebSocket 或 BOSS 私有接口。
- 不调用 `click`、`focus`、`scrollTo`、navigation、form submit 或输入事件。
- 不创建 MutationObserver，不增加轮询或自动重试。
- 不访问 Cookie、localStorage、sessionStorage、剪贴板或浏览历史。
- 不保存或传输读取结果。
- 出现验证码、自动刷新、访问限制或意外跳转时立即停止，不进行重复试探。

## 测试设计

严格按测试先行实现：

1. 纯读取器从一个可见职位卡片 fixture 读取三个字段，并验证规范化和 80 字上限。
2. 隐藏卡片早于可见卡片时只读取首个可见卡片。
3. 缺少部分字段时返回 `partial`，不存在可见职位卡片时返回 `not_found`。
4. 读取器不返回链接、职位 ID、整卡文本或未声明字段。
5. coordinator 初始运行和 DOM mutation 不调用探针。
6. top-frame、logged-out、人工 refresh 组合只调用一次探针并输出一条固定前缀日志。
7. 非 top-frame、非 logged-out 或重复的内部非人工运行不调用探针。
8. 现有 parser、router、UI、Manifest 和安全扫描继续通过。

## 人工观察流程

1. 保持 BOSS 未登录，打开 DevTools Console 和 Network。
2. 清空 Console 与 Network 记录，不滚动页面。
3. 点击扩展“重新读取页面”一次。
4. 记录 Console 中探针的 `status`，并人工核对最多三个公开字段；验证日志不保存实际字段值。
5. 观察 60 秒，记录是否出现验证码、刷新、跳转或访问限制。
6. 检查本次点击后没有由扩展发起的 BOSS 请求；现有 localhost health 请求允许出现。
7. 出现任何停止条件时立即结束，不再次点击。

## 验收与清理

本次诊断只能形成“本次观察到”或“本次未观察到”的结论，不能证明 BOSS 永远不会触发风控。

在进入 HR 登录测试前必须完成清理：删除临时读取器、Console 输出、测试 fixture 和所有临时调用点；重新运行自动验证和生产安全扫描；重新构建并刷新扩展。最终 HR 测试构建不得包含 `[ARC public job probe]` 字符串或公开职位读取 selector。

## 数据记录边界

验证日志只记录匿名事实，例如 `probe_status=success`、是否出现刷新或验证码、是否观察到扩展发起的 BOSS 请求。不得记录实际职位名、公司、地点、链接、页面 HTML、截图、账号信息或候选人信息。
