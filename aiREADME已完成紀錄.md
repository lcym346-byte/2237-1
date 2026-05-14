# ✅ 已完成紀錄

> 本檔記錄所有版本已完成項目的詳細紀錄（由新到舊）。
> 規範與架構說明請見 `aiREADME.md`。
> 當前進行中與待處理請見 `aiREADME最新進度.md`。

---

## 📌 版本速查

| 版本 | 日期 | 重點 |
|---|---|---|
| v20260613 | 2026-05-13 | 營業日 BD + 外送統計 + 修改改加單 |
| v20260608 | 2026-05-11 | 雲端三層架構（IndexedDB + Firebase posBackup + Google Sheets）+ store-config.js 寫死店家綁定 |
| v20260607 | 2026-05-xx | fields 勾選矩陣 + 標籤一品項一張 + 數量 +/- 按鈕 |
| v20260606 | 2026-05-xx | token 自動同步、列印與錢箱回歸 |
| v20260603 | 2026-04-xx | APK 商用化補強（LogManager、PrintQueue、API Token） |
| v20260602 | 2026-04-xx | 印表機字串排版、token 驗證初版、SW cache 更新 |
| v20260601 | 2026-04-xx | APK 純後台改造、三層列印橋接、設定頁 UI |

---
## 2026-05-15（補）

### 模組子選項可單獨停售
- 需求：模組（如「七選三」配料）中的某個子選項賣完時，要能單獨關閉該選項；模組規則、其他選項、其他商品都不受影響；補貨後可再打開。
- 現況檢查：
  - `js/core/store.js` 的 `normalizeModules` 已支援子選項 `enabled` 欄位（預設 true）。
  - `js/pages/pos-page.js` 渲染模組選項時已用 `mod.options.filter(o=>o.enabled!==false)` 過濾。
  - `js/pages/online-order-page.js` 同樣以 `enabled!==false` 過濾。
  - `js/modules/product-module-manager.js` 的 `saveModuleManage()` 已在 `cleanOpts` 保留 `enabled` 欄位。
  - 唯一缺口：管理 UI（`renderOptions()`）沒有提供切換 `enabled` 的勾選框。
- 修法：只改 `js/modules/product-module-manager.js` 的 `renderOptions()`，每個子選項列加入「啟用/停售」勾選框，未勾選時整列以半透明灰底顯示並標註「停售」；勾選框 `change` 事件即時更新 `draft.options[i].enabled` 並重繪。
- 影響檔案：`js/modules/product-module-manager.js`（v20260515-c）
- 驗證：商品管理 → 模組 → 開啟設定 → 取消某選項的「啟用」→ 儲存 → POS 點餐與線上點餐畫面該選項消失，模組規則（min/max）不變；再勾回後恢復顯示；Firebase `menu/default` 的 `updatedAt` 即時更新。

## v20260613（2026-05-13）— 營業日 BD + 外送 + 修改改加單

### POS 端

**新增 `js/core/biz-day.js`**：營業日 (Business Day, BD) 共用工具
- `getBusinessDay(time, businessHours)`：跨日營業時段（例 14:00–03:00）歸屬同一 BD
- `getCurrentBusinessDay`、`getBDRange`、`isOpenDay`、`getRecentBDs`、`getBDsBetween`

**修改 `js/modules/dashboard-publish.js`**：
- 今日範圍改用 BD 切（不再用自然日 00:00–23:59）
- 預約待付款單依 `reservationAt` 歸 BD，其他依 `createdAt`
- 營業額 = completed + pending（含預約）+ 今日 BD 內已結束班次的外送加總
- 異常欄位 `voided` → `abnormal`，移除 `netSalesTotal`
- 新增 publish `dashboards/{storeId}/businessHours` 與 `today.delivery`
- 心跳節點維持 `heartbeat` 名稱（向下相容），內含 `lastSeenAt`（語意：最後更新）

**修改 `js/modules/report-session.js`**：
- import `getBusinessDay`，`sessionHistory/{storeId}/{date}` 的 date 改用 BD（用班次 `startedAt` 的營業日）
- `endSession(opts)` 接收 `deliveryPanda` / `deliveryUber`，加進 stats 與「其他」付款（不計入現金）
- 上傳雲端後清理 90 自然日前 `sessionHistory` 雲端節點，本地保留 90 天

**修改 `index.html`（POS）**：
- 結束值班 Modal 新增「熊貓 Grod / Uber」金額輸入區塊（藍底設計與現金清點區隔）
- 即時加總顯示，明示「不影響現金清點與誤差」

**修改 `js/pages/reports-page.js`**：
- 結束值班 Modal 綁定外送輸入即時加總
- 傳遞 `deliveryPanda` / `deliveryUber` 給 `endSession()`
- 班次摘要 Modal 新增「🛵 外送」藍色卡片 + 付款方式下方追加外送明細區塊
- 加入 `[data-delivery-detail]` 標記避免重開 Modal 時重複插入

**修改 `js/modules/order-service.js`**：
- 移除 `editingOrderId` 就地修改邏輯，每次結帳產生新訂單
- 封閉「就地修改原單可規避營業額」的漏洞
- 函式名稱保留 `createOrUpdateOrder` 維持介面相容，但內部永遠建新單

**修改 `js/pages/orders-page.js`**：
- 「修改」按鈕改為「加到購物車」，函式改名 `addOrderToCart`
- 加到購物車後跳警告：「原訂單仍存在；如需取代請另外作廢原訂單」
- 已作廢訂單禁止加到購物車

### 看板端 (lcym346-byte/pos-dashboard)

**新增 `js/biz-day.js`**：與 POS 端 `js/core/biz-day.js` 邏輯完全一致（未來修改需同步兩個檔案）

### 文件結構

- 將 `aiREADME.md` 拆分為三檔：主檔（說明＋規範）、`aiREADME最新進度.md`（進行中/待處理）、`aiREADME已完成紀錄.md`（本檔）
- 加入規範條款 16（BD 計算）與 17（訂單修改 = 加到購物車）

### 關鍵設計決策

- **營業日定義**：跨日營業（14:00–03:00）視為同一 BD；預約單依 reservationAt 歸屬
- **異常 = void / cancelled / refunded**：獨立顯示不計入營業額
- **外送平台**：熊貓 Grod（台灣熊貓被併購交接中）+ Uber，計入「其他」付款，不計入現金
- **修改流程**：加到購物車 → 結帳產生新單 → 另外作廢原單（留下完整審計軌跡）
- **資料保存**：本地與雲端 sessionHistory 都保留 90 天

### 踩雷紀錄

- **重複貼上錨點造成 SyntaxError**：Commit 5 修改點 4 不小心讓「付款方式」區塊出現兩次 `const payKeys = Object.keys(payMap)`，整個 reports-page.js 模組載入失敗。教訓：修改後務必完整讀檔驗證，搜尋關鍵字（如 `const payKeys`）確認只出現一次。**此問題在後續驗證時發現並修復**（見 `aiREADME最新進度.md` 「已知問題」段）。
- **整段 `aiREADME.md` 顯示截斷誤判**：先前 crawler 抓 raw 內容只回 10KB 就標示 EOF，但實際檔案 28KB，是工具的 byte offset 解析行為而非檔案截斷。教訓：當壓縮歷史說檔案有 N KB 但抓不到，要主動多嘗試不同 offset 或用 GitHub API contents 確認真實大小。

---

## v20260608（2026-05-11）— 雲端三層架構

實機驗證通過。

### Commit 1：store.js 升級為 IndexedDB 主儲存
- 新增 IndexedDB 極簡 wrapper（`restaurantPosDB` / `kvStore` / `posState`）
- 與 localStorage 雙寫快取，啟動時自動從 localStorage 遷移
- 新增 URL 參數 `?storeId=xxx&storeName=yyy` 首次綁定機制
- 新增 `state.rebindStore({storeId, storeName})` API

### Commit 2：Firebase posBackup 全量備份
- 路徑 `posBackup/{storeId}/state`，payload 含 `data` + `meta`
- `persistAll()` 觸發 10 秒節流（CLOUD_THROTTLE_MS = 10000）上傳
- 啟動時若 IndexedDB 與 localStorage 均空且 storeId 已綁定，confirm 詢問是否從雲端還原
- Firebase 安全規則新增 `posBackup` 節點（auth != null）
- 全域 API：`state.cloudBackupNow()`、`state.tryRestoreFromCloud()`

### Commit 3：Google Sheets 增量同步
- 新增檔案 `js/modules/sheets-sync.js`，後端寫死 APPS_SCRIPT_URL
- 分頁 `{storeId}_orders` / `{storeId}_sessions` / `{storeId}_voided`，依 orderNo / sessionId 去重
- 三重觸發：每 15 分鐘 setInterval + 訂單完成 / 班次結束（10 秒節流）+ 啟動後 30 秒首同步
- 已同步 key 保留上限 2000 筆訂單 / 500 筆班次（先進先出）
- 失敗自動記錄 `lastError`，下次自動重試
- 全域 API：`window.sheetsSyncNow()`、`window.sheetsSyncStatus()`、`window.sheetsSyncReset()`
- index.html 增加一行 `<script type="module" src="js/modules/sheets-sync.js">`

### Commit 4：store-config.js 寫死店家綁定 + 強制鎖定
- 新增檔案 `js/core/store-config.js`，匯出 `STORE_CONFIG` 物件（storeId / storeName / storeCode / lockFromUrl）
- `store.js`、`sheets-sync.js` 改為 import STORE_CONFIG，優先順序：STORE_CONFIG > URL 參數
- 多店複製時只需改 `store-config.js` 三個值，其他檔案完全不動

### Commit 5：fix 補上 hydrate 缺漏
- `applyStoreBindingFromUrl(state)` 補上參數
- hydrate 第一輪加上 `syncStoreToDashboard()` 呼叫

### Apps Script 後端
- 試算表 ID：`1RTcKK-cZutAtSBQtPU6O7PcNKUVP53MBgoa6Dk0PFXc`
- Web App URL：`https://script.google.com/macros/s/AKfycbxbQTMq2BZOvdIexY3pz_DERQGe44aR_OLIf-xZbt8MHHDjEI-WHe5408A9qXvTonlC/exec`
- 共用後端：所有店家共用同一個 spreadsheet，以 `{storeId}_xxx` 分頁區分
- doPost 用 `Content-Type: text/plain;charset=utf-8` 避開 CORS preflight

### 踩雷紀錄

- **Chrome 多帳號干擾**：Apps Script 部署後若有第二個 Google 帳號登入，瀏覽器會自動加 `/u/1/` 到 URL，導致「無法開啟檔案」錯誤。解法：用無痕視窗只登一個帳號操作，或在 fetch POST 時用本來的乾淨 URL（POST 不受帳號路徑影響）。
- **改 store.js 的閉合括號**：給使用者修改錨點時務必把「整段函式」當作最小單位置換，**不可只刪一行/補一行**。v20260608 期間發生過兩次語法錯誤：
  - 第一次：刪掉舊 `if (boundByUrlSync) {` 但忘記同步刪除對應的 `}`，導致 hydrateState 被孤兒 `}` 提前結束 → 整支 store.js SyntaxError → 畫面空白只剩框架
  - 第二次：修第一次的錯時，把 `getDeviceId()` 函式的閉合 `}` 也誤刪，造成 `Unexpected token 'export'`
  - 教訓：以後改 store.js 這類關鍵檔案，必須讀完整檔、把整段函式置換，不要只給「在 X 行加/刪 Y 行」這種片段指引
- **線上點餐頁不該套用 STORE_CONFIG 鎖定**：online-order.html 本來就要靠 URL `?storeCode=xxx` 區分顧客掃哪家店的 QR，POS 後台才需要鎖定

---

## v20260607（2026-05-xx）— fields 勾選矩陣 + 標籤一品項一張 + 數量 +/- 按鈕

### 修復一：fields 勾選矩陣失效
- 雙重原因：APK 沒讀 `obj.optJSONObject("fields")`；Web 送的 key 名（shopPhone/shopAddress/customerName...）與 APK 讀的舊 key 名（storePhone/storeAddress...）不一致
- APK `SunmiPrinterManager.printPosReceipt`：加入 fields 旗標讀取（缺鍵預設 true 保留舊行為），所有非必印欄位用 `if(fields.xxx)` 包起來；同時加 firstNonEmpty fallback（shopName↔storeName / shopPhone↔storePhone / shopAddress↔storeAddress / subtotal↔subtotalAmount / discountAmount↔discount）
- Web `print-service.js buildBridgePayload`：依 mode 與 fields 勾選送對應欄位，未勾選送空字串/空陣列

### 修復二：開錢箱誤判訊息
- 真正原因：`reports-page.js initReportsPage()` 內有重複的 `#openCashDrawerBtn` handler，無視 detect.mode 直接檢查 `window.SunmiPrinter`，因為桌面 Chrome / 新版 APK 架構下 `window.SunmiPrinter` 為 undefined，永遠跳「未偵測到出單機，無法開啟錢箱」
- 修法：移除 `reports-page.js` 內那段重複 handler，只保留 `pos-page.js` 的 `openCashDrawerBtn` handler（會走 print-bridge → httpOpenDrawer）
- **踩雷**：第一次以為是 PWA Service Worker 快取，叫使用者清快取與無痕模式都沒解決；第二次以為 GitHub repo 沒有那段字串（grep 漏掉），實際上字串就在 reports-page.js 裡。教訓：用 GitHub UI 全檔案搜尋 `https://github.com/USER/REPO/search?q=...` 比 raw 分段抓更可靠

### 修復三：連續按開錢箱第二次失敗
- 原因：第一次 fetch 成功後 NanoHTTPD socket 立即關閉，下一次 fetch 還沒重連就觸發瀏覽器「Failed to fetch」
- 修法：`print-bridge.js fetchWithTimeout` 在 TypeError / network error 時延遲 200~250ms 重試一次；`httpOpenDrawer` 外層再包兩次重試

### 修復四：設定頁三個預覽列印按鈕未帶 pendingPreviewMode
- 原因：`previewReceiptBtn` / `previewKitchenBtn` / `previewLabelBtn` 直接 call 列印函式，但 `pendingPreviewMode` 未先設定，造成預覽走錯模式
- 修法：`settings-page.js` 三個 handler 內，呼叫列印函式前先 `pendingPreviewMode = 'receipt' | 'kitchen' | 'label'`

### 新增功能五：標籤一品項一張（qty=2 印 2 張）
- `print-service.js getLabelHtml`：`items.flatMap` + `Array.from({length: qty}, oneLabel)` 依 qty 展開；移除標籤上的 xN 顯示
- `print-service.js buildBridgePayload`：mode='label' 時，items 用 flatMap 展開成 N 個 qty:1 獨立 item，APK 收到 N 個 item 就印 N 張
- 顧客單 / 廚房單模式不變（仍合併 xN）

### 新增功能六：點餐 modal 數量 +/- 快捷按鈕
- `index.html productConfigModal`：在 `itemQtyInput` 兩側加 `#qtyMinusBtn` / `#qtyPlusBtn`
- 純 inline onclick，調整完用 `dispatchEvent(new Event('input', {bubbles:true}))` 觸發既有 pos-page.js 小計重算邏輯，零 JS 改動
- 最小值固定為 1（要取消改用「取消」按鈕，不用降到 0）

### 踩雷紀錄

- 在沒看完整個 repo 前不要下「字串不存在」的結論。reports-page.js 是這次卡關 1 小時的元兇
- 多個頁面綁定同一個 button id 的 handler 是大忌：pos-page 與 reports-page 都綁了 `#openCashDrawerBtn`，後綁的覆蓋會看模式選擇，造成偽 race condition
- 短命 fetch 失敗（NanoHTTPD socket close）需要 retry，不是 server bug
- 標籤展開要在 `buildBridgePayload` 處理（送 APK 用），不是只改 `getLabelHtml`（瀏覽器 fallback 用）；兩處都要改

---

## v20260606（2026-05-xx）— token 自動同步、列印與錢箱回歸

實機驗證結果：收據、廚房單、預覽單中文完全正確，錢箱經 sunmi 路徑開啟成功。

### 真正根因
APK 每次重啟/重裝會用 UUID 重新生成 API token，但 Web 端 localStorage 還存著舊 token，所有 `/print/*` 與 `/drawer/open` 都被 APK checkToken 擋掉回 unauthorized，前端 fallback 到 `window.print()` 跳 PDF 對話框。先前誤判為「NanoHTTPD parseBody 把中文吃成 ?」，繞了多輪，實際上請求根本沒進到 readBody。

### 最終修法
- APK `PrintHttpServer.handlePing()` 在回應 JSON 加上 `"token":"..."` 欄位（/ping 免驗證，等於把 token 公開給本機 web）
- Web `print-bridge.js detectPrinters` 收到 /ping 回應時，若 `data.token` 與 localStorage 不一致就自動 `setApiToken(data.token)` 同步
- `httpPrint` / `httpOpenDrawer` 收到 401/403/unauthorized 時呼叫 `detectPrinters(true)` 重抓 token，再重試一次
- 移除原本依賴 /test HTML 解析 token 的 `tryAutoFetchToken` 路徑

### 保活措施
- PrintService 取得 PARTIAL_WAKE_LOCK 防止螢幕關閉時 NanoHTTPD 接收延遲
- AndroidManifest 加 WAKE_LOCK 與 REQUEST_IGNORE_BATTERY_OPTIMIZATIONS 權限

### 踩雷紀錄

- 不要相信「中文變 ?」的表象，先看 APK log 是不是 unauthorized
- /ping 是 token 同步的天然管道：免驗證、Web 端本來就會呼叫、cache TTL 8 秒
- APK 重裝後 token 會換，這是 v20260603 加 API Token 驗證後的副作用；任何依賴 token 的 endpoint 都要有自動重抓機制
- compileSdk=28 環境下不可使用 `android:foregroundServiceType` 屬性
- `PrintHttpServer` 建構子是 4 參數（port + 3 個 manager），不是 5 參數
- `SunmiPrinterManager` 必須保留舊簽名（PrintJsBridge / SettingsActivity 依賴）
- `BluetoothPrinterManager` / `NetworkPrinterManager` 用 `printPosReceipt(json)`、`openCashDrawer()`
- `LogManager.init(this)` 必須寫在 `PrintService.onCreate()` 內

---

## v20260603（2026-04-xx）— APK 商用化補強

- LogManager.java 日誌中心（檔案 + 記憶體 200 筆環形緩衝 + 7 天自動清理 + errors.txt 分檔）
- PrintHttpServer 強制綁 127.0.0.1
- 印表機狀態強化（PrinterStatusInfo + /ping 詳細狀態）
- Foreground Service 常駐通知（`PrintService.createNotificationChannel`）
- PrintQueue.java 單線程列印佇列（30 秒上限）
- 列印失敗紀錄 + SettingsActivity 顯示「最後列印狀態」
- MainActivity 健康檢查頁（4 區塊 + 10 筆錯誤日誌 + 4 顆操作按鈕）
- API Token 驗證（首次啟動 UUID 隨機生成）
- 內建測試列印頁 GET /test

---

## v20260602（2026-04-xx）— 印表機字串排版、token 驗證初版、SW cache 更新

- `sunmiPrintReceiptByFont` 結尾留白縮為 1 行、分隔線動態長度
- `buildPlainTextFromOrder` 修 baseSize ReferenceError、結尾留白縮為 1 行
- `pos-page.js finalizeOrder` 修多餘的 `}`、開錢箱改 async
- APK `SunmiPrinterManager.feedAndCut` / `cutPaper` 的 lineWrap 全改 1
- APK `printPosReceipt` 改條件開錢箱（openDrawer flag）
- `index.html` 三模組 modal 加測試列印按鈕、title 改「餐廳 POS V20260602 列印橋接版」
- `service-worker.js` CACHE_NAME 升至 `pos-v20260602-cache`

---

## v20260601（2026-04-xx）— APK 純後台改造、三層列印橋接、設定頁 UI

- APK 重構為純後台 HTTP Server 架構（NanoHTTPD on 127.0.0.1）
- APK 三種印表機 Manager 完成（Sunmi / 藍牙 / 網路）
- 設定頁三欄勾選矩陣（receipt / kitchen / label）
- `reports-page.js` 報表匯出改用 overlay 顯示 CSV
- 新增 `js/modules/print-bridge.js`（三層橋接偵測）
- 改寫 `js/modules/print-service.js`（列印路由走 bridge）
- 改寫 `js/pages/settings-page.js`（三區塊偵測改走 bridge）
- D9 線上訂單自動列印
- D10 預約 30 分鐘前自動提醒列印

---
## 2026-05-15

### 修復分類/模組儲存後不同步到雲端的問題
- 症狀：商品管理頁新增/修改/刪除分類或模組後，雲端 menu 節點不會更新；
  Firebase 雲端的 categories 與 modules 一直是舊的，下載回來也是舊的。
- 根因：`product-category-manager.js` 的 `saveCategoryManage` / `deleteCategoryManage`
  與 `product-module-manager.js` 的 `saveModuleManage` / `deleteModuleManage`
  結尾只呼叫 `persistAll()`（只寫 localStorage），未呼叫 `syncMenuToFirebase()`。
  只有商品（products）會在按「⬆ 上傳」時才推送，分類與模組從未被自動推送。
- 修法：兩個 manager 各新增 `autoPushIfMaster()`（從機/未啟用即時不會推送、不丟錯），
  在 save 與 delete 的 `persistAll()` 之後呼叫，達到「分類/模組變動 → 自動推雲端」。
- 影響檔案：
  - js/modules/product-category-manager.js（v20260515）
  - js/modules/product-module-manager.js（v20260515）
- 驗證：F12 Console 應出現「菜單同步成功」；
  Firebase Console `menu/{projectId}` 節點 updatedAt 會即時更新。

### 釐清雲端菜單實際路徑
- 本機 `state.realtimeOrderConfig.projectId` 為 undefined，
  程式碼 `cfg.projectId || 'default'` 取 'default'，
  所以實際上傳/下載都在 `menu/default`，非 `menu/webpos-1f626`（舊）。
- 上傳與下載路徑一致，功能正常，不需修改 projectId。

### 移除 index.html 商品管理頁多餘的 < 符號
- 位置：`<div class="products-main"> < <div class="panel-block">` 中間多一個 `<`
- 修法：刪除該字元即可。


> 詳細的當前進行中項目請見 `aiREADME最新進度.md`。
> 規範與架構說明請見 `aiREADME.md`。
