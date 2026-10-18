import { Action, ActionPanel, Form, useNavigation } from "@raycast/api";
import { useState } from "react";
import { dirname } from "node:path";
import { fileDraft } from "../core/favorite-service";
import { expandPath } from "../core/paths";
import { providerNames } from "../providers/registry";
import { Session } from "../core/types";
import { FavoriteEditor } from "./favorite-editor";
import { perform } from "../runtime";

export function FilePicker({ session, onSaved }: { session?: Session; onSaved?: () => void }) {
  const { push } = useNavigation();
  const [files, setFiles] = useState<string[]>([]);
  const [path, setPath] = useState("");
  const [provider, setProvider] = useState<"manual" | "codex" | "kiro" | "grok">(
    (session?.provider as "codex") || "manual",
  );
  const [project, setProject] = useState(session?.projectPath || "");
  return (
    <Form
      navigationTitle="收藏文件或目录版本"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="预览并添加收藏"
            onSubmit={() =>
              perform(async () => {
                const selected = files[0] || path.trim();
                if (!selected) throw new Error("请选择文件、目录或填写 file:// 链接。");
                const draft = await fileDraft(selected, session);
                if (!session) draft.provider = provider;
                draft.projectPath = project.trim()
                  ? expandPath(project.trim())
                  : draft.directorySnapshot
                    ? draft.filePath
                    : dirname(draft.filePath!);
                push(<FavoriteEditor loadDraft={async () => draft} onSaved={onSaved} />);
              })
            }
          />
        </ActionPanel>
      }
    >
      {!session && (
        <Form.Dropdown
          id="provider"
          title="来源 Agent"
          value={provider}
          onChange={(value) => setProvider(value as typeof provider)}
        >
          {(["manual", "codex", "kiro", "grok"] as const).map((id) => (
            <Form.Dropdown.Item key={id} title={providerNames[id]} value={id} />
          ))}
        </Form.Dropdown>
      )}
      <Form.FilePicker
        id="files"
        title="文件或目录"
        allowMultipleSelection={false}
        canChooseDirectories={true}
        value={files}
        onChange={setFiles}
      />
      <Form.TextField
        id="path"
        title="或填写路径 / file:// 链接"
        value={path}
        onChange={setPath}
        placeholder="~/project/architecture.md"
      />
      <Form.TextField
        id="project"
        title="项目目录"
        value={project}
        onChange={setProject}
        placeholder="默认使用文件所在目录"
      />
      <Form.Description
        title="版本"
        text="文本文件最大 8 MiB；目录最多 2000 个文件、共 64 MiB。选择 index.html 会保存所在目录及资源，从收藏中打开网页快照。目录内符号链接需先换成实际文件。变化后可另存新版本。"
      />
    </Form>
  );
}
