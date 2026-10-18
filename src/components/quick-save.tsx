import { Action, Icon, Keyboard, showToast, Toast } from "@raycast/api";
import { useMemo, useState } from "react";
import { FavoriteDraft } from "../core/types";
import { perform, runtime } from "../runtime";

export function QuickSave({
  draft,
  loadDraft,
  onSaved,
}: {
  draft?: FavoriteDraft;
  loadDraft?: () => Promise<FavoriteDraft>;
  onSaved?: () => void;
}) {
  const { store } = useMemo(runtime, []);
  const [saving, setSaving] = useState(false);
  return (
    <Action
      title={saving ? "正在保存…" : "一键收藏"}
      icon={Icon.Star}
      shortcut={Keyboard.Shortcut.Common.Duplicate}
      onAction={() =>
        perform(async () => {
          if (saving) return;
          setSaving(true);
          try {
            const value = draft || (await loadDraft!());
            const result = await store.add(
              { ...value, snapshot: { ...value.snapshot, capturedAt: Date.now() } },
              { title: value.title, tags: [], note: "" },
            );
            await showToast({
              style: Toast.Style.Success,
              title: result.existed ? "该版本已收藏" : "已收藏，可稍后编辑备注",
            });
            onSaved?.();
          } finally {
            setSaving(false);
          }
        })
      }
    />
  );
}
