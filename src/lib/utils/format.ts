const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-IN");

export const formatCurrency = (n: number) => inr.format(Math.round(n));
export const formatNumber = (n: number) => num.format(n);
export const formatPercent = (n: number | null, digits = 0) => (n === null || Number.isNaN(n) ? "—" : `${n.toFixed(digits)}%`);

export function initials(name: string): string {
  const parts = name.replace(/^(Mr|Ms|Mrs|Dr)\.?\s+/i, "").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function pluralize(n: number, one: string, many = `${one}s`) {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

export function titleCase(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
