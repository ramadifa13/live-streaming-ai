export function formatTime(secs: number): string {
  const h = Math.floor(secs / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((secs % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(secs % 60)
    .toString()
    .padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function parsePriceToNumber(price?: number | string): number {
  if (!price) return 0;
  if (typeof price === "number") return price;
  return parseInt(String(price).replace(/\D/g, ""), 10) || 0;
}

export function formatRupiah(amount: number): string {
  return `Rp${amount.toLocaleString("id-ID")}`;
}

export function getAutoOriginalPrice(price?: number | string): string | null {
  if (!price) return null;
  const rawPrice = parsePriceToNumber(price);
  if (rawPrice <= 0) return null;
  const autoOriginal = Math.ceil((rawPrice * 1.35) / 5000) * 5000;
  return formatRupiah(autoOriginal);
}

export function formatCompactRupiah(val: number): string {
  if (val >= 1_000_000_000) {
    return `Rp${(val / 1_000_000_000).toFixed(1)} M`;
  }
  if (val >= 1_000_000) {
    return `Rp${(val / 1_000_000).toFixed(1)} Jt`;
  }
  if (val >= 1_000) {
    return `Rp${(val / 1_000).toFixed(0)} Rb`;
  }
  return formatRupiah(val);
}

export function formatNumber(num: number): string {
  return num.toLocaleString("id-ID");
}
