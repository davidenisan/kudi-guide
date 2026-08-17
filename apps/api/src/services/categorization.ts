export type CategorySuggestion = {
  categoryName: string;
  confidence: number;
  reason: string;
};

const categoryRules = [
  {
    categoryName: "Savings & Investing",
    confidence: 0.92,
    keywords: ["cowrywise", "piggyvest", "bamboo", "risevest", "trov", "chaka"],
    reason: "Matched a known savings or investment platform.",
  },
  {
    categoryName: "Data & Airtime",
    confidence: 0.92,
    keywords: ["mtn", "airtel", "glo", "9mobile", "etisalat", "spectranet", "smile"],
    reason: "Matched a telco or data provider.",
  },
  {
    categoryName: "Food",
    confidence: 0.82,
    keywords: ["restaurant", "kitchen", "foods", "bukka", "chicken republic", "kilimanjaro", "dominos"],
    reason: "Matched a restaurant or food merchant.",
  },
  {
    categoryName: "Shopping",
    confidence: 0.8,
    keywords: ["jumia", "konga", "shoprite", "spar", "market square", "supermarket", "store"],
    reason: "Matched a store, supermarket, or ecommerce merchant.",
  },
] as const;

export function suggestCategory(input: {
  merchant?: string | null;
  description?: string | null;
  recipientName?: string | null;
  userSurname?: string | null;
}): CategorySuggestion {
  const haystack = [input.merchant, input.description, input.recipientName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const userSurname = input.userSurname?.trim().toLowerCase();
  const recipientName = input.recipientName?.trim().toLowerCase();

  if (userSurname && recipientName?.includes(userSurname)) {
    return {
      categoryName: "Family",
      confidence: 0.78,
      reason: "Recipient name appears to share the user's surname.",
    };
  }

  for (const rule of categoryRules) {
    if (rule.keywords.some((keyword) => haystack.includes(keyword))) {
      return {
        categoryName: rule.categoryName,
        confidence: rule.confidence,
        reason: rule.reason,
      };
    }
  }

  return {
    categoryName: "Other",
    confidence: 0.45,
    reason: "No rule matched confidently.",
  };
}
