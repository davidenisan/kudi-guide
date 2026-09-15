/**
 * Minimal structured logging. Section 8 makes logging a first-class part of this
 * phase — the record of what failed to parse is more useful early on than the
 * summary feature itself — so log lines are meant to be read, not just emitted.
 */

type Fields = Record<string, unknown>;

function format(level: string, message: string, fields?: Fields): string {
  const time = new Date().toISOString();
  if (!fields || Object.keys(fields).length === 0) {
    return `${time} ${level} ${message}`;
  }
  const rendered = Object.entries(fields)
    .map(([key, value]) => `${key}=${render(value)}`)
    .join(" ");
  return `${time} ${level} ${message} ${rendered}`;
}

function render(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (value instanceof Error) return JSON.stringify(value.message);
  if (typeof value === "string") return value.includes(" ") ? JSON.stringify(value) : value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export const logger = {
  info(message: string, fields?: Fields): void {
    console.log(format("INFO ", message, fields));
  },
  warn(message: string, fields?: Fields): void {
    console.warn(format("WARN ", message, fields));
  },
  error(message: string, fields?: Fields): void {
    console.error(format("ERROR", message, fields));
  },
};
