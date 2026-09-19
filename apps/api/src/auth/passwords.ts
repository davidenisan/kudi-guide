import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
function derive(password: string, salt: string): Promise<Buffer> {
 return new Promise((resolve, reject) => scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password: string) {
 const salt = randomBytes(16).toString("hex");
 return `scrypt-v1$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string | null) {
 const parts = encoded?.split("$");
 const valid = parts?.length === 3 && parts[0] === "scrypt-v1" && /^[a-f0-9]{32}$/.test(parts[1]) && /^[a-f0-9]{128}$/.test(parts[2]);
 // Missing accounts take the same expensive path as a wrong password.
 const key = await derive(password, valid ? parts[1] : "00000000000000000000000000000000");
 return Boolean(valid && timingSafeEqual(key, Buffer.from(parts![2], "hex")));
}
