import { FavoriteStore } from "./core/store";
import { codexHome, storageDirectory, kiroHome, grokHome, kiroDatabase, kiroLegacyIde } from "./core/paths";
import { KiroProvider } from "./providers/kiro";
import { GrokProvider } from "./providers/grok";
import { ProviderRegistry } from "./providers/registry";
import { HistorySync } from "./core/sync";
import { HistoryIndex } from "./core/history-index";
import { CodexProvider } from "./providers/codex";

export interface Preferences {
  codexHome?: string;
  storageDirectory?: string;
  openCodexLinks: boolean;
  kiroHome?: string;
  kiroDatabase?: string;
  kiroLegacyIde?: string;
  grokHome?: string;
  autoSync?: boolean;
  obsidianVault?: string;
  obsidianFolder?: string;
  embeddingModel?: string;
  embeddingEndpoint?: string;
}
export function createServices(preferences: Preferences) {
  const directory = storageDirectory(preferences.storageDirectory);
  const provider = new ProviderRegistry([
    new CodexProvider(codexHome(preferences.codexHome)),
    new KiroProvider({
      home: kiroHome(preferences.kiroHome),
      cliDatabase: kiroDatabase(preferences.kiroDatabase),
      legacyIde: kiroLegacyIde(preferences.kiroLegacyIde),
    }),
    new GrokProvider(grokHome(preferences.grokHome)),
  ]);
  return {
    preferences,
    store: new FavoriteStore(directory),
    provider,
    sync: new HistorySync(directory, provider),
    historyIndex: new HistoryIndex(directory, provider),
  };
}
