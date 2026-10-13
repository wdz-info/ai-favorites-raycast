import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { BrowseSessions } from "./browse-sessions";
import { FilePicker } from "./file-picker";

export function AddFavorite({ onSaved }: { onSaved?: () => void }) {
  return (
    <List navigationTitle="添加 AI 收藏">
      <List.Item
        title="会话"
        subtitle="保存完整的 AI 会话"
        icon={Icon.Message}
        actions={
          <ActionPanel>
            <Action.Push title="选择 AI 会话" target={<BrowseSessions onSaved={onSaved} mode="session" />} />
          </ActionPanel>
        }
      />
      <List.Item
        title="AI 回复"
        subtitle="保存一条回复及对应的用户问题"
        icon={Icon.SpeechBubble}
        actions={
          <ActionPanel>
            <Action.Push title="选择 AI 回复" target={<BrowseSessions onSaved={onSaved} mode="message" />} />
          </ActionPanel>
        }
      />
      <List.Item
        title="文件"
        subtitle="保存生成或修改过的文本文件版本"
        icon={Icon.Document}
        actions={
          <ActionPanel>
            <Action.Push title="选择文件" target={<FilePicker onSaved={onSaved} />} />
          </ActionPanel>
        }
      />
    </List>
  );
}
