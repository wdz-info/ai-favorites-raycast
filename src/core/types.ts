export type FavoriteType = "session" | "message" | "file";
export type ProviderId = "codex" | "claude" | "kiro" | "gemini" | "opencode" | "grok" | "manual";

export interface Verification {
  status: "unverified" | "verified" | "invalid";
  project?: string;
  version?: string;
  date?: string;
  note?: string;
}

export interface SourceLocation {
  logPath?: string;
  line?: number;
  format?: "jsonl" | "json" | "sqlite";
  jsonPath?: (string | number)[];
  table?: "conversations" | "conversations_v2";
  recordKey?: string;
  conversationId?: string;
  label?: string;
  url?: string;
  application?: string;
  captureMethod?: "selection" | "clipboard" | "manual";
}

export interface SessionSummary {
  id: string;
  provider: ProviderId;
  title: string;
  projectPath?: string;
  logPath: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  fingerprint?: string;
  source?: SourceLocation;
  sourceKind?: "kiro-cli" | "kiro-ide";
}

export interface SessionMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  line: number;
  phase?: string;
  source?: SourceLocation;
}

export interface SessionFile {
  path: string;
  line: number;
  origin: "patch" | "reference";
}

export interface Session extends SessionSummary {
  messages: SessionMessage[];
  files: SessionFile[];
  warnings: string[];
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  listSessions(): Promise<{ sessions: SessionSummary[]; warnings: string[] }>;
  readSession(summary: SessionSummary): Promise<Session>;
}

export interface AIFavorite {
  id: string;
  type: FavoriteType;
  provider: ProviderId;
  sessionId?: string;
  messageId?: string;
  filePath?: string;
  projectPath?: string;
  title: string;
  content: string;
  context?: { question?: string; previousAssistant?: string };
  source: SourceLocation;
  snapshot: { sha256: string; capturedAt: number; fileModifiedAt?: number; sourceFingerprint?: string };
  tags: string[];
  note?: string;
  applicability?: string;
  verification?: Verification;
  recommended?: boolean;
  versionGroupId?: string;
  createdAt: number;
  updatedAt: number;
}

export type FavoriteDraft = Omit<AIFavorite, "id" | "createdAt" | "updatedAt" | "tags" | "note">;
export interface FavoriteMetadata {
  title: string;
  tags: string[];
  note: string;
  applicability?: string;
}
