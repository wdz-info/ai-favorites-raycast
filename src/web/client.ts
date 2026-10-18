/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { marked } from "marked";
import DOMPurify from "dompurify";
import type {
  DetailResult,
  FavoriteRow,
  HistoryResult,
  LibraryResult,
  SessionResult,
  WebSessionSummary,
} from "./types";
import { historyPeriod, historyPeriods, historyPeriodLabels, historyPrograms, HistoryPeriod } from "./history-groups";
import type { FavoriteMetadata } from "../core/types";

const $ = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document) =>
  root.querySelector<T>(selector)!;
const h = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const date = (value: number) => new Date(value).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
const providers: Record<string, string> = {
  manual: "手动来源",
  codex: "Codex",
  kiro: "Kiro",
  grok: "Grok",
  claude: "Claude",
  gemini: "Gemini",
  opencode: "OpenCode",
};
const kinds: Record<string, string> = { session: "会话", message: "AI 回复", file: "文件版本" };
const statusNames: Record<string, string> = { verified: "已验证", unverified: "未验证", invalid: "已失效" };
const launch = new URLSearchParams(location.hash.slice(1));
let token = launch.get("token") || sessionStorage.getItem("ai-favorites-token") || "";
if (token) sessionStorage.setItem("ai-favorites-token", token);
const launchFavorite = launch.get("favorite");
history.replaceState(null, "", location.pathname);
let nav = "all",
  offset = 0,
  total = 0,
  selectedId = launchFavorite || "",
  library: LibraryResult | undefined,
  detail: DetailResult | undefined;
let rows: FavoriteRow[] = [],
  sessionDetail: SessionResult | undefined;
let listSequence = 0,
  detailSequence = 0,
  debounce: ReturnType<typeof setTimeout>,
  toastTimer: ReturnType<typeof setTimeout>;
const selected = new Set<string>();
let historyProvider = "",
  historyTime: HistoryPeriod | "" = "";

function historyCategoryHtml(value: HistoryResult, provider: string, period: string, scope: "main" | "picker") {
  const categoryButton = (program: string, time: string, label: string, count: number, level: string) =>
    `<button class="history-category ${level} ${provider === program && period === time ? "active" : ""}" data-history-provider="${h(program)}" data-history-period="${time}" data-history-scope="${scope}" aria-pressed="${provider === program && period === time}"><span>${h(label)}</span><span>${count}</span></button>`;
  return `<div class="eyebrow">程序 / 最近更新</div>${categoryButton(
    "",
    "",
    "全部程序",
    value.categories.reduce((n, c) => n + c.count, 0),
    "program",
  )}${value.categories
    .map(
      (category) =>
        `<section>${categoryButton(category.provider, "", providers[category.provider] || category.provider, category.count, "program")}
    <div class="history-times">${historyPeriods.map((time) => categoryButton(category.provider, time, historyPeriodLabels[time], category.periods[time], "time")).join("")}</div></section>`,
    )
    .join("")}`;
}
function historyGroupedRows(value: HistoryResult, row: (session: WebSessionSummary) => string) {
  return historyPrograms(value.items.map((s) => s.provider))
    .map(
      (provider) =>
        `<section class="history-program-group" data-program="${h(provider)}"><h2 class="history-program-heading">${h(providers[provider] || provider)}</h2>${historyPeriods
          .map((period) => {
            const items = value.items.filter(
              (s) => s.provider === provider && historyPeriod(s.updatedAt, value.now) === period,
            );
            return items.length
              ? `<section data-time="${period}"><h3 class="history-time-heading">${historyPeriodLabels[period]}</h3>${items.map(row).join("")}</section>`
              : "";
          })
          .join("")}</section>`,
    )
    .join("");
}
function toast(message: string, error = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("error", error);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 4500);
}
function connection(message: string) {
  const el = $("#connection");
  el.textContent = message;
  el.hidden = !message;
}
async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  }).catch(() => {
    const message = "连接已断开，请从 Raycast 重新打开网页收藏夹。";
    connection(message);
    throw new Error(message);
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: `服务返回 ${response.status}` }));
    if (response.status === 401) {
      connection(error.error);
      token = "";
      sessionStorage.removeItem("ai-favorites-token");
    }
    throw new Error(error.error || "操作失败。");
  }
  connection("");
  return response;
}
async function api<T = Record<string, unknown>>(path: string, method = "GET", body?: unknown): Promise<T> {
  return (await request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })).json();
}
function run(work: () => Promise<unknown>) {
  void work().catch((error) => toast((error as Error).message, true));
}
function markdown(target: HTMLElement, source: string) {
  target.innerHTML = DOMPurify.sanitize(marked.parse(source, { async: false, gfm: true }) as string, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "form", "input", "button", "iframe"],
    FORBID_ATTR: ["style"],
  });
  for (const a of target.querySelectorAll("a")) {
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  }
  for (const pre of target.querySelectorAll("pre")) {
    const button = document.createElement("button");
    button.className = "small";
    button.textContent = "复制代码";
    button.addEventListener("click", () =>
      run(() => copy(pre.querySelector("code")?.textContent || pre.textContent || "")),
    );
    pre.after(button);
  }
}
async function copy(content: string) {
  try {
    await navigator.clipboard.writeText(content);
    toast("已复制");
  } catch {
    const area = document.createElement("textarea");
    area.value = content;
    area.className = "copy-fallback";
    openDialog("选择并复制内容", "");
    $("#dialog-body").append(area);
    area.select();
    toast("浏览器未允许剪贴板，请按 ⌘C 复制所选内容。");
  }
}
function openDialog(title: string, html: string) {
  $("#dialog-title").textContent = title;
  $("#dialog-body").innerHTML = html;
  const dialog = $<HTMLDialogElement>("#dialog");
  if (!dialog.open) dialog.showModal();
}
function closeDialog() {
  $<HTMLDialogElement>("#dialog").close();
}
function bindForm(work: (data: FormData) => Promise<void>) {
  const form = $<HTMLFormElement>("form", $("#dialog-body"));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      const button = $<HTMLButtonElement>('button[type="submit"]', form);
      button.disabled = true;
      $(".form-error", form).textContent = "";
      try {
        await work(new FormData(form));
      } catch (error) {
        $(".form-error", form).textContent = (error as Error).message;
      } finally {
        button.disabled = false;
      }
    })();
  });
}
function formActions(label: string) {
  return `<div class="form-error" role="alert"></div><div class="form-actions"><button type="button" data-action="close-dialog">取消</button><button type="submit" class="primary">${label}</button></div>`;
}
function metadataFields(f?: FavoriteMetadata) {
  return `<label>标题<input name="title" value="${h(f?.title)}" ${f ? "required" : ""} maxlength="500" placeholder="留空时自动生成"></label><div class="form-grid"><label>标签<input name="tags" value="${h(f?.tags.join(", "))}" placeholder="用逗号分隔，例如：架构, Java"></label><label>适用条件<input name="applicability" value="${h(f?.applicability)}" placeholder="适用的框架版本、前提与限制"></label></div><label>我的备注<textarea name="note" rows="3" placeholder="记录为什么值得收藏、下次何时使用">${h(f?.note)}</textarea></label>`;
}
const formText = (data: FormData, key: string) => String(data.get(key) || "");
function meta(data: FormData) {
  return {
    title: formText(data, "title") || undefined,
    tags: formText(data, "tags")
      .split(/[,，\n]/)
      .map((t) => t.trim())
      .filter(Boolean),
    note: formText(data, "note"),
    applicability: formText(data, "applicability"),
  };
}
function options(selector: string, values: string[], empty: string) {
  const el = $<HTMLSelectElement>(selector),
    previous = el.value;
  const choices = previous && !values.includes(previous) ? [...values, previous] : values;
  el.innerHTML = `<option value="">${empty}</option>${choices.map((value) => `<option value="${h(value)}">${h(value)}</option>`).join("")}`;
  el.value = previous;
}
function updateSelection() {
  $("#selection").hidden = !selected.size;
  $("#selection-count").textContent = `已选 ${selected.size} 条`;
  $<HTMLInputElement>("#select-page").checked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  for (const box of document.querySelectorAll<HTMLInputElement>("[data-check]"))
    box.checked = selected.has(box.dataset.check!);
}
function showEmpty() {
  detail = undefined;
  $("#reader").innerHTML =
    '<div class="empty-reader"><span class="empty-symbol">✧</span><h2>让好答案，再次派上用场</h2><p>选择一条收藏开始阅读，或保存新的知识片段。</p><button class="primary" data-action="add">添加收藏</button></div>';
}
function renderRows() {
  $("#rows").innerHTML = rows.length
    ? rows
        .map(
          (f) =>
            `<article class="favorite-row ${f.id === selectedId ? "active" : ""}"><input class="row-select" type="checkbox" data-check="${h(f.id)}" aria-label="选择 ${h(f.title)}" ${selected.has(f.id) ? "checked" : ""}><button class="row-open" data-favorite="${h(f.id)}"><div class="row-kind">${f.directory ? "▱ 目录快照" : h(kinds[f.type])}<span>·</span>${h(providers[f.provider])}${f.recommended ? " · 推荐" : ""}</div><h2>${h(f.title)}</h2><p>${h(f.snippet)}</p><div class="row-meta">${f.tags
              .slice(0, 3)
              .map((tag) => `<span class="tag">${h(tag)}</span>`)
              .join(
                "",
              )}<span>${h(new Date(f.updatedAt).toLocaleDateString("zh-CN"))}</span>${f.verification?.status ? `<span>${h(statusNames[f.verification.status])}</span>` : ""}</div></button></article>`,
        )
        .join("")
    : `<div class="empty-list"><strong>${library?.allCount ? "没有匹配的收藏" : "知识库从第一条收藏开始"}</strong>${library?.allCount ? "试试更短的词，或清除筛选条件。" : "添加一段回复、一份文件或整个网页目录。"}</div>`;
  updateSelection();
  renderPager(30);
}
function renderPager(size: number) {
  $("#pager").innerHTML =
    total > size
      ? `<button data-page="${Math.max(0, offset - size)}" ${offset === 0 ? "disabled" : ""} class="small">上一页</button><span>${Math.floor(offset / size) + 1} / ${Math.ceil(total / size)}</span><button data-page="${offset + size}" ${offset + size >= total ? "disabled" : ""} class="small">下一页</button>`
      : "";
}
async function loadLibrary(keepSelection = false, refreshHistory = false) {
  const sequence = ++listSequence;
  if (nav === "history") {
    await loadSessions(sequence, refreshHistory);
    return;
  }
  const params = new URLSearchParams({ q: $<HTMLInputElement>("#search").value, offset: String(offset) });
  if (nav !== "all") params.set("type", nav);
  for (const key of ["provider", "project", "tag", "verification", "mode", "sort"]) {
    const value = $<HTMLSelectElement>(`#${key}`).value;
    if (value) params.set(key, value);
  }
  const value = await api<LibraryResult>(`/favorites?${params}`);
  if (sequence !== listSequence) return;
  library = value;
  if (value.total && offset >= value.total) {
    offset = Math.floor((value.total - 1) / 30) * 30;
    await loadLibrary(keepSelection);
    return;
  }
  rows = value.items;
  total = value.total;
  $("#result-count").textContent = String(total);
  $("#count-all").textContent = String(value.allCount);
  for (const key of ["file", "message", "session"]) $(`#count-${key}`).textContent = String(value.counts[key] || 0);
  options("#project", value.projects, "全部项目");
  options("#tag", value.tags, "全部标签");
  renderRows();
  if (!keepSelection && !rows.some((f) => f.id === selectedId)) {
    selectedId = "";
    if (rows[0]) await showFavorite(rows[0].id);
    else showEmpty();
  }
}
async function showFavorite(id: string) {
  const sequence = ++detailSequence;
  selectedId = id;
  sessionDetail = undefined;
  for (const el of document.querySelectorAll<HTMLElement>("[data-favorite]"))
    el.closest(".favorite-row")?.classList.toggle("active", el.dataset.favorite === id);
  const result = await api<DetailResult>(`/favorites/${encodeURIComponent(id)}`);
  if (sequence !== detailSequence) return;
  detail = result;
  renderDetail();
  $("#layout").classList.add("reading");
  $("#reader").scrollTop = 0;
}
function renderDetail() {
  if (!detail) return;
  const f = detail.favorite,
    status = f.verification?.status || "unverified";
  $("#reader").innerHTML =
    `<div class="reader-inner"><button class="back-button text-button" data-action="back">← 返回列表</button><header class="reader-header"><div class="reader-kicker">${h(f.directory ? "目录快照" : kinds[f.type])}<span>·</span>${h(providers[f.provider])}<span class="status ${status}">${h(statusNames[status])}</span>${f.recommended ? '<span class="status verified">推荐版本</span>' : ""}</div><h2>${h(f.title)}</h2><div class="reader-meta">${f.tags.map((tag) => `<button class="tag" data-tag="${h(tag)}">${h(tag)}</button>`).join("")}<span>保存于 ${h(date(f.snapshot.capturedAt))}</span></div><div class="toolbar"><button data-action="copy">复制内容</button><button data-action="pack">打包复用</button><button data-action="edit">编辑收藏</button><button data-action="verify">验证记录</button>${f.directory ? '<button class="primary" data-action="view-directory">打开网页 / 目录快照 ↗</button>' : ""}<button data-action="raw">查看原文</button><button data-action="delete" class="danger">删除</button></div>${detail.versions.length > 1 ? `<div class="version-bar"><label>版本 <select id="version-select">${detail.versions.map((v) => `<option value="${h(v.id)}" ${v.id === f.id ? "selected" : ""}>${h(date(v.capturedAt))}${v.recommended ? " · 推荐" : ""} · ${v.sha256.slice(0, 8)}</option>`).join("")}</select></label><button class="text-button" data-action="compare">比较版本</button><button class="text-button" data-action="recommend">推荐当前版本</button></div>` : ""}</header><article class="markdown" id="article"></article><div class="feedback"><span>这条收藏这次有帮助吗？</span><button data-action="helpful">有帮助 ${f.reuseFeedback?.helpful || 0}</button><button data-action="unresolved">未解决 ${f.reuseFeedback?.unresolved || 0}</button></div><details class="source-details"><summary>来源与保存信息</summary><dl>${[
      ["来源", f.source.label],
      ["项目", f.projectPath],
      ["原始路径", f.filePath],
      ["来源链接", f.source.url],
      ["会话", f.sessionId],
      ["消息", f.messageId],
      ["文件数", f.directory?.fileCount],
      ["入口", f.directory?.entryPath],
      ["收藏 ID", f.id],
      ["SHA-256", f.snapshot.sha256],
      [
        "验证范围",
        f.verification?.project ? `${f.verification.project} / ${f.verification.version} / ${f.verification.date}` : "",
      ],
      ["验证备注", f.verification?.note],
    ]
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([key, value]) => `<dt>${h(key)}</dt><dd>${h(value)}</dd>`)
      .join(
        "",
      )}</dl>${f.filePath ? '<button class="text-button" data-action="copy-path">复制原始路径</button>' : ""}</details></div>`;
  markdown($("#article"), detail.markdown.replace(/^# [^\n]*\n+---\n+/, ""));
  $("#version-select")?.addEventListener("change", (event) =>
    run(() => showFavorite((event.target as HTMLSelectElement).value)),
  );
}
function addDialog(
  kind = "text",
  historyContext?: { kind: "session" | "message"; sessionKey: string; messageId?: string },
) {
  openDialog(
    historyContext ? "收藏历史内容" : "添加收藏",
    `<div class="segments" ${historyContext ? "hidden" : ""}><button data-add-kind="text" class="${kind === "text" ? "active" : ""}">文字 / AI 回复</button><button data-add-kind="file" class="${kind === "file" ? "active" : ""}">文件 / 目录</button><button data-add-kind="history">从历史会话添加</button></div><form>${historyContext ? '<p class="notice">保存当前会话或 AI 回复的完整快照；回复会保留对应的用户问题。</p>' : kind === "file" ? '<label>文件、目录路径或 file:// 链接<input name="path" required placeholder="file:///Users/…/指标说明/index.html"></label><p class="form-hint">选择 index.html 将连同目录资源一起保存。目录上限 64 MiB / 2000 个文件；文本文件上限 8 MiB。</p>' : '<label>收藏正文（支持 Markdown）<textarea name="content" rows="8" required placeholder="粘贴值得保留的回复、方案或代码…"></textarea></label><div class="form-grid"><label>来源说明<input name="sourceLabel" placeholder="例如：Codex 中的接口设计讨论"></label><label>来源链接（可选）<input name="sourceUrl" placeholder="https://…"></label></div>'}${metadataFields()}${!historyContext ? '<div class="form-grid"><label>项目目录（可选）<input name="projectPath" placeholder="/Users/…/project"></label><label>来源<select name="provider"><option value="manual">手动来源</option><option value="codex">Codex</option><option value="kiro">Kiro</option><option value="grok">Grok</option></select></label></div>' : ""}${formActions("保存收藏")}</form>`,
  );
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-add-kind]"))
    button.addEventListener("click", () => {
      if (button.dataset.addKind === "history") {
        historyDialog();
      } else addDialog(button.dataset.addKind);
    });
  bindForm(async (data) => {
    const body = {
      ...meta(data),
      kind: historyContext?.kind || kind,
      ...(historyContext || {}),
      ...(!historyContext
        ? {
            content: formText(data, "content"),
            path: formText(data, "path"),
            sourceLabel: formText(data, "sourceLabel"),
            sourceUrl: formText(data, "sourceUrl"),
            sessionKey: formText(data, "sessionKey") || undefined,
            projectPath: formText(data, "projectPath"),
            provider: formText(data, "provider"),
          }
        : {}),
    };
    const result = await api<{ favorite: { id: string }; existed: boolean }>("/favorites", "POST", body);
    toast(result.existed ? "该版本已收藏，保留原有备注" : "已保存收藏");
    setNav("all", false);
    for (const key of ["provider", "project", "tag", "verification"]) $<HTMLSelectElement>(`#${key}`).value = "";
    offset = 0;
    $<HTMLInputElement>("#search").value = "";
    await loadLibrary(true);
    await showFavorite(result.favorite.id);
    closeDialog();
  });
}
function historyDialog() {
  openDialog(
    "从历史会话添加",
    '<section id="history-picker"><p class="form-hint">按程序、最近更新时间选择会话，阅读后可收藏整个会话或一条 AI 回复。</p><label class="picker-search">搜索历史会话<input id="history-query" type="search" placeholder="会话标题、项目或 ID…"></label><div class="history-picker-grid"><nav id="picker-categories" class="history-categories" aria-label="弹窗历史分类"></nav><div><p id="history-status" role="status" aria-live="polite">正在加载历史会话…</p><div id="history-choices" class="history-choices"></div><div id="history-pages" class="pager"></div></div></div><div class="form-actions"><button id="history-retry">刷新历史</button><button id="history-back">返回添加</button></div></section>',
  );
  const root = $("#history-picker");
  let pageOffset = 0,
    sequence = 0,
    searchTimer: ReturnType<typeof setTimeout>;
  let selectedProvider = "",
    selectedTime: HistoryPeriod | "" = "";
  const active = () => $<HTMLDialogElement>("#dialog").open && $("#history-picker") === root;
  async function load(refresh = false) {
    const requestSequence = ++sequence;
    const status = $("#history-status", root);
    status.className = "busy";
    status.textContent = "正在加载历史会话…";
    $("#history-choices", root).setAttribute("aria-busy", "true");
    const params = new URLSearchParams({
      q: $<HTMLInputElement>("#history-query", root).value,
      offset: String(pageOffset),
    });
    if (refresh) params.set("refresh", "1");
    if (selectedProvider) params.set("provider", selectedProvider);
    if (selectedTime) params.set("period", selectedTime);
    try {
      const value = await api<HistoryResult>(`/sessions?${params}`);
      if (!active() || requestSequence !== sequence) return;
      status.className = "form-hint";
      status.textContent = value.total
        ? `共 ${value.total} 个会话${value.warnings.length ? ` · ${value.warnings.length} 条源记录读取提示` : ""}`
        : "没有匹配的会话，请修改搜索词或检查 Raycast 中的历史目录设置。";
      $("#picker-categories", root).innerHTML = historyCategoryHtml(value, selectedProvider, selectedTime, "picker");
      for (const category of root.querySelectorAll<HTMLButtonElement>('[data-history-scope="picker"]'))
        category.onclick = () => {
          selectedProvider = category.dataset.historyProvider!;
          selectedTime = category.dataset.historyPeriod as HistoryPeriod | "";
          pageOffset = 0;
          void load();
        };
      $("#history-choices", root).innerHTML = historyGroupedRows(
        value,
        (s) =>
          `<button class="history-choice" data-history-choice="${s.key}" data-choice-provider="${s.provider}"><strong>${h(s.title)}</strong><span>${h(s.projectPath || "未关联项目")}</span></button>`,
      );
      $("#history-pages", root).innerHTML =
        value.total > 40
          ? `<button data-history-page="${pageOffset - 40}" ${pageOffset === 0 ? "disabled" : ""}>上一页</button><span>${Math.floor(pageOffset / 40) + 1} / ${Math.ceil(value.total / 40)}</span><button data-history-page="${pageOffset + 40}" ${pageOffset + 40 >= value.total ? "disabled" : ""}>下一页</button>`
          : "";
      for (const button of root.querySelectorAll<HTMLButtonElement>("[data-history-page]"))
        button.onclick = () => {
          pageOffset = Number(button.dataset.historyPage);
          void load();
        };
      for (const button of root.querySelectorAll<HTMLButtonElement>("[data-history-choice]"))
        button.onclick = () => {
          void (async () => {
            status.className = "busy";
            status.textContent = "正在打开会话内容…";
            for (const choice of root.querySelectorAll<HTMLButtonElement>("[data-history-choice]"))
              choice.disabled = true;
            try {
              historyProvider = selectedProvider || button.dataset.choiceProvider!;
              historyTime = selectedTime;
              setNav("history", false);
              await loadLibrary(true);
              await showSession(button.dataset.historyChoice!);
              if (active()) closeDialog();
            } catch (error) {
              if (active()) {
                status.className = "form-error";
                status.textContent = `无法打开会话：${(error as Error).message}。可选择其他会话或点击重试。`;
              }
            } finally {
              for (const choice of root.querySelectorAll<HTMLButtonElement>("[data-history-choice]"))
                choice.disabled = false;
            }
          })();
        };
    } catch (error) {
      if (active() && requestSequence === sequence) {
        status.className = "form-error";
        status.textContent = `加载历史失败：${(error as Error).message}。请点击“刷新历史”重试。`;
      }
    } finally {
      if (active() && requestSequence === sequence) $("#history-choices", root).removeAttribute("aria-busy");
    }
  }
  $("#history-query", root).oninput = () => {
    clearTimeout(searchTimer);
    pageOffset = 0;
    searchTimer = setTimeout(() => void load(), 200);
  };
  $("#history-retry", root).onclick = () => void load(true);
  $("#history-back", root).onclick = () => addDialog();
  void load();
}
function editDialog() {
  if (!detail) return;
  const f = detail.favorite;
  openDialog(
    "编辑收藏",
    `<p class="form-hint">修改标题、标签和备注，保留收藏时的原始内容与版本。</p><form>${metadataFields({ ...f, note: f.note || "" })}${formActions("保存修改")}</form>`,
  );
  bindForm(async (data) => {
    await api(`/favorites/${f.id}`, "PATCH", meta(data));
    toast("修改已保存");
    await loadLibrary(true);
    await showFavorite(f.id);
    closeDialog();
  });
}
function verifyDialog() {
  if (!detail) return;
  const f = detail.favorite,
    v = f.verification;
  openDialog(
    "验证记录",
    `<form><label>验证状态<select name="status">${["unverified", "verified", "invalid"].map((s) => `<option value="${s}" ${s === (v?.status || "unverified") ? "selected" : ""}>${statusNames[s]}</option>`).join("")}</select></label><div class="form-grid"><label>验证项目<input name="project" value="${h(v?.project || f.projectPath)}" placeholder="项目名称或路径"></label><label>验证版本<input name="version" value="${h(v?.version)}" placeholder="例如：Spring Boot 3.4"></label></div><label>验证日期<input name="date" type="date" value="${h(v?.date || new Date().toLocaleDateString("en-CA"))}"></label><label>验证说明<textarea name="note">${h(v?.note)}</textarea></label><p class="form-hint">标记“已验证”时需填写项目、版本和日期。使用反馈不会自动改变验证状态。</p>${formActions("保存验证记录")}</form>`,
  );
  bindForm(async (data) => {
    const verification = {
      status: formText(data, "status"),
      project: formText(data, "project") || undefined,
      version: formText(data, "version") || undefined,
      date: formText(data, "date") || undefined,
      note: formText(data, "note"),
    };
    await api(`/favorites/${f.id}/verification`, "POST", { verification });
    await loadLibrary(true);
    await showFavorite(f.id);
    closeDialog();
    toast("验证记录已保存");
  });
}
function packDialog(ids: string[]) {
  openDialog(
    "打包复用",
    `<form><p class="form-hint">选择了 ${ids.length} 条收藏。预览后复制到新的 AI 会话。</p><label>当前任务<textarea name="task" rows="2" placeholder="说明这次需要解决的问题"></textarea></label><div class="form-grid"><label>内容模式<select name="mode"><option value="full">完整内容</option><option value="compact">任务相关原文片段</option><option value="code">仅代码</option></select></label><label>字符预算<input name="maxChars" type="number" value="20000" min="1000" max="200000"></label></div><label class="check-label"><input name="includePaths" type="checkbox" checked> 包含原始路径</label>${formActions("生成预览")}</form><div id="pack-output"></div>`,
  );
  bindForm(async (data) => {
    const result = await api<{ markdown: string }>("/pack", "POST", {
      ids,
      task: formText(data, "task"),
      mode: formText(data, "mode"),
      maxChars: Number(data.get("maxChars")),
      includePaths: data.get("includePaths") === "on",
    });
    $("#pack-output").innerHTML =
      '<hr><div class="markdown" id="pack-markdown"></div><div class="form-actions"><button class="primary" id="copy-pack">复制上下文包</button></div>';
    markdown($("#pack-markdown"), result.markdown);
    $("#copy-pack").addEventListener("click", () => run(() => copy(result.markdown)));
  });
}
function compareDialog() {
  if (!detail) return;
  const f = detail.favorite;
  openDialog(
    "比较收藏版本",
    `<form><label>与哪个版本比较<select name="other">${detail.versions
      .filter((v) => v.id !== f.id)
      .map((v) => `<option value="${h(v.id)}">${h(date(v.capturedAt))} · ${v.sha256.slice(0, 12)}</option>`)
      .join("")}</select></label>${formActions("显示差异")}</form><pre id="diff-output" class="raw-content"></pre>`,
  );
  bindForm(async (data) => {
    const result = await api<{ diff: string }>(
      `/favorites/${f.id}/diff?other=${encodeURIComponent(formText(data, "other"))}`,
    );
    $("#diff-output").textContent = result.diff;
  });
}
async function openDirectory() {
  if (!detail) return;
  const id = detail.favorite.id;
  const tab = window.open("about:blank", "_blank");
  if (tab) tab.opener = null;
  try {
    const value = await api<{ url: string; files: string[] }>(`/favorites/${id}/view`, "POST", {});
    if (tab) tab.location.href = value.url;
    else {
      openDialog(
        "打开快照",
        `<a target="_blank" rel="noopener noreferrer" href="${h(value.url)}">点击打开已保存的网页 / 目录 ↗</a>`,
      );
    }
  } catch (error) {
    tab?.close();
    throw error;
  }
}
async function backupDialog() {
  openDialog(
    "备份与恢复",
    '<p class="notice">备份包含全部收藏、备注和目录资源。恢复会合并新条目；已有内容和版本不会被覆盖。</p><h3>下载备份</h3><button id="download-backup" class="primary">下载完整备份</button><h3>从备份恢复</h3><div class="backup-options"><input id="restore-file" type="file" accept=".json,application/json" aria-label="选择备份文件"><button id="preview-restore">检查备份</button></div><div id="restore-preview"></div>',
  );
  $("#download-backup").addEventListener("click", () =>
    run(async () => {
      const response = await request("/backup");
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `ai-favorites-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast("备份已下载");
    }),
  );
  $("#preview-restore").addEventListener("click", () =>
    run(async () => {
      const file = $<HTMLInputElement>("#restore-file").files?.[0];
      if (!file) throw new Error("请先选择备份文件。");
      if (file.size > 128 * 1024 * 1024) throw new Error("备份超过 128 MiB，请使用 Raycast 的本地恢复功能。");
      const body = JSON.parse(await file.text());
      const preview = await api<{ count: number; titles: string[] }>("/restore/preview", "POST", body);
      $("#restore-preview").innerHTML =
        `<p>校验通过，包含 <strong>${preview.count}</strong> 条收藏。</p><ul>${preview.titles.map((t) => `<li>${h(t)}</li>`).join("")}</ul><button id="confirm-restore" class="primary">确认合并恢复</button>`;
      $("#confirm-restore").addEventListener("click", () =>
        run(async () => {
          const result = await api<{ added: number; skipped: number; conflicts: number }>("/restore", "POST", body);
          closeDialog();
          await loadLibrary();
          toast(`恢复完成：新增 ${result.added} 条，跳过重复 ${result.skipped} 条，保留冲突 ${result.conflicts} 条`);
        }),
      );
    }),
  );
}
function setNav(value: string, load = true) {
  detailSequence++;
  nav = value;
  offset = 0;
  selectedId = "";
  sessionDetail = undefined;
  selected.clear();
  $<HTMLInputElement>("#search").value = "";
  $<HTMLInputElement>("#search").placeholder =
    nav === "history" ? "搜索会话标题、项目或 ID…" : "搜索正文、问题、标签和备注…";
  $("#list-title").innerHTML =
    `${nav === "history" ? "历史会话" : nav === "all" ? "全部收藏" : kinds[nav]} <span id="result-count">0</span>`;
  $("#list-eyebrow").textContent = nav === "history" ? "HISTORY" : "FAVORITES";
  for (const button of document.querySelectorAll<HTMLElement>("[data-nav]"))
    button.classList.toggle("active", button.dataset.nav === nav);
  $(".sidebar-filters").hidden = nav === "history";
  $("#history-categories").hidden = nav !== "history";
  $(".list-tools").hidden = nav === "history";
  $("#selection").hidden = true;
  $("#layout").classList.remove("reading");
  if (load) run(() => loadLibrary());
}
async function loadSessions(sequence: number, refresh = false) {
  const params = new URLSearchParams({ q: $<HTMLInputElement>("#search").value, offset: String(offset) });
  if (historyProvider) params.set("provider", historyProvider);
  if (historyTime) params.set("period", historyTime);
  if (refresh) params.set("refresh", "1");
  if (!$("[data-session]")) $("#rows").innerHTML = '<div class="empty-list" role="status">正在加载历史会话…</div>';
  let value: HistoryResult;
  try {
    value = await api(`/sessions?${params}`);
  } catch (error) {
    if (sequence === listSequence)
      $("#rows").innerHTML =
        `<div class="empty-list"><strong>历史加载失败</strong>${h((error as Error).message)}<br>可点击右上角刷新重试。</div>`;
    throw error;
  }
  if (sequence !== listSequence) return;
  total = value.total;
  $("#history-categories").innerHTML = historyCategoryHtml(value, historyProvider, historyTime, "main");
  $("#list-title").innerHTML =
    `${h(historyProvider ? providers[historyProvider] || historyProvider : "历史会话")}${historyTime ? ` · ${historyPeriodLabels[historyTime]}` : ""} <span id="result-count">${total}</span>`;
  $("#result-count").textContent = String(total);
  $("#rows").innerHTML =
    historyGroupedRows(
      value,
      (s) =>
        `<article class="favorite-row"><button class="row-open" data-session="${s.key}"><div class="row-kind">历史会话${s.archived ? " · 已归档" : ""}</div><h2>${h(s.title)}</h2><p>${h(s.projectPath || "未关联项目")}</p><div class="row-meta">${h(date(s.updatedAt))}</div></button></article>`,
    ) || '<div class="empty-list"><strong>此分类下没有匹配的历史会话</strong>可切换程序、时间分类或修改搜索词。</div>';
  renderPager(40);
  if (!sessionDetail)
    $("#reader").innerHTML =
      `<div class="empty-reader"><span class="empty-symbol">◷</span><h2>把历史讨论变成知识资产</h2><p>选择会话，阅读用户问题和 AI 回复，<br>收藏整个会话或单条回复。</p>${value.warnings.length ? `<p>有 ${value.warnings.length} 条历史读取提示；缺失的源文件不会影响已有收藏。</p>` : ""}</div>`;
}
async function showSession(key: string) {
  const sequence = ++detailSequence;
  sessionDetail = undefined;
  detail = undefined;
  $("#reader").innerHTML =
    '<div class="empty-reader" role="status"><h2>正在打开会话…</h2><p>正在读取原始消息，请稍候。</p></div>';
  $("#layout").classList.add("reading");
  let result: SessionResult;
  try {
    result = await api(`/sessions/${key}`);
  } catch (error) {
    if (sequence === detailSequence)
      $("#reader").innerHTML =
        `<div class="empty-reader"><h2>会话暂时无法读取</h2><p>${h((error as Error).message)}</p><p>请选择其他会话或刷新重试，已收藏的快照不受影响。</p><button class="back-button" data-action="back">返回列表</button></div>`;
    throw error;
  }
  if (sequence !== detailSequence) return;
  sessionDetail = result;
  detail = undefined;
  const session = result.session;
  $("#reader").innerHTML =
    `<div class="reader-inner"><button class="back-button text-button" data-action="back">← 返回列表</button><header class="reader-header"><div class="reader-kicker">${h(providers[session.provider])} · 历史会话</div><h2>${h(session.title)}</h2><div class="reader-meta">${h(session.projectPath || "未关联项目")}</div><div class="toolbar"><button class="primary" data-action="save-session">收藏整个会话</button></div></header>${session.warnings.length ? `<p class="notice">${session.warnings.map(h).join("<br>")}</p>` : ""}<div id="messages"></div>${session.files.length ? `<h3>相关文件</h3><p class="history-note">保存文件当前磁盘上的版本。</p>${session.files.map((f) => `<p><button class="text-button" data-save-file="${h(f.path)}">＋ ${h(f.path)}</button></p>`).join("")}` : ""}</div>`;
  const container = $("#messages");
  for (const message of session.messages) {
    const article = document.createElement("section");
    article.className = `session-message ${message.role}`;
    article.innerHTML = `<div class="eyebrow">${message.role === "user" ? "用户问题" : "AI 回复"}</div><div class="markdown"></div>${message.role === "assistant" ? `<button data-save-message="${h(message.id)}">＋ 收藏这条回复</button>` : ""}`;
    markdown($(".markdown", article), message.content);
    container.append(article);
  }
  $("#layout").classList.add("reading");
  $("#reader").scrollTop = 0;
}
async function action(name: string) {
  if (name === "add") {
    addDialog();
    return;
  }
  if (name === "close-dialog") {
    closeDialog();
    return;
  }
  if (name === "back") {
    $("#layout").classList.remove("reading");
    return;
  }
  if (name === "save-session" && sessionDetail) {
    addDialog("text", { kind: "session", sessionKey: sessionDetail.key });
    return;
  }
  if (!detail) return;
  const f = detail.favorite;
  if (name === "copy") await copy(f.content);
  else if (name === "copy-path") await copy(f.filePath || "");
  else if (name === "edit") editDialog();
  else if (name === "verify") verifyDialog();
  else if (name === "pack") packDialog([f.id]);
  else if (name === "view-directory") await openDirectory();
  else if (name === "raw") {
    openDialog("收藏时的原文", '<pre class="raw-content" id="raw-content"></pre>');
    $("#raw-content").textContent = f.content;
  } else if (name === "compare") compareDialog();
  else if (name === "recommend") {
    await api(`/favorites/${f.id}/recommend`, "POST", {});
    await loadLibrary(true);
    await showFavorite(f.id);
    toast("已推荐当前版本");
  } else if (name === "helpful" || name === "unresolved") {
    await api(`/favorites/${f.id}/feedback`, "POST", { result: name });
    await showFavorite(f.id);
    toast("使用反馈已记录");
  } else if (name === "delete") {
    openDialog(
      "删除收藏",
      `<p>确认删除「${h(f.title)}」？删除收藏后，原始会话、文件与目录仍保留。</p><form>${formActions("确认删除")}</form>`,
    );
    bindForm(async () => {
      await api(`/favorites/${f.id}`, "DELETE");
      selected.delete(f.id);
      selectedId = "";
      closeDialog();
      await loadLibrary();
      toast("收藏已删除");
    });
  }
}
document.addEventListener("click", (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>("button");
  if (!el) return;
  if (el.dataset.action) run(() => action(el.dataset.action!));
  else if (el.dataset.historyScope === "main") {
    historyProvider = el.dataset.historyProvider!;
    historyTime = el.dataset.historyPeriod as HistoryPeriod | "";
    offset = 0;
    run(() => loadLibrary());
  } else if (el.dataset.nav) setNav(el.dataset.nav);
  else if (el.dataset.favorite) run(() => showFavorite(el.dataset.favorite!));
  else if (el.dataset.session) run(() => showSession(el.dataset.session!));
  else if (el.dataset.page) {
    offset = Number(el.dataset.page);
    run(() => loadLibrary());
  } else if (el.dataset.tag) {
    $<HTMLSelectElement>("#tag").value = el.dataset.tag;
    offset = 0;
    run(() => loadLibrary());
  } else if (el.dataset.saveMessage && sessionDetail)
    addDialog("text", { kind: "message", sessionKey: sessionDetail.key, messageId: el.dataset.saveMessage });
  else if (el.dataset.saveFile) {
    addDialog("file");
    $<HTMLInputElement>('[name="path"]').value = el.dataset.saveFile;
    if (sessionDetail) {
      $<HTMLInputElement>('[name="projectPath"]').value = sessionDetail.session.projectPath || "";
      $<HTMLSelectElement>('[name="provider"]').value = sessionDetail.session.provider;
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "sessionKey";
      input.value = sessionDetail.key;
      $("form", $("#dialog-body")).append(input);
    }
  }
});
document.addEventListener("change", (event) => {
  const el = event.target as HTMLInputElement;
  if (el.dataset.check) {
    if (el.checked) selected.add(el.dataset.check);
    else selected.delete(el.dataset.check);
    updateSelection();
  }
});
$("#add").addEventListener("click", () => addDialog());
$("#close-dialog").addEventListener("click", closeDialog);
$("#search").addEventListener("input", () => {
  clearTimeout(debounce);
  offset = 0;
  debounce = setTimeout(() => run(() => loadLibrary()), 200);
});
for (const key of ["provider", "project", "tag", "verification", "mode", "sort"])
  $(`#${key}`).addEventListener("change", () => {
    offset = 0;
    run(() => loadLibrary());
  });
$("#reset").addEventListener("click", () => {
  for (const key of ["provider", "project", "tag", "verification"]) $<HTMLSelectElement>(`#${key}`).value = "";
  offset = 0;
  run(() => loadLibrary());
});
$("#refresh").addEventListener("click", () =>
  run(async () => {
    await loadLibrary(true, true);
    if (detail) await showFavorite(detail.favorite.id);
    toast("已刷新");
  }),
);
$("#select-page").addEventListener("change", () => {
  const checked = $<HTMLInputElement>("#select-page").checked;
  for (const row of rows) {
    if (checked) selected.add(row.id);
    else selected.delete(row.id);
  }
  updateSelection();
});
$("#clear-selection").addEventListener("click", () => {
  selected.clear();
  updateSelection();
});
$("#pack-selected").addEventListener("click", () => packDialog([...selected]));
$("#backup").addEventListener("click", () => run(backupDialog));
$("#stop").addEventListener("click", () => {
  openDialog(
    "停止网页服务",
    `<p>停止后可随时从 Raycast 再次打开。已有收藏会保留。</p><form>${formActions("停止服务")}</form>`,
  );
  bindForm(async () => {
    await api("/shutdown", "POST", {});
    closeDialog();
    token = "";
    sessionStorage.removeItem("ai-favorites-token");
    connection("网页服务已停止。需要时从 Raycast 运行“打开网页收藏夹”。");
  });
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    $<HTMLInputElement>("#search").focus();
  }
});
window.addEventListener("focus", () => {
  if (token && !$<HTMLDialogElement>("#dialog").open) run(() => loadLibrary(true));
});
setInterval(() => {
  if (token && !document.hidden && !$<HTMLDialogElement>("#dialog").open) run(() => loadLibrary(true));
}, 15000);
run(async () => {
  if (!token) {
    connection("请从 Raycast 运行“打开网页收藏夹”，以连接本机收藏资料库。");
    return;
  }
  await loadLibrary(!!launchFavorite);
  if (launchFavorite) await showFavorite(launchFavorite);
});
