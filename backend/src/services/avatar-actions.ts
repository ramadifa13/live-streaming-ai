import fs from "fs";
import path from "path";

// Single source of truth untuk gestur avatar, dipakai bersama dengan
// deploy/assets/avatar_actions.json (dibaca oleh live_worker.py & broadcaster.py
// di GPU worker). Ubah gestur cukup di file JSON itu — jangan hardcode ulang
// daftar aksi di file lain.

export type AvatarActionCategory = "idle" | "talk" | "gesture";

export interface AvatarActionEntry {
  key: string;
  clip: string;
  aliases: string[];
  category: AvatarActionCategory;
  crossfadeSeconds: number;
  promptHint: string;
}

interface AvatarActionConfig {
  actions: AvatarActionEntry[];
  defaults: {
    crossfadeSeconds: number;
    fadeSeconds: number;
    noRepeatGestureWindow: number;
  };
}

// Dipakai hanya bila file JSON tidak ditemukan (mis. layout deploy berbeda),
// supaya backend tetap bisa jalan alih-alih crash.
const FALLBACK_CONFIG: AvatarActionConfig = {
  actions: [
    {
      key: "IDLE",
      clip: "idle",
      aliases: [],
      category: "idle",
      crossfadeSeconds: 0.45,
      promptHint: "jangan untuk kalimat yang diucapkan",
    },
    {
      key: "TALK_EXPRESSIVE",
      clip: "talk_expressive",
      aliases: ["expressive"],
      category: "talk",
      crossfadeSeconds: 0.35,
      promptHint: "default bicara (paling sering, ~50%)",
    },
    {
      key: "WAVE",
      clip: "wave",
      aliases: ["raise_hand"],
      category: "gesture",
      crossfadeSeconds: 0.2,
      promptHint: 'sapaan / welcome / "halo kak"',
    },
    {
      key: "NOD",
      clip: "nod",
      aliases: [],
      category: "gesture",
      crossfadeSeconds: 0.15,
      promptHint: 'setuju, "betul kak", "iya benar"',
    },
    {
      key: "LAUGH",
      clip: "laugh",
      aliases: [],
      category: "gesture",
      crossfadeSeconds: 0.2,
      promptHint: "candaan / ketawa",
    },
    {
      key: "POINT_UP",
      clip: "point_up",
      aliases: [],
      category: "gesture",
      crossfadeSeconds: 0.2,
      promptHint: "tunjuk harga, promo, stok (ke atas)",
    },
    {
      key: "POINT_DOWN",
      clip: "point_down",
      aliases: [],
      category: "gesture",
      crossfadeSeconds: 0.2,
      promptHint: "tunjuk harga, promo, stok (ke bawah)",
    },
    {
      key: "THINK",
      clip: "nod",
      aliases: ["think"],
      category: "gesture",
      crossfadeSeconds: 0.2,
      promptHint: 'ragu, "hmm", sedang pikir',
    },
  ],
  defaults: { crossfadeSeconds: 0.5, fadeSeconds: 0.4, noRepeatGestureWindow: 1 },
};

let cached: AvatarActionConfig | null = null;

function loadConfig(): AvatarActionConfig {
  if (cached) return cached;
  const candidates = [
    path.resolve(__dirname, "../../../deploy/assets/avatar_actions.json"),
    path.resolve(process.cwd(), "deploy/assets/avatar_actions.json"),
    path.resolve(process.cwd(), "../deploy/assets/avatar_actions.json"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        cached = JSON.parse(fs.readFileSync(candidate, "utf-8"));
        return cached as AvatarActionConfig;
      }
    } catch {
      // coba kandidat path berikutnya
    }
  }
  console.warn("[avatar-actions] deploy/assets/avatar_actions.json tidak ditemukan — memakai fallback bawaan.");
  cached = FALLBACK_CONFIG;
  return cached;
}

export function getAvatarActions(): AvatarActionEntry[] {
  return loadConfig().actions;
}

export function getAvatarActionKeys(): string[] {
  return loadConfig().actions.map((a) => a.key);
}

export function getAvatarActionSet(): Set<string> {
  return new Set(getAvatarActionKeys());
}

export function getAvatarActionEntry(key: string): AvatarActionEntry | undefined {
  const normalized = (key || "").toUpperCase();
  return loadConfig().actions.find((a) => a.key === normalized);
}

export function isGestureAction(key: string): boolean {
  return getAvatarActionEntry(key)?.category === "gesture";
}

export function buildGesturePromptBlock(): string {
  return loadConfig()
    .actions.map((a) => `- ${a.key}: ${a.promptHint}`)
    .join("\n");
}

export function getNoRepeatGestureWindow(): number {
  return loadConfig().defaults.noRepeatGestureWindow ?? 1;
}
