import { AIFavorite } from "./types";
function quote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
export function resumeCommand(item: Pick<AIFavorite, "provider" | "sessionId" | "projectPath">): string | undefined {
  if (!item.sessionId) return undefined;
  const command = { codex: "codex resume", kiro: "kiro-cli chat --resume-id", grok: "grok --resume" }[
    item.provider as "codex" | "kiro" | "grok"
  ];
  if (!command) return undefined;
  return `${item.projectPath ? `cd ${quote(item.projectPath)} && ` : ""}${command} ${quote(item.sessionId)}`;
}
