import { readFile } from "node:fs/promises";
import { SourceLocation } from "./types";
import { lines } from "../providers/history-files";
import { readDatabaseRecord } from "../providers/sqlite";

export async function readSource(location: SourceLocation): Promise<string> {
  if (!location.logPath) throw new Error("该收藏没有关联原始记录。");
  let value: unknown;
  if (location.format === "sqlite") value = await readDatabaseRecord(location);
  else if (location.format === "json") value = JSON.parse(await readFile(location.logPath, "utf8"));
  else {
    for await (const row of lines(location.logPath))
      if (row.line === (location.line || 1)) return JSON.stringify(JSON.parse(row.text), null, 2);
    throw new Error("原始记录已不存在，已收藏的快照仍可阅读。");
  }
  for (const segment of location.jsonPath || []) {
    if (!value || typeof value !== "object" || !(segment in value))
      throw new Error("原始消息已不存在，已收藏的快照仍可阅读。");
    value = (value as Record<string | number, unknown>)[segment];
  }
  return JSON.stringify(value, null, 2);
}
