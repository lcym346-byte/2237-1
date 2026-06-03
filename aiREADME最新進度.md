# 📋 最新進度（v20260616）

> 本檔記錄**當前版本進行中的項目、待處理事項、已知問題**。
> 已完成項目請見 `aiREADME已完成紀錄.md`。
> 規範與架構說明請見 `aiREADME.md`。
## 會員點數模組 (v20260603-points) — ✅ 已完成（詳見 aiREADME已完成紀錄.md）

### 規則（使用者已定案，為後續開發依據）
- 賺點：僅線上單，且「店家確認 + 結帳完成(completed)」兩條件成立才入帳。
  賺點金額 = 該單優惠碼折扣 order.discountAmount。
  優惠碼不再折現金，total = 小計不變，顧客照小計付，折扣全轉點數。
- 折抵：1點=1元，僅線上點餐頁可用。店家「接單(confirmed)」當下由 POS 端預扣，
  以 min(顧客宣告 pointsRequested, 當下真實餘額) 為上限，杜絕超折。
- 退點：已接單未結帳(pending)的單被作廢/取消 → 退回該單 pointsUsed；
  已結帳完成(completed)作廢 → 不退（規則四）。
- 儲存：Firebase points/{storeCode}/{phone}/balance 與 /history/{pushId}，各店獨立。
  寫入只能 POS（已登入 staff/admin）；顧客匿名端只能讀 balance 顯示。
- 歷史：每筆異動記 at / type(earn|use|refund) / delta / balanceAfter / orderNo。

### 全部完成項目（已進 repo + Firebase 規則已發布）
- customer-service.js：點數核心六函式（getPointsBalance / _writePointsTxn /
  deductPointsOnConfirm / refundPointsOnCancel / earnPointsOnComplete / getPointsHistory）。
- realtime-order-service.js：彈窗接單(showOnlineOrderOverlay) 已接 deductPointsOnConfirm 預扣。
- order-service.js：第 2 行已改 import { state, persistAll }；markPendingOrderPaid
  已接 earnPointsOnComplete 賺點掛鉤（persistAll 已可正常呼叫）。
- orders-page.js：列表接單 accept-btn 已接 deductPointsOnConfirm（與彈窗一致，防超折）；
  voidOrder callback 已改 async 並接 refundPointsOnCancel（pending 作廢退點、completed 不退）。
- index.html：原 Google 備份區(modalGoogle)改為「🎯 會員點數查詢」區，
  含 pointsQueryPhone / pointsQueryBtn / pointsQueryBalanceBox / pointsQueryHistoryBox。
- settings-page.js：點數查詢邏輯（getQueryStoreCode / openPhonePad / runPointsQuery /
  bindPointsQueryEvents），電話用自製字串鍵盤保留開頭 0，紀錄欄位用 at/delta。
- Firebase 規則：已新增 points/{storeCode}/{phone} 節點（.read=true 顧客匿名只讀，
  .write 限 admin 或 stores/{storeCode}===true 的員工），已於 Console 發布。

### 待驗證（實機）
- [ ] 線上單帶優惠碼 → 接單預扣 → 結帳完成賺點 → 設定頁查詢顯示餘額與紀錄，全鏈路實機跑一次。
- [ ] 接單預扣後作廢(pending)→ 點數退回；已結帳(completed)作廢 → 不退。

## 最新進度 (v20260603) — last updated 2026-06-03

### 本次已完成並驗證（詳見 aiREADME已完成紀錄.md v20260603）
- 結帳不自動印廚房單／跳 PDF：已修復並實機驗證直印恢復。
  - print-bridge.js：ping timeout 1500→3500ms、timeout 時重試一次。
  - customer-display-service.js：客顯改「變動立即推、閒置每 10 秒推」，避免干擾列印。

### 待處理 / 待驗證
- （可緩做、低風險）若日後仍偶發跳 PDF，再做補強：把客顯 displayPaid 推送
  改由 finalizeOrder 在「列印送出之後」呼叫，而非在 createOrUpdateOrder 內最早觸發。
  涉及 order-service.js（移除其中的 displayPaid 呼叫）+ pos-page.js（列印後再呼叫），
  須兩檔同批上線，否則 paid 推送會暫時消失。目前直印已穩，暫不動。
- 沿用前述既有待辦（Store002 上線、POS 折扣清理等），不變。

### 提醒
- 若 service-worker.js 有 pre-cache print-bridge.js / customer-display-service.js，
  本次改動後須提升 CACHE_NAME 並更新 pre-cache（守則 8、14），否則 T2 Chrome 吃到舊檔。


---

## 🚨 已知問題（優先處理）


 架構重點提醒
列印橋接（不可破壞）： Web POS → print-bridge.js → POST 127.0.0.1:8080 → APK PrintHttpServer。客顯走 8081，兩者完全獨立互不干擾。

Token 驗證： APK 的 ApiToken（UUID）由 print-bridge.js 的 detectPrinters() 從 /ping 取得後存入 state。客顯 GET /display/state 與 GET /display/ 無需 Token（讓 iPad 直接存取），只有 POST /display/update 需要 Token。

狀態三層持久化： IndexedDB（主）+ localStorage（快取）+ Firebase（10 秒節流雲端備份）。persistAll() 同時寫三層。
---

## ⏳ 進行中／待處理

### 預約 30 分鐘前提醒 — 真實列印驗證
- Modal 已可正常彈出（2026-05-20 實機測試通過，截圖確認）。
- 尚未實機驗證「按下『開始備餐並列印廚房單』後，會真的列印廚房單與顧客單，且該訂單 `reservationReminded = true` 不會再次提醒」。
- 待使用者在下次有預約單時實機按下按鈕驗證。

### 廚房單字級獨立設定（低優先，已用 APK 調整解決）
- 目前 `print-service.js` 廚房單與顧客單共用 `receiptFontSize`，沒有 `kitchenFontSize` 獨立欄位。
- 使用者已於 Sunmi APK 設定頁直接調整字級，暫不需處理。
- 若未來要做：需同時動 POS 前端（`getPrintSettings` 加欄位、設定頁 UI、`buildBridgePayload` 加 `fontSize` 欄位）+ Sunmi APK 端（讀取 `payload.fontSize`）。

### 把本次修改複製到 2234 公開版 repo（使用者自行處理）
- 本次 v20260615 + v20260616 在 `lcym346-byte/2237-1` 完成的所有修改，需複製到 `jess0937588151-hue/2234`。
- 複製檢查清單（每店只需調整三處，務必遵守規範第 18 條）：
  1. Firebase 設定（共用同一個 Firebase 專案不需改）
  2. `js/core/store-config.js` 的 `storeId` / `storeName` / `storeCode`（每店唯一，**絕對不可遺漏，否則資料會互相覆蓋**）
  3. QR Code URL 的 `?storeId=` 參數需與店家 storeId 一致

### POS 折扣機制清理（低優先，不影響使用）
- `js/modules/cart-service.js` 內的 `getDiscountResult` / `handleDiscountInput` / `getDiscountType` / `setDiscountType` 是舊版折扣機制殘留，依賴 `#discountValue` input，但該欄位已從 index.html 移除。
- 目前折扣已改為「負金額品項」存進 cart（`discountAmountBtn` / `discountPercentBtn` 直接 push 到 `state.cart`），實測折扣 $10、折扣 5% 都正常運作。
- 待辦：把 cart-service.js 內這四個 function 直接移除，避免未來誤用。pos-page.js、orders-page.js 若仍有 import 也一併清掉。
## 待處理
- store002 開站：待 store001 營業時間機制穩定運作後進行。
  複製 2237-1 整個 repo 到 store002 的新帳號新 repo，只改 js/core/store-config.js
  的 storeId/storeName/storeCode 為 store002；開 GitHub Pages；
  在 Firebase staff/{該帳號uid}/stores/store002 設 true（或 admin）；
  store002 POS 設定一次自己的營業時間並上傳，確認 Firebase 出現 storeHours/store002。

---

## 🧪 待實機驗證項目

- [ ] 預約 30 分鐘提醒 Modal 按下「開始備餐」後實際列印廚房單與顧客單
- [ ] `dashboard-publish.js` 用 BD 切今日後，跨日時段（02:00）儀表板顯示是否正確（v20260613 沿襲）
- [ ] `sessionHistory` 新 key（BD）寫入 Firebase 後，看板讀取是否相容（v20260613 沿襲）
- [ ] 雲端 90 天清理（需等實際資料累積超過 90 天才能驗證）

---

## ❌ 本次明確不做（使用者已說明）

- Firebase Storage 圖片遷移方案：**整個作廢**，原因是 Firebase Storage 要收費。改用既有的 GitHub Pages 圖庫 + SKU 對應表機制。
- 列印單據顯示折扣明細：使用者表示目前訂單卡顯示折扣明細已足夠，列印單據暫不修改 `print-service.js`。
- 設定頁營業時間 24 小時制（使用者已在系統設定處理）
- 預設營業時間改為 14:00–03:00（不改 `DEFAULT_BUSINESS_HOURS`，避免影響既有店）
- 廚房單獨立字級欄位：使用者已用 Sunmi APK 解決，不再動 POS 前端。

---

## 📐 v20260616 關鍵設計決策（給未來 AI 參考）

- **圖庫工具按鈕**：放在「SKU 圖庫對應」Modal 內、`#imageLibraryBaseUrl` 輸入框正下方，使用 `.sm-btn-row` 包裹，按下 `window.open('.../gallery.html','_blank','noopener')` 在新分頁開啟外部工具。**不**改 `imageLibrary` 內部邏輯。
- **多店部署疏失防護**：複製範本到新店時，`js/core/store-config.js` 的 `storeId` / `storeName` / `storeCode` 是**唯一必改檔案**，已寫入規範第 18 條。任何 AI 接手「複製到新店」任務時，第一動作就是檢查這三個欄位。
- **線上點餐標題 fallback chain**：`state.settings.realtimeOrder.onlineStoreTitle`（線上點餐專屬）→ `state.settings.printConfig.storeName`（出單店名）→ `'立即點餐'`。若使用者反映「改不到」，先確認當前實際讀的是哪一層。

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
