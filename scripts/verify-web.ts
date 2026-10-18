import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { chromium, Browser } from "playwright";
import { FavoriteStore } from "../src/core/store";
import { capturedDraft } from "../src/core/capture";
import { fileDraft } from "../src/core/favorite-service";
import { ensureWebServer } from "../src/web/launcher";

async function main() {
  const root = await mkdtemp(join(tmpdir(), "ai-web-browser-"));
  let browser: Browser | undefined, url: URL | undefined;
  const library = join(root, "library"),
    store = new FavoriteStore(library);
  const artifact = resolve(process.env.AI_FAVORITES_WEB_ARTIFACTS || ".test-build/web");
  await mkdir(artifact, { recursive: true });
  try {
    await mkdir(join(root, "codex/sessions"), { recursive: true });
    await writeFile(
      join(root, "codex/sessions/rollout.jsonl"),
      [
        { type: "session_meta", payload: { id: "browser-session", cwd: root } },
        {
          type: "response_item",
          payload: {
            type: "message",
            id: "user",
            role: "user",
            content: [{ type: "input_text", text: "浏览器验收：如何保证任务幂等？" }],
          },
        },
        {
          type: "response_item",
          payload: {
            type: "message",
            id: "assistant",
            role: "assistant",
            content: [{ type: "output_text", text: "给任务生成稳定的幂等键，再原子记录执行结果。" }],
          },
        },
      ]
        .map((v) => JSON.stringify(v))
        .join("\n") + "\n",
    );
    await writeFile(
      join(root, "codex/session_index.jsonl"),
      JSON.stringify({ id: "browser-session", thread_name: "浏览器历史会话" }) + "\n",
    );
    const sampleLog = await readFile(join(root, "codex/sessions/rollout.jsonl"), "utf8");
    for (const [day, days] of [
      ["yesterday", 1],
      ["history", 4],
    ] as const) {
      const file = join(root, `codex/sessions/${day}.jsonl`);
      await writeFile(file, sampleLog.replaceAll("browser-session", `browser-${day}`));
      const time = new Date(Date.now() - days * 86400000);
      await utimes(file, time, time);
    }
    await mkdir(join(root, "grok/sessions/demo"), { recursive: true });
    await writeFile(
      join(root, "grok/sessions/demo/summary.json"),
      JSON.stringify({ info: { id: "grok-classification", cwd: root }, generated_title: "Grok 分类会话" }),
    );
    await writeFile(
      join(root, "grok/sessions/demo/updates.jsonl"),
      JSON.stringify({
        params: {
          sessionId: "grok-classification",
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Grok 合成回复" } },
        },
      }) + "\n",
    );
    const demo = [
      {
        title: "HTTP API 适配器设计",
        tags: ["架构", "TypeScript"],
        content:
          "## 适用场景\n\n用统一接口封装供应商 API，让业务服务只依赖稳定的领域对象。\n\n> 将协议差异放在适配器内，业务层保持清晰。\n\n## 调用流程\n\n1. 校验请求参数和幂等键。\n2. 转换为供应商协议。\n3. 将返回值映射为统一结果。\n\n```typescript\ninterface ApiAdapter {\n  execute(request: DomainRequest): Promise<DomainResult>;\n}\n```\n\n| 关注点 | 处理方式 |\n| --- | --- |\n| 超时 | 设置明确的调用预算 |\n| 重试 | 仅对可重试错误执行 |\n| 兼容 | 在适配器中完成字段映射 |",
      },
      {
        title: "Redis 分布式锁实现方案",
        tags: ["Redis", "并发"],
        content: "设置带过期时间的锁，释放时验证持有者。使用原子操作避免删除其他请求的新锁。",
      },
      {
        title: "任务幂等与重试清单",
        tags: ["可靠性", "后端"],
        content: "为每个业务任务生成稳定的幂等键；持久化状态；区分可重试失败和永久失败。",
      },
    ];
    for (const item of demo)
      await store.add(capturedDraft(item.title, item.content, "manual", { label: "合成浏览器验收样例" }), {
        title: item.title,
        tags: item.tags,
        note: "供测试阅读，不含真实会话数据。",
      });
    const source = join(root, "本地指南");
    await mkdir(join(source, "assets"), { recursive: true });
    await writeFile(
      join(source, "index.html"),
      `<!doctype html><meta charset="utf-8"><title>目录快照验收</title><link rel="stylesheet" href="assets/site.css"><h1>指标阅读指南</h1><p id="loaded">等待资源</p><p id="isolation">等待隔离验证</p><script>fetch('assets/data.json').then(r=>r.json()).then(v=>document.getElementById('loaded').textContent=v.label);try{sessionStorage.getItem('ai-favorites-token');document.getElementById('isolation').textContent='未隔离'}catch{document.getElementById('isolation').textContent='已隔离'}</script>`,
    );
    await writeFile(join(source, "assets/site.css"), "h1{color:rgb(0,128,0)}");
    await writeFile(join(source, "assets/data.json"), JSON.stringify({ label: "目录相对资源已加载" }));
    const first = (
      await store.add(await fileDraft(source), {
        title: "Grafana 指标阅读指南",
        tags: ["监控", "目录"],
        note: "本地 HTML 目录快照示例",
      })
    ).favorite;
    await writeFile(join(source, "assets/site.css"), "h1{color:rgb(0,0,255)}");
    await store.add(await fileDraft(source), {
      title: "Grafana 指标阅读指南 · 新版",
      tags: ["监控", "目录"],
      note: "资源修改后的独立版本",
    });
    await rm(source, { recursive: true });
    const launchUrl = await ensureWebServer(
      {
        storageDirectory: library,
        codexHome: join(root, "codex"),
        kiroHome: join(root, "no-kiro"),
        kiroDatabase: join(root, "no-kiro.sqlite"),
        kiroLegacyIde: join(root, "no-ide"),
        grokHome: join(root, "grok"),
        openCodexLinks: false,
      },
      resolve("assets/web/server.cjs"),
    );
    url = new URL(launchUrl);
    browser = await chromium.launch({
      headless: true,
      ...(process.env.AI_FAVORITES_CHROME
        ? { executablePath: process.env.AI_FAVORITES_CHROME }
        : { channel: "chrome" }),
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    // Exercise copying without touching the user's real system clipboard.
    await context.addInitScript({
      content:
        "Object.defineProperty(navigator, 'clipboard', { value: { writeText: async function(value) { window.__copied = value; } } });",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(launchUrl);
    await page.locator(".favorite-row").first().waitFor();
    assert.equal(new URL(page.url()).hash, "");
    await page
      .locator(".row-open")
      .filter({ has: page.getByRole("heading", { name: "HTTP API 适配器设计", exact: true }) })
      .click();
    await page.locator("#article table").waitFor();
    assert.equal(await page.locator("#article pre code").count(), 1);
    await page.screenshot({ path: join(artifact, "desktop.png"), fullPage: true });
    // Search covers notes and restores the complete unfiltered library.
    await page.getByRole("searchbox").fill("原子");
    await page.waitForFunction(() => document.querySelectorAll(".favorite-row").length === 1);
    assert.match(await page.locator(".row-open h2").innerText(), /Redis/);
    await page.getByRole("searchbox").fill("");
    await page.waitForFunction(() => document.querySelectorAll(".favorite-row").length === 5);
    // Create text with Markdown and hostile HTML; the browser must render useful content without script execution.
    await page.locator("#add").click();
    await page
      .locator('[name="content"]')
      .fill('## 浏览器阅读\n\n```ts\nretry();\n```\n\n<svg onload="window.__xss=1"></svg>');
    await page.locator('[name="title"]').fill("浏览器新增方案");
    await page.locator('[name="tags"]').fill("测试, 阅读");
    await page.locator('[name="note"]').fill("browser-note");
    await page.getByRole("button", { name: "保存收藏", exact: true }).click();
    await page.locator("#dialog").waitFor({ state: "hidden" });
    await page.locator(".reader-header h2").filter({ hasText: "浏览器新增方案" }).waitFor();
    assert.equal(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss), undefined);
    const created = (await store.list()).find((f) => f.title === "浏览器新增方案")!;
    assert.ok(created);
    await page.getByRole("button", { name: "编辑收藏", exact: true }).click();
    await page.locator('[name="note"]').fill("edited-browser-note");
    await page.locator('[name="title"]').fill("浏览器编辑后的方案");
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    await page.locator("#dialog").waitFor({ state: "hidden" });
    assert.equal((await store.list()).find((f) => f.id === created.id)?.note, "edited-browser-note");
    await page.locator("#tag").selectOption("测试");
    await page.waitForFunction(() => document.querySelectorAll(".favorite-row").length === 1);
    await page.getByRole("button", { name: "验证记录", exact: true }).click();
    await page.locator('[name="status"]').selectOption("verified");
    await page.locator('[name="project"]').fill("browser-project");
    await page.locator('[name="version"]').fill("v1");
    await page.locator('[name="date"]').fill("2026-10-18");
    await page.getByRole("button", { name: "保存验证记录", exact: true }).click();
    await page.locator("#dialog").waitFor({ state: "hidden" });
    assert.equal((await store.list()).find((f) => f.id === created.id)?.verification?.status, "verified");
    await page.getByRole("button", { name: "复制内容", exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { __copied?: string }).__copied !== undefined);
    assert.equal(await page.evaluate(() => (window as unknown as { __copied: string }).__copied), created.content);
    await page.getByRole("button", { name: "打包复用", exact: true }).click();
    await page.getByRole("button", { name: "生成预览", exact: true }).click();
    await page.locator("#pack-markdown").waitFor();
    await page.getByRole("button", { name: "复制上下文包", exact: true }).click();
    assert.ok((await page.evaluate(() => (window as unknown as { __copied: string }).__copied)).includes(created.id));
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    // Backup is a real download; restore is a separate checked/confirmed merge.
    await page.locator("#backup").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载完整备份", exact: true }).click();
    const download = await downloadPromise;
    const backupPath = join(root, "browser-backup.json");
    await download.saveAs(backupPath);
    assert.equal(JSON.parse(await readFile(backupPath, "utf8")).favorites.length, 6);
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "删除", exact: true }).click();
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    await page.locator("#dialog").waitFor({ state: "hidden" });
    assert.ok(!(await store.list()).some((f) => f.id === created.id));
    await page.locator("#backup").click();
    await page.locator("#restore-file").setInputFiles(backupPath);
    await page.getByRole("button", { name: "检查备份", exact: true }).click();
    await page.getByRole("button", { name: "确认合并恢复", exact: true }).click();
    await page.locator("#dialog").waitFor({ state: "hidden" });
    assert.ok((await store.list()).some((f) => f.id === created.id));
    await page.locator("#reset").click();
    await page.getByRole("searchbox").fill("");
    await page.waitForFunction(() => document.querySelectorAll(".favorite-row").length === 6);
    // Saved directory remains functional after original deletion; its scripts have no access to management credentials.
    await page.locator(`[data-favorite="${first.id}"]`).click();
    await page.locator("#version-select").waitFor();
    await page.getByRole("button", { name: "比较版本", exact: true }).click();
    await page.getByRole("button", { name: "显示差异", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#diff-output")?.textContent?.includes("site.css"));
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "打开网页 / 目录快照 ↗", exact: true }).click();
    const popup = await popupPromise;
    await popup.waitForURL(/\/view\//);
    await popup.getByText("目录相对资源已加载", { exact: true }).waitFor();
    assert.equal(await popup.locator("#isolation").innerText(), "已隔离");
    assert.equal(await popup.locator("h1").evaluate((el) => getComputedStyle(el).color), "rgb(0, 128, 0)");
    await popup.close();
    // Add a directory through the actual browser form using a percent-encoded file URL.
    const fresh = join(root, "新目录");
    await mkdir(fresh);
    await writeFile(join(fresh, "index.html"), "<title>网页添加目录</title><h1>独立保存的页面</h1>");
    await page.locator("#add").click();
    await page.getByRole("button", { name: "文件 / 目录", exact: true }).click();
    await page.locator('[name="path"]').fill(pathToFileURL(join(fresh, "index.html")).href);
    await page.getByRole("button", { name: "保存收藏", exact: true }).click();
    await page.locator("#dialog").waitFor({ state: "hidden" });
    assert.equal((await store.list()).find((f) => f.title === "网页添加目录")?.directorySnapshot?.files.length, 1);
    // The add-dialog history entry must remain visible during loading and errors.
    await page.locator('[data-nav="file"]').click();
    await page.locator("#tag").selectOption("监控");
    let listRequests = 0,
      releaseList!: () => void;
    const listGate = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    await page.route("**/api/sessions?*", async (route) => {
      listRequests++;
      if (listRequests === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "测试历史加载失败" }),
        });
        return;
      }
      if (listRequests === 2) await listGate;
      await route.continue();
    });
    await page.locator("#add").click();
    await page.getByRole("button", { name: "从历史会话添加", exact: true }).click();
    await page.locator("#history-status").filter({ hasText: "加载历史失败" }).waitFor();
    assert.ok(await page.locator("#dialog").isVisible());
    await page.getByRole("button", { name: "刷新历史", exact: true }).click();
    assert.match(await page.locator("#history-status").innerText(), /正在加载/);
    assert.ok(await page.locator("#dialog").isVisible());
    releaseList();
    await page.locator("[data-history-choice]").first().waitFor();
    await page.screenshot({ path: join(artifact, "history-picker.png"), fullPage: true });
    for (const period of ["yesterday", "history"]) {
      await page
        .locator(`[data-history-scope="picker"][data-history-provider="codex"][data-history-period="${period}"]`)
        .click();
      await page.waitForFunction(
        (time) => document.querySelector("#history-choices [data-time]")?.getAttribute("data-time") === time,
        period,
      );
      assert.equal(await page.locator("#history-choices [data-history-choice]").count(), 1);
    }
    await page
      .locator('[data-history-scope="picker"][data-history-provider="grok"][data-history-period="today"]')
      .click();
    await page.locator('#history-choices [data-program="grok"]').waitFor();
    assert.equal(await page.locator('#history-choices [data-program="codex"]').count(), 0);
    await page
      .locator('[data-history-scope="picker"][data-history-provider="codex"][data-history-period="today"]')
      .click();
    await page.locator('#history-choices [data-program="codex"] [data-time="today"]').waitFor();
    let detailRequests = 0,
      releaseDetail!: () => void;
    const detailGate = new Promise<void>((resolve) => {
      releaseDetail = resolve;
    });
    await page.route("**/api/sessions/*", async (route) => {
      detailRequests++;
      if (detailRequests === 1) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "测试会话暂不可读" }),
        });
        return;
      }
      if (detailRequests === 2) await detailGate;
      await route.continue();
    });
    await page.locator("[data-history-choice]").first().click();
    await page.locator("#history-status").filter({ hasText: "无法打开会话" }).waitFor();
    assert.ok(await page.locator("#dialog").isVisible());
    await page.locator("[data-history-choice]").first().click();
    assert.match(await page.locator("#history-status").innerText(), /正在打开/);
    assert.ok(await page.locator("#dialog").isVisible());
    releaseDetail();
    await page.locator("#dialog").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "＋ 收藏这条回复", exact: true }).click();
    await page.getByRole("button", { name: "保存收藏", exact: true }).click();
    await page.locator("#dialog").waitFor({ state: "hidden" });
    assert.equal(
      (await store.list()).find((f) => f.messageId === "assistant")?.context?.question,
      "浏览器验收：如何保证任务幂等？",
    );
    assert.equal(await page.locator("#tag").inputValue(), "");
    assert.ok(await page.locator(".row-open h2").filter({ hasText: "给任务生成稳定的幂等键" }).isVisible());
    await page.locator('[data-nav="history"]').click();
    await page
      .locator('[data-history-scope="main"][data-history-provider="grok"][data-history-period="today"]')
      .click();
    await page.locator('#rows [data-program="grok"]').waitFor();
    assert.equal(await page.locator('#rows [data-program="codex"]').count(), 0);
    await page
      .locator('[data-history-scope="main"][data-history-provider="codex"][data-history-period="yesterday"]')
      .click();
    await page.locator('#rows [data-program="codex"] [data-time="yesterday"]').waitFor();
    await page.locator('[data-history-scope="main"][data-history-provider=""]').click();
    await page.waitForFunction(() => document.querySelectorAll("#rows [data-program]").length === 2);
    await page.screenshot({ path: join(artifact, "history-categories.png"), fullPage: true });
    await page.locator('[data-nav="all"]').click();
    await page.locator("#search").fill("HTTP API");
    await page.waitForFunction(() => document.querySelectorAll(".favorite-row").length === 1);
    await page.locator(".row-open").click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".reader-header").waitFor();
    await page.screenshot({ path: join(artifact, "mobile.png"), fullPage: true });
    assert.ok(await page.locator(".reader").isVisible());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        passed: true,
        flows: [
          "search",
          "markdown",
          "safe-html",
          "add",
          "edit",
          "tags",
          "verification",
          "copy",
          "context-pack",
          "backup-download",
          "restore-preview-merge",
          "delete",
          "versions",
          "offline-directory-resources",
          "sandbox-isolation",
          "file-url-capture",
          "history-reply-context",
          "history-dialog-loading-errors-retry",
          "history-program-calendar-categories",
          "new-favorite-clears-hidden-filters",
          "mobile",
        ],
        artifacts: [join(artifact, "desktop.png"), join(artifact, "mobile.png")],
      }),
    );
  } finally {
    await browser?.close();
    if (url)
      await fetch(`${url.origin}/api/shutdown`, {
        method: "POST",
        headers: { Authorization: `Bearer ${new URLSearchParams(url.hash.slice(1)).get("token")}` },
      }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 120));
    await rm(root, { recursive: true, force: true });
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
