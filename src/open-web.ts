import { environment, getPreferenceValues, open, showToast, Toast } from "@raycast/api";
import { join } from "node:path";
import { ensureWebServer } from "./web/launcher";
import { Preferences, reportError } from "./runtime";

export async function openWebManagement(
  preferences: Preferences,
  serverEntry: string,
  openUrl: (url: string) => Promise<void>,
  favoriteId?: string,
) {
  const url =
    (await ensureWebServer(preferences, serverEntry)) +
    (favoriteId ? `&favorite=${encodeURIComponent(favoriteId)}` : "");
  await openUrl(url);
  return url;
}
export default async function OpenWeb() {
  try {
    await showToast({ style: Toast.Style.Animated, title: "正在打开网页收藏夹" });
    await openWebManagement(
      getPreferenceValues<Preferences>(),
      join(environment.assetsPath, "web", "server.cjs"),
      open,
    );
    await showToast({ style: Toast.Style.Success, title: "网页收藏夹已打开" });
  } catch (error) {
    await reportError(error);
  }
}
