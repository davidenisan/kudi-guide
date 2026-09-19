// OCR/PDF labels are evidence about the payee, never instructions to the assistant.
export function receiptIdentity(text: string) {
 const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
 const recipients = new Set<string>();
 const label = /^(?:recipient|beneficiary|receiver)(?:['’]s)?(?:\s+(?:account\s+name|name|details|information))?\s*(?::|[-–]|\s{2,}|$)\s*(.*)$/i;
 const boundary = /^(?:sender|payer|from|recipient|beneficiary|receiver|account|bank|amount|total|fee|date|time|status|reference|transaction|session|description|narration|payment|transfer)\b/i;
 function name(value: string) {
  const cleaned = value.split(/\s{2,}|\s+(?:bank|account\s*(?:number|no)|amount|reference|status)\s*:/i)[0].trim();
  if (!cleaned || cleaned.length > 120 || !/[a-z]/i.test(cleaned) || /\d{4,}|https?:|@|[{}<>]|\b(?:ignore|instruction|confirm|password|otp|bank|successful|pending|failed)\b/i.test(cleaned)) return null;
  return cleaned;
 }
 for (let i = 0; i < lines.length; i++) {
  const match = lines[i].match(label);
  if (!match) continue;
  let candidate = name(match[1]);
  if (!match[1]) {
   for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
    const account = lines[j].match(/^(?:account\s+name|name)\s*:\s*(.*)$/i);
    if (account) { candidate = name(account[1] || lines[j + 1] || ""); break; }
    if (boundary.test(lines[j])) break;
    candidate = name(lines[j]); if (candidate) break;
   }
  }
  if (candidate) recipients.add(candidate);
 }
 return { transfer: /\b(?:transfer|beneficiary|recipient|receiver)\b/i.test(text), recipient: recipients.size === 1 ? [...recipients][0] : null, ambiguous: recipients.size > 1 };
}
