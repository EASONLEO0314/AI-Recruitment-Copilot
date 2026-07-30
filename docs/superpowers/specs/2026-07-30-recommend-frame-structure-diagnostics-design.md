# 推荐页结构诊断设计

日期：2026-07-30

状态：用户已批准快速实施，并明确跳过额外代码评审

## 背景与证据

当前真实 BOSS 招聘端顶层路径为 `/web/chat/recommend`，页面内存在可见的 `/web/frame/recommend/` iframe。现有分类器已经支持该 iframe 路径，但用户手动点击“重新读取页面”后仍得到“当前页面结构暂不支持”。现有推荐页解析器仅识别旧版候选人卡片选择器，因此需要先获取新版 iframe 的安全结构指纹，再编写准确适配器。

## 目标

- 当 `recommend_frame` 未找到可解析候选人卡片时，在现有快照 `warnings` 中附加有限、可验证的结构诊断项。
- 页面读取卡只展示页面类型、匹配数量和经过清洗的结构 class token。
- 用户无需打开 DevTools，只需刷新扩展、点击一次“重新读取页面”并截取诊断区域。
- 诊断完成并实现新版页面适配后，删除临时结构诊断代码和 UI。

## 非目标

- 不读取或展示候选人姓名、简历正文、公司、学校、项目或联系方式。
- 不输出 URL、href、元素 ID、data 属性、HTML、DOM 节点或页面整段文本。
- 不点击、不滚动、不导航、不访问存储，不调用 BOSS 网络接口。
- 本阶段不猜测新版解析 selector，也不直接修改正式候选人字段解析逻辑。

## 方案

复用现有 `ParserSnapshot.warnings` 通道，不增加新的消息契约。推荐页解析器在旧版卡片选择失败时返回：

- 固定原因 `recommend-active-card-not-found`；
- `structure:card-count=<0-50>`；
- 最多 18 个 `structure:class=<token>`。

class token 必须同时满足：

1. 长度为 1–48；
2. 仅包含 ASCII 字母、数字、下划线和连字符，且以字母开头；
3. 命中结构关键词白名单，例如 `resume`、`geek`、`candidate`、`recommend`、`history`、`experience`、`detail`、`card`、`list`、`section`、`item`、`content`、`name`、`base`、`info`；
4. 去重并保持 DOM 首次出现顺序；
5. 总 warnings 数不超过现有验证器允许的 20 项，每项不超过 160 字符。

读取过程只遍历当前 frame 已渲染 DOM 的 classList，不访问 `textContent`、`innerText`、HTML 或属性值。

## UI

`PageReadingCard` 在 `page_kind === 'recommend_frame'` 且 `status === 'unsupported'` 时显示：

- “已识别 BOSS 推荐页，但候选人结构未匹配”；
- 卡片匹配数量；
- 安全 class token 列表。

其他页面类型继续显示原有文案，任意非 `structure:` warning 仍不得直接渲染。

## 测试与验收

- 解析器测试先证明旧实现没有结构诊断项，再实现并验证白名单、去重、数量和长度边界。
- UI 测试先证明旧 UI 不显示诊断，再验证只显示结构项，不显示任意 warning 文本。
- 运行聚焦测试、扩展类型检查和扩展构建。
- 生产安全扫描必须继续证明没有新增网络、点击、滚动、导航、存储或调试日志。
- 用户只截取插件“页面读取”诊断区域，不提交候选人正文。
