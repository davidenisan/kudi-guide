/**
 * Short-lived conversational state: the pending undo question, and the last few
 * turns of what was actually said.
 *
 * Deliberately in memory rather than in MongoDB. It is ephemeral by nature, it
 * expires in minutes, and Section 4 is explicit about not growing the data model
 * for this sort of thing. Losing it on restart is the safe failure: a stale
 * confirmation should never come back to life and delete a real transaction,
 * and a forgotten transcript costs nothing but a slightly flatter reply.
 *
 * The durable pending-category state is different — that one survives restarts
 * and lives on the user document, as Section 4 allows.
 */

const CONFIRMATION_TTL_MS = 5 * 60 * 1000;

export interface PendingUndo {
  /** The transaction the bot offered to remove, if it had one in mind. */
  transactionId: string | null;
  askedAt: number;
}

const pendingUndo = new Map<number, PendingUndo>();

export function setPendingUndo(userId: number, transactionId: string | null): void {
  pendingUndo.set(userId, { transactionId, askedAt: Date.now() });
}

export function takePendingUndo(userId: number): PendingUndo | null {
  const pending = pendingUndo.get(userId);
  if (!pending) return null;

  // Read-once: whatever the answer turns out to be, the question is now closed.
  pendingUndo.delete(userId);

  if (Date.now() - pending.askedAt > CONFIRMATION_TTL_MS) return null;
  return pending;
}

export function clearPendingUndo(userId: number): void {
  pendingUndo.delete(userId);
}

// ---------------------------------------------------------------------------
// Recent turns
// ---------------------------------------------------------------------------

/**
 * The last few things said, per user.
 *
 * Without this the bot answered every message as if it were the first one it had
 * ever seen, which is most of why it read like a phone tree. "You aren't fun to
 * chat with" is a reaction to what the bot just said; read in isolation it is an
 * unlabellable fragment, and the classifier duly called it a greeting and the
 * bot waved back. The same blindness broke follow-ups: "and last month?" has no
 * meaning without the question before it.
 *
 * Kept short on purpose. Four exchanges is enough for a reply to follow on from
 * what was just said, and short enough that it costs almost nothing to process
 * and cannot drift into a long-running relationship the bot does not have.
 */
export interface Turn {
  role: "user" | "bot";
  text: string;
}

interface Transcript {
  turns: Turn[];
  updatedAt: number;
}

const MAX_TURNS = 8;
const TRANSCRIPT_TTL_MS = 30 * 60 * 1000;
/** Long messages are truncated rather than dropped — the gist is what matters here. */
const MAX_TURN_LENGTH = 300;
const MAX_TRANSCRIPTS = 500;

const transcripts = new Map<number, Transcript>();

function remember(userId: number, role: Turn["role"], text: string): void {
  const trimmed = text.trim();
  if (trimmed === "") return;

  // Cheap eviction: this is a convenience cache, not state anything depends on.
  if (transcripts.size > MAX_TRANSCRIPTS) transcripts.clear();

  const existing = recentTurns(userId);
  const turns = [...existing, { role, text: trimmed.slice(0, MAX_TURN_LENGTH) }];
  transcripts.set(userId, {
    turns: turns.slice(-MAX_TURNS),
    updatedAt: Date.now(),
  });
}

export function rememberUserMessage(userId: number, text: string): void {
  remember(userId, "user", text);
}

export function rememberBotReply(userId: number, text: string): void {
  remember(userId, "bot", text);
}

/**
 * The turns worth carrying into the next reply. A gap of half an hour ends the
 * conversation: someone coming back the next day is starting a new one, and
 * answering them in the light of yesterday's exchange would be strange.
 */
export function recentTurns(userId: number): Turn[] {
  const transcript = transcripts.get(userId);
  if (!transcript) return [];

  if (Date.now() - transcript.updatedAt > TRANSCRIPT_TTL_MS) {
    transcripts.delete(userId);
    return [];
  }
  return transcript.turns;
}

export function clearTranscript(userId: number): void {
  transcripts.delete(userId);
}
