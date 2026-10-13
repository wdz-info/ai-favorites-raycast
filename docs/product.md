# 产品构想：Raycast AI Favorites

## 一、产品定位

基于 **Raycast Extension** 开发一个统一的 AI 编程知识收藏夹，用于收藏、管理、检索和回顾 AI 编程过程中产生的有价值内容。

**核心理念：将 AI 对话中的临时信息转化为可长期积累、快速检索、随时复用的个人知识资产。**

首期支持 **Codex**，后续扩展 Claude Code、Kiro、Gemini CLI、OpenCode 等工具。

## 二、核心功能

| 功能模块 | 功能描述 | 优先级 |
|---|---|---|
| ⭐ 会话收藏 | 收藏指定 Codex 会话，保留原始会话关联 | P0 |
| 💬 回复收藏 | 收藏会话中的指定 AI 回复，而非整个会话 | P0 |
| 📁 文件收藏 | 收藏 AI 生成或修改的指定文件 | P0 |
| 🔍 全局搜索 | 跨项目搜索所有收藏内容 | P0 |
| ⚡ 快速访问 | 通过 Raycast 快捷键随时打开收藏夹 | P0 |
| 📖 内容预览 | 直接在 Raycast 中阅读收藏内容 | P0 |
| 🏷️ 标签管理 | 为收藏添加标签，实现分类管理 | P1 |
| 📝 收藏备注 | 为收藏内容添加个人备注 | P1 |
| 🔗 原始定位 | 跳转至原始会话、消息或文件 | P1 |
| 📂 项目分类 | 根据 Codex 工作目录自动归类 | P1 |
| 📋 快速复制 | 一键复制回复、代码或文件路径 | P1 |
| 🔄 自动同步 | 自动发现 Codex 历史会话及内容变化 | P2 |
| 🤖 AI 语义搜索 | 通过自然语言查找历史收藏 | P2 |
| 🌐 多 Agent 支持 | Claude Code、Kiro、Gemini CLI 等 | P2 |

## 三、Raycast 交互设计

### 1. 统一收藏夹

通过 Raycast 输入 `AI Favorites`：

```text
⭐ AI Favorites
──────────────────────────────────────
🔍 Search favorites...

⭐ Sessions
   通用下载平台架构设计
   Kalshi Funding Payment 接口设计

💬 Messages
   HTTP API 适配器设计
   Redis 分布式锁实现方案
   SSHJ 与 JSch 兼容性分析

📁 Files
   GenericFileDownloadService.java
   architecture.md
   download-sequence.puml
──────────────────────────────────────
```

支持根据收藏类型、项目、标签快速过滤。

### 2. 收藏操作

理想情况下，支持两种收藏方式。

**方式 A：从历史会话中收藏**

```text
Raycast → Browse Codex Sessions
    ↓
选择会话
    ↓
浏览消息 / 文件
    ↓
⌘ + Enter → Add to Favorites
```

**方式 B：快捷收藏**

```text
Raycast → Add AI Favorite
    ↓
选择类型
    ├── Session
    ├── Message
    └── File
    ↓
保存
```

后续可以进一步探索从 Codex Desktop 快速定位当前会话的能力。

## 四、收藏数据设计

建议所有收藏统一使用一套数据模型：

```typescript
interface AIFavorite {
  id: string;

  // 收藏类型
  type: "session" | "message" | "file";

  // 来源
  provider: "codex" | "claude" | "kiro" | "opencode";

  // 关联信息
  sessionId?: string;
  messageId?: string;
  filePath?: string;
  projectPath?: string;

  // 收藏内容
  title: string;
  content?: string;

  // 知识管理
  tags: string[];
  note?: string;

  // 时间
  createdAt: number;
  updatedAt: number;
}
```

需要特别注意三个问题。

### 1. 收藏内容不能只保存引用

例如 Codex 历史会话被清理后，收藏的回复仍然应该能够阅读。

因此建议采用：

- 原始内容引用：支持跳转。
- 收藏时的内容快照：支持长期保存。

### 2. 文件收藏需要考虑版本

Codex 可能多次修改同一个文件。

建议支持收藏文件的特定版本，而不是只保存文件路径，避免后续修改覆盖原始内容。

### 3. 消息收藏需要保留上下文

单独收藏 AI 回复，有时无法理解它解决的具体问题。

建议同时保存对应的用户问题，必要时附带相邻消息。

## 五、技术方案

| 技术组件 | 建议 |
|---|---|
| 开发框架 | Raycast Extension API |
| 开发语言 | TypeScript + React |
| 数据来源 | Codex 本地会话记录 |
| 数据存储 | SQLite 或本地 JSON |
| 搜索 | SQLite FTS5 或本地全文索引 |
| 内容展示 | Raycast Detail + Markdown |
| 快捷操作 | Raycast Actions |
| 多 Agent 扩展 | Provider Adapter |

整体架构：

```text
                  Raycast Extension
                         │
             ┌───────────┴───────────┐
             │                       │
       Browse Sessions          My Favorites
             │                       │
             └───────────┬───────────┘
                         │
                  Favorite Service
                         │
             ┌───────────┴───────────┐
             │                       │
       Provider Adapter         Local Storage
             │                       │
       ┌─────┴─────┐            Favorites DB
       │           │
     Codex       Claude
       │           │
   Session Logs  Session Logs
```

这里需要区分：**读取 Codex 本地历史记录是可探索的技术路径，但直接控制 Codex Desktop 当前会话、跳转指定消息，仍需要验证其支持能力。**

## 六、MVP 第一阶段

建议第一版只做四件事：

1. **Browse Codex Sessions**：读取并浏览本地 Codex 历史会话。
2. **Add Favorite**：收藏指定会话、AI 回复、文件。
3. **My Favorites**：集中查看所有收藏内容。
4. **Search Favorites**：全文搜索收藏内容，并支持 Markdown 阅读和复制。

第一版不需要 AI、不需要云同步，也不需要复杂的知识库功能。

重点是把 **收藏 → 搜索 → 阅读 → 复用** 这个流程做好。

## 七、未来扩展方向

这个项目最大的潜力不只是 Codex 收藏夹，而是成为一个 **跨 AI Agent 的个人知识管理入口**。

例如，之前使用 Claude Code 解决过某个 Java 问题，现在使用 Codex 遇到类似问题，可以直接通过 Raycast 找到之前收藏的方案。

这意味着收藏内容不再依赖具体的 AI 工具。

**最终产品定位：**

> **AI Favorites for Raycast — Bookmark anything valuable from your AI coding sessions.**
>
> 一个面向 AI 编程工具的统一收藏夹，让重要的会话、回复和文件随时可查、随时可读、随时可复用。

建议将这个项目作为一个**独立的开源 Raycast Extension**，而不是 Codex 专属插件。第一阶段专注 Codex，但从一开始就设计多 Agent 适配接口，为后续扩展留出空间。
