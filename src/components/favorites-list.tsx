import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Detail,
  Form,
  Icon,
  List,
  useNavigation,
  Keyboard,
} from "@raycast/api";
import { useCallback, useMemo, useState } from "react";
import { basename } from "node:path";
import { AIFavorite, FavoriteType } from "../core/types";
import { codeBlocks, favoriteMarkdown } from "../core/markdown";
import { FavoriteFilter, FavoriteSearchIndex } from "../core/search";
import { sourceStatus } from "../core/sync";
import { providerNames } from "../providers/registry";
import { SyncStatus } from "./sync-status";
import { FavoriteStore } from "../core/store";
import { useResource } from "../hooks";
import { perform, runtime } from "../runtime";
import { AddFavorite } from "./add-favorite";
import { BrowseSessions } from "./browse-sessions";
import { ErrorDetail, UtilityActions } from "./common";
import { FavoriteEditor } from "./favorite-editor";
import { SourceActions } from "./source-actions";
import { CompareVersions, ExportForm, FavoriteSelection, PackPreview, VerificationForm } from "./knowledge-actions";
import { verificationLabels, verificationText } from "../core/knowledge";
import CaptureSelection from "../capture-selection";
import SearchByCode from "../search-by-code";

const icons = { session: Icon.Message, message: Icon.SpeechBubble, file: Icon.Document };
const labels = { session: "会话", message: "AI 回复", file: "文件版本" };

function FilterForm({
  favorites,
  filter,
  apply,
}: {
  favorites: AIFavorite[];
  filter: FavoriteFilter;
  apply: (filter: FavoriteFilter) => void;
}) {
  const { pop } = useNavigation();
  const [type, setType] = useState(filter.type || "all");
  const [agent, setAgent] = useState(filter.provider || "all");
  const [project, setProject] = useState(filter.project === undefined ? "all" : JSON.stringify(filter.project));
  const [tag, setTag] = useState(filter.tag || "");
  const projects = [...new Set(favorites.map((f) => f.projectPath || ""))].sort();
  const tags = [...new Set(favorites.flatMap((f) => f.tags))].sort();
  return (
    <Form
      navigationTitle="筛选收藏"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="应用筛选"
            onSubmit={() => {
              apply({
                type: type === "all" ? undefined : (type as FavoriteType),
                provider: agent === "all" ? undefined : (agent as "codex"),
                project: project === "all" ? undefined : JSON.parse(project),
                tag: tag || undefined,
              });
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="agent" title="来源 Agent" value={agent} onChange={setAgent}>
        <Form.Dropdown.Item title="全部 Agent" value="all" />
        {(["codex", "kiro", "grok", "manual", "claude", "gemini", "opencode"] as const).map((id) => (
          <Form.Dropdown.Item key={id} title={providerNames[id]} value={id} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="type" title="类型" value={type} onChange={setType}>
        <Form.Dropdown.Item title="全部类型" value="all" />
        {Object.entries(labels).map(([key, title]) => (
          <Form.Dropdown.Item key={key} title={title} value={key} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="project" title="项目" value={project} onChange={setProject}>
        <Form.Dropdown.Item title="全部项目" value="all" />
        {projects.map((p) => (
          <Form.Dropdown.Item key={p} title={p || "无项目"} value={JSON.stringify(p)} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="tag" title="标签" value={tag} onChange={setTag}>
        <Form.Dropdown.Item title="全部标签" value="" />
        {tags.map((t) => (
          <Form.Dropdown.Item key={t} title={t} value={t} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}

export function FavoriteActions({
  favorite,
  store,
  reload,
  openCodexLinks,
  onRemoved,
}: {
  favorite: AIFavorite;
  store: FavoriteStore;
  reload: () => void;
  openCodexLinks: boolean;
  onRemoved?: () => void;
}) {
  const code = codeBlocks(favorite.content);
  return (
    <>
      <ActionPanel.Section title="收藏">
        <Action.Push
          title="编辑标题、标签与备注"
          icon={Icon.Pencil}
          shortcut={Keyboard.Shortcut.Common.Edit}
          target={<FavoriteEditor favorite={favorite} onSaved={reload} />}
        />
        <Action.CopyToClipboard
          title={favorite.type === "message" ? "复制 AI 回复" : "复制已保存的内容"}
          content={favorite.content}
          shortcut={Keyboard.Shortcut.Common.Copy}
        />
        {code && <Action.CopyToClipboard title="复制代码块" content={code} />}
        <Action.CopyToClipboard title="复制内容、上下文与备注" content={favoriteMarkdown(favorite)} />
        <Action.CopyToClipboard title="复制快照指纹" content={favorite.snapshot.sha256} />
      </ActionPanel.Section>
      <ActionPanel.Section title="复用与验证">
        <Action.Push title="生成上下文包" target={<PackPreview favorites={[favorite]} />} />
        <Action.Push title="导出到 Obsidian" target={<ExportForm favorites={[favorite]} />} />
        <Action.Push title="对比收藏版本" target={<CompareVersions favorite={favorite} onSaved={reload} />} />
        <Action.Push title="记录验证状态" target={<VerificationForm favorite={favorite} onSaved={reload} />} />
      </ActionPanel.Section>
      <SourceActions item={favorite} openCodexLinks={openCodexLinks} />
      <ActionPanel.Section>
        <Action
          title="移除收藏"
          icon={Icon.Trash}
          style={Action.Style.Destructive}
          onAction={() =>
            perform(async () => {
              if (
                await confirmAlert({
                  title: "移除这条收藏？",
                  message: "将删除此收藏的快照，原始会话和文件保持不变。",
                  primaryAction: { title: "移除", style: Alert.ActionStyle.Destructive },
                })
              ) {
                await store.remove(favorite.id);
                if (onRemoved) onRemoved();
                else reload();
              }
            })
          }
        />
      </ActionPanel.Section>
    </>
  );
}

function FavoriteDetail({
  initial,
  store,
  reload,
  openCodexLinks,
}: {
  initial: AIFavorite;
  store: FavoriteStore;
  reload: () => void;
  openCodexLinks: boolean;
}) {
  const { pop } = useNavigation();
  const [favorite, setFavorite] = useState(initial);
  const update = () => {
    reload();
    void perform(async () => {
      const current = (await store.list()).find((f) => f.id === initial.id);
      if (current) setFavorite(current);
      else pop();
    });
  };
  return (
    <Detail
      markdown={favoriteMarkdown(favorite)}
      navigationTitle={favorite.title}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="类型" text={labels[favorite.type]} />
          <Detail.Metadata.Label title="来源 Agent" text={favorite.provider} />
          <Detail.Metadata.Label title="项目" text={favorite.projectPath || "无项目"} />
          <Detail.Metadata.TagList title="标签">
            {favorite.tags.map((tag) => (
              <Detail.Metadata.TagList.Item key={tag} text={tag} />
            ))}
          </Detail.Metadata.TagList>
          <Detail.Metadata.Label title="保存时间" text={new Date(favorite.snapshot.capturedAt).toLocaleString()} />
          <Detail.Metadata.Label title="版本" text={favorite.snapshot.sha256.slice(0, 12)} />
          <Detail.Metadata.Label title="验证记录" text={verificationText(favorite)} />
          <Detail.Metadata.Label title="推荐版本" text={favorite.recommended ? "是" : "未标记"} />
          {favorite.filePath && <Detail.Metadata.Label title="原始文件" text={favorite.filePath} />}
          {favorite.source.line && <Detail.Metadata.Label title="源记录" text={`第 ${favorite.source.line} 行`} />}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <FavoriteActions
            favorite={favorite}
            store={store}
            reload={update}
            openCodexLinks={openCodexLinks}
            onRemoved={() => {
              reload();
              pop();
            }}
          />
        </ActionPanel>
      }
    />
  );
}

export function FavoritesList({ searchMode = false }: { searchMode?: boolean }) {
  const { store, sync, preferences } = useMemo(runtime, []);
  const load = useCallback(() => store.list(), [store]);
  const { value, error, loading, reload } = useResource(load, preferences.autoSync === false ? 0 : 15000);
  const catalogLoad = useCallback(
    () => (preferences.autoSync === false ? sync.read() : sync.sync()),
    [sync, preferences.autoSync],
  );
  const history = useResource(catalogLoad, preferences.autoSync === false ? 0 : 15000);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FavoriteFilter>({});
  const index = useMemo(() => new FavoriteSearchIndex(value || []), [value]);
  const favorites = index.search(query, filter);
  if (error) return <ErrorDetail error={error} reload={reload} />;
  const generalActions = (
    <>
      <Action.Push
        title="添加 AI 收藏"
        icon={Icon.Plus}
        shortcut={Keyboard.Shortcut.Common.New}
        target={<AddFavorite onSaved={reload} />}
      />
      <Action.Push title="浏览 AI 会话" icon={Icon.Message} target={<BrowseSessions onSaved={reload} />} />
      <Action.Push
        title="按类型、项目、标签和来源筛选"
        icon={Icon.Filter}
        shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
        target={<FilterForm favorites={value || []} filter={filter} apply={setFilter} />}
      />
      <Action
        title="清空筛选"
        icon={Icon.XMarkCircle}
        onAction={() => {
          setFilter({});
          setQuery("");
        }}
      />
      <Action.CopyToClipboard title="复制收藏资料库路径" content={store.filePath} />
      <Action.Push title="同步状态" target={<SyncStatus />} />
      <Action.Push title="多选收藏打包上下文" target={<FavoriteSelection mode="pack" />} />
      <Action.Push title="批量导出到 Obsidian" target={<FavoriteSelection mode="export" />} />
      <Action.Push title="选中文字快捷收藏" target={<CaptureSelection onSaved={reload} />} />
      <Action.Push title="用报错或代码找收藏" target={<SearchByCode />} />
      <UtilityActions reload={reload} />
    </>
  );
  return (
    <List
      isLoading={loading}
      isShowingDetail
      filtering={false}
      searchText={query}
      onSearchTextChange={setQuery}
      navigationTitle={searchMode ? "搜索收藏" : "AI 收藏夹"}
      searchBarPlaceholder="搜索正文、问题、标签、备注或路径…"
      searchBarAccessory={
        <List.Dropdown
          tooltip="收藏类型"
          value={filter.type || "all"}
          onChange={(type) => setFilter((f) => ({ ...f, type: type === "all" ? undefined : (type as FavoriteType) }))}
        >
          <List.Dropdown.Item title="全部类型" value="all" />
          {Object.entries(labels).map(([key, title]) => (
            <List.Dropdown.Item key={key} title={title} value={key} />
          ))}
        </List.Dropdown>
      }
      actions={<ActionPanel>{generalActions}</ActionPanel>}
    >
      <List.EmptyView
        title={value?.length ? "没有匹配的收藏" : "添加你的第一条 AI 收藏"}
        description={
          value?.length ? "尝试其他关键词，或在操作菜单中清空筛选条件。" : "打开操作菜单，浏览 AI 会话或收藏文件版本。"
        }
        icon={Icon.Star}
      />
      {(["session", "message", "file"] as const).map((type) => (
        <List.Section
          key={type}
          title={labels[type]}
          subtitle={`${favorites.filter((f) => f.type === type).length}${filter.project !== undefined ? ` · ${filter.project || "无项目"}` : ""}${filter.tag ? ` · #${filter.tag}` : ""}`}
        >
          {favorites
            .filter((f) => f.type === type)
            .map((favorite) => (
              <List.Item
                key={favorite.id}
                title={favorite.title}
                subtitle={`${providerNames[favorite.provider]}${favorite.projectPath ? ` · ${basename(favorite.projectPath)}` : ""}`}
                icon={icons[type]}
                accessories={[
                  { tag: verificationLabels[favorite.verification?.status || "unverified"] },
                  ...(favorite.recommended ? [{ tag: "推荐版本" }] : []),
                  ...favorite.tags.slice(0, 2).map((tag) => ({ tag })),
                  ...(sourceStatus(favorite, history.value)
                    ? [{ tag: sourceStatus(favorite, history.value) === "changed" ? "来源已更新" : "来源已移除" }]
                    : []),
                ]}
                detail={
                  <List.Item.Detail
                    markdown={favoriteMarkdown(favorite)}
                    metadata={
                      <List.Item.Detail.Metadata>
                        <List.Item.Detail.Metadata.Label title="项目" text={favorite.projectPath || "无项目"} />
                        <List.Item.Detail.Metadata.TagList title="标签">
                          {favorite.tags.map((tag) => (
                            <List.Item.Detail.Metadata.TagList.Item key={tag} text={tag} />
                          ))}
                        </List.Item.Detail.Metadata.TagList>
                        <List.Item.Detail.Metadata.Label
                          title="保存时间"
                          text={new Date(favorite.snapshot.capturedAt).toLocaleString()}
                        />
                        <List.Item.Detail.Metadata.Label title="版本" text={favorite.snapshot.sha256.slice(0, 12)} />
                        <List.Item.Detail.Metadata.Label title="验证记录" text={verificationText(favorite)} />
                      </List.Item.Detail.Metadata>
                    }
                  />
                }
                actions={
                  <ActionPanel>
                    <Action.Push
                      title="阅读收藏"
                      icon={Icon.Eye}
                      target={
                        <FavoriteDetail
                          initial={favorite}
                          store={store}
                          reload={reload}
                          openCodexLinks={preferences.openCodexLinks}
                        />
                      }
                    />
                    <FavoriteActions
                      favorite={favorite}
                      store={store}
                      reload={reload}
                      openCodexLinks={preferences.openCodexLinks}
                    />
                    {generalActions}
                  </ActionPanel>
                }
              />
            ))}
        </List.Section>
      ))}
    </List>
  );
}
