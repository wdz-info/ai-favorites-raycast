import { FavoriteStore } from "../src/core/store";
import { sha256 } from "../src/core/favorite-service";

async function main() {
  const content = `Process ${process.argv[3]}`;
  await new FavoriteStore(process.argv[2]).add(
    {
      type: "message",
      provider: "codex",
      sessionId: `process-${process.argv[3]}`,
      title: content,
      content,
      source: {},
      snapshot: { sha256: sha256(content), capturedAt: Date.now() },
    },
    { title: content, tags: [], note: "" },
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
