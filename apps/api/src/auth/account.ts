import type { AuthUser } from "./userRepository.js";
export function publicUser(user: AuthUser) {
 return { id: user.id, phone: user.phone, nickname: user.nickname, email: user.email, username: user.username, hasPassword: Boolean(user.passwordHash), transactionAlerts: user.transactionAlerts };
}
