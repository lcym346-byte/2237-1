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


### v20260608 已完成（雲端三層架構：IndexedDB + Firebase posBackup + Google Sheets 增量同步）

**Commit 1：store.js 升級為 IndexedDB 主儲存**
- 新增 IndexedDB 極簡 wrapper（restaurantPosDB / kvStore / posState）
- 與 localStorage 雙寫快取，啟動時自動從 localStorage 遷移
- 新增 URL 參數 `?storeId=xxx&storeName=yyy` 首次綁定機制
- 新增 `state.rebindStore({storeId, storeName})` API

**Commit 2：Firebase posBackup 全量備份**
- 路徑 `posBackup/{storeId}/state`，payload 含 `data` + `meta`
- `persistAll()` 觸發 10 秒節流（CLOUD_THROTTLE_MS = 10000）上傳
- 啟動時若 IndexedDB 與 localStorage 均空且 storeId 已綁定，confirm 詢問是否從雲端還原
- Firebase 安全規則新增 `posBackup` 節點（auth != null）
- 全域 API：`state.cloudBackupNow()`、`state.tryRestoreFromCloud()`

**Commit 3：Google Sheets 增量同步**
- 新增檔案 `js/modules/sheets-sync.js`，後端寫死 APPS_SCRIPT_URL
- 分頁 `{storeId}_orders` / `{storeId}_sessions` / `{storeId}_voided`，依 orderNo / sessionId 去重
- 三重觸發：每 15 分鐘 setInterval + 訂單完成 / 班次結束（10 秒節流）+ 啟動後 30 秒首同步
- 已同步 key 保留上限 2000 筆訂單 / 500 筆班次（先進先出）
- 失敗自動記錄 `lastError`，下次自動重試
- 全域 API：`window.sheetsSyncNow()`、`window.sheetsSyncStatus()`、`window.sheetsSyncReset()`
- index.html 增加一行 `<script type="module" src="js/modules/sheets-sync.js">`

**Commit 4：store-config.js 寫死店家綁定 + 強制鎖定**
- 新增檔案 `js/core/store-config.js`，匯出 `STORE_CONFIG` 物件（storeId / storeName / storeCode / lockFromUrl）
- `store.js`、`sheets-sync.js` 改為 import STORE_CONFIG，優先順序：STORE_CONFIG > URL 參數
- 多店複製時只需改 `store-config.js` 三個值，其他檔案完全不動

**Commit 5：fix 補上 hydrate 缺漏**
- `applyStoreBindingFromUrl(state)` 補上參數
- hydrate 第一輪加上 `syncStoreToDashboard()` 呼叫

**Apps Script 後端**：
- 試算表 ID：`1RTcKK-cZutAtSBQtPU6O7PcNKUVP53MBgoa6Dk0PFXc`
- Web App URL：`https://script.google.com/macros/s/AKfycbxbQTMq2BZOvdIexY3pz_DERQGe44aR_OLIf-xZbt8MHHDjEI-WHe5408A9qXvTonlC/exec`
- 共用後端：所有店家共用同一個 spreadsheet，以 `{storeId}_xxx` 分頁區分
- doPost 用 `Content-Type: text/plain;charset=utf-8` 避開 CORS preflight

**踩雷紀錄（v20260608）**：
- Chrome 多帳號干擾：Apps Script 部署後若有第二個 Google 帳號登入，瀏覽器會自動加 `/u/1/` 到 URL，導致「無法開啟檔案」錯誤。解法：用無痕視窗只登一個帳號操作，或在 fetch POST 時用本來的乾淨 URL（POST 不受帳號路徑影響）。
- 給使用者修改錨點時務必把「整段函式」當作最小單位置換，**不可只刪一行/補一行**，否則容易把對應的 `}` 或 `{` 連帶搞錯。v20260608 期間發生過兩次語法錯誤：
  - 第一次：刪掉舊 `if (boundByUrlSync) {` 但忘記同步刪除對應的 `}`，導致 hydrateState 被孤兒 `}` 提前結束，整支 store.js SyntaxError → 畫面空白只剩框架。
  - 第二次：修第一次的錯時，把 `getDeviceId()` 函式的閉合 `}` 也誤刪，造成 `Unexpected token 'export'`。
  - 教訓：以後改 store.js 這類關鍵檔案，必須讀完整檔、把整段函式置換，不要只給「在 X 行加/刪 Y 行」這種片段指引。
- 線上點餐頁（online-order.html）不該套用 STORE_CONFIG 鎖定，因為它本來就要靠 URL `?storeCode=xxx` 區分顧客掃哪家店的 QR。POS 後台才需要鎖定。

---

## 八、待辦事項

**短期（一週內）**
- 把 v20260608 三個 commit 複製到 `jess0937588151-hue/2234`（store002 / 中壢民族店），只需改 `store-config.js` 三個值
- 設定頁加入 Google Sheets 同步狀態面板（顯示 lastSyncAt / lastError / status，提供「立即同步」「重置已同步紀錄」按鈕）
- 升級 `service-worker.js` 的 CACHE_NAME 至 `pos-v20260608-cache`，並把 `js/modules/sheets-sync.js`、`js/core/store-config.js` 加入 ASSETS pre-cache 清單

**中期（一個月內）**
- 開發跨店即時看板（新 repo），讀 `dashboards/{storeId}` 與 `sessionHistory/{storeId}/{date}` 顯示所有店今日營業額、訂單數、班次狀態
- 線上點餐頁（online-order.html）加入 storeCode 白名單機制，非已知 storeCode 顯示「店家不存在」

**長期**
- 打包獨立 APK：整合藍牙 / 網路 / USB ESC/POS，目前只支援 Sunmi T2 內建印表機
- 上線流程簡化：新店家開店標準作業（fork repo、改 store-config.js、設定 Sunmi 桌面捷徑）

---

## 九、關鍵檔案地圖

**網頁 repo（lcym346-byte/2237-1、jess0937588151-hue/2234）**
- `index.html` — 主頁面骨架、所有 modal、外部腳本載入區
- `online-order.html` — 顧客掃 QR 線上點餐頁
- `service-worker.js` — PWA 快取（升新版必須改 CACHE_NAME）
- `manifest.webmanifest` — PWA 設定
- `js/app.js` — 主入口，初始化所有頁面與服務
- `js/core/store.js` — 狀態管理、IndexedDB / localStorage / Firebase posBackup 三層持久化
- `js/core/store-config.js` — **店家寫死設定（每店複製時只改這個）**
- `js/modules/sheets-sync.js` — Google Sheets 增量同步
- `js/modules/print-bridge.js` — 三層列印橋接偵測
- `js/modules/print-service.js` — 列印路由
- `js/modules/order-service.js` — 訂單建立與付款狀態
- `js/modules/realtime-order-service.js` — Firebase 線上接單 + Firebase API 共用
- `js/modules/report-session.js` — 班次（v2.1 含作廢機制）
- `js/modules/google-backup-service.js` — Google Drive 備份
- `js/modules/dashboard-publish.js` — 多店看板資料發佈
- `js/pages/*` — pos / orders / reports / products / settings 各頁面

**APK repo（jess0937588151-hue/sunmi-pos-v2）**
- `app/src/main/java/com/pos/sunmiprinter/MainActivity.java` — 健康檢查頁
- `app/src/main/java/com/pos/sunmiprinter/SettingsActivity.java` — 設定頁
- `app/src/main/java/com/pos/sunmiprinter/PrintService.java` — Foreground Service
- `app/src/main/java/com/pos/sunmiprinter/PrintHttpServer.java` — NanoHTTPD（127.0.0.1:8080）
- `app/src/main/java/com/pos/sunmiprinter/LogManager.java` — 日誌中心
- `app/src/main/java/com/pos/sunmiprinter/PrintQueue.java` — 單線程列印佇列
- `app/src/main/java/com/pos/sunmiprinter/printer/SunmiPrinterManager.java`
- `app/src/main/java/com/pos/sunmiprinter/printer/BluetoothPrinterManager.java`
- `app/src/main/java/com/pos/sunmiprinter/printer/NetworkPrinterManager.java`

---

## 十、AI 工作守則

1. **動手前先讀完這份文件**，禁止憑記憶或猜測修改。
2. **每次只改一個檔案**，每個檔案一個 commit，commit message 描述清楚做了什麼。
3. 所有改動完成後**必須更新本文件的「進度紀錄」段落**。
4. 回覆一律使用**繁體中文**。
5. 改完任何檔案後，**完整讀取一次該檔案內容**確認沒有語法錯誤、沒有遺漏函式閉合大括號。
6. 列印與印表機相關修改必須同時驗證收據 / 廚房單 / 標籤三種模式。
7. 跨店資料路徑一律使用 `state.settings.store.storeId || state.settings.dashboard.storeId`，禁止寫死 `store001`。
8. PWA 升版後**必須升 service-worker.js 的 CACHE_NAME**，否則使用者要手動清快取才能載入新檔。
9. 修改 Firebase 安全規則前必須先在 Firebase Console 備份原規則，並回報新增的路徑。
10. **使用者不寫程式**：所有改動必須給「**完整檔案內容** + 檔案路徑 + GitHub edit 連結 + Commit message」；若必須給片段，至少要包含「上下各 3 行不改動的內容」作為錨點，禁止只說「在第 N 行加上 X」。
11. 一次 commit 只動一個檔案；多檔案改動拆成多個 commit，每個 commit 都要可獨立還原。
12. 收到「網頁剩框架沒資料」「畫面空白」「Console SyntaxError」這類回報，**先懷疑上一次改動有沒有破壞語法**，立刻完整讀取該檔案、找出破壞點，不要急著加 console.log 或重寫邏輯。
13. README 內若需嵌入 markdown 三反引號區塊，內層改用四空白縮排，避免破壞外層 fence。
14. **新增/刪除前端 JS 檔案後必須升 service-worker.js 的 CACHE_NAME 並把新檔加入 ASSETS pre-cache 清單**，否則 PWA 用戶會載到 404。
15. 跨店時所有 Firebase 路徑、Google Sheet 分頁名稱、Drive 備份檔名都必須以 `state.settings.store.storeId` 為前綴，禁止把任何一店寫死。

---

## 版本紀錄

| 版本 | 日期 | 重點 |
|---|---|---|
| v20260601 | 2026-04-xx | APK 純後台改造、三層列印橋接、設定頁 UI |
| v20260602 | 2026-04-xx | 印表機字串排版、token 驗證初版、SW cache 更新 |
| v20260603 | 2026-04-xx | APK 商用化補強（LogManager、PrintQueue、API Token） |
| v20260606 | 2026-05-xx | token 自動同步、列印與錢箱回歸 |
| v20260607 | 2026-05-xx | fields 勾選矩陣 + 標籤一品項一張 + 數量 +/- 按鈕 |
| v20260608 | 2026-05-11 | 雲端三層架構（IndexedDB + Firebase posBackup + Google Sheets）+ store-config.js 寫死店家綁定 |
