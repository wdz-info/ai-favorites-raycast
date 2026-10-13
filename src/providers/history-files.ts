import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { isAbsolute, join, resolve } from "node:path";
import { sha256 } from "../core/favorite-service";
import { SessionFile } from "../core/types";
export type RecordValue = Record<string, unknown>;
export function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : {};
}
export async function* lines(path: string): AsyncGenerator<{ text: string; line: number }> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  let line = 0;
  try {
    for await (const text of reader) yield { text, line: ++line };
  } finally {
    reader.close();
    stream.destroy();
  }
}

export async function discover(root: string, warnings: string[], suffix = ".jsonl"): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    warnings.push(`无法读取 ${root}： ${(error as Error).message}`);
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await discover(path, warnings, suffix)));
    else if (entry.isFile() && entry.name.endsWith(suffix)) files.push(path);
  }
  return files;
}

export function collectFiles(
  input: string,
  cwd: string | undefined,
  line: number,
  files: Map<string, SessionFile>,
): void {
  // Patches may be nested in a JavaScript tool call containing escaped newlines.
  const normalized = input.replace(/\\n/g, "\n").replace(/\\"/g, '"');
  const add = (path: string, origin: SessionFile["origin"]) => {
    path = path.trim();
    if (!path || (!isAbsolute(path) && !cwd)) return;
    const absolute = isAbsolute(path) ? path : resolve(cwd!, path);
    const existing = files.get(absolute);
    if (!existing || origin === "patch") files.set(absolute, { path: absolute, line, origin });
  };
  for (const match of normalized.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): ([^\r\n]+)/gm))
    add(match[1], "patch");
  // Only explicit file links/inline paths are offered as references, never executed.
  for (const match of input.matchAll(/\]\(<?(\/[^\n)>]+)>?\)|`((?:\/|\.\/)[^`\n]+)`/g)) {
    const path = (match[1] || match[2]).replace(/:\d+(?::\d+)?$/, "");
    add(path, "reference");
  }
}

export async function fingerprint(paths: string[], metadata: unknown): Promise<string> {
  const signatures = await Promise.all(
    paths.map(async (path) => {
      try {
        const info = await stat(path);
        return [path, info.size, info.mtimeMs, info.ctimeMs];
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [path, "missing"];
        throw error;
      }
    }),
  );
  return sha256(JSON.stringify([metadata, signatures]));
}
