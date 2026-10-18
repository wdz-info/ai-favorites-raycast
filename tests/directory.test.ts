import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fileDraft } from "../src/core/favorite-service";
import { directoryHash, materializeDirectory, validDirectorySnapshot } from "../src/core/directory-snapshot";
import { FavoriteStore } from "../src/core/store";
import { FavoriteSearchIndex } from "../src/core/search";
import { favoriteMarkdown } from "../src/core/markdown";
import { snapshotDiff } from "../src/core/versions";
import { exportFavorites } from "../src/core/export";

test("Chinese file URL and directory save complete versioned HTML packages and survive source deletion plus backup restore", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-directory-"));
  try {
    const source = join(root, "指标说明 #1");
    await mkdir(join(source, "assets"), { recursive: true });
    const html =
      '<title>指标指南</title><h1>连接池容量</h1><link href="assets/style.css" rel="stylesheet"><img src="assets/image.png"><script>doNotIndex()</script>';
    const image = Buffer.from([0, 255, 137, 80, 78, 71]);
    await writeFile(join(source, "index.html"), html);
    await writeFile(join(source, "assets/style.css"), "h1 { color: red; }");
    await writeFile(join(source, "assets/image.png"), image);
    // Large binary payload exercises base64 validation without a regex stack overflow.
    await writeFile(join(source, "assets/data.bin"), Buffer.alloc(9 * 1024 * 1024, 128));
    const draft = await fileDraft(pathToFileURL(join(source, "index.html")).href);
    assert.equal(draft.filePath, source);
    assert.equal(draft.title, "指标指南");
    assert.equal(draft.provider, "manual");
    assert.equal(draft.directorySnapshot?.files.length, 4);
    assert.equal(draft.directorySnapshot?.entryPath, "index.html");
    assert.ok(draft.content.includes("连接池容量"));
    assert.ok(!draft.content.includes("doNotIndex"));
    assert.equal((await fileDraft(source)).snapshot.sha256, draft.snapshot.sha256);
    const store = new FavoriteStore(join(root, "library"));
    const metadata = { title: draft.title, tags: [], note: "" };
    const { favorite: first } = await store.add(draft, metadata);
    assert.equal((await store.add(await fileDraft(source), metadata)).existed, true);
    await writeFile(join(source, "assets/style.css"), "h1 { color: blue; }");
    const { favorite: second } = await store.add(await fileDraft(source), metadata);
    assert.notEqual(first.snapshot.sha256, second.snapshot.sha256);
    assert.ok(snapshotDiff(first, second).includes("assets/style.css"));
    await rm(source, { recursive: true });
    const backup = join(root, "backup.json");
    await store.backup(backup);
    const restored = new FavoriteStore(join(root, "restored"));
    assert.equal((await restored.previewRestore(backup)).count, 2);
    await restored.restore(backup);
    const favorites = await restored.list();
    const original = favorites.find((f) => f.id === first.id)!;
    const entry = fileURLToPath(
      await materializeDirectory(original.directorySnapshot!, original.snapshot.sha256, restored.directory),
    );
    assert.equal(await readFile(entry, "utf8"), html);
    assert.equal(await readFile(join(dirname(entry), "assets/style.css"), "utf8"), "h1 { color: red; }");
    assert.deepEqual(await readFile(join(dirname(entry), "assets/image.png")), image);
    assert.equal(new FavoriteSearchIndex(favorites).search("连接池容量").length, 2);
    assert.ok(!favoriteMarkdown(original).includes("```"));
    const exported = await exportFavorites([original], root, "vault");
    assert.equal(exported.errors.length, 0);
    const note = await readFile(exported.files[0].path, "utf8");
    const relativeEntry = decodeURIComponent(note.match(/\[打开导出的目录快照\]\(([^)]+)\)/)![1]);
    const exportedEntry = join(dirname(exported.files[0].path), relativeEntry);
    assert.equal(await readFile(exportedEntry, "utf8"), html);
    assert.deepEqual(await readFile(join(dirname(exportedEntry), "assets/image.png")), image);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plain directories open as folders; unsafe restored resources and links cannot escape snapshots", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-directory-invalid-"));
  try {
    const source = join(root, "docs");
    await mkdir(source);
    await writeFile(join(source, "guide.md"), "guide");
    const draft = await fileDraft(source);
    const snapshot = draft.directorySnapshot!;
    const target = await materializeDirectory(snapshot, draft.snapshot.sha256, join(root, "storage"));
    assert.equal(await readFile(join(target, "guide.md"), "utf8"), "guide");
    assert.equal(validDirectorySnapshot({ ...snapshot, files: [{ ...snapshot.files[0], path: "../escape" }] }), false);
    assert.equal(validDirectorySnapshot({ ...snapshot, entryPath: "../escape" }), false);
    const corrupted = structuredClone(snapshot);
    corrupted.files[0].base64 = Buffer.from("wrong").toString("base64");
    await assert.rejects(
      materializeDirectory(corrupted, directoryHash(corrupted), join(root, "storage")),
      /资源校验失败/,
    );
    const outside = join(root, "outside");
    const linked = join(root, "linked-storage");
    await mkdir(outside);
    await mkdir(linked);
    await symlink(outside, join(linked, "directory-previews"));
    await assert.rejects(materializeDirectory(snapshot, draft.snapshot.sha256, linked), /符号链接/);
    await symlink(join(source, "guide.md"), join(source, "link.md"));
    await assert.rejects(fileDraft(source), /符号链接/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
