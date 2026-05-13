# POS 專案 AI 接手說明書

> 給每一個新接手的 AI：**動手前先讀完這份文件，以及本目錄下的 `aiREADME最新進度.md`**，禁止憑記憶或猜測修改。

---

## 📚 相關文件

| 檔案 | 用途 | 何時讀 |
|---|---|---|
| `aiREADME.md`（本檔） | 專案說明、架構、規範守則 | **每次接手必讀** |
| `aiREADME最新進度.md` | 當前版本進行中項目、待處理、已知問題 | **每次接手必讀** |
| `aiREADME已完成紀錄.md` | 所有版本已完成項目的詳細紀錄（追溯用） | 需要查歷史時讀 |

---

## 一、專案組成

| 角色 | Repo | 部署/用途 |
|---|---|---|
| 網頁主程式（總部範本） | https://github.com/jess0937588151-hue/2234 | 部署於 https://jess0937588151-hue.github.io/2234/ |
| 網頁主程式（門市 1） | https://github.com/lcym346-byte/2237-1 | 部署於 https://lcym346-byte.github.io/2237-1/ |
| Sunmi 列印橋接 APK | https://github.com/jess0937588151-hue/sunmi-pos-v2 | 純後台 HTTP Server，僅在 Sunmi T2 上安裝 |
| 舊版參考 | https://github.com/jess0937588151-hue/2332 | 已知可正常使用的版本，遇到回歸問題時對照 |
| 多店看板 | https://github.com/lcym346-byte/pos-dashboard | 老闆用，跨店即時營業狀況 |

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

**Apps Script 後端**：每個試算表內附帶一份 Apps Script 專案 `POS Sync Backend`，已部署為 Web App（執行身分=擁有者、存取對象=任何人）。固定 spreadsheetId 寫死在 `SPREADSHEET_ID` 常數，避免多帳號干擾。試算表 ID：`1RTcKK-cZutAtSBQtPU6O7PcNKUVP53MBgoa6Dk0PFXc`。Web App URL：`https://script.google.com/macros/s/AKfycbxbQTMq2BZOvdIexY3pz_DERQGe44aR_OLIf-xZbt8MHHDjEI-WHe5408A9qXvTonlC/exec`。Web App URL 在瀏覽器直接開若被 Chrome 自動加 `/u/1/` 會 404，但 POS 用 fetch POST 不會有此問題。fetch 必須用 `Content-Type: text/plain;charset=utf-8`（Apps Script doPost 用 `e.postData.contents` 解析 JSON）避開 CORS preflight。

---

## 六、營業日 (Business Day, BD) 規約（v20260613 確立）

POS 與看板統一使用「營業日」概念，跨日營業時段歸屬同一個 BD。

**核心定義**：
- BD = 依店家 `businessHours` 切分的營業日單位（YYYY-MM-DD 字串）
- 例：店家設定 14:00–03:00，則 5/1 14:00 ~ 5/2 03:00 全部屬於「5/1 BD」
- 公休日（businessHours[weekday] = []）不會產生 BD

**訂單歸屬規則**：
- 預約待付款單（`status='pending'` 且有 `reservationAt`）：依 `reservationAt` 歸 BD
- 其他所有訂單：依 `createdAt` 歸 BD

**今日 BD = `getCurrentBusinessDay(businessHours)`**，例如：
- 5/12 23:59（在 14:00–03:00 期間）→ 今日 BD = 5/12
- 5/13 02:00（仍在 5/12 的跨日尾巴）→ 今日 BD = 5/12
- 5/13 04:00（已過營業時段）→ 今日 BD = 5/13（即將開始）

**共用工具檔案**：
- POS 端：`js/core/biz-day.js`
- 看板端：`js/biz-day.js`（**邏輯必須與 POS 端完全一致；未來修改需同步兩個檔案**）

**異常 = void / cancelled / refunded**：獨立顯示不計入營業額。

**外送平台**：熊貓 Grod（台灣熊貓被併購交接中，命名先用此）+ Uber，計入「其他」付款，不計入現金。手動於結束值班時輸入，**只計入該班結束後的 BD 今日總覽**（避免值班中無法結算的問題）。

**雲端與本地 `sessionHistory` 都保留 90 天**，`sessionHistory/{storeId}/{BD}/{sessionId}` 路徑的 BD 採班次 `startedAt` 的營業日。

---

## 七、AI 工作守則

1. **動手前先讀完本檔 + `aiREADME最新進度.md`**，禁止憑記憶或猜測修改。
2. **每次只改一個檔案**，每個檔案一個 commit，commit message 描述清楚做了什麼。
3. 所有改動完成後**必須更新 `aiREADME最新進度.md`**（移動已完成項目到 `aiREADME已完成紀錄.md`，更新進行中／待辦／已知問題）。
4. 回覆一律使用**繁體中文**。
5. 改完任何檔案後，**完整讀取一次該檔案內容**確認沒有語法錯誤、沒有遺漏函式閉合大括號、沒有重複貼上同一段（v20260613 reports-page.js 曾發生過 const payKeys 重複宣告造成 SyntaxError）。
6. 列印與印表機相關修改必須同時驗證收據 / 廚房單 / 標籤三種模式。
7. 跨店資料路徑一律使用 `state.settings.store.storeId || state.settings.dashboard.storeId`，禁止寫死 `store001`。
8. PWA 升版後**必須升 service-worker.js 的 CACHE_NAME**，否則使用者要手動清快取才能載入新檔。
9. 修改 Firebase 安全規則前必須先在 Firebase Console 備份原規則，並回報新增的路徑。
10. **使用者不寫程式**：所有改動必須給「**完整段落跟錨點。如果修改多處就給完整檔案內容** + 檔案路徑 + GitHub edit 連結 + Commit message」；若必須給片段，至少要包含「上下各 3 行不改動的內容」作為錨點，禁止只說「在第 N 行加上 X」。
11. 一次 commit 只動一個檔案；多檔案改動拆成多個 commit，每個 commit 都要可獨立還原。
12. 收到「網頁剩框架沒資料」「畫面空白」「Console SyntaxError」這類回報，**先懷疑上一次改動有沒有破壞語法**，立刻完整讀取該檔案、找出破壞點，不要急著加 console.log 或重寫邏輯。
13. README 內若需嵌入 markdown 三反引號區塊，內層改用四空白縮排，避免破壞外層 fence。
14. **新增/刪除前端 JS 檔案後必須升 service-worker.js 的 CACHE_NAME 並把新檔加入 ASSETS pre-cache 清單**，否則 PWA 用戶會載到 404。
15. 跨店時所有 Firebase 路徑、Google Sheet 分頁名稱、Drive 備份檔名都必須以 `state.settings.store.storeId` 為前綴，禁止把任何一店寫死。
16. **跨日相關計算（今日營業額、週、月、歷史 60 天）一律使用 `js/core/biz-day.js` 的 BD 函式**，禁止用自然日 00:00–23:59 計算。
17. **訂單修改 = 加到購物車 + 結帳建新單 + 作廢原單**（v20260613 確立），禁止再寫入「就地修改原訂單」邏輯。`createOrUpdateOrder` 雖保留舊名，但內部永遠建新單。

---

## 八、關鍵檔案地圖

**網頁 repo（lcym346-byte/2237-1、jess0937588151-hue/2234）**
- `index.html` — 主頁面骨架、所有 modal、外部腳本載入區
- `online-order.html` — 顧客掃 QR 線上點餐頁
- `service-worker.js` — PWA 快取（升新版必須改 CACHE_NAME）
- `manifest.webmanifest` — PWA 設定
- `js/app.js` — 主入口，初始化所有頁面與服務
- `js/core/store.js` — 狀態管理、IndexedDB / localStorage / Firebase posBackup 三層持久化
- `js/core/store-config.js` — **店家寫死設定（每店複製時只改這個）**
- `js/core/biz-day.js` — **營業日 (BD) 共用工具（v20260613 新增）**
- `js/modules/sheets-sync.js` — Google Sheets 增量同步
- `js/modules/print-bridge.js` — 三層列印橋接偵測
- `js/modules/print-service.js` — 列印路由
- `js/modules/order-service.js` — 訂單建立（v20260613 起每次都建新單）
- `js/modules/realtime-order-service.js` — Firebase 線上接單 + Firebase API 共用
- `js/modules/report-session.js` — 班次（v2.1 含作廢機制；v20260613 加外送與 BD）
- `js/modules/google-backup-service.js` — Google Drive 備份
- `js/modules/dashboard-publish.js` — 多店看板資料發佈（v20260613 改 BD）
- `js/pages/*` — pos / orders / reports / products / settings 各頁面

**看板 repo（lcym346-byte/pos-dashboard）**
- `index.html` — 看板主頁面
- `js/biz-day.js` — **BD 工具（與 POS 端 `js/core/biz-day.js` 邏輯一致，需同步維護）**
- `js/history-loader.js` — 從 Firebase 讀 sessionHistory 並彙總
- 其他模組依需求

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

## 九、目前實機狀況

最新驗證版本：v20260608（2026-05-11 雲端三層完工）

最後一輪實測通過項目：
- 顧客單、廚房單、預覽單列印中文正確，欄位勾選矩陣生效
- 錢箱經 Sunmi 路徑開啟成功，連續按兩次都能開
- 三個預覽列印按鈕（顧客 / 廚房 / 標籤）正確帶入 pendingPreviewMode
- 標籤一品項一張：雞排 qty=2 印 2 張、3 個品項各 qty=1 印 3 張
- POS 點餐 modal 的數量輸入框旁有 +/- 快捷按鈕，按下小計即時更新
- 雲端三層：IndexedDB 載入 OK、`posBackup/store001/state` 寫入成功、`store001_orders / store001_sessions` Apps Script 寫入成功

**v20260613 部分未實機驗證**，請見 `aiREADME最新進度.md`。

---

> 詳細的歷史進度紀錄請見 **`aiREADME已完成紀錄.md`**。
> 當前進行中與待處理事項請見 **`aiREADME最新進度.md`**。
