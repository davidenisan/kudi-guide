import { randomBytes, createHash } from "node:crypto";
import { Router } from "express";

import { createAuthMiddleware } from "../auth/middleware.js";
import type { AuthDependencies } from "../auth/dependencies.js";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { handleAssistantMessage } from "../services/telegramAssistant.js";
import { assistantStatus } from "../services/moneyAssistant.js";
import type { TelegramFile } from "../services/receiptReader.js";

export type TelegramUpdate = {
  update_id?: number;
  message?: {
    message_id?: number;
    date?: number;
    text?: string;
    caption?: string;
    photo?: TelegramFile[];
    document?: TelegramFile;
    chat?: {
      id?: number | string;
      type?: string;
    };
  };
};

export function createTelegramRouter(authDependencies: AuthDependencies) {
  const router = Router();
  const requireAuth = createAuthMiddleware(authDependencies);

  router.post("/login", async (_request, response) => {
    if (!telegramHealth.online || !telegramHealth.username) {
      response.status(503).json({ error: "The bot is reconnecting. Please try again shortly." }); return;
    }
    await prisma.telegramLogin.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    const code = randomBytes(24).toString("hex");
    const verifier = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await prisma.telegramLogin.create({ data: { code, verifierHash: createHash("sha256").update(verifier).digest("hex"), expiresAt } });
    response.json({ code, verifier, expiresAt, url: `https://t.me/${telegramHealth.username}?start=login_${code}` });
  });
  router.post("/login/check", async (request, response) => {
    const { code, verifier } = request.body ?? {};
    if (typeof code !== "string" || typeof verifier !== "string") { response.status(400).json({ error: "Invalid login request." }); return; }
    const login = await prisma.telegramLogin.findUnique({ where: { code } });
    if (!login || login.expiresAt < new Date() || login.verifierHash !== createHash("sha256").update(verifier).digest("hex")) {
      response.status(410).json({ error: "This sign-in link has expired. Please start again." }); return;
    }
    if (!login.chatId) { response.json({ pending: true }); return; }
    const user = await prisma.$transaction(async (tx) => {
      const consumed = await tx.telegramLogin.deleteMany({ where: { code, expiresAt: { gt: new Date() } } });
      if (consumed.count !== 1) return null;
      return tx.user.findUnique({ where: { telegramChatId: login.chatId! } });
    });
    if (!user) { response.status(410).json({ error: "No existing account found, or this link was already used. Create an account with email and password." }); return; }
    if (user.passwordHash) { response.status(409).json({ error: "Your account already has password login. Use your username or email and password." }); return; }
    response.json({ accessToken: authDependencies.jwtService.signAccessToken({ sub: user.id, phone: user.phone }), user: { id: user.id, phone: user.phone } });
  });

  router.get("/status", requireAuth, async (request, response) => {
    const user = await prisma.user.findUnique({ where: { id: request.user!.id } });
    const last = await prisma.transaction.findFirst({ where: { userId: request.user!.id, source: "telegram" }, orderBy: { occurredAt: "desc" } });
    response.json({ linked: Boolean(user?.telegramChatId), configured: Boolean(env.TELEGRAM_BOT_TOKEN), ...telegramHealth, assistant: await assistantStatus(), receiptSupport: true, lastReceivedAt: last?.occurredAt.toISOString() ?? null });
  });
  router.delete("/connection", requireAuth, async (request, response) => {
    await prisma.$transaction([
      prisma.user.update({ where: { id: request.user!.id }, data: { telegramChatId: null } }),
      prisma.telegramLinkToken.updateMany({ where: { userId: request.user!.id, usedAt: null }, data: { usedAt: new Date() } }),
    ]);
    response.json({ linked: false });
  });

  router.post("/link-code", requireAuth, async (request, response) => {
    const user = request.user;

    if (!user) {
      response.status(401).json({ error: "Not authenticated." });
      return;
    }

    if (!env.TELEGRAM_BOT_TOKEN || !telegramHealth.username) {
      response.status(503).json({ error: "The Telegram bot is not ready. Configure its token and start the API." });
      return;
    }
    await prisma.telegramLinkToken.deleteMany({ where: { userId: user.id, usedAt: null } });
    const token = await prisma.telegramLinkToken.create({
      data: {
        userId: user.id,
        code: await createUniqueCode(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    response.status(201).json({
      url: `https://t.me/${telegramHealth.username}?start=${token.code}`,
      code: token.code,
      expiresAt: token.expiresAt.toISOString(),
    });
  });

  router.post("/webhook", async (request, response) => {
    if (!env.TELEGRAM_WEBHOOK_SECRET || request.header("x-telegram-bot-api-secret-token") !== env.TELEGRAM_WEBHOOK_SECRET) {
      response.status(401).json({ error: "Invalid Telegram webhook secret." });
      return;
    }
    const { enqueueTelegramUpdate } = await import("../jobs/telegramWorker.js");
    await enqueueTelegramUpdate(request.body as TelegramUpdate);
    response.status(204).send();
  });
  return router;
}

export async function processTelegramUpdate(update: TelegramUpdate) {
  const message = update.message;
  const chatId = message?.chat?.id?.toString();
  if (!chatId || message?.chat?.type !== "private") return;
  const text = (message.text ?? message.caption ?? "").trim();
  const file = message.document ?? message.photo?.at(-1);
  if (!text && !file) return;
  if (!file && /^\/start(?:\s|$)/.test(text)) { await handleStartCommand(chatId, text); return; }
  const user = await prisma.user.findUnique({ where: { telegramChatId: chatId } });
  if (!user) {
    await sendTelegramMessage(chatId, "Sign in at Kudi Guide to connect this account, then send expenses or receipt photos/PDFs here.");
    return;
  }
  const reply = await handleAssistantMessage({ userId: user.id, chatId, messageId: message.message_id, text, file, receivedAt: message.date ? new Date(message.date * 1000) : new Date() });
  await sendTelegramMessage(chatId, reply);
}

async function handleStartCommand(chatId: string, text: string) {
  const code = text.split(/\s+/)[1]?.trim();

  if (!code) {
    await sendTelegramMessage(chatId, "Send /start followed by the link code from Kudi Guide settings.");
    return;
  }

  if (code.startsWith("login_")) {
    const updated = await prisma.telegramLogin.updateMany({ where: { code: code.slice(6), chatId: null, expiresAt: { gt: new Date() } }, data: { chatId } });
    await sendTelegramMessage(chatId, updated.count ? "Account verified. Return to Kudi Guide to add your email, username and password. Your transactions and Telegram connection will stay with you." : "This sign-in link is expired or already used. Start again in Kudi Guide.");
    return;
  }

  const token = await prisma.telegramLinkToken.findUnique({ where: { code } });

  if (!token || token.usedAt || token.expiresAt < new Date()) {
    await sendTelegramMessage(chatId, "That Telegram link code is invalid or expired. Generate a new one in settings.");
    return;
  }

  const existing = await prisma.user.findUnique({ where: { telegramChatId: chatId } });
  if (existing && existing.id !== token.userId) {
    await sendTelegramMessage(chatId, "This Telegram account is already linked. Disconnect it from its current account first.");
    return;
  }
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.telegramLinkToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new Error("Link code already used or expired.");
    await tx.user.update({ where: { id: token.userId }, data: { telegramChatId: chatId } });
  });

  await sendTelegramMessage(chatId, "Telegram is linked. Forward transaction alerts here and I will add them to your dashboard.");
}

async function createUniqueCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomBytes(24).toString("hex");
    const existing = await prisma.telegramLinkToken.findUnique({ where: { code } });

    if (!existing) {
      return code;
    }
  }

  throw new Error("Unable to generate a Telegram link code.");
}

export async function sendTelegramMessage(chatId: string, text: string) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return;
  }

  const result = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(10000),
  });
  if (!result.ok && result.status !== 400 && result.status !== 403) throw new Error("Telegram reply failed.");
}

export const telegramHealth = { online: false, username: null as string | null, checkedAt: null as string | null };

// One long-polling consumer per bot. Telegram acknowledges an update only after processing succeeds.
export function startTelegramConnection() {
  const controller = new AbortController();
  if (!env.TELEGRAM_BOT_TOKEN) return () => controller.abort();
  let offset = 0;
  async function call(method: string, body: object = {}) {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(40000)]),
    });
    const data = await response.json() as { ok: boolean; result: unknown };
    if (!response.ok || !data.ok) throw new Error("Telegram connection unavailable");
    return data.result;
  }
  void (async () => {
    while (!controller.signal.aborted) {
      try {
        const bot = await call("getMe") as { username: string };
        telegramHealth.username = bot.username;
        const webhook = await call("getWebhookInfo") as { url: string };
        if (webhook.url) throw new Error("Remove the existing webhook to enable polling");
        telegramHealth.online = true;
        telegramHealth.checkedAt = new Date().toISOString();
        const updates = await call("getUpdates", { offset, timeout: 25, allowed_updates: ["message"] }) as TelegramUpdate[];
        for (const update of updates) {
          const { enqueueTelegramUpdate } = await import("../jobs/telegramWorker.js");
          await enqueueTelegramUpdate(update);
          offset = (update.update_id ?? offset) + 1;
        }
      } catch {
        telegramHealth.online = false;
        if (!controller.signal.aborted) await new Promise<void>((resolve) => {
          const done = () => { clearTimeout(timer); controller.signal.removeEventListener("abort", done); resolve(); };
          const timer = setTimeout(done, 5000);
          controller.signal.addEventListener("abort", done, { once: true });
        });
      }
    }
  })();
  return () => { telegramHealth.online = false; controller.abort(); };
}
