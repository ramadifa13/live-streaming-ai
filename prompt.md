# TASK: Upgrade `live-script-bank.ts` menjadi Production-Grade `Script Bank v2 / Marathon Host Engine`

## ROLE

Kamu adalah senior TypeScript engineer + AI conversation architect yang bertugas meng-upgrade sistem AI HOST live-commerce agar mampu menjalankan live streaming panjang secara natural, tidak terasa looping, tidak terdengar seperti AI template, mampu merotasi semua kategori dan produk, serta memiliki memory percakapan untuk sesi 1 jam sampai 24 jam.

Saya memiliki file utama:

`live-script-bank.ts`

Jangan hanya menambahkan jumlah script.

Tujuan utama adalah **mengubah arsitektur script bank menjadi Marathon Host Engine**.

---

# PRIMARY OBJECTIVE

Sistem harus mampu mendukung live:

* 1 jam
* 2 jam
* 8 jam
* 24 jam

dengan karakteristik:

1. Produk dapat berganti secara random/terkontrol.
2. Semua kategori produk dapat ikut berputar.
3. Host terdengar seperti seller manusia sungguhan.
4. Host tidak terus-menerus mengulang pola kalimat yang sama.
5. Host tidak mengulang angle/meaning yang sama terlalu dekat.
6. Host memiliki memory terhadap apa yang sudah dibicarakan.
7. CTA/sales rule tetap BOLEH diulang.
8. CTA yang diulang harus memiliki cooldown dan konteks berbeda.
9. Sistem tidak boleh mengarang fakta produk.
10. Existing functionality yang sudah bagus harus dipertahankan.
11. Jangan memecahkan API/public interface yang sudah dipakai bagian lain tanpa alasan kuat.
12. Jangan sekadar memperbesar static script bank.

---

# IMPORTANT PRINCIPLE

## JANGAN SAMAKAN CONTENT REPETITION DENGAN CTA REPETITION

Ini aturan paling penting.

### Content

Tidak boleh berulang secara dekat.

Contoh:

> "Produk ini teksturnya ringan."

lalu beberapa menit kemudian:

> "Enak dipakai karena teksturnya nggak berat."

Walaupun wording berbeda, semantic meaning sama.

Harus dianggap sebagai:

`BENEFIT_TEXTURE_LIGHT`

dan dicegah jika angle tersebut baru saja digunakan.

---

### CTA / SALES RULE

Boleh berulang.

Contoh:

> "Kak, jangan lupa cek banner bawah yaaa."

Boleh muncul berkali-kali dalam sesi 24 jam.

Tetapi:

* harus memiliki cooldown;
* harus relevan dengan kondisi live;
* jangan mengulang full sentence terlalu dekat;
* variasikan konteks/alasan sebelum CTA;
* variasikan bentuk CTA;
* jangan spam CTA tanpa alasan.

Dengan kata lain:

**CONTENT = anti-repeat ketat**

**CTA = repeatable dengan cooldown + context variation**

---

# CURRENT PROBLEM: SCRIPT BANK CAP

Saat ini terdapat:

```ts
export const SCRIPT_BANK_CAP = Number(
  process.env.LIVE_SCRIPT_BANK_CAP || 520
);
```

dan `seedLocalScriptBank()` pada akhirnya membatasi:

```ts
if (unique.length >= SCRIPT_BANK_CAP) break;
```

520 line bukan berarti 520 line yang semuanya benar-benar unik secara semantic.

Untuk live:

### 1 line / 10 detik

* 1 jam ≈ 360 line
* 2 jam ≈ 720 line
* 8 jam ≈ 2.880 line
* 24 jam ≈ 8.640 line

### 1 line / 15 detik

* 1 jam ≈ 240 line
* 2 jam ≈ 480 line
* 8 jam ≈ 1.920 line
* 24 jam ≈ 5.760 line

Jangan menyelesaikan masalah ini hanya dengan:

```ts
SCRIPT_BANK_CAP = 5000
```

atau:

```ts
SCRIPT_BANK_CAP = 10000
```

Itu bukan solusi arsitektural.

Yang dibutuhkan adalah:

**finite local bank + dynamic generation + memory + semantic rotation + recycle yang memory-aware.**

---

# EXISTING FUNCTIONALITY YANG HARUS DIPERTAHANKAN

File saat ini sudah memiliki beberapa fondasi yang bagus.

Jangan menghapus atau merusak konsep:

* `similar`
* `similarToAny`
* `sharesOpening`
* `hasRecentGreetingClass`
* `RHYTHM_SLOTS`
* `phasePreferTopics`
* local bank
* recycle mechanism
* FAQ packs
* local comment responses
* product-agnostic hooks
* CTA types:

  * `SOFT`
  * `DIRECT`
  * `PRICE`
  * `NONE`
* LLM fallback
* prinsip tidak mengarang fakta produk.

Kalau fungsi-fungsi tersebut perlu di-refactor, pertahankan behavior yang bagus dan tingkatkan implementasinya.

---

# ARCHITECTURE BARU YANG DIINGINKAN

Bangun arsitektur:

```text
                    ┌──────────────────────┐
                    │       CATALOG        │
                    │ semua produk/category│
                    └──────────┬───────────┘
                               ↓
                    ┌──────────────────────┐
                    │   PRODUCT ROTATOR    │
                    │ category + product   │
                    │ selection            │
                    └──────────┬───────────┘
                               ↓
                    ┌──────────────────────┐
                    │  MARATHON SESSION    │
                    │  / CYCLE ENGINE      │
                    └──────────┬───────────┘
                               ↓
                    ┌──────────────────────┐
                    │ TOPIC / RHYTHM       │
                    │ ENGINE               │
                    └──────────┬───────────┘
                               ↓
          ┌────────────────────┼────────────────────┐
          ↓                    ↓                    ↓
   PRODUCT FACTS        AUDIENCE STATE        SALES RULES
          ↓                    ↓                    ↓
          └────────────────────┼────────────────────┘
                               ↓
                    ┌──────────────────────┐
                    │ NATURAL SPEECH       │
                    │ GENERATOR            │
                    └──────────┬───────────┘
                               ↓
                    ┌──────────────────────┐
                    │ REPETITION GUARD     │
                    │ exact + lexical +    │
                    │ semantic             │
                    └──────────┬───────────┘
                               ↓
                         ┌────────────┐
                         │  AI HOST   │
                         └────────────┘
```

---

# 1. TAMBAHKAN HOST / CONVERSATION MEMORY

State sekarang kurang untuk marathon.

Pertahankan:

```ts
interface ScriptBankState {
  productId;
  lines;
  lastRefillAt;
  refillInFlight;
  llmRefillCount;
  lastLlmRefillAt;
  rhythmCursor;
  usedTopics;
}
```

Tetapi tambahkan memory terpisah.

Contoh:

```ts
interface HostMemoryState {
  sessionStartAt: number;
  elapsedMinutes: number;

  recentSpeeches: string[];

  recentTopics: string[];
  recentProducts: string[];
  recentCategories: string[];

  usedFacts: string[];
  usedAngles: string[];
  usedStories: string[];
  usedQuestions: string[];

  productVisitCount: Record<string, number>;
  categoryVisitCount: Record<string, number>;

  lastCTAAt: number;
  lastBannerCTAAt: number;
  lastPriceMentionAt: number;

  audienceEnergy: "low" | "normal" | "high";
  chatActivity: "dead" | "slow" | "normal" | "busy";

  currentCycle: number;
}
```

Jika struktur data yang lebih baik diperlukan, silakan refactor, tetapi capability di atas harus ada.

---

# 2. PISAHKAN 3 MEMORY LAYER

## A. Speech Memory

Tujuan:

mencegah kalimat/pola wording yang terlalu dekat.

Contoh:

```ts
recentSpeeches
```

Gunakan untuk:

* exact repeat
* lexical repeat
* opening repeat
* sentence pattern repeat.

---

## B. Semantic Memory

Tujuan:

mengetahui **apa yang sudah dibahas**, bukan hanya kalimat apa yang sudah diucapkan.

Contoh:

```ts
usedAngles
usedFacts
usedTopics
usedStories
usedQuestions
```

Contoh semantic angle:

```ts
type ContentAngle =
  | "benefit"
  | "feature"
  | "texture"
  | "usage"
  | "target_audience"
  | "problem_solution"
  | "objection"
  | "comparison"
  | "how_to_choose"
  | "common_mistake"
  | "faq"
  | "story"
  | "observation"
  | "engagement"
  | "catalog"
  | "price_context"
  | "variant"
  | "care"
  | "maintenance"
  | "scenario"
  | "discovery";
```

Jangan terpaku pada daftar ini jika struktur existing lebih baik.

Yang penting sistem dapat mengetahui:

> "Angle ini sudah dibahas terlalu sering."

---

## C. Sales Rule Memory

CTA tidak boleh dianggap sama dengan content.

Buat memory khusus:

```ts
type SalesRule =
  | "banner_reminder"
  | "check_cart"
  | "soft_cta"
  | "direct_cta"
  | "price_reminder"
  | "variant_reminder"
  | "new_viewer_welcome"
  | "checkout_reminder";
```

Sales rule boleh digunakan kembali berdasarkan cooldown dan context.

---

# 3. UBAH ANTI-REPEAT MENJADI 3 LEVEL

Saat ini ada:

```ts
similar(a, b)
```

Pertahankan sebagai salah satu layer.

Tetapi implementasikan konsep:

```ts
isExactRepeat()
isLexicalRepeat()
isSemanticRepeat()
```

## Exact

Contoh:

```text
"Produk ini teksturnya ringan."
```

vs

```text
"Produk ini teksturnya ringan."
```

BLOCK.

---

## Lexical

Contoh:

```text
"Produk ini cocok buat kulit kering."
```

vs

```text
"Produk ini pas untuk yang kulitnya kering."
```

Jika terlalu mirip:

BLOCK atau beri penalty besar.

---

## Semantic

Contoh:

```text
"Produk ini teksturnya ringan."
```

vs

```text
"Enak dipakai karena teksturnya nggak berat."
```

Walaupun lexical berbeda:

```text
semanticAngle = "texture_light"
```

Jika angle baru digunakan:

BLOCK / penalty.

---

# 4. JANGAN MENGANDALKAN `PARAPHRASE_OPENERS`

Saat ini terdapat pola seperti:

```ts
const PARAPHRASE_OPENERS = [
  "Nah, ",
  "Oke jadi ",
  "Yang penting ",
  "Intinya ",
  "Biar jelas — ",
  "Singkatnya ",
  "Sekadar sharing — ",
  "Yang sering ditanya — ",
  "Aku tekankan lagi — ",
  "Poin ini penting — ",
  "Jadi gini — ",
  "Yang perlu dicatat — ",
];
```

Jangan menjadikan ini mekanisme utama naturalness.

Masalahnya:

```text
Nah...
Oke jadi...
Yang penting...
Intinya...
Biar jelas...
Singkatnya...
Jadi gini...
```

yang berulang justru membuat host terdengar seperti AI.

Boleh tetap ada sebagai optional speech behavior, tetapi:

* frequency harus dibatasi;
* opener harus context-aware;
* jangan random opener setiap line;
* gunakan speech behavior yang lebih natural.

---

# 5. BANGUN `SPEECH BEHAVIOR ENGINE`

Host harus tidak hanya "membaca fakta".

Tambahkan kategori behavior seperti:

```ts
type SpeechBehavior =
  | "observation"
  | "reaction"
  | "thinking"
  | "transition"
  | "audience_engagement"
  | "micro_story"
  | "self_correction"
  | "comparison"
  | "question"
  | "answer"
  | "clarification"
  | "product_demo"
  | "scenario"
  | "soft_cta"
  | "direct_cta"
  | "casual_comment";
```

Contoh behavior:

### Observation

> "Aku lihat yang baru masuk lumayan banyak nih."

### Reaction

> "Oh, ternyata banyak yang nanya bagian ini."

### Thinking

> "Kalau dilihat dari kebutuhan sehari-hari..."

### Transition

> "Nah, dari situ kita masuk ke bagian berikutnya."

### Audience engagement

> "Yang biasanya cari model begini coba kasih tahu ya."

### Micro-story

> "Kalau aku jadi orang yang baru pertama lihat barang ini, yang paling aku cek dulu justru bagian ini."

### Self-correction

> "Eh, bentar, yang aku maksud yang sebelah sini ya."

### Scenario

> "Kalau dipakainya buat kondisi seperti ini, yang perlu diperhatikan..."

Speech behavior harus dipilih berdasarkan state, bukan random murni.

---

# 6. PRODUCT REFERENCE VARIATION

Jangan selalu mengatakan:

```ts
${name}
```

Host manusia tidak menyebut nama produk di setiap kalimat.

Buat context-aware reference.

Contoh:

```ts
const PRODUCT_REFERENCES = [
  "produk ini",
  "yang ini",
  "item ini",
  "barang ini",
  "yang lagi kita bahas",
  "yang ada di etalase",
  "yang tadi aku tunjukin",
  "yang satu ini",
];
```

Tetapi jangan sekadar random.

Pilih berdasarkan context.

Misalnya jika produk baru diperkenalkan:

```text
"Kalau yang ini..."
```

Jika sedang melanjutkan:

```text
"Produk ini..."
```

Jika baru selesai membandingkan:

```text
"Kalau yang tadi..."
```

Jika ada audience baru:

```text
"Buat yang baru masuk, yang lagi aku bahas ini..."
```

---

# 7. BANNER CTA HARUS MENJADI REPEATABLE SALES RULE

Saat ini `bannerLines()` terlalu sedikit.

Jangan hanya memperbanyak menjadi 100 kalimat hardcoded.

Buat sistem:

```ts
type BannerCTAContext =
  | "info"
  | "price"
  | "variant"
  | "detail"
  | "checkout"
  | "new_viewer"
  | "confused_buyer"
  | "soft_reminder"
  | "product_transition"
  | "audience_question";
```

Contoh:

```ts
BANNER_INFO
BANNER_PRICE
BANNER_VARIANT
BANNER_DETAIL
BANNER_CHECKOUT
BANNER_NEW_VIEWER
BANNER_CONFUSED_BUYER
BANNER_SOFT_REMINDER
```

Kemudian CTA engine memilih berdasarkan context.

Misalnya:

### New viewer

> "Buat yang baru masuk, detail yang lagi kita bahas ada di banner bawah ya."

### Price context

> "Kalau mau lihat harga yang sedang tampil, cek banner bawah dulu ya."

### Variant context

> "Yang mau lihat pilihan variannya, coba cek banner bawah."

### Detail context

> "Detail lengkapnya aku taruh di banner bawah biar lebih gampang dicek."

### Checkout

> "Kalau sudah cocok, sebelum checkout cek detail di banner bawah dulu ya."

Fungsi CTA boleh sama:

```text
cek banner bawah
```

tetapi konteksnya harus berbeda.

---

# 8. IMPLEMENTASIKAN CTA COOLDOWN

Contoh konfigurasi:

```ts
interface CTACooldownConfig {
  minIntervalMs: number;
  maxIntervalMs: number;
  contextCooldownMs: number;
}
```

Gunakan configurable value.

Jangan hardcode satu angka yang terlalu kaku.

Sistem harus mempertimbangkan:

* elapsed time;
* audience activity;
* chat activity;
* last CTA;
* last banner CTA;
* product transition;
* product relevance;
* current cycle.

Contoh rule:

```text
Jika CTA baru saja digunakan:
→ jangan gunakan lagi.

Jika sudah cukup lama:
→ boleh.

Jika audience sedang aktif bertanya soal produk:
→ CTA relevan boleh muncul lebih cepat.

Jika chat sedang sepi:
→ CTA boleh muncul tetapi jangan spam.

Jika baru pindah produk:
→ CTA dapat digunakan sebagai transition CTA.
```

---

# 9. MACRO CYCLE UNTUK LIVE 24 JAM

Jangan hanya:

```ts
elapsedMinutes >= 480
```

lalu menganggap semua waktu setelah 8 jam sama.

Buat macro-cycle.

Minimal:

```text
0–30m
INTRO / DISCOVERY

30–60m
PRODUCT EDUCATION

1–2h
OBJECTION / PROOF

2–4h
CATEGORY ROTATION

4–6h
DEEP PRODUCT

6–8h
RE-ENGAGEMENT

8–12h
MARATHON CYCLE

12–16h
MARATHON CYCLE

16–20h
MARATHON CYCLE

20–24h
MARATHON CYCLE
```

Tetapi jangan berhenti di phase saja.

---

# 10. TAMBAHKAN `cycleId`

Contoh:

```ts
interface MarathonCycle {
  cycleId: number;
  startMinute: number;
  endMinute: number;
  preferredTopics: string[];
  preferredBehaviors: SpeechBehavior[];
}
```

Contoh:

```text
cycle 1
cycle 2
cycle 3
cycle 4
...
```

Setiap cycle dapat membahas produk yang sama dari angle berbeda.

Misalnya Product A:

### Cycle 1

```text
basic benefit
feature
basic usage
```

### Cycle 2

```text
problem solution
target audience
common mistake
```

### Cycle 3

```text
scenario
comparison
FAQ
```

### Cycle 4

```text
story
objection
how to choose
```

### Cycle 5

```text
audience engagement
observation
variant
```

Dengan begitu kembali ke produk yang sama **tidak berarti mengulang pembahasan yang sama**.

---

# 11. PRODUCT ROTATION HARUS DIPISAH DARI SCRIPT BANK

Arsitektur yang diinginkan:

```text
CATALOG
   ↓
CATEGORY ROTATOR
   ↓
PRODUCT SELECTOR
   ↓
SCRIPT / TOPIC ENGINE
   ↓
RHYTHM ENGINE
   ↓
HOST
```

Jangan membuat `live-script-bank.ts` seolah-olah hanya bertanggung jawab memilih produk.

Jika catalog sudah ada di sistem lain, buat integration point yang jelas.

---

# 12. CATEGORY ROTATION

Sistem harus mampu melakukan:

```text
Skincare
↓
Fashion
↓
Elektronik
↓
Food
↓
Home
↓
Beauty
↓
Accessories
↓
...
```

Bukan:

```text
Skincare
Skincare
Skincare
Skincare
```

selama berjam-jam.

Gunakan:

```ts
categoryVisitCount
recentCategories
```

untuk mencegah kategori yang sama terlalu sering.

Tetapi jangan membuat randomization terlalu deterministic.

Gunakan weighted random / controlled random jika sesuai.

---

# 13. PRODUCT ROTATION

Gunakan:

```ts
productVisitCount
recentProducts
```

dan pertimbangkan:

* last product;
* category;
* product cooldown;
* current cycle;
* available product facts;
* product priority;
* audience relevance.

Contoh:

```text
Product A
→ digunakan

Product B
→ digunakan

Product C
→ digunakan

Product A
→ boleh kembali setelah cooldown
```

Ketika kembali ke Product A:

**jangan reset memory Product A.**

Sistem harus tahu:

> Product A sudah pernah dibahas.

Dan memilih angle baru.

---

# 14. PRODUCT MEMORY HARUS PERSIST

Pertimbangkan state per product:

```ts
interface ProductMemory {
  productId: string;

  visitCount: number;

  lastVisitedAt?: number;

  usedFacts: string[];
  usedAngles: string[];
  usedStories: string[];
  usedQuestions: string[];

  lastSpeechAt?: number;
}
```

Dengan ini:

```text
Product A cycle 1
```

tidak menghapus memory ketika:

```text
Product B
Product C
Product D
```

ditampilkan.

Ketika Product A kembali, engine tahu apa yang sudah pernah dibahas.

---

# 15. FACT ROTATION

Jangan hanya mengingat topic.

Ingat juga fact.

Contoh:

```ts
usedFacts = [
  "texture_light",
  "hydration",
  "size_100ml",
  "variant_blue"
];
```

Jika fact sudah digunakan terlalu sering:

* jangan ulang;
* kecuali context memang membutuhkan;
* jika diulang, gunakan mode reminder/FAQ/CTA yang berbeda.

---

# 16. ANGLE ROTATION

Buat semantic angle selection.

Contoh:

```text
benefit
↓
usage
↓
scenario
↓
audience
↓
objection
↓
comparison
↓
FAQ
↓
story
↓
engagement
↓
transition
```

Jangan:

```text
benefit
benefit
benefit
benefit
```

meskipun kalimatnya berbeda.

---

# 17. RHYTHM ENGINE HARUS DIPERTAHANKAN DAN DIPERKUAT

Existing:

```ts
RHYTHM_SLOTS
```

bagus.

Pertahankan.

Tetapi rhythm harus mengontrol **behavior**, bukan hanya topic.

Contoh:

```text
observation
→ product fact
→ reaction
→ engagement
→ value
→ soft CTA
→ transition
→ scenario
→ question
→ answer
→ product fact
```

Jangan menghasilkan pola:

```text
fact
fact
fact
CTA
fact
fact
CTA
```

karena itu terasa seperti database penjualan.

---

# 18. AUDIENCE STATE

Gunakan:

```ts
audienceEnergy
chatActivity
```

minimal:

```ts
"low"
"normal"
"high"
```

dan:

```ts
"dead"
"slow"
"normal"
"busy"
```

Behavior harus berubah.

### Chat busy

Lebih banyak:

* response
* engagement
* answer
* clarification
* audience questions.

### Chat dead

Lebih banyak:

* observation
* story
* scenario
* education
* soft engagement.

### Audience energy high

Lebih banyak:

* interaction
* direct response
* CTA contextual
* comparison.

### Audience energy low

Jangan terus-terusan hard sell.

---

# 19. FAQ HARUS DIINTEGRASIKAN DENGAN MEMORY

FAQ existing bagus.

Tetapi jangan:

```text
FAQ question
FAQ answer
FAQ question
FAQ answer
```

tanpa memperhatikan history.

Jika FAQ:

```text
"ukurannya berapa?"
```

sudah dijawab:

jangan mengulang jawaban yang sama kecuali:

* ada user baru yang benar-benar bertanya;
* context berubah;
* ada variant berbeda;
* perlu clarification.

---

# 20. COMMENT RESPONSE HARUS MENJADI INPUT ENGINE

Jika live system menerima comment/chat:

gunakan sebagai context.

Misalnya:

```text
User:
"Ini cocok buat pemula?"
```

Engine:

```text
audience question
→ answer
→ related product angle
→ optional CTA
```

Jangan:

```text
answer
→ generic script random
```

---

# 21. JANGAN MENGARANG FAKTA

Ini HARUS dipertahankan.

Jangan membuat klaim seperti:

```text
"lagi viral"
"paling laris"
"nomor satu"
"banyak banget yang beli"
"semua orang suka"
```

jika tidak ada data yang mendukung.

Contoh:

```text
"lagi viral nih"
```

harus dilarang kecuali catalog/analytics benar-benar menyediakan fact:

```ts
isViral === true
```

Hal yang sama untuk:

* bestseller;
* trending;
* discount;
* stock;
* jumlah pembeli;
* rating;
* review;
* harga;
* promo;
* voucher.

Jangan mengarang.

---

# 22. CLEAN UP PERSONA WORDING

Wording seperti:

```text
"trust me"
"Bestie"
"lagi viral nih"
"Worth banget"
"Itu angka etalase, bukan drama."
```

tidak harus dihapus semuanya, tetapi jangan dijadikan default lintas kategori.

Buat persona language yang:

* natural;
* conversational;
* fleksibel;
* tidak terlalu slang;
* tidak terlalu Gen-Z;
* tidak terlalu salesy;
* tidak terasa scripted.

Jika slang digunakan, frequency harus dikontrol.

---

# 23. NATURALNESS RULE

Host harus terasa seperti manusia yang:

* berpikir;
* melihat kondisi live;
* bereaksi;
* menjawab audience;
* berpindah topik;
* mengingat pembicaraan sebelumnya;
* sesekali mengoreksi diri;
* melakukan transisi;
* menjelaskan sesuatu dengan cara berbeda.

Bukan:

```text
DATABASE → TEMPLATE → SPEECH
```

Tetapi:

```text
STATE
+
MEMORY
+
CONTEXT
+
PRODUCT
+
AUDIENCE
+
RHYTHM
→
SPEECH
```

---

# 24. RECYCLING SYSTEM

Recycle tetap boleh.

Tetapi recycle harus:

```text
memory-aware
semantic-aware
cycle-aware
product-aware
```

Jangan recycle line hanya karena lexical similarity rendah.

Contoh:

Line lama:

> "Produk ini cocok buat kamu yang suka sesuatu yang ringan."

Line baru:

> "Kalau kamu nggak suka yang terasa berat, ini bisa jadi pilihan."

Walaupun wording berbeda:

```text
semanticAngle = target_audience + lightweight_preference
```

harus terdeteksi.

---

# 25. DYNAMIC LLM REFILL

Existing LLM fallback/refill harus dipertahankan.

Tetapi prompt ke LLM harus membawa:

```text
product facts
current cycle
current angle
recent speeches
recent topics
used facts
used angles
used stories
recent products
recent categories
audience state
chat activity
allowed CTA
CTA cooldown
```

LLM harus secara eksplisit diberitahu:

```text
DO NOT repeat recent semantic angles.
DO NOT repeat recent facts unnecessarily.
DO NOT invent product facts.
CTA may repeat only when allowed by sales-rule cooldown.
```

---

# 26. SCRIPT GENERATION HARUS MENGHASILKAN METADATA

Jika memungkinkan, jangan hanya menghasilkan:

```ts
{
  speech: string
}
```

Buat metadata internal seperti:

```ts
interface GeneratedSpeech {
  speech: string;

  topic?: string;
  angle?: string;
  behavior?: SpeechBehavior;

  productId?: string;
  categoryId?: string;

  factIds?: string[];

  ctaType?: "SOFT" | "DIRECT" | "PRICE" | "NONE";
  salesRule?: SalesRule;

  cycleId?: number;

  semanticKey?: string;
}
```

Metadata ini tidak harus dikirim ke audience.

Metadata digunakan untuk memory dan repetition guard.

---

# 27. SEMANTIC KEY

Setiap speech yang penting harus bisa memiliki semantic identity.

Contoh:

```ts
semanticKey = "benefit_texture_light"
```

atau:

```ts
semanticKey = "target_beginner"
```

atau:

```ts
semanticKey = "usage_daily_commute"
```

atau:

```ts
semanticKey = "objection_price_value"
```

Dengan demikian dua kalimat berbeda dapat dianggap sama secara semantic.

---

# 28. REPEAT SCORE

Jangan hanya boolean jika memungkinkan.

Buat scoring:

```ts
interface RepeatScore {
  exact: number;
  lexical: number;
  semantic: number;
  opening: number;
  topic: number;
  product: number;
  overall: number;
}
```

Contoh:

```text
overall > threshold
→ reject

overall medium
→ penalize

overall low
→ accept
```

Ini akan jauh lebih fleksibel daripada hanya:

```ts
similar() === true
```

---

# 29. CTA JANGAN MASUK KE CONTENT ANTI-REPEAT

Ini penting secara implementation.

Misalnya:

```ts
recentSpeeches
```

boleh tetap menyimpan CTA untuk speech memory.

Tetapi CTA harus punya jalur evaluasi sendiri.

Jangan sampai:

```text
"cek banner bawah"
```

yang memang boleh diulang

membuat engine menganggap seluruh CTA system sudah exhausted.

Gunakan:

```ts
contentRepeatGuard
```

dan:

```ts
salesRuleGuard
```

secara terpisah.

---

# 30. PRODUCT RE-ENTRY

Ketika produk lama kembali:

```text
Product A
→ Product B
→ Product C
→ Product A
```

Product A harus masuk:

```text
RE-ENTRY MODE
```

dan bukan:

```text
FIRST INTRO MODE
```

Contoh:

Pertama kali:

> "Buat yang baru lihat, ini..."

Saat kembali:

> "Tadi kita sempat bahas yang ini. Sekarang aku mau lihat dari sisi penggunaannya."

Tetapi jangan menggunakan kalimat yang sama setiap re-entry.

---

# 31. NEW VIEWER MODE

Live marathon akan terus mendapatkan audience baru.

Buat behavior:

```ts
"new_viewer"
```

Tetapi jangan mengulang intro yang sama setiap beberapa menit.

Gunakan multiple contextual introductions.

Contoh:

> "Buat yang baru masuk, sekarang kita lagi bahas yang ini."

> "Kalau kamu baru join, aku lagi ngebahas bagian penggunaannya."

> "Yang baru masuk bisa ikut dari sini ya, kita lagi lihat perbedaan variannya."

Tetapi gunakan cooldown.

---

# 32. 24-HOUR SESSION HARUS TAHAN TANPA MEMORY BLOAT

Jangan membuat:

```ts
recentSpeeches = all 8640 speeches
```

secara tidak terbatas jika tidak diperlukan.

Gunakan windowed memory.

Contoh:

```ts
recentSpeeches
```

menyimpan sejumlah speech terbaru.

Sedangkan semantic memory dapat menggunakan compact representation:

```ts
Map<string, UsageRecord>
```

Contoh:

```ts
interface UsageRecord {
  count: number;
  lastUsedAt: number;
  cycleIds: number[];
}
```

Dengan demikian memory tetap efisien.

---

# 33. MEMORY DECAY

Tidak semua hal harus diblok selamanya.

Contoh:

```text
benefit_texture_light
```

digunakan pada jam 1.

Pada jam 15 mungkin sudah boleh muncul lagi.

Tetapi bukan dalam bentuk yang sama.

Gunakan:

```ts
lastUsedAt
usageCount
cycleId
```

untuk menentukan decay.

---

# 34. SEMANTIC REPETITION TIDAK BOLEH TERLALU KAKU

Jangan sampai:

```text
"benefit"
```

dipakai sekali lalu tidak boleh lagi selama 24 jam.

Yang kita inginkan:

```text
same semantic angle too close
→ BLOCK

same angle after long enough + new context
→ ALLOW

same angle + new cycle + new scenario
→ MAY ALLOW
```

Jadi repetition guard harus kontekstual.

---

# 35. CATEGORY + PRODUCT + TOPIC DIVERSITY

Sistem harus mengoptimalkan diversity pada tiga level:

```text
Category diversity
Product diversity
Semantic angle diversity
```

Contoh buruk:

```text
Skincare
Serum A
benefit
Skincare
Serum B
benefit
Skincare
Serum C
benefit
```

Contoh lebih baik:

```text
Skincare
Serum A
usage

Fashion
Hijab B
styling

Electronics
Powerbank C
scenario

Food
Snack D
FAQ

Skincare
Serum E
objection
```

---

# 36. RANDOMIZATION JANGAN PURE RANDOM

Pure random bisa menghasilkan:

```text
A
A
A
B
A
C
A
```

Gunakan controlled random / weighted random.

Pertimbangkan penalty berdasarkan:

```ts
recentProduct
recentCategory
visitCount
lastUsedAt
currentCycle
semantic overlap
audience relevance
```

Random harus terasa natural, bukan chaos.

---

# 37. FAILURE / FALLBACK

Jika tidak ada script yang lolos repetition guard:

JANGAN:

```text
ambil random line terakhir
```

JANGAN:

```text
paksa ulang line
```

Prioritas fallback:

```text
1. cari angle lain
2. cari behavior lain
3. cari product reference lain
4. cari product/category lain
5. generate dynamic speech
6. gunakan CTA jika memang waktunya
7. gunakan neutral transition
```

Contoh neutral transition:

> "Oke, kita pindah sedikit ke bagian lain."

Tetapi jangan membuat transition yang sama berulang.

---

# 38. PERFORMANCE

Karena sistem dapat berjalan 24 jam:

Hindari:

```text
O(n²)
```

yang semakin berat ketika memory membesar.

Gunakan:

* bounded arrays;
* Maps/Sets;
* semantic keys;
* hashes/signatures jika berguna;
* indexed memory;
* cooldown timestamps.

Jangan melakukan full comparison terhadap ribuan speech jika tidak diperlukan.

---

# 39. TYPE SAFETY

Implementasi harus:

* TypeScript strict-friendly;
* tidak menambahkan `any` tanpa alasan;
* mempertahankan existing exported types;
* mempertahankan compatibility sebisa mungkin;
* menggunakan type guard jika diperlukan;
* tidak membuat hidden global mutable state tanpa alasan.

---

# 40. CONFIGURATION

Buat parameter marathon configurable melalui environment/config.

Contoh:

```ts
LIVE_SCRIPT_BANK_CAP
LIVE_RECENT_SPEECH_LIMIT
LIVE_SEMANTIC_MEMORY_LIMIT
LIVE_CTA_COOLDOWN_MS
LIVE_BANNER_CTA_COOLDOWN_MS
LIVE_PRICE_MENTION_COOLDOWN_MS
LIVE_PRODUCT_COOLDOWN_MS
LIVE_CATEGORY_COOLDOWN_MS
LIVE_MAX_CYCLE_MINUTES
```

Jangan hardcode semua angka.

Jika existing config architecture berbeda, ikuti architecture existing.

---

# 41. TESTING WAJIB

Setelah implementasi, buat atau update tests untuk minimal:

## Exact repeat

```text
same sentence
→ rejected
```

## Lexical repeat

```text
slightly paraphrased sentence
→ rejected / penalized
```

## Semantic repeat

```text
different wording
same semantic angle
→ rejected when too recent
```

## CTA repeat

```text
same CTA
before cooldown
→ rejected
```

```text
same CTA
after cooldown
→ allowed
```

## CTA context variation

```text
same sales rule
different context
→ allowed
```

## Product rotation

```text
same product
→ not selected repeatedly without cooldown
```

## Category rotation

```text
same category
→ penalized when recently used
```

## Product re-entry

```text
product returns
→ uses different angle
```

## Cycle

```text
cycle 1
→ different preferred angle than cycle 2
```

## 24-hour simulation

Simulasikan minimal:

```text
24 * 60 minutes
```

atau sejumlah speech yang realistis.

Verifikasi:

* no uncontrolled exact repeat;
* semantic repetition rate rendah;
* CTA tetap muncul;
* CTA tidak spam;
* category diversity;
* product diversity;
* memory tidak tumbuh tak terbatas;
* system tidak stuck;
* fallback tetap berjalan.

---

# 42. 24-HOUR SIMULATION

Buat test/simulation yang menghasilkan metrics seperti:

```ts
{
  totalSpeeches,
  exactRepeats,
  lexicalRepeats,
  semanticRepeats,
  ctaCount,
  blockedCTA,
  categorySwitches,
  productSwitches,
  uniqueSemanticKeys,
  uniqueProducts,
  uniqueCategories,
  maxMemorySize,
}
```

Tujuannya bukan harus zero repetition absolut.

Yang penting repetition terkendali dan natural.

---

# 43. ACCEPTANCE CRITERIA

Implementasi dianggap berhasil jika:

### 1 hour

Host sudah terasa natural dan tidak looping.

### 2 hours

Tidak terlihat pola template yang sama terus.

### 8 hours

Host masih memiliki variasi topic, product, category, behavior dan CTA.

### 24 hours

Host tetap mampu:

* memilih produk;
* memilih kategori;
* memilih angle baru;
* merespons audience;
* menggunakan CTA;
* melakukan transition;
* menghindari semantic repetition terlalu dekat;
* menggunakan memory;
* melakukan re-entry product dengan angle berbeda;
* tetap natural.

---

# 44. NATURALNESS ACCEPTANCE CRITERIA

Hindari pola seperti:

```text
Nah...
Oke jadi...
Yang penting...
Intinya...
Nah...
Oke jadi...
Yang penting...
Intinya...
```

Hindari juga:

```text
Product name
Product name
Product name
Product name
```

Hindari:

```text
fact
fact
fact
CTA
fact
fact
CTA
```

Target pattern:

```text
observation
→ explanation
→ reaction
→ engagement
→ scenario
→ transition
→ product fact
→ audience response
→ CTA
→ new angle
```

Urutannya tidak harus selalu sama.

---

# 45. IMPORTANT: JANGAN MEMBUAT SCRIPT BANK RAKSASA

Jangan menyelesaikan requirement dengan menambahkan:

```text
+5000 hardcoded lines
```

atau:

```text
+10000 templates
```

Jika menambah static script, gunakan hanya untuk memperkuat foundation.

Solusi utama harus berupa:

```text
memory
+
semantic rotation
+
behavior generation
+
cycle
+
product/category rotation
+
dynamic generation
+
repetition guard
+
CTA rules
```

---

# 46. REFACTORING STRATEGY

Sebelum coding:

1. Baca seluruh `live-script-bank.ts`.
2. Identifikasi semua exported functions/types/constants.
3. Identifikasi siapa yang memanggilnya jika repository tersedia.
4. Identifikasi dependency dan assumptions.
5. Jangan menghapus behavior existing yang masih dibutuhkan.
6. Buat perubahan incremental.
7. Pastikan TypeScript compile.
8. Jalankan existing tests.
9. Tambahkan regression tests.
10. Jika ada behavior yang ambigu, prioritaskan compatibility.

---

# 47. JANGAN DIAM-DIAM MENGUBAH BUSINESS RULE

Jangan mengubah:

* format product data;
* CTA meaning;
* pricing logic;
* catalog facts;
* availability facts;
* existing API contract;

kecuali memang diperlukan untuk architecture baru.

Jika perlu perubahan API, jelaskan secara eksplisit.

---

# 48. OUTPUT YANG SAYA INGINKAN DARI KAMU

Setelah selesai menganalisis dan mengimplementasikan:

## A. Jelaskan perubahan

Berikan:

```text
1. masalah yang ditemukan
2. architecture lama
3. architecture baru
4. file yang diubah
5. fungsi baru
6. fungsi yang direfactor
7. behavior yang dipertahankan
```

---

## B. Tampilkan code final

Saya ingin code yang benar-benar bisa digunakan.

Jangan hanya pseudo-code.

Jika file terlalu panjang untuk satu output, pecah berdasarkan file/section dengan jelas.

---

## C. Tampilkan test

Berikan test untuk:

* exact repeat;
* lexical repeat;
* semantic repeat;
* CTA cooldown;
* product rotation;
* category rotation;
* cycle;
* product re-entry;
* memory limit;
* 24h simulation.

---

## D. Jelaskan environment/config baru

Misalnya:

```text
LIVE_SCRIPT_BANK_CAP=
LIVE_RECENT_SPEECH_LIMIT=
LIVE_SEMANTIC_MEMORY_LIMIT=
LIVE_CTA_COOLDOWN_MS=
...
```

---

# 49. FINAL DESIGN PRINCIPLE

Selalu pegang prinsip ini:

```text
HOST SHOULD REMEMBER WHAT WAS SAID,
NOT JUST WHAT WAS WRITTEN.
```

Dan:

```text
CONTENT REPETITION ≠ SALES CTA REPETITION
```

Serta:

```text
NATURALNESS COMES FROM CONTEXT,
NOT FROM RANDOM PARAPHRASING.
```

Dan:

```text
24-HOUR LIVE DOES NOT NEED 10,000 STATIC SENTENCES.
IT NEEDS A MEMORY-AWARE GENERATION SYSTEM.
```

Target akhir:

```text
CATALOG
↓
CATEGORY ROTATOR
↓
PRODUCT ROTATOR
↓
MARATHON CYCLE
↓
TOPIC + RHYTHM
↓
PRODUCT FACTS
+
AUDIENCE STATE
+
CONVERSATION MEMORY
+
SALES RULES
↓
NATURAL SPEECH GENERATOR
↓
EXACT GUARD
↓
LEXICAL GUARD
↓
SEMANTIC GUARD
↓
CTA COOLDOWN GUARD
↓
AI HOST
```

## DO NOT JUST ADD MORE SCRIPTS.

## UPGRADE THE ENGINE.

DAN CHECK APAKAH SCRIPT INI SUDAH HANDLE JIKA NANTI PAS LIVE USER MAU PAKAI LEBIH DARI 1 PRODUK WALAUPUN NANTINYA YANG IMPLEMENTASINYA TETAP MEMASARKAN PRODUK YANG TAMPIL SEBAGAI BANNER , TAPI HARUS DI ANTISIPASI JUGA KETIKA MISAL USER ADA BAWA 3 PRODUK PADA WAKTU LIVE . NANTI USER BISA PILIH GANTI PRODUK JANGAN SAMPEE KETIKA DARI AWALNYA ITU PRODUK SUDAH DI 1 PINDAH KE PRODUK 2 > PINDAH KE PRODUK 3 TERUS BALIK KE PRODUK 1 DIA MALAH NGULANG PERCAKAPAN YANG UDAH DI UCAPIN DI AWAL PAS PRODUCT 1 NYA ITU UDAH MUNCUL DI PERTAMA KALI 