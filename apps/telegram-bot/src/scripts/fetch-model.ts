import { resolveModelFile } from "node-llama-cpp";
import { env } from "../config/env.js";
import { MODELS_DIR } from "../core/nlu/model.js";

/**
 * Downloads the local instruct model used by the NLU layer.
 *
 * Run once before first use: `npm run model:fetch`. The bot also resolves the
 * model lazily on startup, but doing it here means the first real user message
 * isn't waiting on a download.
 */
async function main(): Promise<void> {
  console.log(`Resolving ${env.NLU_MODEL_URI}`);
  console.log(`into ${MODELS_DIR}\n`);

  const path = await resolveModelFile(env.NLU_MODEL_URI, {
    directory: MODELS_DIR,
    onProgress: ({ downloadedSize, totalSize }) => {
      const percent = totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0;
      process.stdout.write(
        `\r  ${percent}%  ${(downloadedSize / 1e9).toFixed(2)} / ${(totalSize / 1e9).toFixed(2)} GB   `,
      );
    },
  });

  console.log(`\n\nReady: ${path}`);
}

main().catch((error: unknown) => {
  console.error("\nModel download failed:", error);
  process.exitCode = 1;
});
