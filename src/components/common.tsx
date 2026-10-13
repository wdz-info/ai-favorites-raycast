import {
  Action,
  ActionPanel,
  Detail,
  Icon,
  Keyboard,
  openCommandPreferences,
  openExtensionPreferences,
} from "@raycast/api";

export function UtilityActions({ reload }: { reload?: () => void }) {
  return (
    <ActionPanel.Section>
      {reload && (
        <Action title="刷新" icon={Icon.ArrowClockwise} shortcut={Keyboard.Shortcut.Common.Refresh} onAction={reload} />
      )}
      <Action title="设置命令快捷键" icon={Icon.Keyboard} onAction={openCommandPreferences} />
      <Action title="扩展设置" icon={Icon.Gear} onAction={openExtensionPreferences} />
    </ActionPanel.Section>
  );
}

export function ErrorDetail({ error, reload }: { error: string; reload?: () => void }) {
  return (
    <Detail
      markdown={`# 无法读取\n\n${error}`}
      actions={
        <ActionPanel>
          <UtilityActions reload={reload} />
        </ActionPanel>
      }
    />
  );
}

export const favoriteShortcut: Keyboard.Shortcut = { modifiers: ["cmd"], key: "return" };

export function WarningDetail({ warnings }: { warnings: string[] }) {
  return <Detail markdown={`# 历史读取提示\n\n${warnings.map((w) => `- ${w}`).join("\n")}`} />;
}
