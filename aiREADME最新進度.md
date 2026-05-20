# 📋 最新進度（v20260615）

> 本檔記錄**當前版本進行中的項目、待處理事項、已知問題**。
> 已完成項目請見 `aiREADME已完成紀錄.md`。
> 規範與架構說明請見 `aiREADME.md`。

最後更新：2026-05-20

---

## 🚨 已知問題（優先處理）

（目前無）

---

## ⏳ 進行中／待處理

### 預約 30 分鐘前提醒 — 真實列印驗證
- Modal 已可正常彈出（2026-05-20 實機測試通過，截圖確認）。
- 尚未實機驗證「按下『開始備餐並列印廚房單』後，會真的列印廚房單與顧客單，且該訂單 `reservationReminded = true` 不會再次提醒」。
- 待使用者在下次有預約單時實機按下按鈕驗證。

### 把本次修改複製到公開版 repo（JESS0937588151）
- 本次 session 在 `lcym346-byte/2237-1` 完成的所有修改，需複製到公開版分店 repo。
- 複製檢查清單（每店只需調整三處）：
  1. Firebase 設定（若共用同一個 Firebase 專案則不需改）
  2. `storeId`（每店唯一，例如 `JESS001`）— 在「設定 → 看板 / 即時接單」頁設定
  3. QR Code URL 的 `?storeId=` 參數需與店家 storeId 一致
- 唯一 `storeId` 確保 `publicOnlineStores/{storeId}/promotions`、`onlineOrders/{storeId}/…` 雲端路徑彼此隔離。

### POS 折扣機制清理（低優先，不影響使用）
- `js/modules/cart-service.js` 內的 `getDiscountResult` / `handleDiscountInput` / `getDiscountType` / `setDiscountType` 是舊版折扣機制殘留，依賴 `#discountValue` input，但該欄位已從 index.html 移除。
- 目前折扣已改為「負金額品項」存進 cart（`discountAmountBtn` / `discountPercentBtn` 直接 push 到 `state.cart`），實測折扣 $10、折扣 5% 都正常運作。
- 待辦：把 cart-service.js 內這四個 function 直接移除，避免未來誤用。pos-page.js、orders-page.js 若仍有 import 也一併清掉。

### 2234 同步（使用者自行處理）
- 本次 v20260615 的修改（促銷管理 tile、優惠碼帶入訂單、訂單卡折扣明細、預約 30 分鐘提醒 Modal、SKU 圖庫反推工具）需由使用者自行手動複製到 2234 公開範本。

---

## 🧪 待實機驗證項目

- [ ] 預約 30 分鐘提醒 Modal 按下「開始備餐」後實際列印廚房單與顧客單
- [ ] `dashboard-publish.js` 用 BD 切今日後，跨日時段（02:00）儀表板顯示是否正確（v20260613 沿襲）
- [ ] `sessionHistory` 新 key（BD）寫入 Firebase 後，看板讀取是否相容（v20260613 沿襲）
- [ ] 雲端 90 天清理（需等實際資料累積超過 90 天才能驗證）

---

## ❌ 本次明確不做（使用者已說明）

- Firebase Storage 圖片遷移方案：**整個作廢**，原因是 Firebase Storage 要收費。改用既有的 GitHub Pages 圖庫 + SKU 對應表機制（index.html 內已有「SKU 圖庫對應」Modal、`imageLibraryBaseUrl`、`imageLibraryImportBtn`；store.js 已有 `state.settings.imageLibrary.skuMap`）。
- 列印單據顯示折扣明細：使用者表示目前訂單卡顯示折扣明細已足夠，列印單據暫不修改 `print-service.js`。
- 設定頁營業時間 24 小時制（使用者已在系統設定處理）
- 預設營業時間改為 14:00–03:00（不改 `DEFAULT_BUSINESS_HOURS`，避免影響既有店）

---

## 📐 v20260615 關鍵設計決策（給未來 AI 參考）

- **促銷管理入口**：放在設定頁 tile（`data-promo-open="1"`），不放在 POS 主畫面浮動按鈕。原本浮動按鈕 `#promoOpenSettingsBtn` 仍保留在 DOM 但隱藏，由 tile 點擊事件 dispatch click 觸發 `mountPromotionSettingsUI()`，避免動到 `promotion-ui.js` 內部邏輯。
- **優惠碼資料流**：手機端 `online-order-page.js` 在 submit 時呼叫 `getCurrentPromotionResult()` 取得 `{code, discount, message}`，組進訂單 payload 的 `couponCode` / `discount` / `couponMessage` / `total`（總金額已扣折扣）。POS 端 `realtime-order-service.js` 的 `buildRealtimeOrderForPOS()` 讀這三個欄位並轉成 POS 訂單的 `discountAmount` / `couponCode` / `couponMessage`。
- **訂單卡折扣顯示**：`orders-page.js` 的 `renderOrdersSection()` 與 `renderIncomingOnlineOrders()` 在 `discountAmount > 0` 時，於金額區塊上方顯示劃掉的小計、紅字折扣後金額，並加一行綠底「🎁 優惠折扣（CODE）<message> -NN」明細。
- **SKU 圖庫設計**：圖片放在 `jess0937588151-hue/2234/images/products/`（檔名不規律，例：`48.jpg / 391.jpg`），由 `gallery.html` 工具產生對應表，或從現有 `state.products[].image` 反推（取檔名 part）寫回 `state.settings.imageLibrary.skuMap`。匯出 JSON 後可在新店或新機器上「匯入並合併」還原。**未來建議**：新增商品時圖片檔名直接用 SKU 命名（例：`A058.jpg`），可省略對應表維護。

---

## 📐 v20260615 欄位命名規約（給未來 AI 參考）

- **線上訂單優惠碼欄位**（手機端 → 雲端 → POS 端讀）：
  - `couponCode`：優惠碼字串（大寫）
  - `discount`：折扣金額（正整數，0 代表沒折扣）
  - `couponMessage`：優惠碼描述文字（可空）
- **POS 訂單折扣欄位**（POS 內部使用）：
  - `discountAmount`：折扣金額（含線上優惠碼、POS 端手動折扣）
  - `discountValue`：同 discountAmount（向下相容）
  - `discountType`：'amount'（金額）/ 'percent'（百分比），預設 'amount'
  - `couponCode`、`couponMessage`：保留線上優惠碼資訊用於顯示
- 修改任何優惠碼相關欄位名稱前，必須 grep `online-order-page.js`、`realtime-order-service.js`、`orders-page.js` 三處。

---

## 📐 沿襲設計決策（v20260613 / v20260614）

- **營業日定義**：跨日營業（14:00–03:00）視為同一 BD；預約單依 `reservationAt` 歸屬，其他依 `createdAt`
- **異常**：`status = void / cancelled / refunded`，獨立顯示，不計入營業額
- **外送平台**：熊貓 Grod（台灣熊貓被併購交接中暫用此名）+ Uber
- **訂單修改流程**：加到購物車 → 結帳產生新單 → 另外作廢原單
- **資料保存**：本地與雲端 `sessionHistory` 都保留 90 自然日
- **歷史報表**：顯示最近 60 個營業日，自動跳過公休日
- **折扣機制**：採「負金額品項」存進 cart（POS 端手動折扣），線上優惠碼則走 `discount` 欄位
- **圖片方案**：不用 Firebase Storage，改用 GitHub Pages 圖庫 + SKU 對應表
- **儀表板異常欄位**：固定為 `voided`（不是 `abnormal`），POS 與看板兩邊必須一致

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
