import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
async function main() {
  await mkdir("assets/web", { recursive: true });
  await Promise.all([
    build({
      entryPoints: ["src/web/client.ts"],
      bundle: true,
      platform: "browser",
      target: "es2022",
      format: "iife",
      outfile: "assets/web/app.js",
      minify: true,
    }),
    build({
      entryPoints: ["src/web/main.ts"],
      bundle: true,
      platform: "node",
      target: "node22",
      format: "cjs",
      outfile: "assets/web/server.cjs",
      minify: true,
    }),
  ]);
}
void main().catch(() => {
  process.exitCode = 1;
});
