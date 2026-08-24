/**
 * Short-lived conversational state — currently just "I asked this user to
 * confirm an undo and I'm waiting on their answer".
 *
 * Deliberately in memory rather than in MongoDB. It is ephemeral by nature, it
 * expires in minutes, and Section 4 is explicit about not growing the data model
 * for this sort of thing. Losing it on restart is the safe failure: a stale
 * confirmation should never come back to life and delete a real transaction.
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
