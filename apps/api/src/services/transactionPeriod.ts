export type TransactionPeriod = "today" | "week" | "month" | "year" | "all";
export function transactionPeriodStart(now: Date, period: TransactionPeriod): Date | null {
 if (period === "all") return null;
 const lagos = new Date(now.getTime() + 3600000);
 const year = lagos.getUTCFullYear(), month = lagos.getUTCMonth(), day = lagos.getUTCDate();
 return new Date(Date.UTC(year, period === "year" ? 0 : month, period === "month" || period === "year" ? 1 : day) - 3600000 - (period === "week" ? 6 * 86400000 : 0));
}
