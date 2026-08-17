import { Router } from "express";
import { z } from "zod";

import { createAuthMiddleware } from "./middleware.js";
import {
  OtpAttemptsExceededError,
  OtpRateLimitError,
  OtpVerificationError,
} from "./otpService.js";
import type { AuthDependencies } from "./dependencies.js";

const phoneSchema = z.object({
  phone: z.string().min(1),
});

const verifySchema = phoneSchema.extend({
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits."),
});

export function createAuthRouter(dependencies: AuthDependencies) {
  const router = Router();
  const authMiddleware = createAuthMiddleware(dependencies);

  router.post("/otp/request", async (request, response) => {
    const parsed = phoneSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      return;
    }

    try {
      const result = await dependencies.otpService.request(parsed.data.phone);
      response.status(202).json(result);
    } catch (error) {
      handleOtpError(error, response);
    }
  });

  router.post("/otp/resend", async (request, response) => {
    const parsed = phoneSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      return;
    }

    try {
      const result = await dependencies.otpService.resend(parsed.data.phone);
      response.status(202).json(result);
    } catch (error) {
      handleOtpError(error, response);
    }
  });

  router.post("/otp/verify", async (request, response) => {
    const parsed = verifySchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      return;
    }

    try {
      const { phone } = await dependencies.otpService.verify(parsed.data.phone, parsed.data.code);
      const user = await dependencies.userRepository.findOrCreateByPhone(phone);
      const accessToken = dependencies.jwtService.signAccessToken({
        sub: user.id,
        phone: user.phone,
      });

      response.json({
        accessToken,
        tokenType: "Bearer",
        user: {
          id: user.id,
          phone: user.phone,
        },
      });
    } catch (error) {
      handleOtpError(error, response);
    }
  });

  router.get("/me", authMiddleware, (request, response) => {
    response.json({
      user: {
        id: request.user?.id,
        phone: request.user?.phone,
      },
    });
  });

  return router;
}

function handleOtpError(error: unknown, response: { status: (code: number) => { json: (body: unknown) => void } }) {
  if (error instanceof OtpRateLimitError) {
    response.status(429).json({ error: error.message });
    return;
  }

  if (error instanceof OtpAttemptsExceededError) {
    response.status(423).json({ error: error.message });
    return;
  }

  if (error instanceof OtpVerificationError || error instanceof Error) {
    response.status(400).json({ error: error.message });
    return;
  }

  response.status(500).json({ error: "Unexpected auth error." });
}
