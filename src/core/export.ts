import { mkdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { expandPath } from "./paths";
import { AIFavorite } from "./types";
import { obsidianMarkdown } from "./knowledge";

function inside(root: string, target: string) {
  const path = relative(root, target);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export async function exportFavorites(favorites: AIFavorite[], vaultPath: string, folder = "AI收藏") {
  if (!favorites.length) throw new Error("请至少选择一条收藏。");
  const vault = await realpath(expandPath(vaultPath));
  if (isAbsolute(folder) || folder.split(/[\\/]/).includes("..")) throw new Error("导出子目录必须位于所选仓库内。");
  let directory = vault;
  for (const part of folder.split(/[\\/]/).filter(Boolean)) {
    const next = join(directory, part);
    await mkdir(next, { recursive: true });
    directory = await realpath(next);
    if (!inside(vault, directory)) throw new Error("导出子目录链接到了仓库外，请选择仓库内目录。");
  }
  const files: { favorite: AIFavorite; path: string; uri: string }[] = [];
  const errors: { title: string; message: string }[] = [];
  for (const favorite of favorites) {
    try {
      const name =
        favorite.title
          .replace(/[\p{Cc}/\\:*?"<>|#^]/gu, "_")
          .replace(/^\.+|[. ]+$/g, "")
          .slice(0, 100) || "AI收藏";
      let path = "";
      for (let suffix = 0; suffix < 1000; suffix++) {
        const candidate = join(directory, `${name}-${favorite.id.slice(0, 8)}${suffix ? `-${suffix}` : ""}.md`);
        try {
          await writeFile(candidate, obsidianMarkdown(favorite), { flag: "wx", mode: 0o600 });
          path = candidate;
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      }
      if (!path) throw new Error("同名笔记过多，请修改收藏标题后重试。");
      files.push({ favorite, path, uri: `obsidian://open?path=${encodeURIComponent(path)}` });
    } catch (error) {
      errors.push({ title: favorite.title, message: (error as Error).message });
    }
  }
  return { files, errors };
}
