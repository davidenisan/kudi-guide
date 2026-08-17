import type { NextFunction, Request, Response } from "express";

import type { JwtService } from "./jwt.js";
import type { UserRepository } from "./userRepository.js";

export function createAuthMiddleware(input: {
  jwtService: JwtService;
  userRepository: UserRepository;
}) {
  return async function authMiddleware(request: Request, response: Response, next: NextFunction) {
    const authorization = request.header("authorization");
    const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;

    if (!token) {
      response.status(401).json({ error: "Missing access token." });
      return;
    }

    try {
      const payload = input.jwtService.verifyAccessToken(token);
      const user = await input.userRepository.findById(payload.sub);

      if (!user) {
        response.status(401).json({ error: "Invalid access token." });
        return;
      }

      request.user = user;
      next();
    } catch {
      response.status(401).json({ error: "Invalid access token." });
    }
  };
}
