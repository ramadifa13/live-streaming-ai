import { CsvRawItem } from "@/app/dashboard/types";

export function parseProductCsv(csvText: string): CsvRawItem[] {
  if (!csvText.trim()) return [];

  const lines = csvText.trim().split(/\r?\n/);
  const rawItems: CsvRawItem[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    if (!line || (idx === 0 && line.toLowerCase().startsWith("nama"))) {
      continue;
    }

    const parts = line
      .split(",")
      .map((p) => p.trim().replace(/^["']|["']$/g, ""));

    if (parts.length >= 2) {
      const name = parts[0];
      const priceNum = parseInt(parts[1].replace(/[^0-9]/g, ""), 10) || 0;
      const stock = parseInt(parts[2], 10) || 0;
      const category = parts[3] || "General";
      const description = parts[4] || `Produk ${name}`;
      const link = parts[5] || "";

      rawItems.push({
        name,
        price: priceNum,
        stock,
        category,
        description,
        link,
        image:
          "",
        bannerImage: "",
        benefits: "",
        usage: "",
      });
    }
  }

  return rawItems;
}
