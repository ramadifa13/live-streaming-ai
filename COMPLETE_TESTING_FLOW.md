# 🔍 Complete Testing Guide - Find & Fix Banner/Product Issue

**Status:** Backend running on `:4000` ✅ Frontend running on `:3000` ✅

---

## 📋 TEST PLAN

Follow these steps EXACTLY to identify where banner/product data is lost:

### STEP 1: Upload Product with Banner & Image (Frontend)

**In Browser:** http://localhost:3000

1. Click **"Add Product"** button
2. Fill form:
   - **Product Name:** `TEST_BANNER_PRODUCT`
   - **Price:** `99.99`
   - **Product Image:** Upload any PNG/JPG (required)
   - **Banner Image:** Upload any PNG/JPG (IMPORTANT - test banner specifically)
3. Click **"Save Product"**

**Expected:** Product shows in list with both images visible

---

### STEP 2: Verify Product in Zustand Store (Frontend)

**In Browser F12 Console:**

```javascript
// Check what's in the Zustand store:
// (Paste this in F12 Console and press Enter)

import { useProductStore } from "@/stores/useProductStore";
const store = useProductStore.getState();
console.log("=== ZUSTAND STORE ===");
console.log("activeFeaturedProduct:", store.activeFeaturedProduct);
console.log("Has bannerImage:", !!store.activeFeaturedProduct.bannerImage);
console.log("Banner length:", store.activeFeaturedProduct.bannerImage?.length || 0);
console.log("Has image:", !!store.activeFeaturedProduct.image);
console.log("Image length:", store.activeFeaturedProduct.image?.length || 0);
```

**Expected Output:**

```
=== ZUSTAND STORE ===
activeFeaturedProduct: { name: 'TEST_BANNER_PRODUCT', price: '99.99', bannerImage: 'data:image/...', image: 'data:image/...', ... }
Has bannerImage: true
Banner length: 12345+
Has image: true
Image length: 54321+
```

✅ **If both fields are PRESENT → Continue to STEP 3**
❌ **If bannerImage MISSING → Issue is in FRONTEND (product upload)**

---

### STEP 3: Check Network Request (Frontend → Backend)

**In Browser F12:**

1. Go to **Network** tab
2. Click **"Start Live Session"** button
3. Find request: `POST /api/live-session/start` (or look for any POST starting with `/api`)
4. Click on it
5. Go to **"Request"** tab or **"Payload"** tab

**Look for:**

```
{
  "product": {
    "name": "TEST_BANNER_PRODUCT",
    "price": "99.99",
    "image": "data:image/png;base64,iVBORw0KGgo...",
    "bannerImage": "data:image/png;base64,iVBORw0KGgo...",
    ...
  },
  "productId": "...",
  "avatarId": "...",
  ...
}
```

✅ **If both `image` and `bannerImage` fields VISIBLE → Continue to STEP 4**
❌ **If `bannerImage` MISSING → Issue is in FRONTEND (toLiveProductSnapshot)**

---

### STEP 4: Check Backend Logs (Backend Terminal)

**In Terminal 1 (Backend):**

Look for logs starting with `[DEBUG-BANNER`:

```
[DEBUG-BANNER-FE] ========== LIVE SESSION START REQUEST ==========
[DEBUG-BANNER-FE] Request body received: {
  productName: 'TEST_BANNER_PRODUCT',
  hasBannerImage: true,       ← MUST BE TRUE
  bannerLength: 12345,         ← MUST BE > 0
  hasProductImage: true,
  productImageLength: 54321
}

[DEBUG-BANNER-PROCESS] After normalizeClientProduct: {
  productName: 'TEST_BANNER_PRODUCT',
  hasBannerImage: true,        ← MUST BE TRUE
  bannerLength: 12345,         ← MUST BE > 0
  hasProductImage: true,
  productImageLength: 54321,
  productObject: [...]
}
```

✅ **If both show TRUE and length > 0 → Continue to STEP 5**
❌ **If hasBannerImage is FALSE or length 0 → Backend is LOSING data**

---

### STEP 5: Check Browser Network Response

**In Browser F12:**

Still looking at POST `/api/live-session/start` request:

1. Go to **"Response"** tab
2. Should see:

```json
{
  "success": true,
  "data": {
    "id": "abc-123-def",
    "status": "started",
    ...
  }
}
```

✅ **Status 200 OK → Backend started session successfully**
❌ **Status 500 → Backend error (check server terminal)**
❌ **Status 400 → Validation error (check response body)**

---

### STEP 6: Check Live Host Orchestrator Logs

**In Terminal 1 (Backend):**

Wait 2-3 seconds, then look for logs with `[DEBUG-BANNER-LIVEHOST]` and `[DEBUG-BANNER-RESOLVED]`:

```
[DEBUG-BANNER-LIVEHOST] Product data before resolveMediaAsDataUrl: {
  productName: 'TEST_BANNER_PRODUCT',
  hasProductImage: true,
  productImageLength: 54321,
  hasBannerImage: true,         ← MUST BE TRUE
  bannerImageLength: 12345      ← MUST BE > 0
}

[DEBUG-BANNER-RESOLVED] After resolveMediaAsDataUrl: {
  productImageUrl: '[data: data:image/png;base64,iVBORw0K...]',
  bannerImageUrl: '[data: data:image/png;base64,iVBORw0K...]'  ← MUST NOT BE 'null/undefined'
}
```

✅ **If both TRUE and not 'null/undefined' → Backend sending to AI Worker correctly**
❌ **If bannerImageUrl is 'null/undefined' → Issue in resolveMediaAsDataUrl()**

---

## 🎯 DECISION TREE

```
Run STEP 1-2 (Product Upload)
  ↓
Check STEP 3 (Network Request)
  ├─ bannerImage MISSING → STOP: Frontend issue
  │  └─ Check: liveSessionService.ts toLiveProductSnapshot()
  │  └─ Fix: Make sure includeMedia: true is passed
  │
  └─ bannerImage PRESENT → Continue STEP 4
      ↓
      Check STEP 4 (Backend Receives)
      ├─ Backend logs show hasBannerImage FALSE → STOP: Data Loss in Parsing
      │  └─ Check: productSnapshotSchema in live-session.ts
      │  └─ Fix: Schema might be wrong
      │
      └─ Backend logs show hasBannerImage TRUE → Continue STEP 6
          ↓
          Check STEP 6 (LiveHost Processing)
          ├─ bannerImageUrl shows NULL/UNDEFINED → STOP: resolveMediaAsDataUrl() broken
          │  └─ Check: backend/src/services/runpod-bridge.ts line 91
          │  └─ Fix: resolveMediaAsDataUrl function
          │
          └─ bannerImageUrl shows DATA URL → GOOD!
              └─ Problem is in AI Worker (not local backend)
              └─ SSH to pod and check overlay_generator.py
```

---

## 🧪 QUICK TEST COMMANDS

### Check Zustand Store (F12 Console):

```javascript
import { useProductStore } from "@/stores/useProductStore";
const { activeFeaturedProduct } = useProductStore.getState();
console.log("Product:", activeFeaturedProduct.name);
console.log("Has banner:", !!activeFeaturedProduct.bannerImage);
console.log("Banner size:", activeFeaturedProduct.bannerImage?.length);
```

### Check Backend Logs in Real-time:

```bash
# In Terminal 1, look for lines starting with:
# [DEBUG-BANNER-FE]
# [DEBUG-BANNER-PROCESS]
# [DEBUG-BANNER-LIVEHOST]
# [DEBUG-BANNER-RESOLVED]
```

### Check If Backend Received Banner:

```bash
# Grep backend output (Terminal 1):
# Should show "hasBannerImage: true"
```

---

## 📊 EXPECTED OUTPUTS (Copy for Reference)

### ✅ If Everything Works:

**Frontend Console:**

```
Product: TEST_BANNER_PRODUCT
Has banner: true
Banner size: 12345
```

**Network Request (POST body):**

```json
{
  "product": {
    "name": "TEST_BANNER_PRODUCT",
    "price": "99.99",
    "image": "data:image/png;base64,iVBORw0...",
    "bannerImage": "data:image/png;base64,iVBORw0...",
    ...
  }
}
```

**Backend Terminal:**

```
[DEBUG-BANNER-FE] Request body received: {
  productName: 'TEST_BANNER_PRODUCT',
  hasBannerImage: true,
  bannerLength: 12345,
  ...
}

[DEBUG-BANNER-PROCESS] After normalizeClientProduct: {
  productName: 'TEST_BANNER_PRODUCT',
  hasBannerImage: true,
  ...
}

[DEBUG-BANNER-LIVEHOST] Product data before resolveMediaAsDataUrl: {
  hasBannerImage: true,
  bannerImageLength: 12345,
  ...
}

[DEBUG-BANNER-RESOLVED] After resolveMediaAsDataUrl: {
  bannerImageUrl: '[data: data:image/png;base64,iVBORw0...]'
}
```

---

### ❌ If Banner is LOST:

Show me the output of STEPS 3, 4, 6 and I can pinpoint the exact problem!

---

## 🚀 NOW RUN THE TEST!

1. ✅ Backend at http://localhost:4000
2. ✅ Frontend at http://localhost:3000
3. **Do STEP 1-2:** Upload product with banner
4. **Do STEP 3:** Check network request
5. **Do STEP 4:** Check backend logs
6. **Do STEP 6:** Check livehost logs
7. **Report:** Which step fails?

---

## 💬 Report Format

When sharing findings, provide:

```
STEP X: [PASS/FAIL]

Frontend Zustand:
[Copy output from console.log]

Network Request:
[Copy product object from F12 Network]

Backend Logs:
[Copy [DEBUG-BANNER-*] logs from Terminal 1]

Expected vs Actual:
- Expected: bannerImage present
- Actual: [What you see]

Next Step:
[What to check next based on decision tree]
```

---

**Ready? Start STEP 1 now!** 🎬

Browser already open at http://localhost:3000 ✅
