import { Action, ActionPanel, Detail, Form, List, useNavigation } from "@raycast/api";
import { useCallback, useMemo, useState } from "react";
import { verificationLabels, verificationText } from "./core/knowledge";
import { codeTerms, searchByCode } from "./core/code-search";
import { favoriteMarkdown } from "./core/markdown";
import { runtime } from "./runtime";
import { useResource } from "./hooks";
import { ErrorDetail } from "./components/common";
import { FavoriteActions } from "./components/favorites-list";

function Results({ query }: { query: string }) {
  const { store, preferences } = useMemo(runtime, []);
  const load = useCallback(() => store.list(), [store]);
  const { value, error, loading, reload } = useResource(load);
  const [includeInvalid, setIncludeInvalid] = useState(false);
  if (error) return <ErrorDetail error={error} reload={reload} />;
  const results = searchByCode(value || [], query, { includeInvalid });
  const toggle = (
    <Action
      title={includeInvalid ? "隐藏已失效的收藏" : "显示已失效的收藏"}
      onAction={() => setIncludeInvalid((old) => !old)}
    />
  );
  return (
    <List
      isLoading={loading}
      navigationTitle="报错与代码匹配结果"
      isShowingDetail
      searchBarPlaceholder="筛选匹配结果…"
      actions={<ActionPanel>{toggle}</ActionPanel>}
    >
      <List.EmptyView
        title="没有词项匹配"
        description="可补充异常名、类名或业务关键词。当前按词项检索，无法识别只有语义相似的表达。"
      />
      {results.map(({ favorite, matches, score }) => (
        <List.Item
          key={favorite.id}
          title={favorite.title}
          subtitle={`匹配分 ${score}`}
          detail={<List.Item.Detail markdown={`${verificationText(favorite)}\n\n${favoriteMarkdown(favorite)}`} />}
          accessories={[
            { tag: verificationLabels[favorite.verification?.status || "unverified"] },
            {
              text: matches
                .slice(0, 3)
                .map((t) => t.term)
                .join(" · "),
            },
          ]}
          actions={
            <ActionPanel>
              {toggle}
              <Action.Push
                title="查看匹配依据"
                target={
                  <Detail
                    markdown={`# 匹配依据\n\n${matches.map((t) => `- ${t.kind}：${t.term}（权重 ${t.weight}）`).join("\n")}\n\n异常名优先，其次类名、关键词。当前使用本地词项匹配。`}
                  />
                }
              />
              <FavoriteActions
                favorite={favorite}
                store={store}
                reload={reload}
                openCodexLinks={preferences.openCodexLinks}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

export default function SearchByCode() {
  const [query, setQuery] = useState("");
  const { push } = useNavigation();
  const terms = codeTerms(query);
  return (
    <Form
      navigationTitle="用报错或代码找收藏"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="查找相关收藏"
            onSubmit={() => {
              if (terms.length) push(<Results query={query} />);
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="query"
        title="报错或代码"
        placeholder="粘贴异常堆栈、代码片段或业务关键词"
        value={query}
        onChange={setQuery}
        error={query.trim() && !terms.length ? "没有可检索的异常名、类名或关键词" : undefined}
      />
      <Form.Description title="提取词项" text={terms.map((t) => `${t.kind}：${t.term}`).join("；") || "等待输入"} />
    </Form>
  );
}
