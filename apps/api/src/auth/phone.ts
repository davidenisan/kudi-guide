export function normalizeNigerianPhone(phone: string) {
  const compact = phone.replace(/[\s()-]/g, "");

  if (/^\+234[789]\d{9}$/.test(compact)) {
    return compact;
  }

  if (/^234[789]\d{9}$/.test(compact)) {
    return `+${compact}`;
  }

  if (/^0[789]\d{9}$/.test(compact)) {
    return `+234${compact.slice(1)}`;
  }

  throw new Error("Enter a valid Nigerian phone number.");
}
