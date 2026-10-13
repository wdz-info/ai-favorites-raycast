# AI 收藏夹 · AI Favorites for Raycast

独立的 Raycast Extension，用来收藏、检索和复用 Codex、Kiro、Grok 编程会话中的内容。会话、回复和文件均保存独立快照；原始记录删除后仍可阅读。界面与操作菜单使用中文。

## 本地安装

需要 macOS、Raycast 和 Node.js 22.22.2 或更高版本。无需 AI 订阅、API Key 或云服务。

```bash
git clone https://github.com/wdz-info/ai-favorites-raycast.git
cd ai-favorites-raycast
npm ci
npm run dev
```

在下载的扩展目录运行。开发命令将扩展导入本机 Raycast 并监听改动，可在导入后停止监听。构建产物位于 `dist/`。当前通过源码安装，尚未发布到 Raycast Store。

| Raycast 命令       | 用途                                                |
| ------------------ | --------------------------------------------------- |
| AI 收藏夹          | 统一阅读、全文搜索与管理收藏                        |
| 浏览 AI 会话       | 浏览 Codex、Kiro、Grok 的历史，收藏会话、回复和文件 |
| 添加 AI 收藏       | 添加三类收藏，补充标签、备注、适用条件              |
| 搜索收藏           | 跨项目检索正文、上下文、路径及元数据                |
| 同步 AI 历史       | 立即同步；后台按一分钟间隔扫描                      |
| 上下文打包         | 多选收藏，补充当前任务，预览后复制 Markdown         |
| 选中文字快捷收藏   | 读取前台选中文字，失败时读取剪贴板，补充标题及来源  |
| 导出到 Obsidian    | 单条或批量保存 Markdown 笔记                        |
| 用报错或代码找收藏 | 提取异常名、类名和关键词，展示匹配依据              |

## 收藏与阅读

运行“浏览 AI 会话”，通过来源筛选选择 Codex、Kiro 或 Grok。选中会话按 `⌘ + Enter` 收藏整个会话；Enter 浏览消息和文件。选中 AI 回复按 `⌘ + Enter` 收藏回复，其快照包含此前用户问题及同一问题下的前一条回复。保存表单可以预览快照、设置标题、标签、备注和适用条件。

“添加 AI 收藏”也支持手动选择文件、来源 Agent 与项目目录。文件收藏保存打开表单时磁盘上的 UTF-8 内容，最大 8 MiB；带 SHA-256、保存时间和文件修改时间。同一路径内容变化后再次收藏，会保留两个独立版本。相同来源及内容重复收藏会保留原有元数据。不会从历史 patch 重建某次工具执行时的文件版本。

收藏列表右侧直接显示 Markdown，Enter 打开阅读页。`⌘ + E` 编辑标题、标签、备注与适用条件，保留已保存内容。标签用英文逗号、中文逗号或换行分隔。全文搜索使用不区分大小写的 Unicode 规范化匹配，多个空格分隔词按 AND 匹配；可同时按类型、Agent、完整项目目录和标签筛选。

操作菜单提供内容、代码、上下文、文件路径、来源位置的复制，以及原始记录定位。移除收藏会先确认；只移除收藏，不修改原始历史或文件。

## 自动同步与 Agent 格式

扩展的自动同步设置默认开启。首次安装后，在 Raycast 搜索“同步 AI 历史”，打开 Actions 并选择 **Activate Background Refresh**，启用每分钟后台扫描。浏览及收藏界面打开时每 15 秒刷新。实际调度由 Raycast 管理，退出 Raycast、休眠或系统调度延迟期间不会保证准点执行；下次运行重新扫描。“同步状态”显示最近扫描、各来源最近完整同步、新增、变化、移除和读取提示。

同步保存独立的 `history-catalog.json`，通过文件状态与元数据识别来源变化。不会覆盖、升级或删除已收藏快照。来源变化时列表提示“来源已更新”；已确认移除时提示“来源已移除”。如果来源扫描失败或不完整，保留旧索引，避免把暂时不可读的历史当作已删除。首次扫描的缺失或损坏记录会显示提示。

| Agent | 当前支持的本地记录                                                                                                                                                          |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex | `sessions/`、`archived_sessions/` JSONL 与 `session_index.jsonl` 标题索引                                                                                                   |
| Kiro  | `~/.kiro/sessions/cli/` 的 CLI 元数据和 JSONL；新版 IDE 的 `session.json` / `messages.jsonl`；旧版 IDE workspace-sessions JSON；CLI SQLite conversations / conversations_v2 |
| Grok  | 官方 Grok CLI 的 `~/.grok/sessions/.../summary.json` 与 `updates.jsonl` 消息流                                                                                              |

仅预览用户消息与可见 AI 回复，排除推理、系统消息及工具输出。Grok 流式文本分片会合并；Kiro 同一消息 ID 的更新会替换未完成的显示版本。SQLite 使用 macOS 自带程序以只读模式读取指定会话表，不访问认证表。ProviderAdapter 保留后续 Agent 接入接口。Grok 网页聊天不是此适配器的数据来源。

## 上下文打包

打开“上下文打包”，按 Enter 选择或取消收藏，也可选择当前搜索结果。`⌘ + Enter` 进入打包，补充当前任务后选择“预览上下文包”，确认内容再复制。

Markdown 包含问题、原始方案、适用条件、代码、标签、备注、验证记录、推荐标记和完整来源。缺失的用户问题及适用条件会明确写“未记录”。不会由 AI 猜测、总结或补写事实。单条收藏操作菜单也提供“生成上下文包”。

## 选中文字快捷收藏

建议在 Raycast 设置中给“选中文字快捷收藏”配置一个空闲 Hotkey。在来源应用中选中文字后直接运行命令，扩展先调用 Raycast 的选中文字 API；无结果或失败时读取剪贴板。两者都不可用时表单允许手动粘贴。

确认内容、标题、来源说明和来源 Agent，可选填写原始链接。剪贴板可能来自别的应用，因此不把当前应用自动当作剪贴板的来源。未确认来源时标记“手动来源”，不编造会话 ID。收藏保存读取方式与选中文字时取得的应用信息。

通过收藏夹内的操作菜单启动时，选区可能已不在来源应用，适合确认剪贴板后收藏。不同 AI 客户端的原生选区读取仍需逐个实测；当前验证记录明确区分 API 边界测试与真实桌面交互。

## Obsidian 导出

单条收藏操作菜单选择“导出到 Obsidian”；批量导出从独立命令或收藏夹操作菜单进入。多选后选择仓库目录及相对导出子目录。可在扩展设置中保存默认仓库，未设置时在表单选择。

每条收藏生成独立 Markdown 文件，YAML 属性保留标签、类型、Agent、ID、来源、快照、验证项目/版本/日期及推荐标记；正文保留备注、适用条件、用户问题、相邻回复、原始内容和来源。遇到同名文件会生成新文件，避免覆盖已在 Obsidian 编辑的笔记。导出结果逐条显示成功或失败，成功项可通过 Obsidian URI 打开，也可在访达定位。子目录不得跳出所选仓库。

## 版本与验证

收藏操作菜单选择“对比收藏版本”，优先列出同一来源的其他快照，也允许选择修正后的另一条回复。差异显示旧/新正文及上下文，支持阅读双方完整快照和复制差异。手动选择“推荐新版”或“推荐旧版”后，两个方案及既有版本归入同一版本组，组内只保留一个推荐标记，旧内容继续保存。推荐标记与验证状态分别管理；推荐不会自动变成已验证。

“记录验证状态”提供“未验证 / 已验证 / 已失效”。标记已验证时需要填写验证项目、版本和日期，可记录测试结果；失效时可记录原因。旧收藏默认未验证。状态在收藏列表、阅读页、上下文包和 Obsidian 笔记中显示。

## 用报错或代码找收藏

粘贴异常堆栈、代码片段或业务关键词。检索先提取异常名、类名和关键词，排除常见语言关键字；英文标识符按完整词项匹配，中文按关键词匹配。结果按权重和更新时间排序，展示命中词项及匹配分，可直接阅读、复制、打包或导出。

当前实现本地词项检索。只有语义相似、没有共同词项的表达可能无结果。语义检索的评估与后续验收建议见 [检索评估](SEARCH-EVALUATION.md)，本版没有嵌入模型或上传收藏。

## 来源定位、设置与数据

- Codex 会话使用 `codex://threads/<sessionId>`。本机应用代码已核对这个格式，实际桌面跳转尚未验收；可关闭链接。指定消息通过 JSONL 行定位，不生成未经验证的消息深链接。
- Kiro 提供会话 ID 复制；Grok 提供恢复命令复制，用户手动运行。原始消息可通过 JSONL 行、JSON 路径或 SQLite 记录定位。
- 文件打开操作指向磁盘当前版本；收藏预览显示保存版本。记录不可用时提示错误，快照继续可读。

| 设置                  | 默认                                                                   |
| --------------------- | ---------------------------------------------------------------------- |
| Codex 历史目录        | `CODEX_HOME` 或 `~/.codex`                                             |
| Kiro 历史目录         | `KIRO_HOME` 或 `~/.kiro`                                               |
| Kiro CLI 旧版数据库   | `~/Library/Application Support/kiro-cli/data.sqlite3`                  |
| Kiro IDE 旧版历史目录 | `~/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent` |
| Grok 历史目录         | `GROK_HOME` 或 `~/.grok`                                               |
| 收藏资料库目录        | `~/Library/Application Support/AI Favorites`                           |
| 自动同步              | 开启                                                                   |
| Codex 会话跳转        | 开启                                                                   |
| Obsidian 仓库与子目录 | 仓库需选择，子目录默认 `AI收藏`                                        |

收藏写入 `favorites.json`，文件权限 `0600`，新建资料库目录 `0700`。备份整个资料库可保留快照、上下文和元数据。修改目录是切换资料库，不自动搬迁。旧版收藏可直接读取，新字段均为可选。

收藏和同步目录分别使用进程间锁、临时文件、文件同步及原子替换。损坏数据会报错并保留原文件。如果异常退出留下 `.write-lock` 或 `.sync-lock`，先关闭相关命令并确认没有操作，再移除对应空锁目录。不要在保存时移除锁。扫描阶段不持有同步锁，提交索引时加锁，并防止旧扫描覆盖更新的结果。

扩展不主动上传日志、收藏或剪贴板，不修改 Agent 历史。复制会进入系统剪贴板；导出会写入用户选定的仓库；原始定位会交给对应本地应用。全局快捷键由用户在 Raycast 设置中选择，扩展不覆盖现有按键。

## 开发与验证

```bash
npm run typecheck
npm run lint:local
npm test
npm run smoke
npm run build
```

`smoke` 只读本机三种真实历史，使用临时收藏目录验证同步、收藏、重载、搜索、打包和导出后清理。不会打印对话正文。UI 测试渲染实际 React 组件，仅模拟原生 Raycast API；这些测试不能替代原生窗口、剪贴板或跨应用选择的实测。

`npm run lint` 另含商店清单和作者身份检查；当前 author `wudaizhuang` 的商店校验返回 404，发布前需填真实 Raycast Store 用户名。本地构建不依赖商店发布。详细结果及未验收项见 [验证记录](VALIDATION.md)。

## 参考与许可证

[产品构想](docs/product.md)、[Raycast Manifest](https://developers.raycast.com/information/manifest)、[选中文字 API](https://developers.raycast.com/api-reference/environment)、[Clipboard](https://developers.raycast.com/api-reference/clipboard)、[Kiro 会话管理](https://kiro.dev/docs/cli/chat/session-management/)、[Grok 会话格式](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/17-sessions.md)、[Obsidian Properties](https://obsidian.md/help/properties)、[Obsidian URI](https://obsidian.md/help/uri)。

MIT。扩展许可证不改变用户收藏内容的原有权利。
