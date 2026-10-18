import { Clipboard, showToast, Toast } from "@raycast/api";
import { capturedDraft } from "./core/capture";
import { runtime, perform } from "./runtime";

export default async function CaptureClipboard() {
  await perform(async () => {
    const content = await Clipboard.readText();
    if (!content?.trim()) throw new Error("剪贴板中没有可收藏的文本。");
    const title =
      content
        .split("\n")
        .find((line) => line.trim())!
        .replace(/^[#*>\s]+/, "")
        .slice(0, 100) || "剪贴板收藏";
    const draft = capturedDraft(title, content, "manual", {
      label: "剪贴板（未关联会话）",
      captureMethod: "clipboard",
    });
    const { existed } = await runtime().store.add(draft, { title, tags: [], note: "" });
    await showToast({ style: Toast.Style.Success, title: existed ? "该内容已收藏" : "剪贴板已收藏，可稍后补充备注" });
  });
}
