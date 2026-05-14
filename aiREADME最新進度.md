# 📋 最新進度（v20260614）

> 本檔記錄**當前版本進行中的項目、待處理事項、已知問題**。
> 已完成項目請見 `aiREADME已完成紀錄.md`。
> 規範與架構說明請見 `aiREADME.md`。

最後更新：2026-05-15

---

## 🚨 已知問題（優先處理）

（目前無）

---

## ⏳ 進行中／待處理

### POS 折扣機制清理（低優先，不影響使用）
- `js/modules/cart-service.js` 內的 `getDiscountResult` / `handleDiscountInput` / `getDiscountType` / `setDiscountType` 是舊版折扣機制殘留，依賴 `#discountValue` input，但該欄位已從 index.html 移除。
- 目前折扣已改為「負金額品項」存進 cart（`discountAmountBtn` / `discountPercentBtn` 直接 push 到 `state.cart`），實測折扣 $10、折扣 5% 都正常運作。
- 待辦：把 cart-service.js 內這四個 function 直接移除，避免未來誤用。pos-page.js、orders-page.js 若仍有 import 也一併清掉。

### 2234 同步（使用者自行處理）
- 本次 2237-1 的修改（模組子選項停售、addOrderToCart TypeError、成本管理模組、看板異常單欄位修正、分類「全部」改到最後）由使用者自行手動複製到 2234。
- 看板修改（最後更新文字 + abnormal→voided 對齊）由使用者自行複製到 pos-dashboard repo（已完成）。

---

## 🧪 待實機驗證項目（v20260613）

- [ ] `dashboard-publish.js` 用 BD 切今日後，跨日時段（02:00）儀表板顯示是否正確
- [ ] 結束值班 Modal 的「熊貓 Grod / Uber」即時加總顯示
- [ ] 班次摘要 Modal 的「🛵 外送」卡片與「外送明細」區塊
- [ ] `sessionHistory` 新 key（BD）寫入 Firebase 後，看板讀取是否相容
- [ ] 訂單頁「加到購物車」按鈕：載入 → 結帳 → 產生新單 → 原訂單不變（TypeError 已於 2026-05-15 修復）
- [ ] 雲端 90 天清理（需等實際資料累積超過 90 天才能驗證）

---

## ❌ 本次明確不做（使用者已說明）

- Firebase Storage 圖片遷移方案：**整個作廢**，原因是 Firebase Storage 要收費。改用既有的 GitHub Pages 圖庫 + SKU 對應表機制（index.html 內已有「SKU 圖庫對應」Modal、`imageLibraryBaseUrl`、`imageLibraryImportBtn`；store.js 已有 `state.settings.imageLibrary.skuMap`）。
- 設定頁營業時間 24 小時制（使用者已在系統設定處理）
- 預設營業時間改為 14:00–03:00（不改 `DEFAULT_BUSINESS_HOURS`，避免影響既有店）

---

## 📐 v20260613 關鍵設計決策（給未來 AI 參考）

- **營業日定義**：跨日營業（14:00–03:00）視為同一 BD；預約單依 `reservationAt` 歸屬，其他依 `createdAt`
- **異常**：`status = void / cancelled / refunded`，獨立顯示，不計入營業額
- **外送平台**：熊貓 Grod（台灣熊貓被併購交接中暫用此名）+ Uber
- **訂單修改流程**：加到購物車 → 結帳產生新單 → 另外作廢原單
- **資料保存**：本地與雲端 `sessionHistory` 都保留 90 自然日
- **歷史報表**：顯示最近 60 個營業日，自動跳過公休日
- **折扣機制**：採「負金額品項」存進 cart，不再使用獨立 input 欄位

---

## 📐 v20260614 圖片方案決策

- **不採用 Firebase Storage**：要收費，不適合多店長期使用
- **採用 GitHub Pages + SKU 對應表**：圖片放在 `jess0937588151-hue/2234/images/products/`，由 `gallery.html` 工具產生 SKU → URL 對應表，匯入到 POS `state.settings.imageLibrary.skuMap`，商品依 SKU 自動套圖
- **優點**：免費、CDN 快、image 欄位只存 URL（不含 base64），localStorage 不會爆

---

## 📐 v20260614 欄位命名規約（給未來 AI 參考）

- **POS 端 `dashboard-publish.js` 寫入 Firebase `dashboards/{storeId}/today` 的異常欄位名稱固定為 `voided`**（不是 `abnormal`）。
- 看板端 `pos-dashboard/index.html` 讀的也是 `today.voided`。
- 兩邊必須一致，2026-05-12~13 曾因 POS 端把 `voided` 改名為 `abnormal` 但看板沒同步，導致異常單金額永遠顯示 0。2026-05-15 已還原。
- **規則**：未來修改任何 Firebase 寫入欄位名稱前，必須先 grep 看板 repo 是否有對應讀取程式碼。

---

## 🔁 接手 SOP

每次新 AI 接手時：
1. 讀完 `aiREADME.md`（主檔，規範與架構）
2. 讀完本檔（最新進度、待辦、已知問題）
3. 需要查歷史時讀 `aiREADME已完成紀錄.md`
4. 完成任何項目後：
   - 把該項目從本檔「進行中／待處理」**移除**
   - 在 `aiREADME已完成紀錄.md` 最上方對應版本下**新增**該項目的詳細紀錄
   - 若是修 bug，把「已知問題」對應項移除
5. Commit 順序：先給程式碼 commit，全部完成後**最後一個 commit** 才動本檔與已完成紀錄檔
