import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createServices, Preferences } from "../services";
import { writeJsonAtomically } from "../core/atomic-json";
import { sha256 } from "../core/favorite-service";
import { startWebServer } from "./server";
import { webProfile } from "./launcher";

export async function runWebServer(preferences: Preferences, assetsDirectory: string, buildId: string) {
  const services = createServices(preferences);
  const profileKey = webProfile(preferences);
  const service = await startWebServer({ services, assetsDirectory, buildId, profileKey });
  const directory = services.store.directory,
    statePath = join(directory, "web-service.json");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeJsonAtomically(directory, statePath, {
      origin: service.origin,
      token: service.token,
      profileKey,
      buildId,
    });
  } catch (error) {
    await service.close();
    throw error;
  }
  // Leave stale state on shutdown. The launcher verifies health before reuse; an old
  // process must never race with a newer process to remove its published state.
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void service.close();
    });
  return service;
}
if (require.main === module) {
  void (async () => {
    const preferences = JSON.parse(process.env.AI_FAVORITES_WEB_CONFIG || '{"openCodexLinks":true}') as Preferences;
    const buildId = process.env.AI_FAVORITES_WEB_BUILD || sha256(await readFile(__filename));
    await runWebServer(preferences, __dirname, buildId);
  })().catch((error) => {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  });
}
