import { MongoClient } from "mongodb";
import { env } from "../config/env.js";
import { clearPendingUndo } from "../core/conversation.js";
import type { IncomingMessage } from "../core/message.js";
import { router } from "../core/router.js";
import { closeDatabase, connectToDatabase } from "../db/index.js";

/**
 * Drives the router directly, with no Telegram anywhere in the process.
 *
 * That is the point of the exercise as much as the test coverage: if the core
 * can be exercised end to end without a transport, the Section 2 boundary is
 * real rather than aspirational. A WhatsApp adapter would plug in exactly here.
 */

const USER = 999000222;

function text(body: string): IncomingMessage {
  return { userId: USER, kind: "text", text: body, receivedAt: new Date() };
}

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);

const PDF_BYTES = Buffer.concat([Buffer.from("%PDF-1.4\n", "ascii"), Buffer.alloc(64, 7)]);

function media(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    userId: USER,
    kind: "media",
    mimeType: "image/png",
    fileBytes: PNG_BYTES,
    receivedAt: new Date(),
    ...overrides,
  };
}

const SCRIPT: { label: string; message: IncomingMessage }[] = [
  { label: "first contact", message: text("/start") },
  { label: "greeting", message: text("hi") },
  { label: "gratitude", message: text("thanks") },
  { label: "acknowledgement (the 'okk' case)", message: text("okk") },
  { label: "bare emoji", message: text("👍") },
  { label: "capability question", message: text("what can you do") },
  { label: "pidgin check-in", message: text("you dey?") },
  { label: "summary, natural language", message: text("how much have I spent this month") },
  { label: "summary, pidgin", message: text("abeg how much I don spend") },
  { label: "undo, confident", message: text("delete the last one") },
  { label: "undo, low confidence -> asks first", message: text("wrong") },
  { label: "  ...answered yes", message: text("yes") },
  { label: "undo, low confidence again", message: text("wrong") },
  { label: "  ...answered no", message: text("no leave it") },
  { label: "undo, low confidence again", message: text("wrong") },
  { label: "  ...answered ambiguously", message: text("hmm what do you mean") },
  { label: "out of scope: weather", message: text("what's the weather") },
  { label: "out of scope: bank link", message: text("can you connect to my bank account") },
  { label: "out of scope: advice", message: text("should I stop buying takeout") },
  { label: "genuinely not understood", message: text("asdfgh") },
  { label: "slash command", message: text("/summary") },
  { label: "receipt image", message: media() },
  { label: "PDF", message: media({ mimeType: "application/pdf", fileBytes: PDF_BYTES }) },
  { label: "image mislabelled as PDF", message: media({ mimeType: "application/pdf" }) },
  { label: "sticker", message: media({ mimeType: undefined, fileBytes: undefined, mediaError: "unsupported_type" }) },
  { label: "oversized file", message: media({ fileBytes: undefined, mediaError: "too_large" }) },
];

async function main(): Promise<void> {
  await connectToDatabase();
  clearPendingUndo(USER);

  for (const { label, message } of SCRIPT) {
    const preview = message.kind === "text" ? JSON.stringify(message.text) : `<${message.mimeType ?? "unknown"}>`;
    const reply = await router(message);

    console.log(`\n── ${label}`);
    console.log(`   in:  ${preview}`);
    console.log(
      reply === null
        ? "   out: (nothing)"
        : reply.text
            .split("\n")
            .map((line, index) => (index === 0 ? `   out: ${line}` : `         ${line}`))
            .join("\n"),
    );
  }

  console.log("");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
    const client = new MongoClient(env.MONGODB_URI);
    await client.connect();
    await client.db(env.MONGODB_DB_NAME).collection("users").deleteMany({ telegram_user_id: USER });
    await client.close();
  });
