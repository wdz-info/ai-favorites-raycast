import { ProviderAdapter, SessionSummary } from "../core/types";

export const providerNames = {
  manual: "手动来源",
  codex: "Codex",
  kiro: "Kiro",
  grok: "Grok",
  claude: "Claude",
  gemini: "Gemini",
  opencode: "OpenCode",
};
export function sessionKey(summary: SessionSummary): string {
  return JSON.stringify([
    summary.provider,
    summary.id,
    summary.projectPath || "",
    summary.logPath,
    summary.source?.recordKey || "",
  ]);
}

export class ProviderRegistry {
  constructor(readonly adapters: ProviderAdapter[]) {}
  adapterFor(provider: string): ProviderAdapter {
    const adapter = this.adapters.find((a) => a.id === provider);
    if (!adapter) throw new Error(`尚未接入 ${provider} 的历史记录读取。`);
    return adapter;
  }
  readSession(summary: SessionSummary) {
    return this.adapterFor(summary.provider).readSession(summary);
  }
}
