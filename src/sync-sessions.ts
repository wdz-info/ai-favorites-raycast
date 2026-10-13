import { environment, LaunchType, showToast, Toast } from "@raycast/api";
import { runtime } from "./runtime";

export default async function Command() {
  const { sync, preferences } = runtime();
  const background = environment.launchType === LaunchType.Background;
  if (background && preferences.autoSync === false) return;
  try {
    const result = await sync.sync();
    if (!background)
      await showToast({
        style: result.warnings.length ? Toast.Style.Failure : Toast.Style.Success,
        title: result.warnings.length ? "同步完成，部分来源需检查" : "历史同步完成",
        message: `共 ${result.sessions.length} 个会话，新增 ${result.changes.added.length}，变化 ${result.changes.changed.length}，移除 ${result.changes.removed.length}。`,
      });
  } catch (error) {
    if (!background)
      await showToast({ style: Toast.Style.Failure, title: "历史同步失败", message: (error as Error).message });
    else throw error;
  }
}
