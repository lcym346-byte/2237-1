# 📋 最新進度（v20260613）

> 本檔記錄**當前版本進行中的項目、待處理事項、已知問題**。
> 已完成項目請見 `aiREADME已完成紀錄.md`。
> 規範與架構說明請見 `aiREADME.md`。

最後更新：2026-05-14

---

## 🚨 已知問題（優先處理）

### 1. 顧客點餐頁空白：localStorage 配額爆掉（最高優先）

**現象**：開啟 `online-order.html?storeId=xxx` 後畫面只剩購物車按鈕與「我的訂單」按鈕，沒有商品列表也沒有分類。Console 紅字：
persistAll failed: DOMException: Failed to execute 'setItem' on 'Storage': Setting the value of 'restaurantPosState_v2' exceeded the quota. at persistAll (store.js:343) at applyCloudMenu (realtime-order-service.js:840:3) at handler (realtime-order-service.js:785:7)

Copy
**原因**：商品圖片以 base64 內嵌存在 `state.products[i].image`，80 樣商品約 4 MB，整包 state 寫入 localStorage（5 MB 上限）時爆掉。`persistAll()` throw 後 `applyCloudMenu` 中斷，連帶 `renderProducts()` 不執行 → 顧客頁空白。

**雙軌處理**：
- **Step 1（治標，本次優先）**：`js/core/store.js` 第 343 行附近的 localStorage.setItem 用 try/catch 包起來吞掉 QuotaExceededError，讓 IndexedDB 寫入成功就算成功。
- **Step 2-6（治本）**：見下方「Firebase Storage 圖片遷移計劃」。

### 2. reports-page.js 重複貼上造成 SyntaxError（待修）

**現象**：`openSessionSummaryModal()` 內「付款方式」區塊出現兩次 `const payKeys = Object.keys(payMap)`，會丟出 `SyntaxError: Identifier 'payKeys' has already been declared`，整個 `reports-page.js` 模組載入失敗，POS 報表頁開啟即掛掉。

**位置**:約在 v20260613 Commit 5 修改點 4 附近。

**修法**：刪除重複的後 4 行，只保留前 4 行。

**Commit 訊息**：`fix(reports-page)：移除誤貼的重複 payKeys 宣告（修復 SyntaxError）`

---

## 🚀 Firebase Storage 圖片遷移計劃（v20260614 規劃中）

### 背景

目前商品圖片以 base64 內嵌方式存在 `state.products[i].image`：
- 80 樣商品 × 約 50 KB = 約 4 MB 整包 state
- localStorage 5 MB 上限已爆（見已知問題 1）
- Firebase Realtime Database `menu/{projectId}` 節點肥到 4 MB+，顧客每次開頁全量下載
- `startMenuAutoWatch` 每 30 秒輪詢 → 流量爆炸
- 估算每月 Firebase 免費額度 10 GB 撐不到 2,560 人次，實際更少

### 遷移目標

商品圖片改放 Firebase Storage（`webpos-1f626` 同專案，bucket: `webpos-1f626.firebasestorage.app`），`state.products[i].image` 只存公開 URL 字串（80 chars 左右）。預期：
- state 體積從 4 MB → < 100 KB
- 顧客頁首次載入 3.2 MB（圖片走 CDN 並行下載），之後瀏覽器自動快取
- Firebase Realtime Database 流量降到原本的 1%

### 執行步驟（單店先動 2237-1，測試 OK 後複製到 2234）

**Step 1：治標 store.js（最優先）**
- 檔案：`js/core/store.js`
- 改第 343 行附近的 `localStorage.setItem` 用 try/catch 吞掉 QuotaExceededError
- 立即效果：顧客頁恢復顯示
- Commit 訊息：`fix(store): localStorage 滿時不中斷 persistAll（IndexedDB 仍寫入）`

**Step 2：開通 Firebase Storage 並補安全規則**
- 使用者操作：Firebase Console → `webpos-1f626` 專案 → Storage → Get started → 地區選 `asia-southeast1`（與 Database 同區）
- AI 提供 Storage 安全規則 JSON：admin 可寫、所有人可讀
- 順手補 Realtime Database 規則缺漏（menu、posBackup、dashboards、sessionHistory；onlineOrders 改雙層）
- Commit 訊息：手動操作，不涉及 repo

**Step 3：新增 image-upload-service.js**
- 檔案：`js/modules/image-upload-service.js`（新檔）
- 提供 `uploadProductImage(file, productId)` 函式：壓縮 → 上傳到 `productImages/{projectId}/{productId}.jpg` → 回傳公開 URL
- 同步在 `realtime-order-service.js` 初始化 Storage SDK
- service-worker.js CACHE_NAME 升版並加入新檔到 ASSETS
- Commit 訊息：`feat(image-upload): 新增 Firebase Storage 圖片上傳服務`

**Step 4：改 products-page.js 上傳流程**
- 檔案：`js/pages/products-page.js`
- 現有「選檔 → 讀 base64 → 塞進 state」改為「選檔 → 壓縮 → 呼叫 uploadProductImage → 取得 URL → 塞進 state」
- 上傳期間顯示「上傳中…」，禁止重複按
- Commit 訊息：`feat(products): 新增商品圖片改走 Firebase Storage 上傳`

**Step 5：寫一次性遷移按鈕**
- 檔案：`js/pages/settings-page.js`、`index.html`
- 「設定 → 本機資料」內加按鈕「將舊圖片遷移到 Storage」
- 按下後逐項處理 base64 圖片：上傳到 Storage、替換 state 內為 URL、顯示進度
- 完成後自動呼叫 `syncMenuToFirebase()` 推上去
- Commit 訊息：`feat(settings): 新增舊商品圖片批次遷移到 Storage`

**Step 6：實機驗證並複製到 2234**
- 在 2237-1 完整跑過 Step 1-5 + 實機測試（新增商品、編輯商品、顧客頁載入、跨店看板）
- 全部 OK 後把 Steps 1, 3, 4, 5 的修改複製到 jess0937588151-hue/2234

### 跨店規劃

- 圖片路徑使用 `productImages/{projectId}/...`（不是 `{storeId}`），所有店共用同一份圖檔（與菜單路徑一致原則）
- Storage 規則：寫入限 admin、讀取公開（圖片本來就要顯示給顧客）

---

## ⏳ 進行中／待處理

### 看板端（lcym346-byte/pos-dashboard）

#### Commit 8：`js/history-loader.js` 改用 BD 查詢
- 從目前的「自然日 60 天」改為「最近 60 個營業日」
- 跳過公休日
- 新舊 key 並存相容（舊資料的 dateKey 是自然日 `endedAt`，新資料是 BD `startedAt`）
- 用 `import { getRecentBDs, getBDsBetween } from './biz-day.js'`

#### Commit 9：`index.html`（看板）UI 與資料調整
- 從 Firebase 多讀 `dashboards/{storeId}/businessHours` 節點
- 「今日」直接讀 POS publish 好的值（`dashboards/{storeId}/today`）
- 週 / 月用 BD 切割（跳過公休日）
- UI 文字調整：
  - 「淨營業額」→「營業額」
  - 「作廢/取消」→「異常」
  - 「最後心跳」→「最後更新」
- 新增「外送 $X」顯示（讀 `today.delivery.total`，分項可選擇性顯示 panda/uber）
- 移除「淨營業額」這格（避免使用者再混淆）

### POS 端

#### POS service-worker.js（依使用者指示暫不做，但 Step 3 會觸發必要升版）
- 升 CACHE_NAME 至 `pos-v20260614-cache`
- 加入 `js/core/biz-day.js`、`js/modules/image-upload-service.js` 到 ASSETS pre-cache 清單

#### 訂單頁「修改」TypeError（早先回報，截圖顯示 orders-page.js:135）
- **狀態**：v20260613 已透過「加到購物車」流程繞過此 bug，但原本的 `loadOrderToCart` 路徑被移除後是否還會跳錯需實機驗證

---

## ❌ 本次明確不做（使用者已說明）

- 設定頁營業時間 24 小時制（使用者已在系統設定處理）
- 預設營業時間改為 14:00–03:00（不改 `DEFAULT_BUSINESS_HOURS`，避免影響既有店）
- GitHub Pages `images/` 方案存圖片（已評估：POS 前端無法安全 git push，使用者要自己 git 操作不可行）

---

## 🧪 待實機驗證項目（v20260613）

- [ ] `dashboard-publish.js` 用 BD 切今日後，跨日時段（02:00）儀表板顯示是否正確
- [ ] 結束值班 Modal 的「熊貓 Grod / Uber」即時加總顯示
- [ ] 班次摘要 Modal 的「🛵 外送」卡片與「外送明細」區塊（**須先修上面 SyntaxError**）
- [ ] `sessionHistory` 新 key（BD）寫入 Firebase 後，看板讀取是否相容
- [ ] 訂單頁「加到購物車」按鈕：載入 → 結帳 → 產生新單 → 原訂單不變
- [ ] 雲端 90 天清理（需等實際資料累積超過 90 天才能驗證）

---

## 📐 v20260613 關鍵設計決策（給未來 AI 參考）

- **營業日定義**：跨日營業（14:00–03:00）視為同一 BD；預約單依 `reservationAt` 歸屬，其他依 `createdAt`
- **異常**：`status = void / cancelled / refunded`，獨立顯示，不計入營業額
- **外送平台**：熊貓 Grod（台灣熊貓被併購交接中暫用此名）+ Uber
- **訂單修改流程**：加到購物車 → 結帳產生新單 → 另外作廢原單
- **資料保存**：本地與雲端 `sessionHistory` 都保留 90 自然日
- **歷史報表**：顯示最近 60 個營業日，自動跳過公休日

---

## 📐 v20260614 圖片遷移關鍵設計決策

- **base64 內嵌不可持續**：localStorage 5 MB 上限、Firebase 流量爆、菜單節點過大
- **方案選 Firebase Storage**：與既有 Firebase 專案整合最自然、CDN 加速、瀏覽器自動快取
- **不選 GitHub Pages `images/`**：POS 前端不能安全 git push，使用者不寫程式
- **圖片路徑跨店共用**：`productImages/{projectId}/{productId}.jpg`（與菜單 `menu/{projectId}` 一致）
- **遷移採批次自動化**：在 POS 設定頁加按鈕，使用者按一次跑完 80 樣商品
進度檔補一條「已知問題 3：訂單查詢『加到購物車』TypeError（orders-page.js:138）」，跟治標一起在 Step 1b 處理。
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
