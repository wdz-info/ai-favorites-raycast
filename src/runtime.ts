import { getPreferenceValues, showToast, Toast } from "@raycast/api";
import { createServices, Preferences } from "./services";

export type { Preferences } from "./services";
export function runtime() {
  return createServices(getPreferenceValues<Preferences>());
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
