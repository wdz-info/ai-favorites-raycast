import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function expandPath(value: string): string {
  if (/^file:/i.test(value)) value = fileURLToPath(value);
  const expanded = value === "~" ? homedir() : value.startsWith("~/") ? resolve(homedir(), value.slice(2)) : value;
  if (!isAbsolute(expanded)) throw new Error("请使用绝对路径，或以 ~/ 开头的路径。");
  return resolve(expanded);
}

export function codexHome(preference?: string): string {
  return expandPath(preference?.trim() || process.env.CODEX_HOME || `${homedir()}/.codex`);
}

export function storageDirectory(preference?: string): string {
  return expandPath(preference?.trim() || `${homedir()}/Library/Application Support/AI Favorites`);
}

export function kiroHome(preference?: string): string {
  return expandPath(preference?.trim() || process.env.KIRO_HOME || `${homedir()}/.kiro`);
}
export function grokHome(preference?: string): string {
  return expandPath(preference?.trim() || process.env.GROK_HOME || `${homedir()}/.grok`);
}
export function kiroDatabase(preference?: string): string {
  return expandPath(preference?.trim() || `${homedir()}/Library/Application Support/kiro-cli/data.sqlite3`);
}
export function kiroLegacyIde(preference?: string): string {
  return expandPath(
    preference?.trim() || `${homedir()}/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent`,
  );
}
