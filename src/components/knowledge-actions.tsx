import { Action, ActionPanel, Detail, Form, Icon, List, showToast, Toast, useNavigation } from "@raycast/api";
import { useCallback, useMemo, useState } from "react";
import { AIFavorite, Verification } from "../core/types";
import { contextPack, obsidianMarkdown, verificationLabels, verificationText } from "../core/knowledge";
import { exportFavorites } from "../core/export";
import { favoriteMarkdown, fileMarkdown } from "../core/markdown";
import { FavoriteSearchIndex } from "../core/search";
import { snapshotDiff, versionKey } from "../core/versions";
import { runtime, perform } from "../runtime";
import { useResource } from "../hooks";
import { ErrorDetail } from "./common";

export function PackPreview({ favorites }: { favorites: AIFavorite[] }) {
  const [task, setTask] = useState("");
  return (
    <Form
      navigationTitle="补充当前任务"
      actions={
        <ActionPanel>
          <Action.Push
            title="预览上下文包"
            target={
              <Detail
                navigationTitle="上下文包预览"
                markdown={contextPack(favorites, task)}
                actions={
                  <ActionPanel>
                    <Action.CopyToClipboard title="复制上下文包" content={contextPack(favorites, task)} />
                  </ActionPanel>
                }
              />
            }
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="task"
        title="当前任务（可选）"
        value={task}
        onChange={setTask}
        placeholder="准备交给另一个 AI 处理的问题"
      />
      <Form.Description
        title="已选收藏"
        text={`${favorites.length} 条；保留问题、方案、适用条件、代码、来源及验证记录。`}
      />
    </Form>
  );
}

export function ExportForm({ favorites }: { favorites: AIFavorite[] }) {
  const { preferences } = useMemo(runtime, []);
  const [vault, setVault] = useState(preferences.obsidianVault || "");
  const [folder, setFolder] = useState(preferences.obsidianFolder || "AI收藏");
  const [saving, setSaving] = useState(false);
  const { push } = useNavigation();
  async function save() {
    if (saving) return;
    setSaving(true);
    await perform(async () => {
      const result = await exportFavorites(favorites, vault, folder);
      await showToast({
        style: result.errors.length ? Toast.Style.Failure : Toast.Style.Success,
        title: `已导出 ${result.files.length} 条${result.errors.length ? `，失败 ${result.errors.length} 条` : ""}`,
      });
      push(
        <List navigationTitle="Obsidian 导出结果">
          {result.files.map((file) => (
            <List.Item
              key={file.path}
              title={file.favorite.title}
              subtitle={file.path}
              actions={
                <ActionPanel>
                  <Action.Open title="在 Obsidian 打开" target={file.uri} />
                  <Action.ShowInFinder title="在访达显示笔记" path={file.path} />
                  <Action.CopyToClipboard title="复制笔记路径" content={file.path} />
                </ActionPanel>
              }
            />
          ))}
          {result.errors.map((error, i) => (
            <List.Item key={`error-${i}`} title={error.title} subtitle={error.message} icon={Icon.Warning} />
          ))}
        </List>,
      );
    });
    setSaving(false);
  }
  return (
    <Form
      isLoading={saving}
      navigationTitle="导出到 Obsidian"
      actions={
        <ActionPanel>
          <Action.SubmitForm title={`导出 ${favorites.length} 条收藏`} onSubmit={save} />
          <Action.Push
            title="预览导出 Markdown"
            target={<Detail markdown={favorites.map(obsidianMarkdown).join("\n\n---\n\n")} />}
          />
        </ActionPanel>
      }
    >
      <Form.FilePicker
        id="vaultPicker"
        title="选择 Obsidian 仓库"
        allowMultipleSelection={false}
        canChooseDirectories
        canChooseFiles={false}
        onChange={(paths) => {
          if (paths[0]) setVault(paths[0]);
        }}
      />
      <Form.TextField
        id="vault"
        title="仓库路径"
        value={vault}
        onChange={setVault}
        placeholder="~/Documents/Obsidian"
      />
      <Form.TextField id="folder" title="导出子目录" value={folder} onChange={setFolder} />
      <Form.Description
        title="导出规则"
        text="每条收藏保存为独立 Markdown 笔记，包含标签、备注、上下文、来源和验证记录。遇到同名笔记时创建新文件。"
      />
    </Form>
  );
}

export function FavoriteSelection({ mode }: { mode: "pack" | "export" }) {
  const { store } = useMemo(runtime, []);
  const load = useCallback(() => store.list(), [store]);
  const { value, loading, error, reload } = useResource(load);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const { push } = useNavigation();
  const index = useMemo(() => new FavoriteSearchIndex(value || []), [value]);
  const visible = index.search(query),
    favorites = (value || []).filter((f) => selected.has(f.id));
  if (error) return <ErrorDetail error={error} reload={reload} />;
  const toggle = (id: string) =>
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const actions = (
    <>
      <Action
        title={mode === "pack" ? "预览上下文包" : "导出所选收藏"}
        onAction={() =>
          void perform(async () => {
            if (!favorites.length) throw new Error("请至少选择一条收藏。");
            push(mode === "pack" ? <PackPreview favorites={favorites} /> : <ExportForm favorites={favorites} />);
          })
        }
        shortcut={{ modifiers: ["cmd"], key: "return" }}
      />
      <Action
        title="选择当前搜索结果"
        onAction={() => setSelected((old) => new Set([...old, ...visible.map((f) => f.id)]))}
      />
      <Action title="清空选择" onAction={() => setSelected(new Set())} />
    </>
  );
  return (
    <List
      navigationTitle={`${mode === "pack" ? "上下文打包" : "批量导出"} · 已选 ${favorites.length} 条`}
      isLoading={loading}
      filtering={false}
      searchText={query}
      onSearchTextChange={setQuery}
      searchBarPlaceholder="搜索收藏，按回车选择或取消…"
      actions={<ActionPanel>{actions}</ActionPanel>}
    >
      <List.EmptyView title="没有可选收藏" description="先添加收藏，或尝试其他关键词。" />
      {visible.map((f) => (
        <List.Item
          key={f.id}
          title={f.title}
          subtitle={verificationText(f)}
          icon={selected.has(f.id) ? Icon.CheckCircle : Icon.Circle}
          accessories={[{ text: selected.has(f.id) ? "已选" : "未选" }]}
          actions={
            <ActionPanel>
              <Action title={selected.has(f.id) ? "取消选择" : "选择收藏"} onAction={() => toggle(f.id)} />
              {actions}
              <Action.Push title="阅读收藏" target={<Detail markdown={favoriteMarkdown(f)} />} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

export function VerificationForm({ favorite, onSaved }: { favorite: AIFavorite; onSaved: () => void }) {
  const { store } = useMemo(runtime, []);
  const { pop } = useNavigation();
  const [status, setStatus] = useState<Verification["status"]>(favorite.verification?.status || "unverified");
  const [project, setProject] = useState(favorite.verification?.project || favorite.projectPath || "");
  const [version, setVersion] = useState(favorite.verification?.version || "");
  const [date, setDate] = useState<Date | null>(
    favorite.verification?.date ? new Date(`${favorite.verification.date}T12:00:00`) : new Date(),
  );
  const [note, setNote] = useState(favorite.verification?.note || "");
  const [saving, setSaving] = useState(false);
  async function save() {
    if (saving) return;
    setSaving(true);
    await perform(async () => {
      const localDate = date
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
        : undefined;
      await store.setVerification(favorite.id, {
        status,
        project: project.trim(),
        version: version.trim(),
        date: localDate,
        note: note.trim(),
      });
      await showToast({ style: Toast.Style.Success, title: "验证记录已保存" });
      onSaved();
      pop();
    });
    setSaving(false);
  }
  return (
    <Form
      navigationTitle="方案验证记录"
      isLoading={saving}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="保存验证记录" onSubmit={save} />
        </ActionPanel>
      }
    >
      <Form.Dropdown
        id="status"
        title="验证状态"
        value={status}
        onChange={(value) => setStatus(value as Verification["status"])}
      >
        {Object.entries(verificationLabels).map(([value, title]) => (
          <Form.Dropdown.Item key={value} value={value} title={title} />
        ))}
      </Form.Dropdown>
      <Form.TextField id="project" title="验证项目" value={project} onChange={setProject} />
      <Form.TextField
        id="version"
        title="验证版本"
        value={version}
        onChange={setVersion}
        placeholder="项目、框架或发布版本"
      />
      <Form.DatePicker id="date" title="验证日期" value={date} onChange={setDate} type={Form.DatePicker.Type.Date} />
      <Form.TextArea id="note" title="验证结果 / 失效原因" value={note} onChange={setNote} />
    </Form>
  );
}

function VersionDiff({ before, after, onSaved }: { before: AIFavorite; after: AIFavorite; onSaved: () => void }) {
  const { store } = useMemo(runtime, []);
  const [recommended, setRecommended] = useState(before.recommended ? before.id : after.recommended ? after.id : "");
  let diff: string;
  try {
    diff = snapshotDiff(before, after);
  } catch (error) {
    return <ErrorDetail error={(error as Error).message} />;
  }
  const recommend = (id: string, other: string) =>
    void perform(async () => {
      await store.recommend(id, other);
      setRecommended(id);
      onSaved();
      await showToast({ style: Toast.Style.Success, title: "推荐版本已更新，旧快照已保留" });
    });
  return (
    <Detail
      navigationTitle="收藏版本对比"
      markdown={`# 快照对比\n\n${recommended ? `推荐版本：${recommended === before.id ? "旧版" : "新版"}` : "尚未指定推荐版本"}\n\n旧版保存时间：${new Date(before.snapshot.capturedAt).toLocaleString()}\n\n新版保存时间：${new Date(after.snapshot.capturedAt).toLocaleString()}\n\n${fileMarkdown(diff, "snapshot.diff")}`}
      actions={
        <ActionPanel>
          <Action title="推荐新版" onAction={() => recommend(after.id, before.id)} />
          <Action title="推荐旧版" onAction={() => recommend(before.id, after.id)} />
          <Action.Push title="阅读旧版完整快照" target={<Detail markdown={favoriteMarkdown(before)} />} />
          <Action.Push title="阅读新版完整快照" target={<Detail markdown={favoriteMarkdown(after)} />} />
          <Action.CopyToClipboard title="复制版本差异" content={diff} />
        </ActionPanel>
      }
    />
  );
}

export function CompareVersions({ favorite, onSaved }: { favorite: AIFavorite; onSaved: () => void }) {
  const { store } = useMemo(runtime, []);
  const load = useCallback(() => store.list(), [store]);
  const { value, error, loading, reload } = useResource(load);
  if (error) return <ErrorDetail error={error} reload={reload} />;
  const candidates = (value || [])
    .filter((f) => f.id !== favorite.id)
    .sort(
      (a, b) =>
        Number(versionKey(b) === versionKey(favorite)) - Number(versionKey(a) === versionKey(favorite)) ||
        b.snapshot.capturedAt - a.snapshot.capturedAt,
    );
  return (
    <List
      isLoading={loading}
      navigationTitle="选择另一个快照"
      searchBarPlaceholder="优先展示同一来源，也可选择修正后的新回复…"
    >
      <List.EmptyView title="还没有可比较的快照" description="再次收藏文件或修正后的回复，旧版会继续保留。" />
      {candidates.map((other) => {
        const [before, after] = [favorite, other].sort((a, b) => a.snapshot.capturedAt - b.snapshot.capturedAt);
        return (
          <List.Item
            key={other.id}
            title={other.title}
            subtitle={`${versionKey(other) === versionKey(favorite) ? "同一来源 · " : "其他来源 · "}${new Date(other.snapshot.capturedAt).toLocaleString()}`}
            accessories={other.recommended ? [{ tag: "推荐版本" }] : []}
            actions={
              <ActionPanel>
                <Action.Push
                  title="比较两个快照"
                  target={<VersionDiff before={before} after={after} onSaved={onSaved} />}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
