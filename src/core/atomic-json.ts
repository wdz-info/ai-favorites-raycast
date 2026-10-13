import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function withDirectoryLock<T>(
  directory: string,
  lockName: string,
  operation: () => Promise<T>,
): Promise<T> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = join(directory, lockName);
  let acquired = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      acquired = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await delay(50);
    }
  }
  if (!acquired)
    throw new Error(`资料库正在使用中，请稍后重试。若 Raycast 异常退出，请关闭相关命令后再移除空锁目录 ${lockPath}。`);
  try {
    return await operation();
  } finally {
    await rmdir(lockPath);
  }
}

export async function writeJsonAtomically(directory: string, filePath: string, value: unknown): Promise<void> {
  const temporary = join(directory, `.write-${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(value, null, 2) + "\n", "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}
