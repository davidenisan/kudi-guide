import jwt from "jsonwebtoken";

export type AccessTokenPayload = {
  sub: string;
  phone: string | null;
};

export class JwtService {
  constructor(
    private readonly secret: string,
    private readonly expiresIn: string,
  ) {}

  signAccessToken(payload: AccessTokenPayload) {
    return jwt.sign(payload, this.secret, {
      expiresIn: this.expiresIn as jwt.SignOptions["expiresIn"],
      audience: "kudi-guide",
      issuer: "kudi-guide-api",
    });
  }

  verifyAccessToken(token: string) {
    return jwt.verify(token, this.secret, {
      audience: "kudi-guide",
      issuer: "kudi-guide-api",
    }) as AccessTokenPayload & jwt.JwtPayload;
  }
}
