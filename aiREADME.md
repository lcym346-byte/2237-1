# POS 專案 AI 接手說明書

> 給每一個新接手的 AI：**動手前先讀完這份文件**，禁止憑記憶或猜測修改。所有改動完成後請更新「進度紀錄」段落。

---

## 一、專案組成

| 角色 | Repo | 部署/用途 |
|---|---|---|
| 網頁主程式（總部範本） | https://github.com/jess0937588151-hue/2234 | 部署於 https://jess0937588151-hue.github.io/2234/ |
| 網頁主程式（門市 1） | https://github.com/lcym346-byte/2237-1 | 部署於 https://lcym346-byte.github.io/2237-1/ |
| Sunmi 列印橋接 APK | https://github.com/jess0937588151-hue/sunmi-pos-v2 | 純後台 HTTP Server，僅在 Sunmi T2 上安裝 |
| 舊版參考 | https://github.com/jess0937588151-hue/2332 | 已知可正常使用的版本，遇到回歸問題時對照 |
| 多店看板（規劃中） | 尚未建立 | 老闆用，跨店即時營業狀況 |

**多店架構（v20260608 確立）**：每間店一個獨立 GitHub repo（2237-1、2237-2…），共用同一個 Firebase 專案 `webpos-1f626`，以 `storeId` 區分路徑（`sessionHistory/{storeId}/`、`dashboards/{storeId}/`、`posBackup/{storeId}/`、`onlineOrders/{storeCode}/`）。`storeId` / `storeName` 由 URL 參數 `?storeId=xxx&storeName=yyy` 首次啟動時綁定並寫入 IndexedDB，之後忽略 URL 變更。

---

## 二、執行環境

**主裝置：Sunmi T2**
- Android 7.1.1（API 25）
- 2 GB RAM
- 80 mm 熱感紙
- 內建熱感印表機 + 錢箱
- 安裝 sunmi-pos-v2 APK（純後台 HTTP Server，無 WebView UI）
- 用 Chrome 直接開門市網址（不再用 APK 內建 WebView）

**備援裝置：**
- iPad（Safari）— 主要看訂單與簡單操作，列印走系統列印對話框
- Windows 電腦（Chrome）— 完整功能，列印走系統列印對話框
- 其他 Android（未來可能安裝 2234 打包後的獨立 APK，需自帶 HTTP Server 才能直印）

**關鍵限制：**
- iPad/Safari 不支援 Web Bluetooth、WebUSB、Service Worker 部分行為
- Sunmi T2 Android 7.1.1 不支援部分新 API
- WebView 內 OAuth 被 Google 封鎖（disallowed_useragent）→ 因此採純後台 HTTP 架構，APK 不再開 WebView
- Android 沒 console / Logcat 不易接：所有錯誤都必須寫到 LogManager 檔案 + HTTP /logs 端點
- 使用者不寫程式：所有改動必須給「完整檔案內容 + 檔案路徑 + GitHub 編輯連結 + Commit message」，禁止只貼片段叫使用者插入

---

## 三、列印架構

網頁端 js/modules/print-bridge.js 依序嘗試三種橋接：
1. HTTP 127.0.0.1:8080（Sunmi T2 跑的 sunmi-pos-v2 APK，或未來打包的新 APK）
2. window.SunmiPrinter（舊 WebView 殼，已停用）
3. window.print()（iPad / PC）

關鍵設計原則：網頁端的偵測邏輯不認牌子、不認機型，只問「本機 127.0.0.1:8080 有沒有橋接服務在跑」。所以未來打包新 APK 時，網頁端不需要改，**但新 APK 必須提供完全相同的 /ping、/print/*、/drawer/open API，且必須支援 payload.fields 勾選旗標與標籤模式 qty 展開（詳見第四節）**，否則會出現「勾選沒作用」「qty=2 只印 1 張」等 v20260607 已踩過的雷。

---

## 四、HTTP Server API 規格

位址：http://127.0.0.1:8080（埠號可在 APK 設定頁修改）
綁定：強制只綁 127.0.0.1（loopback），外部裝置連不到
所有回應：{"ok": true/false, "data": ..., "error": "..."}
所有 Endpoint 必含 CORS header（Allow-Origin: *）
驗證：所有 /print/*、/drawer/open、/logs 需 header X-API-Token，token 首次啟動時隨機生成

| Method | Path | 用途 |
|---|---|---|
| GET | /ping | 心跳，回 version、印表機連線狀態、paperOut/coverOpen/overheat、lastPrintAt/lastPrintOk、token、printerReady |
| GET | /printer/status | 詳細印表機狀態 |
| GET | /logs?date=YYYY-MM-DD&lines=200 | 查看當日日誌 |
| GET | /test | 內建測試列印頁 |
| POST | /print/sunmi | Sunmi 內建列印 |
| POST | /print/bluetooth | 藍牙 ESC/POS 列印 |
| POST | /print/network | 網路 ESC/POS 列印 |
| POST | /drawer/open | 開錢箱（優先順序：Sunmi > 藍牙 > 網路） |

POST body 範例（內層用四空白縮排表示，避免破壞外層 fence）：

    {
      "payload": {
        "shopName": "...",
        "items": [{ "name":"雞排", "qty":1, "basePrice":60, "extraPrice":0, "options":"加辣", "note":"" }],
        "total": 100,
        "mode": "label",
        "fields": { "storeName": true, "items": true, "itemSelections": true }
      },
      "openDrawer": false
    }

標籤模式（mode='label'）的關鍵約定：

- 網頁端 buildBridgePayload 已在送出前把 qty>1 的品項展開成 N 個 qty=1 獨立 item（雞排 qty=2 → 送 2 個 {name:雞排, qty:1}）。
- APK 端只要 for 迴圈逐個 item 印一張即可，不要再乘 qty，否則會印雙倍。
- 顧客單 / 廚房單模式不展開，APK 仍照原 qty 顯示「雞排 x2」。

---

## 五、雲端資料三層架構（v20260608 確立）

POS 資料採三層持久化，依序：

1. **第一層 — IndexedDB（本地主儲存）**：資料庫 `restaurantPosDB`、object store `kvStore`、key=`posState`。透過 `js/core/store.js` 內建的 wrapper（無外部套件），與 localStorage 雙寫（localStorage 為快取／向下相容，IndexedDB 為主），啟動時若 localStorage 有資料、IndexedDB 沒資料，會自動遷移並 console 印出 `[store] 已從 localStorage 自動遷移至 IndexedDB`。
2. **第二層 — Firebase Realtime Database 全量備份**：路徑 `posBackup/{storeId}/state`，包含 `data`（state 全文）與 `meta`（backupAt / orderCount / deviceId）。寫入採 **10 秒節流**（CLOUD_THROTTLE_MS = 10000），由 `persistAll()` 觸發。啟動時若本地 IndexedDB 與 localStorage 均為空且 `storeId` 已綁定，會 confirm 詢問使用者是否從雲端還原。Firebase Realtime Database 安全規則需加入 `"posBackup": { ".read": "auth != null", ".write": "auth != null" }`（POS 以 Google 登入後通過驗證）。
3. **第三層 — Google Sheets 增量同步**：透過 Google Apps Script Web App（後端寫死於 `js/modules/sheets-sync.js` 的 `APPS_SCRIPT_URL`），分頁命名 `{storeId}_orders`、`{storeId}_sessions`、`{storeId}_voided`，依 orderNo / sessionId 去重。同步觸發三重：每 15 分鐘 setInterval + 班次結束 + 訂單完成（10 秒節流）。已同步的 key 記錄在 `state.settings.sheetsSync.syncedOrderNos / syncedSessionIds`，最多保留 2000 筆 / 500 筆。全域 API：`window.sheetsSyncNow()`、`window.sheetsSyncStatus()`、`window.sheetsSyncReset()`。

**店家綁定**：URL 參數 `?storeId=xxx&storeName=yyy` 首次啟動寫入 `state.settings.store`，同時同步至 `state.settings.dashboard`（供 dashboard-publish.js 與 realtime-order-service.js 使用）。`state.rebindStore()` 可手動清除綁定後再以新 URL 開啟即可重綁。

**Apps Script 後端**：每個試算表內附帶一份 Apps Script 專案 `POS Sync Backend`，已部署為 Web App（執行身分=擁有者、存取對象=任何人）。固定 spreadsheetId 寫死在 `SPREADSHEET_ID` 常數，避免多帳號干擾。Web App URL 範例：`https://script.google.com/macros/s/AKfycbxbQTMq2BZOvdIexY3pz_DERQGe44aR_OLIf-xZbt8MHHDjEI-WHe5408A9qXvTonlC/exec`。Web App URL 在瀏覽器直接開若被 Chrome 自動加 `/u/1/` 會 404，但 POS 用 fetch POST 不會有此問題。fetch 必須用 `Content-Type: text/plain;charset=utf-8`（Apps Script doPost 用 `e.postData.contents` 解析 JSON）避開 CORS preflight。

---

## 六、目前實機狀況（2026-05-11，v20260608 雲端三層完工）

最後一輪實測通過項目：

- 顧客單、廚房單、預覽單列印中文正確，欄位勾選矩陣生效
- 錢箱經 Sunmi 路徑開啟成功，連續按兩次都能開
- 三個預覽列印按鈕（顧客 / 廚房 / 標籤）正確帶入 pendingPreviewMode
- 標籤一品項一張：雞排 qty=2 印 2 張、3 個品項各 qty=1 印 3 張
- POS 點餐 modal 的數量輸入框旁有 +/- 快捷按鈕，按下小計即時更新
- 雲端三層：IndexedDB 載入 OK、`posBackup/store001/state` 寫入成功、`store001_orders / store001_sessions` Apps Script 寫入成功

未驗證但邏輯上一致的：

- iPad / PC Chrome 走 browser fallback 列印標籤，行為與 Sunmi 一致（getLabelHtml 同樣依 qty 展開）
- 多店 storeId 區分路徑（目前只用 store001 實測，store002+ 邏輯與 store001 完全一致）

---

## 七、進度紀錄

### v20260601 已完成
- APK 重構為純後台 HTTP Server 架構（NanoHTTPD on 127.0.0.1）
- APK 三種印表機 Manager 完成（Sunmi / 藍牙 / 網路）
- 設定頁三欄勾選矩陣（receipt / kitchen / label）
- reports-page.js 報表匯出改用 overlay 顯示 CSV
- 新增 js/modules/print-bridge.js（三層橋接偵測）
- 改寫 js/modules/print-service.js（列印路由走 bridge）
- 改寫 js/pages/settings-page.js（三區塊偵測改走 bridge）
- D9 線上訂單自動列印
- D10 預約 30 分鐘前自動提醒列印

### v20260602 已完成
- sunmiPrintReceiptByFont 結尾留白縮為 1 行、分隔線動態長度
- buildPlainTextFromOrder 修 baseSize ReferenceError、結尾留白縮為 1 行
- pos-page.js finalizeOrder 修多餘的 }、開錢箱改 async
- APK SunmiPrinterManager.feedAndCut / cutPaper 的 lineWrap 全改 1
- APK printPosReceipt 改條件開錢箱（openDrawer flag）
- index.html 三模組 modal 加測試列印按鈕、title 改「餐廳 POS V20260602 列印橋接版」
- service-worker.js CACHE_NAME 升至 pos-v20260602-cache

### v20260603 已完成（APK 商用化補強）
- LogManager.java 日誌中心（檔案 + 記憶體 200 筆環形緩衝 + 7 天自動清理 + errors.txt 分檔）
- PrintHttpServer 強制綁 127.0.0.1
- 印表機狀態強化（PrinterStatusInfo + /ping 詳細狀態）
- Foreground Service 常駐通知（PrintService.createNotificationChannel）
- PrintQueue.java 單線程列印佇列（30 秒上限）
- 列印失敗紀錄 + SettingsActivity 顯示「最後列印狀態」
- MainActivity 健康檢查頁（4 區塊 + 10 筆錯誤日誌 + 4 顆操作按鈕）
- API Token 驗證（首次啟動 UUID 隨機生成）
- 內建測試列印頁 GET /test

### v20260606 已完成（列印與錢箱回歸 + token 同步）
實機驗證結果：收據、廚房單、預覽單中文完全正確，錢箱經 sunmi 路徑開啟成功。

真正根因：APK 每次重啟/重裝會用 UUID 重新生成 API token，但 Web 端 localStorage 還存著舊 token，所有 /print/* 與 /drawer/open 都被 APK checkToken 擋掉回 unauthorized，前端 fallback 到 window.print() 跳 PDF 對話框。先前誤判為「NanoHTTPD parseBody 把中文吃成 ?」，繞了多輪，實際上請求根本沒進到 readBody。

最終修法：
- APK PrintHttpServer.handlePing() 在回應 JSON 加上 "token":"..." 欄位（/ping 免驗證，等於把 token 公開給本機 web）
- Web print-bridge.js detectPrinters 收到 /ping 回應時，若 data.token 與 localStorage 不一致就自動 setApiToken(data.token) 同步
- httpPrint / httpOpenDrawer 收到 401/403/unauthorized 時呼叫 detectPrinters(true) 重抓 token，再重試一次
- 移除原本依賴 /test HTML 解析 token 的 tryAutoFetchToken 路徑

保活措施：
- PrintService 取得 PARTIAL_WAKE_LOCK 防止螢幕關閉時 NanoHTTPD 接收延遲
- AndroidManifest 加 WAKE_LOCK 與 REQUEST_IGNORE_BATTERY_OPTIMIZATIONS 權限

踩雷紀錄：
- 不要相信「中文變 ?」的表象，先看 APK log 是不是 unauthorized
- /ping 是 token 同步的天然管道：免驗證、Web 端本來就會呼叫、cache TTL 8 秒
- APK 重裝後 token 會換，這是 v20260603 加 API Token 驗證後的副作用；任何依賴 token 的 endpoint 都要有自動重抓機制
- compileSdk=28 環境下不可使用 android:foregroundServiceType 屬性
- PrintHttpServer 建構子是 4 參數（port + 3 個 manager），不是 5 參數
- SunmiPrinterManager 必須保留舊簽名（PrintJsBridge / SettingsActivity 依賴）
- BluetoothPrinterManager / NetworkPrinterManager 用 printPosReceipt(json)、openCashDrawer()
- LogManager.init(this) 必須寫在 PrintService.onCreate() 內

### v20260607 已完成（fields 勾選矩陣 + 開錢箱訊息 + 連續開錢箱 + 預覽列印 + 標籤一品項一張 + 數量 +/- 按鈕）
修復一：fields 勾選矩陣失效
- 雙重原因：APK 沒讀 obj.optJSONObject("fields")；Web 送的 key 名（shopPhone/shopAddress/customerName...）與 APK 讀的舊 key 名（storePhone/storeAddress...）不一致
- APK SunmiPrinterManager.printPosReceipt：加入 fields 旗標讀取（缺鍵預設 true 保留舊行為），所有非必印欄位用 if(fields.xxx) 包起來；同時加 firstNonEmpty fallback（shopName↔storeName / shopPhone↔storePhone / shopAddress↔storeAddress / subtotal↔subtotalAmount / discountAmount↔discount）
- Web print-service.js buildBridgePayload：依 mode 與 fields 勾選送對應欄位，未勾選送空字串/空陣列

修復二：開錢箱誤判訊息
- 真正原因：reports-page.js initReportsPage() 內有重複的 #openCashDrawerBtn handler，無視 detect.mode 直接檢查 window.SunmiPrinter，因為桌面 Chrome / 新版 APK 架構下 window.SunmiPrinter 為 undefined，永遠跳「未偵測到出單機，無法開啟錢箱」
- 修法：移除 reports-page.js 內那段重複 handler，只保留 pos-page.js 的 openCashDrawerBtn handler（會走 print-bridge → httpOpenDrawer）
- 踩雷：第一次以為是 PWA Service Worker 快取，叫使用者清快取與無痕模式都沒解決；第二次以為 GitHub repo 沒有那段字串（grep 漏掉），實際上字串就在 reports-page.js 裡。教訓：用 GitHub UI 全檔案搜尋 https://github.com/USER/REPO/search?q=... 比 raw 分段抓更可靠

修復三：連續按開錢箱第二次失敗
- 原因：第一次 fetch 成功後 NanoHTTPD socket 立即關閉，下一次 fetch 還沒重連就觸發瀏覽器「Failed to fetch」
- 修法：print-bridge.js fetchWithTimeout 在 TypeError / network error 時延遲 200~250ms 重試一次；httpOpenDrawer 外層再包兩次重試

修復四：設定頁三個預覽列印按鈕未帶 pendingPreviewMode
- 原因：previewReceiptBtn / previewKitchenBtn / previewLabelBtn 直接 call 列印函式，但 pendingPreviewMode 未先設定，造成預覽走錯模式
- 修法：settings-page.js 三個 handler 內，呼叫列印函式前先 pendingPreviewMode = 'receipt' | 'kitchen' | 'label'

新增功能五：標籤一品項一張（qty=2 印 2 張）
- print-service.js getLabelHtml：items.flatMap + Array.from({length: qty}, oneLabel) 依 qty 展開；移除標籤上的 xN 顯示
- print-service.js buildBridgePayload：mode='label' 時，items 用 flatMap 展開成 N 個 qty:1 獨立 item，APK 收到 N 個 item 就印 N 張
- 顧客單 / 廚房單模式不變（仍合併 xN）

新增功能六：點餐 modal 數量 +/- 快捷按鈕
- index.html productConfigModal：在 itemQtyInput 兩側加 #qtyMinusBtn / #qtyPlusBtn
- 純 inline onclick，調整完用 dispatchEvent(new Event('input', {bubbles:true})) 觸發既有 pos-page.js 小計重算邏輯，零 JS 改動
- 最小值固定為 1（要取消改用「取消」按鈕，不用降到 0）

踩雷紀錄：
- 在沒看完整個 repo 前不要下「字串不存在」的結論。reports-page.js 是這次卡關 1 小時的元兇
- 多個頁面綁定同一個 button id 的 handler 是大忌：pos-page 與 reports-page 都綁了 #openCashDrawerBtn，後綁的覆蓋會看模式選擇，造成偽 race condition
- 短命 fetch 失敗（NanoHTTPD socket close）需要 retry，不是 server bug
- 標籤展開要在 buildBridgePayload 處理（送 APK 用），不是只改 getLabelHtml（瀏覽器 fallback 用）；兩處都要改

### v20260608 已完成（雲端資料三層架構：IndexedDB + Firebase posBackup + Google Sheets）
本版於 lcym346-byte/2237-1 門市 1 完成，所有 commit 同樣適用於總部範本 jess0937588151-hue/2234。

新增功能一：本地儲存升級為 IndexedDB（store.js commit 1/3）
- js/core/store.js 內建 IndexedDB wrapper（資料庫 `restaurantPosDB`、object store `kvStore`、key=`posState`），無外部套件
- 雙寫策略：localStorage 為快取／向下相容、IndexedDB 為主儲存；啟動時若 localStorage 有資料、IndexedDB 沒資料，自動遷移並 console 印 `[store] 已從 localStorage 自動遷移至 IndexedDB`
- URL 參數綁定店家：`?storeId=xxx&storeName=yyy` 寫入 `state.settings.store = { storeId, storeName, boundAt }`，已綁定後忽略後續 URL 變更；提供 `state.rebindStore()` 重新綁定
- 預設 store001 / 測試店
- 實測通過：store001 / 測試店在 Sunmi T2 與 Chrome 桌面均載入 OK，無痕視窗開 `?storeId=store099&storeName=測試新店` 也能正確綁定

新增功能二：Firebase Realtime Database 全量備份（store.js commit 2/3）
- 路徑 `posBackup/{storeId}/state`，內含 `data`（state 全文）與 `meta`（backupAt / orderCount / deviceId）
- 10 秒節流（CLOUD_THROTTLE_MS = 10000）由 persistAll() 觸發，避免高頻寫入
- 啟動時若本地 IndexedDB + localStorage 均為空且 storeId 已綁定，confirm 詢問是否從雲端還原；拒絕後本次 session 不再詢問（sessionStorage 旗標）
- 新增 `state.settings.cloudBackup = { enabled, lastBackupAt, lastRestoreAt, status, deviceId }`
- URL 綁定店家時自動同步 `storeId / storeName` 至 `state.settings.dashboard`，供 dashboard-publish.js 與 realtime-order-service.js 使用
- 全域 API：`state.cloudBackupNow()`、`state.tryRestoreFromCloud()`
- Firebase Realtime Database 安全規則新增節點 `"posBackup": { ".read": "auth != null", ".write": "auth != null" }`（其餘節點維持原狀）
- 實測通過：store001 寫入 `posBackup/store001/state`，meta.backupAt 與 meta.orderCount 正確

新增功能三：Google Sheets 增量同步（sheets-sync.js + index.html commit 3/3）
- 新增 `js/modules/sheets-sync.js`：每 15 分鐘 setInterval + 訂單/班次變動 10 秒節流，增量推送至 Google Apps Script Web App
- index.html 在 `js/app.js` 之後新增 `<script type="module" src="js/modules/sheets-sync.js"></script>`
- Apps Script 後端 `POS Sync Backend`：固定 spreadsheetId 寫死於 `SPREADSHEET_ID` 常數；doPost 依 storeId 寫入 `{storeId}_orders` / `{storeId}_sessions` / `{storeId}_voided` 分頁；orderNo / sessionId 去重；首次寫入自動建立分頁與表頭並凍結首列
- POS 端固定 Web App URL 寫死於 `APPS_SCRIPT_URL` 常數（store001 範本：https://script.google.com/macros/s/AKfycbxbQTMq2BZOvdIexY3pz_DERQGe44aR_OLIf-xZbt8MHHDjEI-WHe5408A9qXvTonlC/exec）
- 已同步的 key 記錄於 `state.settings.sheetsSync.syncedOrderNos / syncedSessionIds`，最多保留 2000 筆 / 500 筆
- 全域 API：`window.sheetsSyncNow()`、`window.sheetsSyncStatus()`、`window.sheetsSyncReset()`
- 待付款（status=pending）與作廢（status=void）暫不送，僅送 completed 訂單；班次僅送 endedAt 有值（已結束）的
- fetch 必須用 `Content-Type: text/plain;charset=utf-8` 避開 CORS preflight，Apps Script doPost 用 e.postData.contents 解析 JSON 完全相容
- 實測通過：手動 `await window.sheetsSyncNow()` 與 30 秒自動觸發均成功寫入 store001 試算表

踩雷紀錄：
- Apps Script Web App URL 用瀏覽器直接開啟，若 Chrome 同時登入多個 Google 帳號會自動加 `/u/1/` 路徑，造成「很抱歉，目前無法開啟這個檔案」誤判為部署失敗；實際 URL 沒問題，POS 用 fetch 也不會有此問題。驗證 URL 改用無痕視窗或 curl。
- Apps Script 部署「執行身分=我、存取對象=任何人」是讓 POS 跨網域 POST 的必要條件；缺一無法寫入。
- 第一次執行 testInsertSample 須走「進階 → 前往（不安全）→ 允許」完成 OAuth 授權，否則 Apps Script 無法 openById 寫入試算表。
- Firebase Realtime Database 規則若沒加 `posBackup` 節點，會出現 `permission_denied`，雲端備份呼叫失敗但本地仍正常；補規則後即恢復。
- 兩個 storeId 來源（`state.settings.store.storeId` 與 `state.settings.dashboard.storeId`）必須在 URL 綁定時同步寫入，否則 dashboard-publish.js 看板與 sheets-sync.js 同步會用到不同的 storeId 造成分流錯誤。
- sheets-sync.js 採用「監測 state.orders.length / sessions.length 變化」的 polling（每 2 秒）取代覆寫 persistAll，避免循環依賴與遞迴 import。
- service-worker CACHE_NAME 升版是讓所有裝置自動載入新版的必要動作（v20260608 commit 完成後需另外升版本號，避免使用者卡舊快取）。

---

## 八、待辦

### 短期
- Google 登入失敗：APK 改純後台架構後，使用者改用一般瀏覽器（非 WebView）開網頁，Google OAuth 不再被 disallowed_useragent 擋。問題消失，不需處理。
- APK 被 T2 系統殺掉：使用者改用「Web 直接開」，不再依賴 APK 開 WebView
- 自動更新檢查：維持手動更新
- v20260608 後續：升 service-worker CACHE_NAME 至 `pos-v20260608-cache` 並把 `js/modules/sheets-sync.js` 加入 ASSETS 預快取清單；UI 端在設定頁新增「Google Sheets 同步狀態」面板（顯示 `state.settings.sheetsSync.status / lastSyncAt / lastError` 與「立即同步」「重置已同步紀錄」按鈕）

### 長期
- A. 2234 打包成獨立 APK（含市售印表機列印模組：藍牙 / 網路 / USB ESC/POS）
  - 用其他裝置時不影響 Sunmi T2 列印（因 print-bridge.js 只認本機 127.0.0.1:8080，不認牌子）
  - 新 APK 必須實作完整 /ping、/print/*、/drawer/open，且 /ping 要回 token 給 web 自動同步
  - 新 APK printPosReceipt 必須讀 payload.fields 旗標、支援標籤模式 qty 展開的 N 個 qty:1 item，否則重蹈 v20260607 覆轍
- B. 多店即時營業看板網站（Firebase 資料源 `dashboards/{storeId}/` + `sessionHistory/{storeId}/{date}/`）
- C. 新加盟店上線流程簡化：fork 範本 repo → 改 GitHub Pages → Sunmi T2 開 `?storeId=storeXXX&storeName=店名` 桌面捷徑（≈ 5 分鐘 / 店）
- D. POS 新功能 / 流程改善（待用戶提出）

### Android 平台已知限制（不要嘗試突破）
- 不可能整合 HP / Epson / Canon 的 Windows 私有驅動
- 非 ESC/POS 印表機（A4 雷射 / 噴墨）只能透過 Mopria / IPP

---

## 九、關鍵檔案地圖

網頁（總部範本 jess0937588151-hue/2234 與門市 lcym346-byte/2237-1 結構一致）：

- index.html — 主頁面 + 各 view 區塊（含 reservationReminderOverlay、productConfigModal 內 +/- 數量按鈕；尾端外部腳本區載入 app.js 與 sheets-sync.js）
- js/app.js — 入口、Service Worker 註冊、startReservationReminderLoop()
- service-worker.js — PWA 快取（CACHE_NAME，修改記得改觸發更新；ASSETS 需含 sheets-sync.js）
- js/core/store.js — 全域 state 與持久化（v20260608 起：IndexedDB 主儲存 + localStorage 雙寫 + Firebase posBackup 全量備份 10 秒節流 + URL 參數綁定店家 + 啟動時 confirm 還原）
- js/core/utils.js — 格式化、下載等工具
- js/modules/print-bridge.js — 列印橋接偵測（HTTP/WebView/系統），含 X-API-Token header、fetch retry、token 自動同步
- js/modules/print-service.js — 列印主服務（getReceiptHtml / getLabelHtml / buildBridgePayload / printOrderReceipt / printOrderLabels / openCashDrawer 等；標籤模式 qty 展開）
- js/modules/order-service.js — 訂單建立 / 結帳
- js/modules/cart-service.js — 購物車
- js/modules/realtime-order-service.js — Firebase 線上單監聽 + D9 自動列印 + D10 預約提醒；公用 `_getRef(path)` 與 `_dbApi()` 供其他模組使用
- js/modules/customer-service.js — 顧客資料、電話遮罩
- js/modules/report-session.js — 班次 / 報表 / `sessionHistory/{storeId}/{date}/` 雲端上傳
- js/modules/dashboard-publish.js — 多店看板心跳 + 今日營業統計 + 班次摘要（30 秒一次）
- js/modules/google-backup-service.js — Google Drive 備份（舊版手動匯出，與 v20260608 自動 Sheets 同步並存）
- js/modules/sheets-sync.js — v20260608 新增，Google Sheets 自動增量同步（每 15 分鐘 + 班次結束 + 訂單完成 10 秒節流）
- js/pages/pos-page.js — 點餐頁（finalizeOrder 含開錢箱與雙列印；唯一綁 #openCashDrawerBtn 的地方）
- js/pages/orders-page.js — 訂單查詢
- js/pages/reports-page.js — 報表（含 CSV overlay 匯出；不可再加 #openCashDrawerBtn handler）
- js/pages/products-page.js — 商品管理
- js/pages/settings-page.js — 設定頁（含印表機偵測 UI、三預覽按鈕需先設 pendingPreviewMode；未來預計加入「Google Sheets 同步狀態」面板）

雲端後端：

- Firebase Realtime Database `webpos-1f626`：節點 `staff` / `menu` / `onlineOrders` / `orders` / `stores` / `dashboards` / `sessionHistory` / `dashboardAccess` / `posBackup`（v20260608 新增）
- Google Apps Script `POS Sync Backend`：依附於 Google Sheet「POS 同步資料庫」，spreadsheetId 寫死於 SPREADSHEET_ID 常數；doPost 寫入 `{storeId}_orders` / `{storeId}_sessions` / `{storeId}_voided`

APK（jess0937588151-hue/sunmi-pos-v2）：

- app/src/main/java/com/pos/sunmiprinter/MainActivity.java — 健康檢查頁
- app/src/main/java/com/pos/sunmiprinter/SettingsActivity.java — APK 設定頁（token + 列印狀態）
- app/src/main/java/com/pos/sunmiprinter/AppSettings.java — SharedPreferences 包裝
- app/src/main/java/com/pos/sunmiprinter/PrintService.java — Foreground Service（含 WAKE_LOCK）
- app/src/main/java/com/pos/sunmiprinter/PrintHttpServer.java — NanoHTTPD 路由器（/ping 回 token；readBody 用 UTF-8 byte 解碼）
- app/src/main/java/com/pos/sunmiprinter/BootReceiver.java — 開機自動啟動
- app/src/main/java/com/pos/sunmiprinter/LogManager.java — 全 APK 共用日誌
- app/src/main/java/com/pos/sunmiprinter/PrintQueue.java — 列印任務序列化
- app/src/main/java/com/pos/sunmiprinter/printer/SunmiPrinterManager.java — AIDL 綁定 + 列印（讀 fields 旗標 + key fallback）
- app/src/main/java/com/pos/sunmiprinter/printer/BluetoothPrinterManager.java — 藍牙 ESC/POS
- app/src/main/java/com/pos/sunmiprinter/printer/NetworkPrinterManager.java — 網路 ESC/POS
- app/src/main/java/com/pos/sunmiprinter/printer/SunmiCallbackAdapter.java — Sunmi 回調轉接
- app/src/main/assets/test-print.html — 內建測試列印頁
- app/src/main/AndroidManifest.xml — INTERNET / BLUETOOTH / FOREGROUND_SERVICE / RECEIVE_BOOT_COMPLETED / WAKE_LOCK / REQUEST_IGNORE_BATTERY_OPTIMIZATIONS

---

## 十、AI 工作守則

1. 動手前先讀完此文件，禁止憑記憶或猜測修改
2. 每次只改一個檔案 → 一個 commit → 清楚的 commit message
3. 改完更新「進度紀錄」段落
4. 給使用者改動時必含：完整檔案內容（不是片段插入）、檔案路徑、GitHub edit URL、commit message
5. 列印議題先看 APK /logs，不要猜中文編碼問題
6. 多個頁面禁止綁定同一個 button id 的 click handler；新增 button 前先全 repo 搜尋確認 id 沒重複
7. 標籤模式 qty 展開要同時改 getLabelHtml（瀏覽器）與 buildBridgePayload（APK 路徑），缺一不可
8. token 相關 endpoint 必須有 401/403 自動重抓重試機制
9. Sunmi T2 不支援部分新 API、compileSdk=28 不可用 foregroundServiceType
10. 使用者不寫程式 → 不要叫他「在某行後面插入」，要給整檔；若真有「插入一行」的需求，必須同時附上前後不變的數行作為錨點供使用者確認
11. 回覆使用者用繁體中文
12. 在沒讀完整個 repo（特別是 pages 內各檔的事件綁定）前，不要下「字串不存在」「程式碼沒這段」的結論
13. README 內示範程式碼禁止使用三反引號 ``` 內嵌另一段三反引號區塊（會把外層提前結束、後半變正文）。需要在區塊內展示 JSON / 程式碼時，改用「四個空白縮排」表示，或把內層改成單行 inline code。整份 README 從頭到尾只能有一層 ``` 區塊（或乾脆都不用，全部改縮排）。
14. 修改 store.js / 新增 js/modules/*.js / 修改 index.html 後，務必提醒使用者升 service-worker.js 的 CACHE_NAME（並把新檔加入 ASSETS），否則所有已安裝 PWA 的裝置會卡舊版快取
15. 多店架構：所有跨店資料路徑必須以 `state.settings.store.storeId || state.settings.dashboard.storeId` 取得 storeId，絕不寫死；URL 參數綁定店家後要同步寫入兩個欄位

---

## 十一、版本紀錄

- 2026-05-11 Claude：v20260608 完工。雲端三層架構（IndexedDB + Firebase posBackup + Google Sheets 增量同步）上線。新增 store.js 內建 IndexedDB wrapper、URL 參數綁定店家、Firebase posBackup 全量備份 10 秒節流、啟動時 confirm 從雲端還原。新增 js/modules/sheets-sync.js 每 15 分鐘 + 變動 10 秒節流增量推送至 Google Apps Script Web App，分頁依 storeId 區分。Apps Script 後端 POS Sync Backend 寫死 spreadsheetId，依 orderNo / sessionId 去重。新增工作守則第 10 條補強「插入錨點」、第 14 條補強「CACHE_NAME 升版提醒」、第 15 條補強「多店 storeId 取法」。
- 2026-05-09 Claude：v20260607 完工。修復 fields 勾選矩陣（APK + Web）、開錢箱誤判訊息（移除 reports-page.js 重複 handler）、連續開錢箱失敗（fetch retry）、預覽按鈕 pendingPreviewMode 漏設。新增標籤一品項一張（getLabelHtml + buildBridgePayload 雙改）、點餐 modal 數量 +/- 快捷按鈕（純 HTML inline onclick，零 JS 改動）。踩雷紀錄已寫入 v20260607 段落。
- 2026-05-06 Claude：v20260606 完工，token 自動同步上線，列印鏈路恢復正常。
- 2026-05-04 Claude：v20260603 APK 商用化補強完成。
- 2026-05-02 Claude：v20260602 列印橋接版上線。
- 2026-05-01 Claude：v20260601 架構重構完成（APK 改純後台 HTTP Server）。
