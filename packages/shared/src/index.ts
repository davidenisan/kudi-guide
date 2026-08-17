export type AuthProvider = "phone" | "email" | "oauth";

export type TransactionSource = "whatsapp" | "upload" | "manual";

export type TransactionStatus = "pending" | "confirmed" | "needs_review" | "duplicate";

export type GoalType = "saving" | "investment";

export type OcrStatus = "queued" | "processing" | "completed" | "failed";

export interface User {
  id: string;
  phone: string | null;
  email: string | null;
  authProvider: AuthProvider;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  isSystemDefault: boolean;
}

export interface Screenshot {
  id: string;
  userId: string;
  s3Key: string;
  ocrStatus: OcrStatus;
  rawOcrText: string | null;
}

export interface Transaction {
  id: string;
  userId: string;
  source: TransactionSource;
  amount: string;
  currency: string;
  merchant: string | null;
  categoryId: string | null;
  occurredAt: string;
  confidenceScore: number | null;
  dedupHash: string | null;
  status: TransactionStatus;
}

export interface Budget {
  id: string;
  userId: string;
  categoryId: string;
  period: string;
  amountLimit: string;
}

export interface Goal {
  id: string;
  userId: string;
  type: GoalType;
  targetAmount: string;
  currentAmount: string;
  targetDate: string | null;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  sentAt: string | null;
}
