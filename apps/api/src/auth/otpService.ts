import { normalizeNigerianPhone } from "./phone.js";
import type { OtpStore } from "./otpStore.js";
import type { SmsProvider } from "./smsProvider.js";

export class OtpRateLimitError extends Error {}
export class OtpVerificationError extends Error {}
export class OtpAttemptsExceededError extends Error {}

type OtpServiceOptions = {
  expiresInMs?: number;
  maxVerifyAttempts?: number;
  rateLimitWindowMs?: number;
  maxRequestsPerWindow?: number;
  maxResendsPerWindow?: number;
  now?: () => Date;
  generateCode?: () => string;
};

export class OtpService {
  private readonly expiresInMs: number;
  private readonly maxVerifyAttempts: number;
  private readonly rateLimitWindowMs: number;
  private readonly maxRequestsPerWindow: number;
  private readonly maxResendsPerWindow: number;
  private readonly now: () => Date;
  private readonly generateCode: () => string;

  constructor(
    private readonly store: OtpStore,
    private readonly smsProvider: SmsProvider,
    options: OtpServiceOptions = {},
  ) {
    this.expiresInMs = options.expiresInMs ?? 5 * 60 * 1000;
    this.maxVerifyAttempts = options.maxVerifyAttempts ?? 3;
    this.rateLimitWindowMs = options.rateLimitWindowMs ?? 15 * 60 * 1000;
    this.maxRequestsPerWindow = options.maxRequestsPerWindow ?? 3;
    this.maxResendsPerWindow = options.maxResendsPerWindow ?? 3;
    this.now = options.now ?? (() => new Date());
    this.generateCode = options.generateCode ?? OtpService.generateSixDigitCode;
  }

  static generateSixDigitCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  async request(phoneInput: string) {
    const phone = normalizeNigerianPhone(phoneInput);
    const existing = await this.store.get(phone);
    const now = this.now();
    const requestTimestamps = this.pruneTimestamps(existing?.requestTimestamps ?? [], now);

    if (requestTimestamps.length >= this.maxRequestsPerWindow) {
      throw new OtpRateLimitError("Too many OTP requests. Try again later.");
    }

    const code = this.generateCode();
    await this.store.set(phone, {
      code,
      expiresAt: new Date(now.getTime() + this.expiresInMs),
      attempts: 0,
      requestTimestamps: [...requestTimestamps, now.getTime()],
      resendTimestamps: this.pruneTimestamps(existing?.resendTimestamps ?? [], now),
    });
    await this.smsProvider.sendOtp({ phone, code });

    return { phone, expiresInSeconds: Math.floor(this.expiresInMs / 1000) };
  }

  async resend(phoneInput: string) {
    const phone = normalizeNigerianPhone(phoneInput);
    const existing = await this.store.get(phone);
    const now = this.now();
    const resendTimestamps = this.pruneTimestamps(existing?.resendTimestamps ?? [], now);

    if (resendTimestamps.length >= this.maxResendsPerWindow) {
      throw new OtpRateLimitError("Too many OTP resend attempts. Try again later.");
    }

    const code = this.generateCode();
    await this.store.set(phone, {
      code,
      expiresAt: new Date(now.getTime() + this.expiresInMs),
      attempts: 0,
      requestTimestamps: this.pruneTimestamps(existing?.requestTimestamps ?? [], now),
      resendTimestamps: [...resendTimestamps, now.getTime()],
    });
    await this.smsProvider.sendOtp({ phone, code });

    return { phone, expiresInSeconds: Math.floor(this.expiresInMs / 1000) };
  }

  async verify(phoneInput: string, code: string) {
    const phone = normalizeNigerianPhone(phoneInput);
    const existing = await this.store.get(phone);

    if (!existing) {
      throw new OtpVerificationError("Request a new code before verifying.");
    }

    if (existing.expiresAt.getTime() <= this.now().getTime()) {
      await this.store.delete(phone);
      throw new OtpVerificationError("This code has expired. Request a new one.");
    }

    if (existing.attempts >= this.maxVerifyAttempts) {
      throw new OtpAttemptsExceededError("Too many invalid attempts. Resend the code.");
    }

    if (existing.code !== code) {
      const attempts = existing.attempts + 1;
      await this.store.set(phone, { ...existing, attempts });

      if (attempts >= this.maxVerifyAttempts) {
        throw new OtpAttemptsExceededError("Too many invalid attempts. Resend the code.");
      }

      throw new OtpVerificationError("Invalid verification code.");
    }

    await this.store.delete(phone);
    return { phone };
  }

  private pruneTimestamps(timestamps: number[], now: Date) {
    const cutoff = now.getTime() - this.rateLimitWindowMs;
    return timestamps.filter((timestamp) => timestamp > cutoff);
  }
}
