import { FavoriteDraft, ProviderId, SourceLocation } from "./types";
import { sha256 } from "./favorite-service";

export async function captureText(
  selected: () => Promise<string>,
  clipboard: () => Promise<string | undefined>,
): Promise<{ text: string; method: "selection" | "clipboard" | "manual"; selectionIssue?: string }> {
  let selectionIssue: string | undefined;
  try {
    const text = await selected();
    if (text.trim()) return { text, method: "selection" as const };
  } catch (error) {
    selectionIssue = error instanceof Error ? error.message : String(error);
  }
  try {
    const text = await clipboard();
    if (text?.trim()) return { text, method: "clipboard" as const, ...(selectionIssue ? { selectionIssue } : {}) };
  } catch {
    /* Keep the form usable for a manual paste. */
  }
  return { text: "", method: "manual" as const, ...(selectionIssue ? { selectionIssue } : {}) };
}

export function capturedDraft(
  title: string,
  content: string,
  provider: ProviderId,
  source: SourceLocation,
): FavoriteDraft {
  if (!content.trim()) throw new Error("请填写收藏内容。");
  if (!source.label?.trim()) throw new Error("请补充来源说明。");
  return {
    type: "message",
    provider,
    title,
    content,
    source,
    snapshot: { sha256: sha256(JSON.stringify({ content, source })), capturedAt: Date.now() },
  };
}
