import { getPreferenceValues, showToast, Toast } from "@raycast/api";
import { FavoriteStore } from "./core/store";
import { codexHome, storageDirectory, kiroHome, grokHome, kiroDatabase, kiroLegacyIde } from "./core/paths";
import { KiroProvider } from "./providers/kiro";
import { GrokProvider } from "./providers/grok";
import { ProviderRegistry } from "./providers/registry";
import { HistorySync } from "./core/sync";
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
}
export function runtime() {
  const preferences = getPreferenceValues<Preferences>();
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
  return { preferences, store: new FavoriteStore(directory), provider, sync: new HistorySync(directory, provider) };
}
export async function reportError(error: unknown) {
  await showToast({
    style: Toast.Style.Failure,
    title: "AI 收藏夹",
    message: error instanceof Error ? error.message : String(error),
  });
}
export async function perform(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    await reportError(error);
  }
}
