import { Bot } from "grammy";
import { requireTelegramToken } from "../config/env.js";

/**
 * Finds the ID of a channel or group your bot is in.
 *
 * Uses your own bot rather than a third-party "get my id" bot — those want you
 * to forward them your messages, several of them are impostors squatting similar
 * usernames, and none of it is necessary. Your bot already receives the posts of
 * any channel it administers, and the chat id arrives with them.
 *
 * The main bot must be stopped while this runs: Telegram only allows one poller
 * per token.
 */
async function main(): Promise<void> {
  const bot = new Bot(requireTelegramToken());
  const seen = new Set<number>();

  const me = await bot.api.getMe();
  console.log(`Listening as @${me.username}.\n`);
  console.log("Now post any message in your channel (or send the bot a direct message).");
  console.log("Waiting 60 seconds…\n");

  const report = (chat: { id: number; type: string; title?: string; username?: string }): void => {
    if (seen.has(chat.id)) return;
    seen.add(chat.id);

    const name = chat.title ?? chat.username ?? "(direct message)";
    console.log(`  ${chat.type.padEnd(10)} ${String(chat.id).padEnd(18)} ${name}`);

    if (chat.type === "channel" || chat.type === "supergroup" || chat.type === "group") {
      console.log(`\n  -> Put this in apps/telegram-bot/.env:\n     ADMIN_CHAT_ID=${chat.id}\n`);
    }
  };

  // Channel posts arrive as their own update type, not as ordinary messages.
  bot.on("channel_post", (ctx) => report(ctx.chat));
  bot.on("message", (ctx) => report(ctx.chat));

  void bot.start({
    allowed_updates: ["message", "channel_post"],
    drop_pending_updates: false,
  });

  await new Promise((done) => setTimeout(done, 60_000));
  await bot.stop();

  if (seen.size === 0) {
    console.log("Nothing arrived. Two things to check:");
    console.log("  - the bot is an ADMINISTRATOR of the channel, not just a member");
    console.log("  - the main bot isn't running (only one can poll at a time)");
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
