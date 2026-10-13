import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { create, act, ReactTestRenderer } from "react-test-renderer";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { FavoriteStore } from "../src/core/store";
import { AIFavorite } from "../src/core/types";
import { capturedDraft } from "../src/core/capture";
import { fileDraft } from "../src/core/favorite-service";

// Render the actual command components with only the native Raycast boundary mocked.
// No production data, desktop settings, clipboard, or application links are changed.
const ready = (async () => {
  await build({
    entryPoints: ["tests/ui-entry.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: ".test-build/ui.cjs",
    external: ["react"],
    plugins: [
      {
        name: "mock-raycast",
        setup(build) {
          build.onResolve({ filter: /^@raycast\/api$/ }, () => ({ path: resolve("tests/mock-raycast.tsx") }));
        },
      },
    ],
  });
  return createRequire(resolve("package.json"))("./.test-build/ui.cjs") as {
    FavoritesList: React.ComponentType<{ searchMode?: boolean }>;
    BrowseSessions: React.ComponentType<{ mode?: string }>;
    AddFavorite: React.ComponentType;
    FavoriteSelection: React.ComponentType<{ mode: "pack" | "export" }>;
    VerificationForm: React.ComponentType<{ favorite: AIFavorite; onSaved: () => void }>;
    CompareVersions: React.ComponentType<{ favorite: AIFavorite; onSaved: () => void }>;
    ExportForm: React.ComponentType<{ favorites: AIFavorite[] }>;
    CaptureSelection: React.ComponentType;
    SearchByCode: React.ComponentType;
    SyncCommand: () => Promise<void>;
    environment: { launchType: string };
    uiState: {
      preferences: {
        codexHome: string;
        storageDirectory: string;
        openCodexLinks: boolean;
        kiroHome: string;
        grokHome: string;
        kiroDatabase: string;
        kiroLegacyIde: string;
        autoSync: boolean;
      };
      pushed: React.ReactElement[];
      pops: number;
      opened: string[];
      toasts: { title: string; message?: string; style: string }[];
      selection: string | undefined;
      clipboard: string | undefined;
    };
  };
})();
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ai-favorites-ui-"));
  await mkdir(join(root, "sessions"));
  const file = join(root, "generated.ts");
  await writeFile(file, "const version = 1;\n");
  const log = join(root, "sessions", "rollout.jsonl");
  await writeFile(
    log,
    [
      { type: "session_meta", payload: { id: "ui-session", cwd: root } },
      {
        type: "response_item",
        payload: {
          type: "message",
          id: "ui-question",
          role: "user",
          content: [{ type: "input_text", text: "How does retry work?" }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          id: "ui-reply",
          role: "assistant",
          content: [{ type: "output_text", text: "Use idempotency.\n\n```ts\nretry();\n```" }],
        },
      },
    ]
      .map((row) => JSON.stringify(row))
      .join("\n") + "\n",
  );
  await writeFile(
    join(root, "session_index.jsonl"),
    JSON.stringify({ id: "ui-session", thread_name: "UI Workflow" }) + "\n",
  );
  const ui = await ready;
  ui.uiState.preferences = {
    codexHome: root,
    storageDirectory: join(root, "favorites"),
    openCodexLinks: true,
    kiroHome: join(root, "no-kiro"),
    grokHome: join(root, "no-grok"),
    kiroDatabase: join(root, "no-db"),
    kiroLegacyIde: join(root, "no-ide"),
    autoSync: false,
  };
  ui.uiState.pushed = [];
  ui.uiState.pops = 0;
  ui.uiState.opened = [];
  ui.uiState.toasts = [];
  return { ...ui, root, file, store: new FavoriteStore(join(root, "favorites")) };
}

function node(renderer: ReactTestRenderer, type: string, title?: string) {
  const result = renderer.root.findAll((n) => n.type === type && (title === undefined || n.props.title === title));
  assert.ok(result.length, `Missing ${type} ${title || ""}`);
  return result[0];
}
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 60));
}
async function render(element: React.ReactElement, previous?: ReactTestRenderer) {
  let result = previous;
  await act(async () => {
    if (result) result.update(element);
    else result = create(element);
  });
  const deadline = Date.now() + 5000;
  while (
    result!.root.findAll((n) => ["List", "Form", "Detail"].includes(String(n.type)) && n.props.isLoading === true)
      .length
  ) {
    assert.ok(Date.now() < deadline, "Component did not finish loading within 5 seconds");
    await act(settle);
  }
  return result!;
}
async function pushAction(renderer: ReactTestRenderer, title: string) {
  return render(node(renderer, "Action.Push", title).props.target, renderer);
}

test("Raycast UI flow saves session, reply with context, and file; previews, searches and exposes copy/source actions", async () => {
  const f = await fixture();
  let renderer: ReactTestRenderer | undefined;
  try {
    renderer = await render(React.createElement(f.BrowseSessions));
    assert.equal(node(renderer, "List.Item", "UI Workflow").props.title, "UI Workflow");
    renderer = await pushAction(renderer, "收藏这个会话");
    assert.equal(node(renderer, "Form.TextField", "标题").props.value, "UI Workflow");
    await act(async () => {
      await node(renderer!, "Action.SubmitForm").props.onSubmit();
    });
    assert.equal((await f.store.list())[0].type, "session");

    renderer = await render(React.createElement(f.BrowseSessions), renderer);
    renderer = await pushAction(renderer, "浏览回复与文件");
    renderer = await pushAction(renderer, "收藏这条回复");
    await act(async () => {
      node(renderer!, "Form.TextField", "标签").props.onChange("retry, TypeScript");
      node(renderer!, "Form.TextArea", "我的备注").props.onChange("reusable note");
    });
    renderer = await pushAction(renderer, "预览快照");
    assert.match(node(renderer, "Detail").props.markdown, /How does retry work/);
    // Return to the actual saved reply editor via the browse flow.
    renderer = await render(React.createElement(f.BrowseSessions), renderer);
    renderer = await pushAction(renderer, "浏览回复与文件");
    renderer = await pushAction(renderer, "收藏这条回复");
    await act(async () => {
      node(renderer!, "Form.TextField", "标签").props.onChange("retry, TypeScript");
      node(renderer!, "Form.TextArea", "我的备注").props.onChange("reusable note");
    });
    await act(async () => {
      await node(renderer!, "Action.SubmitForm").props.onSubmit();
    });
    assert.equal((await f.store.list()).find((v) => v.type === "message")?.context?.question, "How does retry work?");

    renderer = await render(React.createElement(f.AddFavorite), renderer);
    renderer = await pushAction(renderer, "选择文件");
    await act(async () => {
      node(renderer!, "Form.TextField", "或填写文件路径").props.onChange(f.file);
    });
    await act(async () => {
      await node(renderer!, "Action.SubmitForm").props.onSubmit();
    });
    renderer = await render(f.uiState.pushed.pop()!, renderer);
    await act(async () => {
      await node(renderer!, "Action.SubmitForm").props.onSubmit();
    });
    assert.equal((await f.store.list()).length, 3);

    renderer = await render(React.createElement(f.FavoritesList, { searchMode: true }), renderer);
    await act(async () => {
      node(renderer!, "List").props.onSearchTextChange("reusable note");
    });
    assert.equal(renderer.root.findAll((n) => String(n.type) === "List.Item").length, 1);
    assert.match(node(renderer, "List.Item.Detail").props.markdown, /How does retry work/);
    assert.equal(
      node(renderer, "Action.CopyToClipboard", "复制 AI 回复").props.content,
      "Use idempotency.\n\n```ts\nretry();\n```",
    );
    assert.equal(node(renderer, "Action.CopyToClipboard", "复制代码块").props.content, "retry();");
    assert.match(node(renderer, "Action.CopyToClipboard", "复制源记录位置").props.content, /rollout.jsonl:3$/);
    await act(async () => {
      await node(renderer!, "Action", "在 Codex 中打开会话").props.onAction();
    });
    assert.equal(f.uiState.opened[0], "codex://threads/ui-session");
    renderer = await pushAction(renderer, "定位原始消息记录");
    assert.match(node(renderer, "Detail").props.markdown, /ui-reply/);
    assert.equal(f.uiState.toasts.filter((t) => t.style === "failure").length, 0);
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    await rm(f.root, { recursive: true, force: true });
  }
});

test("Raycast UI edits tags/notes, applies combined filters, removes only favorite and keeps missing-source snapshots readable", async () => {
  const f = await fixture();
  let renderer: ReactTestRenderer | undefined;
  try {
    renderer = await render(React.createElement(f.AddFavorite));
    renderer = await pushAction(renderer, "选择文件");
    await act(async () => {
      node(renderer!, "Form.TextField", "或填写文件路径").props.onChange(f.file);
      node(renderer!, "Form.TextField", "项目目录").props.onChange(f.root);
    });
    await act(async () => {
      await node(renderer!, "Action.SubmitForm").props.onSubmit();
    });
    renderer = await render(f.uiState.pushed.pop()!, renderer);
    await act(async () => {
      await node(renderer!, "Action.SubmitForm").props.onSubmit();
    });
    await rm(f.file);
    renderer = await render(React.createElement(f.FavoritesList), renderer);
    renderer = await pushAction(renderer, "编辑标题、标签与备注");
    await act(async () => {
      node(renderer!, "Form.TextField", "标题").props.onChange("Saved Code");
      node(renderer!, "Form.TextField", "标签").props.onChange("saved");
      node(renderer!, "Form.TextArea", "我的备注").props.onChange("still readable");
    });
    await act(async () => {
      await node(renderer!, "Action.SubmitForm").props.onSubmit();
    });
    const favorite = (await f.store.list())[0];
    assert.equal(favorite.title, "Saved Code");
    assert.deepEqual(favorite.tags, ["saved"]);
    assert.equal(favorite.content, "const version = 1;\n");
    renderer = await render(React.createElement(f.FavoritesList), renderer);
    // Filter form applies all three independent constraints to the actual parent.
    const parent = renderer;
    const filterElement = node(parent, "Action.Push", "按类型、项目、标签和来源筛选").props.target;
    let filters = await render(filterElement);
    await act(async () => {
      node(filters, "Form.Dropdown", "类型").props.onChange("file");
      node(filters, "Form.Dropdown", "项目").props.onChange(JSON.stringify(f.root));
      node(filters, "Form.Dropdown", "标签").props.onChange("saved");
    });
    await act(async () => {
      node(filters, "Action.SubmitForm").props.onSubmit();
    });
    assert.equal(parent.root.findAll((n) => String(n.type) === "List.Item").length, 1);
    await act(async () => {
      node(filters, "Form.Dropdown", "类型").props.onChange("session");
    });
    await act(async () => {
      node(filters, "Action.SubmitForm").props.onSubmit();
    });
    assert.equal(parent.root.findAll((n) => String(n.type) === "List.Item").length, 0);
    await act(async () => filters.unmount());
    await act(async () => {
      node(parent, "Action", "清空筛选").props.onAction();
    });
    assert.match(node(parent, "List.Item.Detail").props.markdown, /const version = 1/);
    assert.equal(node(parent, "Action.CopyToClipboard", "复制文件路径").props.content, f.file);
    renderer = await pushAction(parent, "阅读收藏");
    const beforeRemoval = f.uiState.pops;
    await act(async () => {
      await node(renderer!, "Action", "移除收藏").props.onAction();
    });
    await act(settle);
    assert.equal(f.uiState.pops, beforeRemoval + 1, "Removing from Detail pops exactly one screen");
    assert.equal((await f.store.list()).length, 0);
    assert.equal(f.uiState.toasts.filter((t) => t.style === "failure").length, 0);
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    await rm(f.root, { recursive: true, force: true });
  }
});

test("UI multi-select pack previews before copy, batch export and manual verification preserve metadata", async () => {
  const f = await fixture();
  let renderer: ReactTestRenderer | undefined;
  try {
    const draft = capturedDraft("方案 A", "RetryPolicy handles SocketTimeoutException", "manual", {
      label: "测试会话",
    });
    const first = (
      await f.store.add(draft, { title: "方案 A", tags: ["Java"], note: "备注", applicability: "Java 21" })
    ).favorite;
    await f.store.add(
      { ...draft, title: "方案 B", content: "另一个方案", snapshot: { ...draft.snapshot, sha256: "a".repeat(64) } },
      { title: "方案 B", tags: [], note: "" },
    );
    renderer = await render(React.createElement(f.FavoriteSelection, { mode: "pack" }));
    await act(async () => node(renderer!, "Action", "选择当前搜索结果").props.onAction());
    await act(async () => node(renderer!, "Action", "预览上下文包").props.onAction());
    renderer = await render(f.uiState.pushed.at(-1)!, renderer);
    await act(async () => node(renderer!, "Form.TextArea", "当前任务（可选）").props.onChange("修复重试"));
    renderer = await pushAction(renderer, "预览上下文包");
    const markdown = node(renderer, "Detail").props.markdown;
    for (const term of ["方案 A", "方案 B", "修复重试", "Java 21", "未验证", "测试会话"])
      assert.ok(markdown.includes(term), term);
    assert.equal(node(renderer, "Action.CopyToClipboard", "复制上下文包").props.content, markdown);
    renderer = await render(React.createElement(f.ExportForm, { favorites: await f.store.list() }), renderer);
    await act(async () => node(renderer!, "Form.TextField", "仓库路径").props.onChange(f.root));
    await act(async () => node(renderer!, "Action.SubmitForm").props.onSubmit());
    renderer = await render(f.uiState.pushed.at(-1)!, renderer);
    assert.equal(renderer.root.findAll((n) => (n.type as unknown) === "List.Item").length, 2);
    assert.ok(node(renderer, "Action.Open", "在 Obsidian 打开").props.target.startsWith("obsidian://open?"));
    renderer = await render(React.createElement(f.VerificationForm, { favorite: first, onSaved: () => {} }), renderer);
    await act(async () => {
      node(renderer!, "Form.Dropdown", "验证状态").props.onChange("verified");
      node(renderer!, "Form.TextField", "验证项目").props.onChange("payment");
      node(renderer!, "Form.TextField", "验证版本").props.onChange("v2");
    });
    await act(async () => node(renderer!, "Action.SubmitForm").props.onSubmit());
    assert.equal((await f.store.list()).find((v) => v.id === first.id)?.verification?.status, "verified");
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    await rm(f.root, { recursive: true, force: true });
  }
});

test("UI quick capture falls back to clipboard, records source, and code search exposes reusable result actions", async () => {
  const f = await fixture();
  let renderer: ReactTestRenderer | undefined;
  try {
    f.uiState.selection = undefined;
    f.uiState.clipboard = "RetryPolicy handles SocketTimeoutException";
    renderer = await render(React.createElement(f.CaptureSelection));
    assert.equal(node(renderer, "Form.TextArea", "收藏内容").props.value, f.uiState.clipboard);
    assert.ok(node(renderer, "Form.Description", "读取方式").props.text.includes("剪贴板"));
    await act(async () => node(renderer!, "Form.TextField", "来源说明").props.onChange("粘贴自测试讨论"));
    await act(async () => node(renderer!, "Action.SubmitForm").props.onSubmit());
    const saved = (await f.store.list())[0];
    assert.equal(saved.source.captureMethod, "clipboard");
    assert.equal(saved.source.application, undefined);
    renderer = await render(React.createElement(f.SearchByCode), renderer);
    await act(async () =>
      node(renderer!, "Form.TextArea", "报错或代码").props.onChange(
        "java.net.SocketTimeoutException at RetryPolicy.execute()",
      ),
    );
    await act(async () => node(renderer!, "Action.SubmitForm").props.onSubmit());
    renderer = await render(f.uiState.pushed.at(-1)!, renderer);
    assert.equal(node(renderer, "List.Item", saved.title).props.title, saved.title);
    assert.equal(node(renderer, "Action.CopyToClipboard", "复制 AI 回复").props.content, saved.content);
    assert.ok(node(renderer, "Action.Push", "生成上下文包"));
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    await rm(f.root, { recursive: true, force: true });
  }
});

test("UI compares two saved versions and persists a single recommendation without deleting old content", async () => {
  const f = await fixture();
  let renderer: ReactTestRenderer | undefined;
  try {
    const old = (await f.store.add(await fileDraft(f.file), { title: "版本1", tags: [], note: "" })).favorite;
    await writeFile(f.file, "const version = 2;\n");
    const latest = (await f.store.add(await fileDraft(f.file), { title: "版本2", tags: [], note: "" })).favorite;
    renderer = await render(React.createElement(f.CompareVersions, { favorite: old, onSaved: () => {} }));
    renderer = await pushAction(renderer, "比较两个快照");
    assert.ok(node(renderer, "Detail").props.markdown.includes("+const version = 2;"));
    await act(async () => node(renderer!, "Action", "推荐新版").props.onAction());
    await act(settle);
    const saved = await f.store.list();
    assert.equal(saved.length, 2);
    assert.equal(saved.find((v) => v.id === latest.id)?.recommended, true);
    assert.equal(saved.find((v) => v.id === old.id)?.content, old.content);
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    await rm(f.root, { recursive: true, force: true });
  }
});

test("background command respects sync preference, persists catalog when enabled, and stays quiet", async () => {
  const f = await fixture();
  try {
    f.environment.launchType = "background";
    await f.SyncCommand();
    f.uiState.preferences.autoSync = true;
    await f.SyncCommand();
    const { readFile } = await import("node:fs/promises");
    const catalog = JSON.parse(await readFile(join(f.store.directory, "history-catalog.json"), "utf8"));
    assert.equal(catalog.sessions.length, 1);
    assert.equal(f.uiState.toasts.length, 0);
  } finally {
    f.environment.launchType = "user";
    await rm(f.root, { recursive: true, force: true });
  }
});
