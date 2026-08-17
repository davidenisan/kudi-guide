import cors from "cors";
import express from "express";

import { createAuthDependencies, type AuthDependencies } from "./auth/dependencies.js";
import { createAuthRouter } from "./auth/routes.js";
import { env } from "./config/env.js";
import { healthRouter } from "./routes/health.js";

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

  return app;
}
