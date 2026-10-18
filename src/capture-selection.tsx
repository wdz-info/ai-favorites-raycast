import {
  Action,
  ActionPanel,
  Clipboard,
  Detail,
  Form,
  getFrontmostApplication,
  getSelectedText,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { capturedDraft, captureText } from "./core/capture";
import { ProviderId, SourceLocation } from "./core/types";
import { favoriteMarkdown } from "./core/markdown";
import { providerNames } from "./providers/registry";
import { useResource } from "./hooks";
import { perform, runtime } from "./runtime";

export default function CaptureSelection({ onSaved }: { onSaved?: () => void }) {
  const { store } = useMemo(runtime, []);
  const { pop } = useNavigation();
  const load = useCallback(async () => {
    const [capture, app] = await Promise.all([
      captureText(getSelectedText, () => Clipboard.readText()),
      getFrontmostApplication().catch(() => undefined),
    ]);
    return { ...capture, application: app?.name };
  }, []);
  const { value, loading } = useResource(load);
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [provider, setProvider] = useState<ProviderId>("manual");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!value) return;
    setContent(value.text);
    setTitle(
      value.text
        .split("\n")
        .find((line) => line.trim())
        ?.slice(0, 100) || "",
    );
    // A clipboard value can belong to a different app, so it needs user-supplied provenance.
    setLabel(
      value.method === "selection"
        ? value.application || "选中文字（未关联会话）"
        : value.method === "clipboard"
          ? "剪贴板（未关联会话）"
          : "手动输入（未关联会话）",
    );
  }, [value]);
  const source: SourceLocation = {
    label: label.trim(),
    url: url.trim() || undefined,
    application: value?.method === "selection" ? value.application : undefined,
    captureMethod: value?.method || "manual",
  };
  async function save() {
    if (saving) return;
    setSaving(true);
    await perform(async () => {
      const draft = capturedDraft(title, content, provider, source);
      const result = await store.add(draft, { title, tags: [], note: "" });
      await showToast({ style: Toast.Style.Success, title: result.existed ? "该内容已收藏" : "快捷收藏已保存" });
      onSaved?.();
      pop();
    });
    setSaving(false);
  }
  const preview = () =>
    favoriteMarkdown({
      ...capturedDraft(title, content, provider, source),
      id: "preview",
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  const { push } = useNavigation();
  return (
    <Form
      navigationTitle="选中文字快捷收藏"
      isLoading={loading || saving}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="保存收藏" onSubmit={save} />
          <Action
            title="预览收藏"
            onAction={() =>
              void perform(async () => {
                push(<Detail markdown={preview()} />);
              })
            }
          />
        </ActionPanel>
      }
    >
      <Form.Description
        title="读取方式"
        text={
          value?.method === "selection"
            ? `已读取选中文字${value.application ? `，应用：${value.application}` : ""}`
            : value?.method === "clipboard"
              ? "未读到选中文字，已使用剪贴板。请确认内容并补充真实来源。"
              : "未读到选中文字或剪贴板文本，请手动粘贴内容并补充来源。"
        }
      />
      {value?.selectionIssue && <Form.Description title="选区读取提示" text={value.selectionIssue} />}
      <Form.TextField id="title" title="标题" value={title} onChange={setTitle} />
      <Form.TextArea id="content" title="收藏内容" value={content} onChange={setContent} />
      <Form.Dropdown id="provider" title="来源 Agent" value={provider} onChange={(v) => setProvider(v as ProviderId)}>
        {(["manual", "codex", "kiro", "grok", "claude", "gemini", "opencode"] as const).map((id) => (
          <Form.Dropdown.Item key={id} title={providerNames[id]} value={id} />
        ))}
      </Form.Dropdown>
      <Form.TextField
        id="label"
        title="来源说明"
        value={label}
        onChange={setLabel}
        placeholder="应用、会话标题或资料名称"
      />
      <Form.TextField id="url" title="来源链接（可选）" value={url} onChange={setUrl} />
      <Form.Description
        title="来源关联"
        text="选中文字与剪贴板不包含可靠的会话 ID。可填写原始链接，收藏内容仍独立保存。"
      />
    </Form>
  );
}
