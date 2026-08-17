import { env } from "../config/env.js";
import { JwtService } from "./jwt.js";
import { InMemoryOtpStore } from "./otpStore.js";
import { OtpService } from "./otpService.js";
import { createSmsProvider } from "./smsProvider.js";
import { PrismaUserRepository, type UserRepository } from "./userRepository.js";

export type AuthDependencies = {
  otpService: OtpService;
  jwtService: JwtService;
  userRepository: UserRepository;
};

export function createAuthDependencies(): AuthDependencies {
  const smsProvider = createSmsProvider({
    termiiApiKey: env.TERMII_API_KEY,
    termiiSenderId: env.TERMII_SENDER_ID,
  });

  return {
    otpService: new OtpService(new InMemoryOtpStore(), smsProvider),
    jwtService: new JwtService(env.JWT_SECRET, env.JWT_ACCESS_TOKEN_TTL),
    userRepository: new PrismaUserRepository(),
  };
}
