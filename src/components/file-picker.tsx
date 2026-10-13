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
  const [provider, setProvider] = useState<"codex" | "kiro" | "grok">((session?.provider as "codex") || "codex");
  const [project, setProject] = useState(session?.projectPath || "");
  return (
    <Form
      navigationTitle="收藏文件版本"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="预览并添加收藏"
            onSubmit={() =>
              perform(async () => {
                const selected = files[0] || path.trim();
                if (!selected) throw new Error("请选择文件或填写绝对路径。");
                const draft = await fileDraft(selected, session);
                if (!session) draft.provider = provider;
                draft.projectPath = project.trim() ? expandPath(project.trim()) : dirname(draft.filePath!);
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
          {(["codex", "kiro", "grok"] as const).map((id) => (
            <Form.Dropdown.Item key={id} title={providerNames[id]} value={id} />
          ))}
        </Form.Dropdown>
      )}
      <Form.FilePicker
        id="files"
        title="文本文件"
        allowMultipleSelection={false}
        canChooseDirectories={false}
        value={files}
        onChange={setFiles}
      />
      <Form.TextField
        id="path"
        title="或填写文件路径"
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
        text="保存当前磁盘上的 UTF-8 文本，最大 8 MiB。文件变化后可再次收藏为独立版本，旧快照仍可阅读。"
      />
    </Form>
  );
}
