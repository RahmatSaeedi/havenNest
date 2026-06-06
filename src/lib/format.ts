/** Formatting helpers shared across the site. */
export const money = (n: number): string => `$${Math.round(n).toLocaleString('en-CA')}`;

export const moneyMonthly = (n: number): string => `${money(n)}/mo`;

export const num = (n: number): string => n.toLocaleString('en-CA');

/** Beds/baths label, e.g. "2.5" -> "2.5", "1" -> "1". */
export const bathLabel = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(1);
