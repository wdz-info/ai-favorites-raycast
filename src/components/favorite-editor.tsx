import { Action, ActionPanel, Detail, Form, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FavoriteDraft, AIFavorite } from "../core/types";
import { favoriteMarkdown } from "../core/markdown";
import { parseTags } from "../core/store";
import { runtime, perform } from "../runtime";
import { useResource } from "../hooks";
import { ErrorDetail } from "./common";

export function FavoriteEditor({
  loadDraft,
  favorite,
  onSaved,
}: {
  loadDraft?: () => Promise<FavoriteDraft>;
  favorite?: AIFavorite;
  onSaved?: () => void;
}) {
  const { pop } = useNavigation();
  const { store } = useMemo(runtime, []);
  const loader = useCallback(async () => favorite || (await loadDraft!()), [favorite, loadDraft]);
  const { value: draft, loading, error, reload } = useResource(loader);
  const [title, setTitle] = useState(favorite?.title || "");
  const [tags, setTags] = useState(favorite?.tags.join(", ") || "");
  const [note, setNote] = useState(favorite?.note || "");
  const [applicability, setApplicability] = useState(favorite?.applicability || "");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (draft) setTitle(draft.title);
  }, [draft]);
  if (error) return <ErrorDetail error={error} reload={reload} />;

  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    await perform(async () => {
      const metadata = { title, tags: parseTags(tags), note, applicability };
      let existed = false;
      if (favorite) await store.edit(favorite.id, metadata);
      else existed = (await store.add(draft!, metadata)).existed;
      await showToast({
        style: Toast.Style.Success,
        title: existed ? "该版本已收藏，保留原快照" : favorite ? "收藏已更新" : "收藏已保存",
      });
      onSaved?.();
      pop();
    });
    setSaving(false);
  }
  return (
    <Form
      isLoading={loading || saving}
      navigationTitle={favorite ? "编辑收藏" : "添加到收藏夹"}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={favorite ? "保存修改" : "保存收藏"} onSubmit={save} />
          {draft && (
            <Action.Push
              title="预览快照"
              icon={Icon.Eye}
              target={
                <Detail
                  markdown={favoriteMarkdown({
                    ...draft,
                    title,
                    tags: parseTags(tags),
                    note,
                    applicability,
                    id: "preview",
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                  })}
                />
              }
            />
          )}
        </ActionPanel>
      }
    >
      <Form.TextField
        id="title"
        title="标题"
        value={title}
        onChange={setTitle}
        error={!loading && !title.trim() ? "请填写标题" : undefined}
      />
      <Form.TextField
        id="tags"
        title="标签"
        placeholder="架构, Java, 可复用"
        value={tags}
        onChange={setTags}
        info="多个标签用逗号分隔，可跨项目复用。"
      />
      <Form.TextArea id="note" title="我的备注" value={note} onChange={setNote} />
      <Form.TextArea
        id="applicability"
        title="适用条件"
        placeholder="适用的框架版本、前提、限制与使用环境"
        value={applicability}
        onChange={setApplicability}
      />
      <Form.Separator />
      <Form.Description
        title="内容快照"
        text={
          favorite
            ? "修改标题、标签、备注和适用条件，已保存的内容与来源保留原版本。"
            : "内容独立于 Agent 历史保存，文件按打开表单时的磁盘内容生成快照。"
        }
      />
      {draft?.projectPath && <Form.Description title="项目" text={draft.projectPath} />}
      {draft?.filePath && (
        <Form.Description
          title="文件版本"
          text={`${draft.filePath}\nSHA-256: ${draft.snapshot.sha256}\n保存时间：${new Date(draft.snapshot.capturedAt).toLocaleString()}`}
        />
      )}
    </Form>
  );
}
