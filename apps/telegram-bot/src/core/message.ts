/**
 * The neutral contract between a transport adapter and the expense-tracking core.
 *
 * This is the boundary the spec calls the single most important structural rule
 * (Section 2). An adapter converts a platform update into an IncomingMessage,
 * hands it to the core, and sends back whatever OutgoingReply it gets. Nothing
 * platform-specific appears here — no chat ids, no file ids, no message ids.
 *
 * Swapping Telegram for WhatsApp Cloud API (Section 12) means writing a second
 * adapter that speaks these two types. It must not mean touching the core.
 */

export interface IncomingMessage {
  /** Stable numeric id for the person messaging us, from the transport. */
  userId: number;
  kind: "text" | "media";

  /** Present when kind is "text". */
  text?: string;

  /**
   * Present when kind is "media" and the file was downloadable. Absent for a
   * media message the adapter declined to fetch — an unsupported type, or a
   * file too large — in which case mimeType still describes what arrived so
   * the core can answer per Section 8 without paying for the download.
   */
  fileBytes?: Buffer;
  mimeType?: string;
  fileName?: string;

  /** Why fileBytes is missing, when it is. Lets the core reply accurately. */
  mediaError?: "unsupported_type" | "too_large" | "download_failed";

  receivedAt: Date;
}

export interface OutgoingReply {
  text: string;
}

/**
 * What an adapter calls. Returning null means "say nothing" — used for updates
 * the core deliberately ignores.
 */
export type MessageHandler = (message: IncomingMessage) => Promise<OutgoingReply | null>;

export function isPdf(mimeType: string | undefined): boolean {
  return mimeType === "application/pdf";
}

export function isImage(mimeType: string | undefined): boolean {
  return mimeType !== undefined && mimeType.startsWith("image/");
}

/** The only media the receipt pipeline will attempt to read. */
export function isSupportedReceiptMedia(mimeType: string | undefined): boolean {
  return isImage(mimeType) || isPdf(mimeType);
}
