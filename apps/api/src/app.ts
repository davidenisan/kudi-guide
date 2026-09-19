import { createProfileRouter } from "./routes/profile.js";
import { createNotificationsRouter } from "./routes/notifications.js";
import cors from "cors";
import express from "express";

import { createAuthDependencies, type AuthDependencies } from "./auth/dependencies.js";
import { createAuthRouter } from "./auth/routes.js";
import { env } from "./config/env.js";
import { healthRouter } from "./routes/health.js";
import { createTelegramRouter } from "./routes/telegram.js";
import { createTransactionsRouter } from "./routes/transactions.js";

type CreateAppOptions = {
  authDependencies?: AuthDependencies;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const authDependencies = options.authDependencies ?? createAuthDependencies();

  app.use(cors({ origin: env.API_CORS_ORIGIN }));
  app.use(express.json());

  app.use("/health", healthRouter);
  app.use("/auth", createAuthRouter(authDependencies));
  app.use("/telegram", createTelegramRouter(authDependencies));
  app.use("/profile", createProfileRouter(authDependencies));
  app.use("/notifications", createNotificationsRouter(authDependencies));
  app.use("/transactions", createTransactionsRouter(authDependencies));

  return app;
}
