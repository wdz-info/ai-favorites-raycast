import { AIFavorite, Session } from "./types";

export function heading(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/[\\`*_{}[\]<>#|]/g, "\\$&");
}

export function sessionMarkdown(session: Session): string {
  return session.messages
    .map((m) => `## ${m.role === "user" ? "用户" : "AI 回复"}\n\n${m.content}`)
    .join("\n\n---\n\n");
}

export function fileMarkdown(content: string, path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() || "text";
  if (["md", "markdown", "mdx"].includes(extension)) return content;
  const runs = content.match(/`+/g) || [];
  const fence = "`".repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
  const language = /^[a-z0-9]+$/.test(extension) ? extension : "text";
  return `${fence}${language}\n${content}\n${fence}`;
}

export function favoriteMarkdown(favorite: AIFavorite): string {
  const sections = [`# ${heading(favorite.title)}`];
  if (favorite.note) sections.push(`## 我的备注\n\n${favorite.note}`);
  if (favorite.applicability) sections.push(`## 适用条件\n\n${favorite.applicability}`);
  if (favorite.context?.question) sections.push(`## 用户问题\n\n${favorite.context.question}`);
  if (favorite.context?.previousAssistant) sections.push(`## 上一条回复\n\n${favorite.context.previousAssistant}`);
  sections.push(favorite.type === "file" ? fileMarkdown(favorite.content, favorite.filePath || "") : favorite.content);
  return sections.join("\n\n---\n\n");
}

export function codeBlocks(content: string): string | undefined {
  const blocks = [...content.matchAll(/^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^\1\s*$/gm)].map((m) => m[2].replace(/\n$/, ""));
  return blocks.length ? blocks.join("\n\n") : undefined;
}
