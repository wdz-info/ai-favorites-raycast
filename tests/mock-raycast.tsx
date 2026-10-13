import React from "react";

export const uiState = {
  preferences: {
    codexHome: "",
    storageDirectory: "",
    openCodexLinks: true,
    kiroHome: "",
    grokHome: "",
    kiroDatabase: "",
    kiroLegacyIde: "",
    autoSync: false,
  },
  pushed: [] as React.ReactElement[],
  pops: 0,
  opened: [] as string[],
  toasts: [] as { title: string; message?: string; style: string }[],
  selection: "selected content" as string | undefined,
  clipboard: "clipboard content" as string | undefined,
};

function component(name: string) {
  return (props: Record<string, unknown>) =>
    React.createElement(
      name,
      props,
      props.children as React.ReactNode,
      props.actions as React.ReactNode,
      props.detail as React.ReactNode,
      props.metadata as React.ReactNode,
    );
}
function metadata(name: string) {
  return Object.assign(component(name), {
    Label: component(`${name}.Label`),
    TagList: Object.assign(component(`${name}.TagList`), { Item: component(`${name}.TagList.Item`) }),
  });
}
export const ActionPanel = Object.assign(component("ActionPanel"), { Section: component("ActionPanel.Section") });
export const Action = Object.assign(component("Action"), {
  Push: component("Action.Push"),
  Open: component("Action.Open"),
  CopyToClipboard: component("Action.CopyToClipboard"),
  ShowInFinder: component("Action.ShowInFinder"),
  SubmitForm: component("Action.SubmitForm"),
  Style: { Destructive: "destructive" },
});
export const Detail = Object.assign(component("Detail"), { Metadata: metadata("Detail.Metadata") });
export const List = Object.assign(component("List"), {
  EmptyView: component("List.EmptyView"),
  Section: component("List.Section"),
  Dropdown: Object.assign(component("List.Dropdown"), { Item: component("List.Dropdown.Item") }),
  Item: Object.assign(component("List.Item"), {
    Detail: Object.assign(component("List.Item.Detail"), { Metadata: metadata("List.Item.Detail.Metadata") }),
  }),
});
export const Form = Object.assign(
  component("Form"),
  Object.fromEntries(
    ["TextField", "TextArea", "FilePicker", "Separator", "Description"].map((name) => [
      name,
      component(`Form.${name}`),
    ]),
  ),
  {
    Dropdown: Object.assign(component("Form.Dropdown"), { Item: component("Form.Dropdown.Item") }),
    DatePicker: Object.assign(component("Form.DatePicker"), { Type: { Date: "date" } }),
  },
);
export const Icon = new Proxy({}, { get: (_, key) => String(key) });
export const Keyboard = {
  Shortcut: {
    Common: {
      Refresh: { modifiers: ["cmd"], key: "r" },
      Edit: { modifiers: ["cmd"], key: "e" },
      Copy: { modifiers: ["cmd", "shift"], key: "c" },
      New: { modifiers: ["cmd"], key: "n" },
    },
  },
};
export const Toast = { Style: { Success: "success", Failure: "failure" } };
export const Alert = { ActionStyle: { Destructive: "destructive" } };
export const confirmAlert = async () => true;
export const showToast = async (toast: (typeof uiState.toasts)[number]) => {
  uiState.toasts.push(toast);
};
export const getPreferenceValues = () => uiState.preferences;
export const useNavigation = () => ({
  push: (element: React.ReactElement) => uiState.pushed.push(element),
  pop: () => {
    uiState.pops++;
  },
});
export const open = async (target: string) => {
  uiState.opened.push(target);
};
export const openExtensionPreferences = async () => {};
export const openCommandPreferences = async () => {};
export const getSelectedText = async () => {
  if (uiState.selection === undefined) throw new Error("selection unavailable");
  return uiState.selection;
};
export const getFrontmostApplication = async () => ({ name: "Fixture App" });
export const Clipboard = { readText: async () => uiState.clipboard };
export const environment = { launchType: "user" };
export const LaunchType = { Background: "background", UserInitiated: "user" };
