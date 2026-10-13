/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Codex 历史目录 - 留空使用 CODEX_HOME 或 ~/.codex。 */
  "codexHome"?: string,
  /** 收藏资料库目录 - 留空使用 ~/Library/Application Support/AI Favorites，快照独立于 Agent 历史保存。 */
  "storageDirectory"?: string,
  /** Codex 会话跳转 - 打开原始会话；指定消息使用源记录定位。 */
  "openCodexLinks": boolean,
  /** Kiro 历史目录 - 留空使用 KIRO_HOME 或 ~/.kiro；支持 CLI 与 IDE 新版会话。 */
  "kiroHome"?: string,
  /** Kiro CLI 旧版数据库 - 留空读取 macOS kiro-cli 的 data.sqlite3；只读，不访问认证表。 */
  "kiroDatabase"?: string,
  /** Kiro IDE 旧版历史目录 - 留空读取 Kiro 的 kiro.kiroagent 全局存储目录。 */
  "kiroLegacyIde"?: string,
  /** Grok 历史目录 - 留空使用 GROK_HOME 或 ~/.grok；支持官方 Grok CLI 消息流。 */
  "grokHome"?: string,
  /** 自动同步 - 后台每分钟扫描一次，浏览界面打开时每 15 秒刷新；保留已收藏的历史快照。 */
  "autoSync": boolean,
  /** Obsidian 仓库路径 - 留空时每次导出选择仓库目录。 */
  "obsidianVault"?: string,
  /** Obsidian 导出子目录 - 相对于仓库的目录，默认 AI收藏。 */
  "obsidianFolder"?: string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `favorites` command */
  export type Favorites = ExtensionPreferences & {}
  /** Preferences accessible in the `browse-codex-sessions` command */
  export type BrowseCodexSessions = ExtensionPreferences & {}
  /** Preferences accessible in the `add-ai-favorite` command */
  export type AddAiFavorite = ExtensionPreferences & {}
  /** Preferences accessible in the `search-favorites` command */
  export type SearchFavorites = ExtensionPreferences & {}
  /** Preferences accessible in the `sync-sessions` command */
  export type SyncSessions = ExtensionPreferences & {}
  /** Preferences accessible in the `context-pack` command */
  export type ContextPack = ExtensionPreferences & {}
  /** Preferences accessible in the `capture-selection` command */
  export type CaptureSelection = ExtensionPreferences & {}
  /** Preferences accessible in the `export-obsidian` command */
  export type ExportObsidian = ExtensionPreferences & {}
  /** Preferences accessible in the `search-by-code` command */
  export type SearchByCode = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `favorites` command */
  export type Favorites = {}
  /** Arguments passed to the `browse-codex-sessions` command */
  export type BrowseCodexSessions = {}
  /** Arguments passed to the `add-ai-favorite` command */
  export type AddAiFavorite = {}
  /** Arguments passed to the `search-favorites` command */
  export type SearchFavorites = {}
  /** Arguments passed to the `sync-sessions` command */
  export type SyncSessions = {}
  /** Arguments passed to the `context-pack` command */
  export type ContextPack = {}
  /** Arguments passed to the `capture-selection` command */
  export type CaptureSelection = {}
  /** Arguments passed to the `export-obsidian` command */
  export type ExportObsidian = {}
  /** Arguments passed to the `search-by-code` command */
  export type SearchByCode = {}
}
