# 餐廳 POS 系統(多店架構)

> 商用等級 Web POS 系統,專為 Sunmi T2 終端機設計,支援雲端三層備份、即時跨店看板、線上點餐、Google Sheets 同步,並可於 iPad、Windows、Android 等備援裝置運作。

[![版本](https://img.shields.io/badge/version-v20260614-blue)]()
[![授權](https://img.shields.io/badge/license-Private-red)]()
[![部署](https://img.shields.io/badge/deploy-GitHub%20Pages-green)]()

---

## 目錄

1. [產品概述](#1-產品概述)
2. [系統架構](#2-系統架構)
3. [快速開始](#3-快速開始)
4. [硬體與環境需求](#4-硬體與環境需求)
5. [多店部署流程](#5-多店部署流程)
6. [雲端資料三層架構](#6-雲端資料三層架構)
7. [列印架構](#7-列印架構)
8. [Firebase 設定](#8-firebase-設定)
9. [Google Sheets 同步設定](#9-google-sheets-同步設定)
10. [線上點餐(顧客掃 QR)](#10-線上點餐顧客掃-qr)
11. [核心業務邏輯](#11-核心業務邏輯)
12. [檔案結構與職責](#12-檔案結構與職責)
13. [日常維運](#13-日常維運)
14. [故障排除](#14-故障排除)
15. [安全規約](#15-安全規約)
16. [版本歷史](#16-版本歷史)
17. [開發守則(給 AI 與工程師)](#17-開發守則給-ai-與工程師)

---

## 1. 產品概述

### 適用對象
中小型餐飲店家(單店至多店連鎖),需要:
- 在 Sunmi T2 終端機上完成點餐、結帳、出單、開錢箱
- 在 iPad / Windows / Android 觀單與簡易操作
- 跨店即時營運看板(老闆遠端監控)
- 顧客掃 QR 線上點餐(外帶/外送/預約)
- 雲端自動備份、Google Sheets 報表匯出

### 核心功能
| 模組 | 說明 |
|---|---|
| **點餐結帳** | 商品分類、模組化選項(單選/複選/最小最大限制)、即時加總、現金/信用卡/行動支付/外送平台 |
| **訂單管理** | 訂單查詢、狀態追蹤(已完成/待付款/作廢/取消/退款)、訂單修改(加入購物車重新結帳) |
| **班次管理** | 開班 / 結班、開班現金、現金差額、外送平台手動匯入(熊貓 Grod / Uber)、班次摘要列印 |
| **報表中心** | 今日營業、班次明細、付款方式分項、Top 商品、時段分布、CSV 匯出、成本管理與預估獲利 |
| **商品管理** | 分類、商品、模組(選項組)維護;子選項可單獨停售 |
| **預約點餐** | 1 小時後至 2 天內、每 15 分鐘為一個時段、依營業時間自動切割 |
| **線上點餐** | 顧客掃 QR 進入,選單即時同步,送單後 POS 端鈴聲提醒 |
| **即時看板** | 老闆透過獨立網址查看所有店即時營業狀況 |
| **三層備份** | IndexedDB(本地) + Firebase Realtime DB(全量) + Google Sheets(增量) |
| **列印橋接** | HTTP 127.0.0.1:8080 → SunmiPrinter → window.print(),自動容錯 |

### 設計原則
1. **使用者不寫程式**:所有操作透過 UI 完成,設定改動透過 modal,不需編輯任何檔案
2. **離線可用**:本地 IndexedDB 為主儲存,網路斷線不影響營業
3. **多店隔離**:同一 Firebase 專案,以 `storeId` 完全隔離資料路徑
4. **跨裝置容錯**:Sunmi T2 為主、iPad/PC/其他 Android 為備援
5. **資料零遺失**:三層備份 + 60 天歷史 + 90 天雲端 sessionHistory

---

## 2. 系統架構

```
┌─────────────────────────────────────────────────────────────────┐
│                          顧客端 (顧客手機)                          │
│  online-order.html?storeId=TWxxx                                │
│  └─ 線上點餐 → Firebase: onlineOrders/{storeCode}/              │
└─────────────────────────────────────────────────────────────────┘
                              │ (Realtime Push)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Sunmi T2 終端機 (門市主裝置)                     │
│  ┌──────────────────────────┐  ┌──────────────────────────────┐  │
│  │  Chrome (POS 網頁)        │◄─┤  sunmi-pos-v2 APK            │  │
│  │  index.html              │  │  HTTP Server 127.0.0.1:8080   │  │
│  │  - 點餐 / 結帳            │  │  - /print/sunmi  (內建熱感)    │  │
│  │  - 訂單查詢              │  │  - /print/bluetooth (外接 BT)  │  │
│  │  - 班次 / 報表           │  │  - /print/network  (網路)      │  │
│  │  - 線上接單              │  │  - /drawer/open  (錢箱)        │  │
│  └──────────────┬──────────┘  └────────────────────────────────┘  │
└─────────────────┼───────────────────────────────────────────────┘
                  │
                  ├─ IndexedDB (本地主儲存, restaurantPosDB)
                  │
                  ├──► Firebase Realtime DB  (10 秒節流全量備份)
                  │    posBackup/{storeId}/state
                  │    sessionHistory/{storeId}/{BD}/{sessionId}
                  │    dashboards/{storeId}/{heartbeat,today,session,...}
                  │
                  └──► Google Apps Script (15 分鐘 + 班次結束 + 訂單完成)
                       └──► Google Sheets
                            {storeId}_orders / {storeId}_sessions / {storeId}_voided

┌─────────────────────────────────────────────────────────────────┐
│              備援裝置(iPad / Windows / 其他 Android)              │
│  Chrome / Safari 開門市網址 → 無 HTTP Server → window.print()    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                  老闆端 (多店即時看板)                              │
│  pos-dashboard repo → Google 登入 → 讀 dashboards/ + sessionHistory/  │
└─────────────────────────────────────────────────────────────────┘
```

### 專案組成

| 角色 | Repo | 部署/用途 |
|---|---|---|
| 網頁主程式(總部範本) | https://github.com/jess0937588151-hue/2234 | https://jess0937588151-hue.github.io/2234/ |
| 網頁主程式(門市 1) | https://github.com/lcym346-byte/2237-1 | https://lcym346-byte.github.io/2237-1/ |
| Sunmi 列印橋接 APK | https://github.com/jess0937588151-hue/sunmi-pos-v2 | 純後台 HTTP Server,僅在 Sunmi T2 安裝 |
| 多店即時看板 | https://github.com/lcym346-byte/pos-dashboard | 老闆查跨店即時營運 |
| 舊版參考 | https://github.com/jess0937588151-hue/2332 | 遇回歸問題對照 |

---

## 3. 快速開始

### 新門市開店 SOP

1. **複製 Repo**
   - 從 `lcym346-byte/2237-1` 或 `jess0937588151-hue/2234` 複製為新門市 repo(例:`2237-2`)
2. **修改店家綁定**
   - 編輯 `js/core/store-config.js`,改三個值:
     ```js
     export const STORE_CONFIG = {
       storeId: 'store002',        // 雲端路徑用,英數字
       storeName: '二店',           // UI 顯示
       storeCode: 'TW002',          // 線上點餐 QR 用
       lockFromUrl: true            // 鎖定不接受 URL 覆寫
     };
     ```
3. **升 PWA 版號**
   - 編輯 `service-worker.js`,改 `CACHE_NAME = 'pos-vYYYYMMDD-cache'`
4. **GitHub Pages 啟用**
   - Settings → Pages → Source: `main` / `(root)` → 等 1~2 分鐘
5. **首次啟動**
   - 在 Sunmi T2 Chrome 開新門市網址 → 自動讀 `store-config.js` 綁定
   - 確認左下角 storeId 顯示正確
6. **APK 設定**
   - 安裝 `sunmi-pos-v2.apk`、開啟,記下 API Token
   - POS 頁面會在首次 /ping 時自動取回 token(無需手動輸入)
7. **印表機測試**
   - 設定頁 → 三模式預覽(顧客單 / 廚房單 / 標籤)
   - 顧客單測試開錢箱
8. **第一張訂單測試**
   - 加商品 → 結帳 → 確認 IndexedDB 寫入 + Firebase 雲端寫入 + Google Sheets 寫入

### 顧客掃 QR 線上點餐
- 線上點餐網址:`https://lcym346-byte.github.io/2237-1/online-order.html?storeId=TW002`
- 把這串網址做成 QR Code(各家 QR 產生器皆可)
- 顧客掃描即可進入,商品與菜單即時同步

---

## 4. 硬體與環境需求

### 主裝置:Sunmi T2(必備)
| 項目 | 規格 |
|---|---|
| 作業系統 | Android 7.1.1 (API 25) |
| 記憶體 | 2 GB RAM |
| 列印紙 | 80 mm 熱感 |
| 內建周邊 | 熱感印表機 + 錢箱接口 |
| 必裝 APK | sunmi-pos-v2(純後台 HTTP Server) |
| 瀏覽器 | Chrome(直接開門市網址,不再用 APK 內建 WebView) |

### 備援裝置(任選)
| 裝置 | 用途 | 限制 |
|---|---|---|
| iPad | 觀單、簡易操作 | Safari 不支援 Web Bluetooth/USB;列印走系統列印對話框 |
| Windows + Chrome | 完整功能 | 列印走系統列印對話框,需另接印表機 |
| 其他 Android | 觀單;若打包 APK 可直印 | 需與 sunmi-pos-v2 相同的 /ping、/print/*、/drawer/open API |

### 已知環境限制
- iPad / Safari:不支援 Web Bluetooth、WebUSB、部分 Service Worker 行為
- Sunmi T2 Android 7.1.1:不支援部分新版 Web API
- WebView 內 OAuth 被 Google 封鎖(disallowed_useragent)→ 因此採純後台 HTTP 架構
- Android 無 console / Logcat 不易接:APK 端所有錯誤寫到 LogManager 檔案 + HTTP /logs 端點

### 網路需求
- 必備:Wi-Fi(雲端備份、線上接單、看板上傳)
- 雲端斷線時:本地點餐、列印、結帳全部可用(IndexedDB 主儲存),恢復後自動同步

---

## 5. 多店部署流程

### 多店架構決策(v20260608 確立)
- **每間店一個獨立 GitHub repo**(2237-1、2237-2、2237-3…)
- 共用同一個 Firebase 專案 `webpos-1f626`
- 共用同一個 Google Apps Script Web App 與試算表
- 以 `storeId` 區分所有雲端路徑

### 路徑命名規約
| 用途 | 路徑模板 | 範例 |
|---|---|---|
| Firebase 全量備份 | `posBackup/{storeId}/state` | `posBackup/store001/state` |
| Firebase 班次歷史 | `sessionHistory/{storeId}/{BD}/{sessionId}` | `sessionHistory/store001/2026-05-15/sess_xxx` |
| Firebase 看板節點 | `dashboards/{storeId}/{heartbeat,today,session,...}` | `dashboards/store001/today` |
| Firebase 線上訂單 | `onlineOrders/{storeCode}/{orderId}` | `onlineOrders/TW001/order_xxx` |
| Google Sheets 分頁 | `{storeId}_orders` / `{storeId}_sessions` / `{storeId}_voided` | `store001_orders` |

### 新店開設清單
1. 複製 Repo(2237-1 → 2237-N)
2. 改 `js/core/store-config.js`(storeId、storeName、storeCode)
3. 升 `service-worker.js` 的 CACHE_NAME
4. 啟用 GitHub Pages
5. 首次啟動驗證:storeId 顯示正確、Firebase 路徑寫入正確
6. APK 安裝、印表機測試
7. 加入 `pos-dashboard` 自動偵測(看板會自動列出所有 `dashboards/{storeId}/` 節點,不需設定)

### 多店共用 vs 不共用
| 資料 | 共用否 | 原因 |
|---|---|---|
| 商品菜單 | 部分共用 | `menu/{projectId}` 預設 projectId='default',各店可共用一份;若要各店獨立,改 store.js 的 projectId |
| 商品成本(costMap) | **不共用** | 各店成本不同,存於 `state.settings.costMap`,跟著 posBackup 走 |
| 訂單 / 班次 | 不共用 | 各店獨立 storeId 路徑 |
| 客戶資料 | 不共用 | 客戶歸屬各店 |
| 圖庫對應(SKU→URL) | 共用 | `state.settings.imageLibrary.skuMap` 為店長手動匯入 |

---

## 6. 雲端資料三層架構

### 第一層:IndexedDB(本地主儲存)
- **資料庫**:`restaurantPosDB`
- **Object Store**:`kvStore`
- **Key**:`posState`
- **內容**:整個 `state` 物件(orders、cart、settings、products、modules、categories、reports 等)
- **寫入時機**:任何 `persistAll()` 觸發點,即時寫入
- **雙寫 localStorage**:作為快取與向下相容,啟動時若 localStorage 有資料、IndexedDB 沒資料,自動遷移
- **配額處理**:`persistAll()` 內 `localStorage.setItem` 有 try/catch,QuotaExceededError 時 console.warn + removeItem,IndexedDB 寫入仍正常

### 第二層:Firebase Realtime Database(全量備份)
- **路徑**:`posBackup/{storeId}/state`
- **Payload**:
  ```json
  {
    "data": { /* state 全文 */ },
    "meta": { "backupAt": "ISO", "orderCount": N, "deviceId": "uuid" }
  }
  ```
- **節流**:10 秒(`CLOUD_THROTTLE_MS = 10000`),由 `persistAll()` 觸發
- **還原**:啟動時若 IndexedDB 與 localStorage 均空且 storeId 已綁定,confirm 詢問是否從雲端還原
- **API**:`state.cloudBackupNow()`、`state.tryRestoreFromCloud()`

### 第三層:Google Sheets(增量同步)
- **後端**:Google Apps Script Web App,固定寫死 `APPS_SCRIPT_URL` 與 `SPREADSHEET_ID`
- **分頁命名**:`{storeId}_orders`、`{storeId}_sessions`、`{storeId}_voided`
- **去重**:依 orderNo / sessionId
- **觸發三重**:
  1. 每 15 分鐘 setInterval
  2. 班次結束時
  3. 訂單完成時(10 秒節流)
  4. 啟動後 30 秒首同步
- **已同步 key 記錄**:`state.settings.sheetsSync.syncedOrderNos`(最多 2000 筆) / `syncedSessionIds`(最多 500 筆),先進先出
- **失敗處理**:自動記錄 `lastError`,下次自動重試
- **全域 API**:`window.sheetsSyncNow()`、`window.sheetsSyncStatus()`、`window.sheetsSyncReset()`

### 雲端清理策略
| 資料 | 保留期 | 清理時機 |
|---|---|---|
| 本地 sessionHistory | 90 天 | 結束班次後自動清 |
| Firebase sessionHistory | 90 天 | 結束班次後上傳完自動清 |
| posBackup/{storeId}/state | 永久 | 每次寫入直接 set 覆蓋 |
| dashboards/{storeId}/ | 即時覆蓋 | 30 秒推一次,無歷史 |
| Google Sheets | 永久 | 從不刪除 |

---

## 7. 列印架構

### 三層橋接(`js/modules/print-bridge.js`)
依序嘗試三種方式,任一成功即停止:
1. **HTTP 127.0.0.1:8080** — Sunmi T2 上的 sunmi-pos-v2 APK
2. **window.SunmiPrinter** — 舊 WebView 殼(已停用,保留容錯)
3. **window.print()** — iPad / PC / 無 APK Android

### 偵測原則
- 網頁端**不認牌子、不認機型**,只問「本機 127.0.0.1:8080 有沒有橋接服務在跑」
- 未來打包新 APK 時,網頁端不需要改,但 APK 必須提供完全相同的 API:

| Method | Path | 用途 |
|---|---|---|
| GET | /ping | 心跳,回 version、印表機狀態、token |
| GET | /printer/status | 詳細印表機狀態 |
| GET | /logs?date=YYYY-MM-DD&lines=200 | 查當日日誌 |
| GET | /test | 內建測試列印頁 |
| POST | /print/sunmi | Sunmi 內建列印 |
| POST | /print/bluetooth | 藍牙 ESC/POS |
| POST | /print/network | 網路 ESC/POS |
| POST | /drawer/open | 開錢箱(Sunmi > 藍牙 > 網路) |

### API 規格
- 位址:`http://127.0.0.1:8080`(埠號可在 APK 設定改)
- 綁定:強制只綁 127.0.0.1(loopback),外部裝置連不到
- 所有回應:`{"ok": true/false, "data": ..., "error": "..."}`
- 必含 CORS header(`Allow-Origin: *`)
- 驗證:`/print/*`、`/drawer/open`、`/logs` 需 header `X-API-Token`,token 首次啟動隨機生成

### POST Body 範例
    {
      "payload": {
        "shopName": "...",
        "items": [{"name":"雞排", "qty":1, "basePrice":60, "extraPrice":0, "options":"加辣", "note":""}],
        "total": 100,
        "mode": "label",
        "fields": { "storeName": true, "items": true, "itemSelections": true }
      },
      "openDrawer": false
    }

### 列印模式
| Mode | 用途 | qty 處理 |
|---|---|---|
| `receipt` | 顧客單 | 合併 xN(雞排 x2) |
| `kitchen` | 廚房單 | 合併 xN |
| `label` | 標籤 | **展開**(qty=2 印 2 張,APK 端不再乘 qty) |

### Fields 勾選矩陣
- 設定頁有三欄勾選矩陣(receipt / kitchen / label)
- 控制各模式要印哪些欄位(店名、店址、電話、訂單號、品項、單價、總計、付款方式、備註、…)
- Web 端 `buildBridgePayload` 依 mode 與 fields 勾選送對應欄位,未勾選送空字串/空陣列
- APK 端讀 `fields` 旗標(缺鍵預設 true,保留舊行為),所有非必印欄位 `if(fields.xxx)` 包起

### Token 自動同步機制
- APK 每次重啟/重裝會用 UUID 重新生成 API token
- `/ping` 免驗證,回應中帶 `token` 欄位
- Web 端 `detectPrinters` 收到 /ping 回應時,若 `data.token` 與 localStorage 不一致,自動 `setApiToken(data.token)` 同步
- `httpPrint` / `httpOpenDrawer` 收到 401/403 時,呼叫 `detectPrinters(true)` 重抓 token 再重試一次

---

## 8. Firebase 設定

### Firebase 專案
- 專案 ID:`webpos-1f626`
- Realtime Database URL:`https://webpos-1f626-default-rtdb.asia-southeast1.firebasedatabase.app`
- Auth 方式:Google 登入(POS 端啟動時自動)

### Realtime Database 安全規則
**最小可用版本**(僅允許認證使用者讀寫):

    {
      "rules": {
        "posBackup":      { ".read": "auth != null", ".write": "auth != null" },
        "sessionHistory": { ".read": "auth != null", ".write": "auth != null" },
        "dashboards":     { ".read": "auth != null", ".write": "auth != null" },
        "onlineOrders":   { ".read": true,           ".write": true },
        "menu":           { ".read": "auth != null", ".write": "auth != null" },
        "staff":          {
          "$uid": {
            ".read":  "$uid === auth.uid",
            ".write": "auth.token.admin === true"
          }
        }
      }
    }

**注意事項**:
- `onlineOrders` 開放未驗證讀寫,因為線上點餐顧客沒有 Google 帳號
- 修改規則前必須在 Firebase Console 備份原規則
- 新增路徑必須回報在 PR description 與 `aiREADME.md`

### staff 節點(用於看板權限)
- 路徑:`staff/{uid}`
- 內容:`{ email: "xxx@gmail.com", name: "店長", role: "admin" | "staff" }`
- 看板登入後讀 `staff/{uid}`,role 必須是 `admin` 或 `staff` 才放行

### menu 節點(分店共用菜單)
- 路徑:`menu/{projectId}/{categories,modules,products}`
- 預設 `projectId='default'`(若 `state.realtimeOrderConfig.projectId` 未設)
- 商品管理頁的「⬆ 上傳」會推送 products
- 分類/模組變動時自動推送(v20260515 修)
- 線上點餐頁啟動時 `fetchMenuFromFirebase` 拉取,並 `startMenuAutoWatch` 監聽變動

---

## 9. Google Sheets 同步設定

### Apps Script 後端(已部署,使用者無需操作)
- **試算表 ID**:`1RTcKK-cZutAtSBQtPU6O7PcNKUVP53MBgoa6Dk0PFXc`
- **Web App URL**:`https://script.google.com/macros/s/AKfycbxbQTMq2BZOvdIexY3pz_DERQGe44aR_OLIf-xZbt8MHHDjEI-WHe5408A9qXvTonlC/exec`
- **執行身分**:擁有者
- **存取對象**:任何人
- **CORS 處理**:fetch 用 `Content-Type: text/plain;charset=utf-8`(Apps Script 用 `e.postData.contents` 解析 JSON,避開 preflight)

### 分頁結構
| 分頁名 | 欄位 |
|---|---|
| `{storeId}_orders` | 訂單號、時間、類型、付款、小計、折扣、總額、品項、狀態(含異常標記) |
| `{storeId}_sessions` | 班次 ID、開始時間、結束時間、人員、營業額、訂單數、開班現金、結班現金、應收、差額、備註 |
| `{storeId}_voided` | 作廢訂單詳細,含作廢原因 |

### 同步指令(Chrome Console)
```js
window.sheetsSyncNow();     // 立即同步
window.sheetsSyncStatus();  // 看上次同步時間、待同步筆數、最後錯誤
window.sheetsSyncReset();   // 重置已同步 key,下次全量重推
```

### 已知踩雷
- **Chrome 多帳號干擾**:Apps Script 部署後若有第二個 Google 帳號登入,瀏覽器會自動加 `/u/1/` 到 URL,導致直接點連結 404
- 解法:用無痕視窗只登一個帳號,或 POST fetch(不受帳號路徑影響,POS 端走這條)

---

## 10. 線上點餐(顧客掃 QR)

### 顧客流程
1. 掃店家 QR → 進入 `online-order.html?storeId=TWxxx`
2. 選商品、配置模組、加入購物車
3. 填姓名、電話、訂單類型(外帶/內用/預約)、備註
4. 預約類型:選擇 1 小時後至 2 天內、每 15 分鐘為一個時段(依店家營業時間)
5. 送出 → 進入「等待店家確認」狀態
6. 店家在 POS 接單 → 顧客頁自動更新狀態
7. 顧客可用「我的訂單」按鈕,憑姓名+電話(30 秒節流)查詢歷史訂單

### 店家流程
- POS 端 `realtime-order-service.js` 監聽 `onlineOrders/{storeCode}/`,新單時鈴聲提醒
- 接受 → 訂單進入 POS 訂單系統
- 拒絕 → 標記 rejected,顧客頁顯示拒單原因
- 自動列印(若設定開啟):接受時自動印顧客單 + 廚房單
- 預約單:30 分鐘前自動提醒列印

### 必要 URL 參數
- `?storeId=TWxxx`:**必備**,缺少會顯示「請從店家 QR 掃描進入」錯誤頁,禁止下單
- storeId 必須是英數字,不能含 `.#$/[]`(Firebase Key 限制)

---

## 11. 核心業務邏輯

### 營業日 (Business Day, BD) 規約
POS 與看板統一使用「營業日」概念,跨日營業時段歸屬同一個 BD。

**定義**:
- BD = 依店家 `businessHours` 切分的營業日單位(YYYY-MM-DD 字串)
- 例:店家設 14:00–03:00,則 5/1 14:00 ~ 5/2 03:00 全部屬於「5/1 BD」
- 公休日(businessHours[weekday] = []) 不產生 BD

**訂單歸屬規則**:
- 預約待付款單(`status='pending'` 且有 `reservationAt`):依 `reservationAt` 歸 BD
- 其他所有訂單:依 `createdAt` 歸 BD

**今日 BD 範例**:
- 5/12 23:59(在 14:00–03:00 期間) → 今日 BD = 5/12
- 5/13 02:00(仍在 5/12 的跨日尾巴) → 今日 BD = 5/12
- 5/13 04:00(已過營業時段) → 今日 BD = 5/13(即將開始)

**共用工具**:
- POS 端:`js/core/biz-day.js`
- 看板端:`js/biz-day.js`(**邏輯必須與 POS 端完全一致**)

### 訂單狀態
| 狀態 | 計入營業額 | 說明 |
|---|---|---|
| `completed` | ✓ | 已結帳完成 |
| `pending` | ✓ | 待付款(含預約待付款) |
| `void` | ✗ | 作廢(列入異常統計) |
| `cancelled` | ✗ | 取消(列入異常統計) |
| `refunded` | ✗ | 退款(列入異常統計) |

**異常 = void / cancelled / refunded**,獨立顯示不計入營業額。

### 訂單修改規則(v20260613 確立)
**訂單修改 = 加到購物車 + 結帳建新單 + 作廢原單**

- 禁止「就地修改原訂單」邏輯(封閉以修改規避營業額的漏洞)
- `order-service.js` 的 `createOrUpdateOrder` 函式名稱保留,但內部永遠建新單
- 訂單查詢頁「修改」按鈕已改名為「加到購物車」
- 加到後跳警告:「原訂單仍存在;如需取代請另外作廢原訂單」
- 已作廢訂單禁止再加到購物車

### 外送平台(v20260613)
- **熊貓 Grod**(台灣熊貓被併購交接中暫用此名) + **Uber**
- 計入「其他」付款方式,**不計入現金**
- 手動於結束值班時輸入,只計入該班結束後的 BD 今日總覽(避免值班中無法結算)
- 結束值班 Modal 有藍底輸入區塊,與現金清點區隔
- 班次摘要 Modal 有「🛵 外送」藍色卡片 + 付款方式下方追加外送明細

### 折扣機制(v20260515 改版)
- 採「**負金額品項**」存進 cart,不再使用獨立 input 欄位
- `discountAmountBtn` / `discountPercentBtn` 直接 push 到 `state.cart`
- 舊版 `getDiscountResult` / `handleDiscountInput` 等函式為待清理殘留

### 成本管理與預估獲利(v20260515)
- 成本資料存於 `state.settings.costMap[productId] = { cost, updatedAt }`
- **不污染 `state.products`** 欄位,獨立 map 儲存
- **不跨店共用**,各店成本獨立,透過 `posBackup/{storeId}/state` 自動雲端備份
- Excel 匯入欄位:`SKU | 品名 | 分類 | 售價 | 成本 | 毛利 | 毛利率`
- 匯入主鍵:SKU 優先,無 SKU 用品名比對
- 預估獲利顯示:
  - 即時班次面板(`renderCurrentSessionData`)
  - 結束班次摘要(`openSessionSummaryModal`)
- 公式:`profit = salesTotal - Σ(costMap[productId] × qty)`
- 未設成本品項:跳過並在 UI 提示「未設成本項目 N 個」

### 模組子選項停售
- `state.modules[i].options[j].enabled` 控制是否顯示
- 商品管理 → 模組設定 → 每個子選項旁勾選框,停售時整列半透明灰底
- POS 與線上點餐渲染時 `.filter(o => o.enabled !== false)` 過濾

---

## 12. 檔案結構與職責

```
2237-1/
├── README.md                        # 本檔(商用說明書)
├── aiREADME.md                      # AI 接手規範與架構
├── aiREADME最新進度.md                # 當前進行中/待處理/已知問題
├── aiREADME已完成紀錄.md              # 所有版本已完成項目詳細紀錄
├── Firebase_Realtime_Database_安全規則.json   # Firebase 規則範本
├── Firebase_安全規則版_使用說明.txt
├── index.html                       # POS 主頁面骨架、所有 modal、外部腳本載入
├── online-order.html                # 顧客掃 QR 線上點餐頁
├── service-worker.js                # PWA 快取(升新版必須改 CACHE_NAME)
├── manifest.webmanifest             # PWA 設定
├── diag.html                        # 診斷工具
├── A123.mp3                         # 新單提醒鈴聲
├── assets/                          # 靜態資源
├── styles/                          # CSS 拆分(base, layout, pos, online-order, …)
└── js/
    ├── app.js                       # 主入口,初始化所有頁面與服務
    ├── core/
    │   ├── store.js                 # 狀態管理 + 三層持久化(IndexedDB / localStorage / Firebase posBackup)
    │   ├── store-config.js          # 店家寫死設定(每店複製只改這個)
    │   ├── biz-day.js               # 營業日 (BD) 共用工具(v20260613)
    │   └── utils.js                 # escapeHtml / money / id / fmtLocalDateTime 等
    ├── modules/
    │   ├── print-bridge.js          # 三層列印橋接偵測
    │   ├── print-service.js         # 列印路由與 payload 組裝
    │   ├── order-service.js         # 訂單建立(v20260613 起每次都建新單)
    │   ├── realtime-order-service.js # Firebase 線上接單 + Firebase API 共用
    │   ├── report-session.js        # 班次(含作廢、外送、BD)
    │   ├── cart-service.js          # 購物車操作(部分舊折扣函式待清理)
    │   ├── customer-service.js      # 客戶查詢
    │   ├── dashboard-publish.js     # 多店看板資料發佈(30 秒)
    │   ├── sheets-sync.js           # Google Sheets 增量同步
    │   ├── google-backup-service.js # Google Drive 備份
    │   ├── product-category-manager.js  # 分類管理(自動推雲端)
    │   ├── product-module-manager.js    # 模組管理(自動推雲端)
    │   └── cost-manage.js           # 成本管理 modal + Excel 匯入匯出 + 預估獲利
    └── pages/
        ├── pos-page.js              # POS 點餐頁
        ├── orders-page.js           # 訂單查詢頁
        ├── reports-page.js          # 報表頁(含班次摘要、預估獲利、成本管理按鈕)
        ├── products-page.js         # 商品管理頁
        ├── settings-page.js         # 設定頁(列印矩陣、營業時間、雲端備份…)
        └── online-order-page.js     # 線上點餐頁邏輯
```

---

## 13. 日常維運

### 每日開店
1. 開機 Sunmi T2 → 開 Chrome → 開門市網址(若為 PWA 已安裝直接點桌面圖示)
2. 確認 APK 已啟動(設定頁三模式偵測都顯示綠色)
3. 開班 → 輸入開班現金 → 開始營業

### 每日結班
1. 班次摘要 Modal 點「結束值班」
2. 輸入結班現金、外送平台金額(熊貓 Grod、Uber)
3. 系統自動算現金差額、上傳雲端、清理 90 天前資料、列印班次報表

### 商品管理
- 新增/修改商品 → 商品管理頁 → 雲端 menu 即時更新
- 新增/修改分類 → 自動推雲端(v20260515 修)
- 新增/修改模組 → 自動推雲端(v20260515 修)
- 子選項停售:模組設定 → 取消勾選 → 儲存

### 圖庫管理(v20260614)
- 圖片放在 `jess0937588151-hue/2234/images/products/`
- 用 `gallery.html` 工具產生 SKU → URL 對應表
- 在 POS 設定頁「SKU 圖庫對應」匯入
- 商品依 SKU 自動套圖
- 不採用 Firebase Storage(要收費)

### 雲端備份監控
- Chrome Console 執行 `window.sheetsSyncStatus()` 查上次同步時間
- Firebase Console 看 `posBackup/{storeId}/state/meta` 的 `backupAt`
- 看板若顯示「離線 X 分」表示該店心跳超過 90 秒未更新

---

## 14. 故障排除

### 列印相關
| 症狀 | 可能原因 | 排除步驟 |
|---|---|---|
| 結帳後跳系統列印對話框 | APK 沒在跑 / token 不同步 | 1. APK 健康檢查頁看狀態 2. Chrome Console 看 print-bridge log 3. 重啟 APK 後重整網頁 |
| 標籤印雙倍 | APK 版本過舊,沒處理 qty 展開 | 升級 APK 至 v20260607 以上 |
| Fields 勾選沒作用 | APK 沒讀 `fields` JSONObject | 升級 APK 至 v20260607 以上 |
| 開錢箱第一次成功第二次失敗 | NanoHTTPD socket 立即關閉 | 已內建重試,若仍失敗檢查 APK 端 LogManager |
| 字串中文變 ? | **不是編碼問題**,先看 APK log 是不是 unauthorized(token 問題) | 重新 detectPrinters,讓 /ping 重抓 token |

### 雲端相關
| 症狀 | 可能原因 | 排除步驟 |
|---|---|---|
| 訂單沒寫到 Google Sheets | Apps Script Web App 失效 / 網路斷 | 1. `window.sheetsSyncStatus()` 看 lastError 2. 試 `window.sheetsSyncNow()` 3. 用無痕視窗試 Apps Script URL |
| 雲端還原 confirm 沒跳出 | 本地有舊資料殘留 | 確認 IndexedDB 與 localStorage 都已清除 |
| 看板異常單顯示 0 | 欄位名稱不一致(historical bug) | 確認 POS 端寫的是 `today.voided`(非 abnormal) |
| Firebase 寫入 permission denied | Auth 沒登入 / 規則錯誤 | 1. 點重新登入 Google 2. 檢查 Firebase Console 規則 |

### 畫面相關
| 症狀 | 可能原因 | 排除步驟 |
|---|---|---|
| 網頁空白只剩框架 | JS SyntaxError(上次改動破壞語法) | 1. 開 Console 看紅字 2. 對照 git history 還原 |
| 顧客點餐頁空白 | localStorage 配額爆 | 已內建容錯,若仍空白檢查 IndexedDB |
| PWA 沒更新 | service-worker.js CACHE_NAME 沒升 | 升 CACHE_NAME 重新部署 |
| 分類「全部」位置不對 | 已修(v20260515 改到最後) | 清快取或升 CACHE_NAME |

### 日誌位置
- **網頁端**:Chrome Console + Firebase Console
- **APK 端**:HTTP `GET http://127.0.0.1:8080/logs?date=YYYY-MM-DD&lines=200`
- **APK 健康檢查頁**:開啟 APK MainActivity 直接看
- **Apps Script**:Apps Script Console 查 doPost 執行紀錄

---

## 15. 安全規約

### Token 管理
- APK API Token:首次啟動 UUID 隨機生成,寫入 APK 設定檔
- POS 端 localStorage 存對應 token,/ping 自動同步
- 不要把 token 寫進 git

### Firebase 安全規則
- 修改前必須備份原規則(Firebase Console 有版本歷史可還原)
- 新增節點必須更新 `aiREADME.md` 與 Firebase_Realtime_Database_安全規則.json
- `onlineOrders` 為唯一公開節點(顧客點餐用),不存敏感資料

### 跨店資料隔離
- 所有 Firebase 路徑、Sheets 分頁、Drive 備份檔名都必須以 `state.settings.store.storeId` 為前綴
- 禁止寫死 `store001`
- 多店時必須驗證:A 店看不到 B 店資料

### 顧客個資
- 線上點餐顧客姓名、電話存於 `onlineOrders/{storeCode}/` 與 POS 訂單
- 90 天後自動清理 sessionHistory
- Google Sheets 永久保留(由店家自行管理)

### 印表機綁定
- HTTP Server 強制只綁 127.0.0.1(loopback)
- 外部裝置連不到(防止隔壁桌的人列印)

---

## 16. 版本歷史

| 版本 | 日期 | 重點 |
|---|---|---|
| v20260614 | 2026-05-15 | 圖庫採 GitHub Pages、欄位命名規約、分類「全部」改最後 |
| v20260613 | 2026-05-13 | 營業日 BD + 外送統計 + 修改改加單 |
| v20260608 | 2026-05-11 | 雲端三層架構(IndexedDB + Firebase posBackup + Google Sheets)+ store-config.js |
| v20260607 | 2026-05-xx | fields 勾選矩陣 + 標籤一品項一張 + 數量 +/- 按鈕 |
| v20260606 | 2026-05-xx | token 自動同步、列印與錢箱回歸 |
| v20260603 | 2026-04-xx | APK 商用化補強(LogManager、PrintQueue、API Token) |
| v20260602 | 2026-04-xx | 印表機字串排版、token 驗證初版、SW cache 更新 |
| v20260601 | 2026-04-xx | APK 純後台改造、三層列印橋接、設定頁 UI |

**詳細變更紀錄請見 `aiREADME已完成紀錄.md`**。

---

## 17. 開發守則(給 AI 與工程師)

> 維護本專案的 AI 與工程師,動手前**必讀** `aiREADME.md` 與 `aiREADME最新進度.md`。
>
> 以下為核心守則摘要,完整版見 `aiREADME.md` 第七節。

1. **動手前先讀完** `aiREADME.md` + `aiREADME最新進度.md`,禁止憑記憶或猜測修改
2. **每次只改一個檔案**,每個檔案一個 commit,commit message 描述清楚
3. 所有改動完成後**必須更新** `aiREADME最新進度.md`(移已完成項目到 `aiREADME已完成紀錄.md`)
4. 回覆一律使用**繁體中文**
5. 改完任何檔案後**完整讀取一次該檔案內容**確認沒有語法錯誤
6. 列印相關修改必須**同時驗證收據 / 廚房單 / 標籤三種模式**
7. 跨店資料路徑一律使用 `state.settings.store.storeId`,**禁止寫死** `store001`
8. PWA 升版後**必須升 service-worker.js 的 CACHE_NAME**
9. 修改 Firebase 安全規則前必須先在 Firebase Console 備份原規則
10. **使用者不寫程式**:所有改動必須給「完整段落 + 錨點;改多處給完整檔案內容 + 檔案路徑 + GitHub edit 連結 + Commit message」
11. 一次 commit 只動一個檔案;多檔案改動拆成多個 commit
12. 收到「網頁剩框架」「Console SyntaxError」**先懷疑上次改動破壞語法**,不要急著加 console.log
13. README 內若嵌入 markdown 三反引號區塊,內層改用四空白縮排
14. **新增/刪除前端 JS 檔案後必須升 service-worker.js CACHE_NAME 並把新檔加入 ASSETS pre-cache 清單**
15. 跨店時所有 Firebase 路徑、Sheets 分頁名、Drive 備份檔名都必須以 storeId 為前綴
16. 跨日相關計算一律使用 `js/core/biz-day.js` 的 BD 函式,**禁止用自然日 00:00–23:59**
17. **訂單修改 = 加到購物車 + 結帳建新單 + 作廢原單**,禁止寫「就地修改原訂單」邏輯
18. **修改 Firebase 寫入欄位名稱前**必須 grep 看板 repo 是否有對應讀取碼,並同 commit 同步兩邊

---

## 聯絡與支援

- POS Repo:https://github.com/lcym346-byte/2237-1
- 範本 Repo:https://github.com/jess0937588151-hue/2234
- APK Repo:https://github.com/jess0937588151-hue/sunmi-pos-v2
- 看板 Repo:https://github.com/lcym346-byte/pos-dashboard

如需協助,請於 Repo Issues 開啟議題,並附上:
- POS 版號(看 `service-worker.js` CACHE_NAME)
- APK 版號(健康檢查頁顯示)
- Chrome Console 錯誤訊息截圖
- APK `/logs` 端點輸出(若涉及列印問題)
