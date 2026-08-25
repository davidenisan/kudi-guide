import { logger } from "../logger.js";

/**
 * Getting a problem in front of you, without the core knowing how.
 *
 * Section 8 wants every failed extraction somewhere reviewable. A folder on a
 * server is technically reviewable and practically isn't — it means SSHing in
 * and copying files down, which is enough friction that nobody does it, and an
 * unread log is worth nothing.
 *
 * So failures are pushed to the developer instead of waiting to be pulled. The
 * core says "this went wrong, here is the picture"; the transport decides how
 * that reaches a human. On Telegram that's a message to a private channel; a
 * future adapter might send an email. The core does not care and must not know.
 */

export interface AdminReport {
  title: string;
  /** Rendered as "label: value" lines. Values are shown verbatim. */
  fields: Record<string, string | number | null | undefined>;
  /** Free text appended after the fields — raw OCR output, an error, a stack. */
  detail?: string;
  /** The file in question, when there is one worth looking at. */
  image?: Buffer;
  imageName?: string;
}

export type AdminNotifier = (report: AdminReport) => Promise<void>;

/** Until an adapter registers one, reports are logged and go no further. */
let notifier: AdminNotifier | null = null;
let warnedAboutMissingNotifier = false;

export function setAdminNotifier(next: AdminNotifier | null): void {
  notifier = next;
}

/**
 * Never throws and never blocks anything important. A failed notification must
 * not turn one problem into two — the disk copy is the durable record, this is
 * only the part that gets your attention.
 */
export async function notifyAdmin(report: AdminReport): Promise<void> {
  if (!notifier) {
    if (!warnedAboutMissingNotifier) {
      logger.info("no admin notifier configured — reports go to the review log only");
      warnedAboutMissingNotifier = true;
    }
    logger.warn(`[admin] ${report.title}`, report.fields);
    return;
  }

  try {
    await notifier(report);
  } catch (error) {
    logger.error("could not deliver admin report", { title: report.title, error });
  }
}

/** Renders a report as plain text, for transports that only send text. */
export function formatReport(report: AdminReport): string {
  const lines = [report.title];

  for (const [label, value] of Object.entries(report.fields)) {
    lines.push(`${label}: ${value ?? "—"}`);
  }

  if (report.detail) {
    lines.push("", report.detail);
  }

  return lines.join("\n");
}
