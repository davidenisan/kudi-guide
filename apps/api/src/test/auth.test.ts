import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import type { AuthDependencies } from "../auth/dependencies.js";
import { JwtService } from "../auth/jwt.js";
import { InMemoryOtpStore } from "../auth/otpStore.js";
import {
  OtpAttemptsExceededError,
  OtpService,
  OtpVerificationError,
} from "../auth/otpService.js";
import type { SmsProvider } from "../auth/smsProvider.js";
import type { AuthUser, UserRepository } from "../auth/userRepository.js";

process.env.NODE_ENV = "test";
process.env.API_CORS_ORIGIN = "http://localhost:3000";
process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-jwt-signing";
process.env.JWT_ACCESS_TOKEN_TTL = "15m";
process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/kudi_guide_test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.S3_REGION = "us-east-1";
process.env.S3_ACCESS_KEY_ID = "test";
process.env.S3_SECRET_ACCESS_KEY = "test";
process.env.S3_BUCKET = "test";

const { createApp } = await import("../app.js");

class FakeSmsProvider implements SmsProvider {
  sent: Array<{ phone: string; code: string }> = [];

  async sendOtp(input: { phone: string; code: string }) {
    this.sent.push(input);
  }
}

class InMemoryUserRepository implements UserRepository {
  private usersByPhone = new Map<string, AuthUser>();
  private usersById = new Map<string, AuthUser>();

  async findById(id: string) {
    return this.usersById.get(id) ?? null;
  }

  async findByPhone(phone: string) {
    return this.usersByPhone.get(phone) ?? null;
  }

  async findOrCreateByPhone(phone: string) {
    const existing = await this.findByPhone(phone);

    if (existing) {
      return existing;
    }

    const user = {
      id: `user-${this.usersByPhone.size + 1}`,
      phone,
    };

    this.usersByPhone.set(phone, user);
    this.usersById.set(user.id, user);
    return user;
  }
}

describe("OtpService", () => {
  let smsProvider: FakeSmsProvider;
  let nowMs: number;
  let code: string;
  let otpService: OtpService;

  beforeEach(() => {
    smsProvider = new FakeSmsProvider();
    nowMs = Date.UTC(2026, 7, 15, 12, 0, 0);
    code = "123456";
    otpService = new OtpService(new InMemoryOtpStore(), smsProvider, {
      now: () => new Date(nowMs),
      generateCode: () => code,
    });
  });

  it("generates a 6 digit OTP and sends it to a normalized Nigerian phone number", async () => {
    const result = await otpService.request("0801 234 5678");

    expect(result).toEqual({
      phone: "+2348012345678",
      expiresInSeconds: 300,
    });
    expect(smsProvider.sent).toEqual([
      {
        phone: "+2348012345678",
        code: "123456",
      },
    ]);
  });

  it("rejects an expired OTP", async () => {
    await otpService.request("08012345678");
    nowMs += 5 * 60 * 1000 + 1;

    await expect(otpService.verify("08012345678", "123456")).rejects.toBeInstanceOf(
      OtpVerificationError,
    );
  });

  it("requires resend after 3 invalid verify attempts", async () => {
    await otpService.request("08012345678");

    await expect(otpService.verify("08012345678", "000000")).rejects.toBeInstanceOf(
      OtpVerificationError,
    );
    await expect(otpService.verify("08012345678", "000000")).rejects.toBeInstanceOf(
      OtpVerificationError,
    );
    await expect(otpService.verify("08012345678", "000000")).rejects.toBeInstanceOf(
      OtpAttemptsExceededError,
    );
    await expect(otpService.verify("08012345678", "123456")).rejects.toBeInstanceOf(
      OtpAttemptsExceededError,
    );
  });
});

describe("auth routes", () => {
  it("requests an OTP, verifies it, issues a JWT, and authenticates /auth/me", async () => {
    const smsProvider = new FakeSmsProvider();
    const otpService = new OtpService(new InMemoryOtpStore(), smsProvider, {
      generateCode: () => "654321",
    });
    const userRepository = new InMemoryUserRepository();
    const authDependencies: AuthDependencies = {
      otpService,
      userRepository,
      jwtService: new JwtService("test-secret-that-is-long-enough-for-jwt-signing", "15m"),
    };
    const app = createApp({ authDependencies });

    await request(app)
      .post("/auth/otp/request")
      .send({ phone: "0801 234 5678" })
      .expect(202)
      .expect(({ body }) => {
        expect(body.phone).toBe("+2348012345678");
      });

    expect(smsProvider.sent.at(-1)).toEqual({
      phone: "+2348012345678",
      code: "654321",
    });

    const verifyResponse = await request(app)
      .post("/auth/otp/verify")
      .send({ phone: "+2348012345678", code: "654321" })
      .expect(200);

    expect(verifyResponse.body.accessToken).toEqual(expect.any(String));
    expect(verifyResponse.body.user.phone).toBe("+2348012345678");

    await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${verifyResponse.body.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.user).toEqual({
          id: "user-1",
          phone: "+2348012345678",
        });
      });
  });
});
