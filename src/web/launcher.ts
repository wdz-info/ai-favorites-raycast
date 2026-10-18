import { spawn } from "node:child_process";
import { readFile, open, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { withDirectoryLock } from "../core/atomic-json";
import { sha256 } from "../core/favorite-service";
import { storageDirectory } from "../core/paths";
import type { Preferences } from "../services";
import { WEB_API_VERSION } from "./server";

export interface WebState {
  origin: string;
  token: string;
  buildId: string;
  profileKey: string;
}
export function webProfile(preferences: Preferences) {
  return sha256(
    JSON.stringify(
      Object.fromEntries(
        Object.entries({ ...preferences, storageDirectory: storageDirectory(preferences.storageDirectory) }).sort(
          ([a], [b]) => a.localeCompare(b),
        ),
      ),
    ),
  );
}
export async function reachable(state: WebState) {
  try {
    const url = new URL(state.origin);
    if (url.hostname !== "127.0.0.1" || url.protocol !== "http:" || !/^[a-f0-9]{64}$/.test(state.token)) return false;
    const response = await fetch(`${state.origin}/api/health`, {
      headers: { Authorization: `Bearer ${state.token}` },
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return false;
    const health = (await response.json()) as { apiVersion: number; buildId: string; profileKey: string };
    return (
      health.apiVersion === WEB_API_VERSION &&
      health.buildId === state.buildId &&
      health.profileKey === state.profileKey
    );
  } catch {
    return false;
  }
}

// Serialize launch across commands; reuse only a server that proves its identity with the private token.
export async function ensureWebServer(preferences: Preferences, entryPath: string): Promise<string> {
  const directory = storageDirectory(preferences.storageDirectory);
  const entry = resolve(entryPath);
  let bytes: Buffer;
  try {
    bytes = Buffer.concat(
      await Promise.all(
        [entry, ...["app.js", "style.css", "index.html"].map((name) => join(dirname(entry), name))].map((file) =>
          readFile(file),
        ),
      ),
    );
  } catch {
    throw new Error("网页服务尚未构建，请先在扩展项目执行 npm run build:web，再重新加载命令。");
  }
  const buildId = sha256(bytes),
    profileKey = webProfile(preferences);
  return withDirectoryLock(directory, ".web-launch-lock", async () => {
    const statePath = join(directory, "web-service.json");
    let existing: WebState | undefined;
    try {
      existing = JSON.parse(await readFile(statePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    if (existing && (await reachable(existing))) {
      if (existing.buildId === buildId && existing.profileKey === profileKey)
        return `${existing.origin}/#token=${existing.token}`;
      const response = await fetch(`${existing.origin}/api/shutdown`, {
        method: "POST",
        headers: { Authorization: `Bearer ${existing.token}` },
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) throw new Error("旧网页服务无法停止，请关闭旧服务后重试。");
    }
    const log = await open(join(directory, "web-service.log"), "a", 0o600);
    const child = spawn(process.execPath, [entry], {
      detached: true,
      stdio: ["ignore", "ignore", log.fd],
      env: { ...process.env, AI_FAVORITES_WEB_CONFIG: JSON.stringify(preferences), AI_FAVORITES_WEB_BUILD: buildId },
      cwd: directory,
    });
    let spawnError: Error | undefined;
    child.once("error", (error) => {
      spawnError = error;
    });
    child.unref();
    await log.close();
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error("网页服务启动失败，请查看资料库中的 web-service.log。");
      try {
        const state = JSON.parse(await readFile(statePath, "utf8")) as WebState;
        if (state.buildId === buildId && state.profileKey === profileKey && (await reachable(state)))
          return `${state.origin}/#token=${state.token}`;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // This child belongs to this launch; terminate it rather than leave a late duplicate listener.
    child.kill();
    await rm(statePath, { force: true }).catch(() => {});
    throw new Error("网页服务未在 10 秒内就绪，请查看 web-service.log 后重试。");
  });
}
