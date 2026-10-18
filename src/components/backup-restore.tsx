import { Action, ActionPanel, Detail, Form, showToast, Toast } from "@raycast/api";
import { useMemo, useState } from "react";
import { join } from "node:path";
import { runtime, perform } from "../runtime";
import { expandPath } from "../core/paths";

export function BackupRestore({ onSaved }: { onSaved?: () => void }) {
  const { store } = useMemo(runtime, []);
  const [directory, setDirectory] = useState("");
  const [file, setFile] = useState("");
  const [preview, setPreview] = useState<{ count: number; titles: string[] }>();
  const [busy, setBusy] = useState(false);
  return (
    <Form
      navigationTitle="备份与恢复收藏"
      isLoading={busy}
      actions={
        <ActionPanel>
          <Action
            title="创建新备份文件"
            onAction={() =>
              perform(async () => {
                if (busy) return;
                setBusy(true);
                try {
                  const path = join(
                    expandPath(directory),
                    `ai-favorites-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
                  );
                  const count = await store.backup(path);
                  await showToast({ style: Toast.Style.Success, title: `已备份 ${count} 条收藏`, message: path });
                } finally {
                  setBusy(false);
                }
              })
            }
          />
          <Action
            title="检查所选备份"
            onAction={() => perform(async () => setPreview(await store.previewRestore(expandPath(file))))}
          />
          {preview && (
            <Action.Push
              title="预览备份内容"
              target={
                <Detail
                  markdown={`# 备份预览\n\n${preview.count} 条收藏；最多列出前 20 个标题。\n\n${preview.titles.map((title) => `- ${title}`).join("\n")}\n\n恢复只合并新增快照，相同内容保留现有备注；ID 冲突创建新 ID，不覆盖现有收藏。`}
                />
              }
            />
          )}
          {preview && (
            <Action
              title="合并恢复（保留现有收藏）"
              onAction={() =>
                perform(async () => {
                  if (busy) return;
                  setBusy(true);
                  try {
                    const result = await store.restore(expandPath(file));
                    await showToast({
                      style: Toast.Style.Success,
                      title: `新增 ${result.added}，跳过 ${result.skipped}，ID 冲突 ${result.conflicts}`,
                    });
                    onSaved?.();
                    setPreview(undefined);
                  } finally {
                    setBusy(false);
                  }
                })
              }
            />
          )}
        </ActionPanel>
      }
    >
      <Form.FilePicker
        id="backupDirectory"
        title="备份到目录"
        canChooseDirectories
        canChooseFiles={false}
        allowMultipleSelection={false}
        onChange={(paths) => setDirectory(paths[0] || "")}
      />
      <Form.TextField id="directory" title="备份目录路径" value={directory} onChange={setDirectory} />
      <Form.FilePicker
        id="restoreFile"
        title="选择恢复文件"
        canChooseDirectories={false}
        canChooseFiles
        allowMultipleSelection={false}
        onChange={(paths) => {
          setFile(paths[0] || "");
          setPreview(undefined);
        }}
      />
      <Form.Description
        title="恢复方式"
        text="先检查并预览备份，再合并恢复。保留现有快照、备注和版本；不修改 Agent 历史。历史搜索索引无需备份。"
      />
    </Form>
  );
}
