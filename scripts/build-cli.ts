import { build } from "esbuild";
void build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "build/ai-favorites.cjs",
  packages: "external",
}).catch(() => {
  process.exitCode = 1;
});
