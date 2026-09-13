export type PlanAutomations = {
  autoReply: boolean;
  autoPin: boolean;
  autoPromo: boolean;
  autoModeration: boolean;
};

export type LivePlan = {
  id: string;
  hours: number;
  label: string;
  tag: string;
  amount: number;
  currency: "IDR";
  priceLabel: string;
  automations: PlanAutomations;
  toast: string;
};

export const LIVE_PLANS: readonly LivePlan[] = [
  {
    id: "trial-1h",
    hours: 1,
    label: "1 Jam",
    tag: "Trial",
    amount: 59000,
    currency: "IDR",
    priceLabel: "Rp59.000 (Trial)",
    automations: { autoReply: true, autoPin: true, autoPromo: true, autoModeration: true },
    toast: "Paket Trial (1 Jam): Auto-Reply aktif",
  },
  {
    id: "express-2h",
    hours: 2,
    label: "2 Jam",
    tag: "Express",
    amount: 99000,
    currency: "IDR",
    priceLabel: "Rp99.000 (Express)",
    automations: { autoReply: true, autoPin: true, autoPromo: false, autoModeration: false },
    toast: "Paket Express (2 Jam): Auto-Reply & Auto-Pin aktif",
  },
  {
    id: "shift-8h",
    hours: 8,
    label: "8 Jam",
    tag: "Shift",
    amount: 299000,
    currency: "IDR",
    priceLabel: "Rp299.000 (Shift)",
    automations: { autoReply: true, autoPin: true, autoPromo: true, autoModeration: true },
    toast: "Paket Shift (8 Jam): Semua otomatisasi aktif",
  },
  {
    id: "marathon-24h",
    hours: 24,
    label: "24 Jam",
    tag: "24/7",
    amount: 699000,
    currency: "IDR",
    priceLabel: "Rp699.000 (Marathon)",
    automations: { autoReply: true, autoPin: true, autoPromo: true, autoModeration: true },
    toast: "Paket Marathon (24 Jam): Semua otomatisasi aktif",
  },
] as const;

export function getPlanById(planId: string | undefined | null): LivePlan | null {
  if (!planId) return null;
  return LIVE_PLANS.find((plan) => plan.id === planId) ?? null;
}

export function getPlanByHours(hours: number | undefined | null): LivePlan | null {
  if (!hours) return null;
  return LIVE_PLANS.find((plan) => plan.hours === hours) ?? null;
}

export function listPublicPlans() {
  return LIVE_PLANS.map((plan) => ({
    id: plan.id,
    hours: plan.hours,
    label: plan.label,
    tag: plan.tag,
    amount: plan.amount,
    currency: plan.currency,
    priceLabel: plan.priceLabel,
    automations: plan.automations,
    toast: plan.toast,
  }));
}
