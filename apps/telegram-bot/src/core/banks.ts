/**
 * Which bank or fintech a receipt came from.
 *
 * This is a label, not a parser. Extraction stays entirely general — nothing
 * here changes how a field is read, and there are no per-bank templates. The tag
 * exists so failures can be counted per provider, which turns "OCR sometimes
 * struggles" into "OPay receipts fail four times out of nine, the others are
 * fine". That is the difference between guessing where to spend effort and
 * knowing.
 *
 * An unrecognised receipt is tagged null, and a pile of nulls is itself a
 * finding: it means testers are using providers we haven't seen.
 */

interface BankSignature {
  name: string;
  /** Lowercase markers. Any one of them appearing in the OCR text is a match. */
  markers: string[];
}

/**
 * The four in the initial test set, plus the providers a Nigerian test group is
 * most likely to reach for. Adding to this list is free and changes no logic.
 */
const BANKS: BankSignature[] = [
  { name: "GTBank", markers: ["gtbank", "gtworld", "guaranty trust", "737"] },
  { name: "Kuda", markers: ["kuda"] },
  { name: "OPay", markers: ["opay", "paycom"] },
  { name: "PalmPay", markers: ["palmpay", "palm pay"] },
  { name: "Moniepoint", markers: ["moniepoint", "monie point"] },
  { name: "Access", markers: ["access bank", "accessbank", "accessmore", "diamond bank"] },
  { name: "Zenith", markers: ["zenith"] },
  { name: "UBA", markers: ["united bank for africa", "uba "] },
  { name: "First Bank", markers: ["firstbank", "first bank", "firstmonie"] },
  { name: "Sterling", markers: ["sterling bank", "onebank"] },
  { name: "Fidelity", markers: ["fidelity bank"] },
  { name: "Wema", markers: ["wema", "alat"] },
  { name: "Stanbic", markers: ["stanbic"] },
  { name: "Union", markers: ["union bank"] },
  { name: "FCMB", markers: ["fcmb"] },
  { name: "Ecobank", markers: ["ecobank"] },
  { name: "Carbon", markers: ["carbon"] },
  { name: "Piggyvest", markers: ["piggyvest", "piggybank"] },
  { name: "Cowrywise", markers: ["cowrywise"] },
  { name: "Paystack", markers: ["paystack"] },
  { name: "Flutterwave", markers: ["flutterwave", "barter"] },
];

/**
 * Reads the provider out of OCR text. Returns null rather than guessing — an
 * honest "unrecognised" is more useful in a report than a wrong attribution.
 *
 * The earliest mention wins, not the first entry in the list below. More than
 * one bank routinely appears on a transfer receipt: the issuer brands the top,
 * and the recipient's bank is named down in the beneficiary block. An Access
 * receipt paying into a Moniepoint account was being filed under Moniepoint
 * purely because that name came first in this file, which would have blamed the
 * wrong provider in every accuracy report.
 */
export function detectBank(ocrText: string): string | null {
  const haystack = ocrText.toLowerCase().replace(/\s+/g, " ");

  let best: { name: string; at: number } | null = null;

  for (const bank of BANKS) {
    for (const marker of bank.markers) {
      const at = haystack.indexOf(marker);
      if (at === -1) continue;
      if (best === null || at < best.at) best = { name: bank.name, at };
    }
  }

  return best?.name ?? null;
}

export function knownBanks(): string[] {
  return BANKS.map((bank) => bank.name);
}
