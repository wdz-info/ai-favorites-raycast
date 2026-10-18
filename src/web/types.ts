import type { AIFavorite, Session, SessionSummary } from "../core/types";
import type { HistoryPeriod } from "./history-groups";

export type WebFavorite = Omit<AIFavorite, "directorySnapshot"> & {
  directory?: { entryPath?: string; fileCount: number };
};
export interface FavoriteRow {
  id: string;
  type: AIFavorite["type"];
  provider: AIFavorite["provider"];
  title: string;
  projectPath?: string;
  tags: string[];
  snippet: string;
  verification?: AIFavorite["verification"];
  recommended?: boolean;
  updatedAt: number;
  directory: boolean;
}
export interface LibraryResult {
  items: FavoriteRow[];
  total: number;
  allCount: number;
  projects: string[];
  tags: string[];
  counts: Record<string, number>;
}
export interface DetailResult {
  favorite: WebFavorite;
  markdown: string;
  versions: { id: string; title: string; capturedAt: number; sha256: string; recommended?: boolean }[];
}
export type WebSessionSummary = SessionSummary & { key: string };
export interface HistoryResult {
  now: number;
  items: WebSessionSummary[];
  total: number;
  warnings: string[];
  categories: { provider: string; count: number; periods: Record<HistoryPeriod, number> }[];
}
export interface SessionResult {
  session: Session;
  key: string;
}
