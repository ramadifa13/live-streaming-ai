/**
 * Marathon Host Engine tests — run: npx tsx --test src/services/live-script-bank.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  contentRepeatGuard,
  emptyProductMemory,
  emptySalesRuleMemory,
  emptyScriptBank,
  inferSemanticKey,
  isExactRepeat,
  isLexicalRepeat,
  marathonCycleId,
  mergeScriptLines,
  preferredAnglesForCycle,
  productReference,
  recordSpeechUsage,
  recycleLocalScriptBank,
  salesRuleGuard,
  seedLocalScriptBank,
  takeScriptLine,
  touchProductVisit,
  type ScriptProductFacts,
} from "./live-script-bank.js";
import { SEMANTIC_MEMORY_LIMIT, isSemanticRepeat } from "./live-marathon-memory.js";

function sampleProduct(id: string, name: string): ScriptProductFacts {
  return {
    id,
    name,
    price: "99.000",
    category: "skincare",
    benefits: "Teksturnya ringan. Membantu melembapkan kulit. Formula lembut untuk pemula.",
    description:
      "Serum harian dengan tekstur ringan. Cocok untuk kulit kering. Cara pakai oleskan pagi dan malam. Ukuran 30ml.",
    usage: "Oleskan pagi dan malam setelah cleanser. Tunggu kering sebelum sunscreen.",
    faq: "Apakah cocok untuk pemula? Ya, teksturnya ringan. Ada berapa ml? 30ml.",
    hasBanner: true,
    targetAudience: "Pemula skincare. Kulit kering.",
  };
}

describe("exact / lexical / semantic repeat", () => {
  it("rejects exact repeats", () => {
    const a = "Produk ini teksturnya ringan.";
    assert.equal(isExactRepeat(a, a), true);
    const guard = contentRepeatGuard({
      speech: a,
      topic: "benefit",
      recentSpeeches: [a],
    });
    assert.equal(guard.blocked, true);
    assert.equal(guard.reason, "exact");
  });

  it("detects lexical paraphrase", () => {
    const a = "Produk ini cocok buat kulit kering.";
    const b = "Produk ini cocok untuk kulit kering sekali.";
    assert.equal(isLexicalRepeat(a, b), true);
  });

  it("blocks semantic angle when too recent", () => {
    const mem = emptyProductMemory("p1");
    const speech = "Teksturnya ringan banget dipakai sehari-hari.";
    const key = inferSemanticKey(speech, "benefit");
    recordSpeechUsage({
      productMemory: mem,
      speech,
      topic: "benefit",
      semanticKey: key,
      cycleId: 0,
      now: Date.now(),
    });
    assert.equal(isSemanticRepeat(speech, "benefit", mem, Date.now()), true);
    const guard = contentRepeatGuard({
      speech,
      topic: "benefit",
      recentSpeeches: ["halo semuanya"],
      productMemory: mem,
    });
    assert.equal(guard.blocked, true);
  });
});

describe("CTA sales rule cooldown", () => {
  it("blocks CTA before cooldown and allows after", () => {
    const sales = emptySalesRuleMemory();
    const now = Date.now();
    sales.lastCTAAt = now;
    sales.lastSalesRuleAt.soft_cta = now;

    assert.equal(
      salesRuleGuard({
        salesRule: "soft_cta",
        ctaType: "SOFT",
        salesMemory: sales,
        now: now + 5_000,
        ctaCooldownMs: 45_000,
      }).blocked,
      true,
    );

    assert.equal(
      salesRuleGuard({
        salesRule: "soft_cta",
        ctaType: "SOFT",
        salesMemory: sales,
        now: now + 50_000,
        ctaCooldownMs: 45_000,
      }).blocked,
      false,
    );
  });

  it("allows banner CTA after cooldown", () => {
    const sales = emptySalesRuleMemory();
    const now = Date.now();
    sales.lastBannerCTAAt = now;
    sales.lastSalesRuleAt.banner_reminder = now;
    sales.lastCTAAt = now;

    assert.equal(
      salesRuleGuard({
        salesRule: "banner_reminder",
        ctaType: "SOFT",
        topic: "banner_callout",
        salesMemory: sales,
        now: now + 10_000,
        bannerCooldownMs: 90_000,
        ctaCooldownMs: 45_000,
      }).blocked,
      true,
    );

    assert.equal(
      salesRuleGuard({
        salesRule: "banner_reminder",
        ctaType: "SOFT",
        topic: "banner_callout",
        salesMemory: sales,
        now: now + 100_000,
        bannerCooldownMs: 90_000,
        ctaCooldownMs: 45_000,
      }).blocked,
      false,
    );
  });
});

describe("product re-entry A→B→C→A", () => {
  it("keeps product memory and uses re_entry mode", () => {
    const store = new Map();
    const a = emptyProductMemory("A");
    store.set("A", a);
    touchProductVisit(a);
    assert.equal(a.entryMode, "first_intro");

    recordSpeechUsage({
      productMemory: a,
      speech: "Serum A teksturnya ringan untuk pemula.",
      topic: "benefit",
      cycleId: 0,
    });
    assert.equal(a.entryMode, "continuing");
    const anglesBefore = Object.keys(a.angleUsage).length;
    assert.ok(anglesBefore >= 1);
    assert.equal(a.visitCount, 1);

    touchProductVisit(emptyProductMemory("B"));
    touchProductVisit(emptyProductMemory("C"));

    const aAgain = store.get("A")!;
    touchProductVisit(aAgain);
    assert.equal(aAgain.visitCount, 2);
    assert.equal(aAgain.entryMode, "re_entry");
    assert.equal(Object.keys(aAgain.angleUsage).length, anglesBefore);

    const seeded = seedLocalScriptBank(sampleProduct("A", "Serum A"), [], {
      entryMode: aAgain.entryMode,
      productMemory: aAgain,
      cycleId: 1,
    });
    assert.ok(seeded.some((line) => /tadi|balik|sebelumnya|angle/i.test(line.speech)));

    const bank = emptyScriptBank("A");
    mergeScriptLines(bank, seeded, []);
    const recent = ["Serum A teksturnya ringan untuk pemula."];
    const picked = takeScriptLine(bank, recent, {
      productMemory: aAgain,
      preferUnusedAngles: true,
      cycleId: 1,
      now: Date.now(),
    });
    assert.ok(picked);
    assert.equal(isExactRepeat(picked!.speech, recent[0]!), false);
  });
});

describe("cycle + product reference", () => {
  it("rotates preferred angles across cycles", () => {
    assert.notEqual(
      preferredAnglesForCycle(0).join(","),
      preferredAnglesForCycle(1).join(","),
    );
    assert.equal(marathonCycleId(0), 0);
    assert.equal(marathonCycleId(45), 1);
  });

  it("varies product references by context", () => {
    const name = "Serum Glow";
    assert.ok(productReference(name, "first_intro", { index: 0 }).length > 0);
    assert.notEqual(
      productReference(name, "continuing", { index: 0 }),
      productReference(name, "re_entry", { index: 0 }),
    );
  });
});

describe("memory bounds + smoke", () => {
  it("keeps semantic memory bounded", () => {
    const mem = emptyProductMemory("bound");
    for (let i = 0; i < SEMANTIC_MEMORY_LIMIT + 40; i++) {
      recordSpeechUsage({
        productMemory: mem,
        speech: `Fakta unik nomor ${i} tentang tekstur ringan hydrasi ${i}`,
        topic: "benefit",
        semanticKey: `benefit_unique_${i}`,
        cycleId: i % 5,
      });
    }
    assert.ok(Object.keys(mem.angleUsage).length <= SEMANTIC_MEMORY_LIMIT);
    assert.ok(mem.usedAngles.length <= SEMANTIC_MEMORY_LIMIT);
  });

  it("smoke: no uncontrolled exact repeats across many takes", () => {
    const product = sampleProduct("p1", "Serum Marathon");
    const mem = emptyProductMemory("p1");
    touchProductVisit(mem);
    const sales = emptySalesRuleMemory();
    const bank = emptyScriptBank("p1");
    mergeScriptLines(
      bank,
      seedLocalScriptBank(product, [], {
        entryMode: "first_intro",
        productMemory: mem,
        cycleId: 0,
      }),
      [],
    );

    const spoken: string[] = [];
    let exactHits = 0;
    for (let i = 0; i < 48; i++) {
      if (bank.lines.length < 6) {
        const boost = recycleLocalScriptBank(product, [], spoken.slice(-12), {
          productMemory: mem,
          salesMemory: sales,
          cycleId: marathonCycleId(i / 4),
          entryMode: mem.entryMode,
        }).slice(0, 40);
        mergeScriptLines(bank, boost, spoken.slice(-12));
      }
      const line = takeScriptLine(bank, spoken.slice(-16), {
        productMemory: mem,
        salesMemory: sales,
        preferUnusedAngles: true,
        cycleId: marathonCycleId(i / 4),
        now: Date.now() + i * 20_000,
        avoidCta: i % 4 !== 0,
      });
      if (!line) continue;
      if (spoken.some((s) => isExactRepeat(s, line.speech))) exactHits++;
      spoken.push(line.speech);
      recordSpeechUsage({
        productMemory: mem,
        speech: line.speech,
        topic: line.topic,
        semanticKey: line.semanticKey,
        ctaType: line.ctaType,
        salesRule: line.salesRule as any,
        cycleId: marathonCycleId(i / 4),
        now: Date.now() + i * 20_000,
      });
      if (line.ctaType && line.ctaType !== "NONE") {
        sales.lastCTAAt = Date.now() + i * 20_000;
      }
    }
    assert.ok(spoken.length >= 30, `expected >=30 speeches, got ${spoken.length}`);
    assert.equal(exactHits, 0);
  });
});
