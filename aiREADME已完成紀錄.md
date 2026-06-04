已完成紀錄

> 本檔記錄所有版本已完成項目的詳細紀錄（由新到舊）。
> 規範與架構說明請見 `aiREADME.md`。
> 當前進行中與待處理請見 `aiREADME最新進度.md`。

---
## 📌 版本速查

| 版本 | 日期 | 重點 |
|---|---|---|
| v20260604 | 2026-06-04 | 線上點餐購物車打開自動查點數（兩入口）+ 待付款訂單卡顯示顧客預選付款別（現金/電支）|
| v20260603-points | 2026-06-03 | 會員點數模組：賺點/折抵預扣/作廢退點/POS查詢 + Firebase points 規則 |

| v20260616 | 2026-05-20 | SKU 圖庫工具按鈕 + 2234 storeId 部署疏失修正 + 線上點餐標題來源確認 + Google OAuth 環境排查 |
| v20260615 | 2026-05-20 | 促銷整合 + 優惠碼帶入訂單 + 訂單卡折扣明細 + 預約 30 分鐘提醒 + SKU 圖庫反推 + 三個舊 bug |
| v20260613 | 2026-05-13 | 營業日 BD + 外送統計 + 修改改加單 |
| v20260608 | 2026-05-11 | 雲端三層架構（IndexedDB + Firebase posBackup + Google Sheets）+ store-config.js 寫死店家綁定 |
| v20260607 | 2026-05-xx | fields 勾選矩陣 + 標籤一品項一張 + 數量 +/- 按鈕 |
| v20260606 | 2026-05-xx | token 自動同步、列印與錢箱回歸 |
| v20260603 | 2026-04-xx | APK 商用化補強（LogManager、PrintQueue、API Token） |
| v20260602 | 2026-04-xx | 印表機字串排版、token 驗證初版、SW cache 更新 |
| v20260601 | 2026-04-xx | APK 純後台改造、三層列印橋接、設定頁 UI |

## v20260604 — 線上購物車自動查點數 + 待付款卡顯示顧客預選付款別

### 異動檔案（2 支 JS + service-worker 升版）
1. js/pages/online-order-page.js — 打開購物車時主動查一次會員點數並顯示。
   - openCartDrawer() 內新增呼叫 refreshPointsBalance()（原本只在電話欄位 blur/change 時查，
     導致電話雖已帶入、但要碰一下欄位點數才會出現）。
   - 購物車有兩個開啟入口：#openCartBtn 與浮動鈕 #floatingCartBtn。浮動鈕原本直接
     remove('hidden') 不走 openCartDrawer，已改成呼叫 openCartDrawer()，兩入口行為一致。
2. js/pages/orders-page.js — renderOrdersSection 訂單卡新增顯示「顧客選擇：現金/電子支付」標籤。
   - 讀 o.payMethod（由 realtime-order-service.js buildRealtimeOrderForPOS 帶入，
     值為 '現金' / '電子支付' / ''）。現金綠底、電支藍底。
   - pending/completed/void 三種 mode 共用該段 HTML，故三區皆顯示；POS 現場單無 payMethod 故不顯示。
3. service-worker.js — 升 CACHE_NAME，強制顧客端與 POS 主機 T2 Chrome 清舊快取載新檔。

### 設計決策 / 注意
- 點數讀取走 Firebase points/{storeCode}/{phone}/balance，規則為 .read=true（匿名可讀），
  手機顧客查得到；若顯示 0 是該電話真的無餘額，非權限問題（與查單需 auth!=null 的路徑不同）。
- 顧客「預選付款別」o.payMethod 與「實際收款方式」o.paymentMethod 是兩個不同欄位，勿混用。
- 兩項皆屬 points-v2 任務範圍內的補強，與付款回饋點數主流程不衝突。

## v20260603-points — 會員點數模組（賺點 / 折抵 / 退點 / POS 查詢）


### 規則
- 賺點：僅線上單，店家確認＋結帳完成(completed) 才入帳，賺點 = order.discountAmount（優惠不折現、全轉點）。
- 折抵：1點=1元，僅線上點餐用。接單(confirmed)時 POS 預扣 min(pointsRequested, 真實餘額)，杜絕超折。
- 退點：pending 單作廢退回 pointsUsed；completed 作廢不退。
- 儲存：points/{storeCode}/{phone}/balance 與 /history/{pushId}，各店獨立；POS 才能寫，顧客匿名只讀。

### 異動檔案
1. js/modules/customer-service.js — 新增點數核心六函式：getPointsBalance、_writePointsTxn（改餘額＋推 history，欄位 at/type/delta/balanceAfter/orderNo）、deductPointsOnConfirm（回寫 order.pointsUsed）、refundPointsOnCancel（completed 不退）、earnPointsOnComplete（pointsSettled 防重複）、getPointsHistory（回 {balance, history} 新→舊）。
2. js/modules/realtime-order-service.js — showOnlineOrderOverlay 彈窗接單已接 deductPointsOnConfirm 並調整 total；新增 export _getRef / _dbApi / getStoreCode 供 customer-service 跨檔讀寫 points。
3. js/modules/order-service.js — 第 2 行 import 補 persistAll；markPendingOrderPaid 結帳完成且 discountAmount>0 且未 settle 時 import customer-service 呼叫 earnPointsOnComplete 後 persistAll。
4. js/pages/orders-page.js — 列表接單 accept-btn 補 deductPointsOnConfirm（與彈窗一致）；voidOrder callback 改 async，pending 單作廢時 refundPointsOnCancel。
5. index.html — modalGoogle 改為「🎯 會員點數查詢」區（電話輸入框＋查詢鈕＋餘額框＋紀錄框）；設定頁 tile 文字改「會員點數查詢」。
6. js/pages/settings-page.js — 新增 getQueryStoreCode / resetPointsQueryUI / openPhonePad（自製字串鍵盤保留開頭 0）/ runPointsQuery（欄位 at/delta，type 翻賺點/折抵/退點）/ bindPointsQueryEvents；Google tile 綁定改為開點數查詢區，移除舊 loadGoogleSettingsToForm。
7. Firebase 安全規則 — 新增 points/{storeCode}/{phone}：.read=true（顧客匿名只讀餘額/紀錄）、.write 限 admin 或 stores/{storeCode}===true 員工；balance 驗證為 >=0 數字，history 子項驗證 at/type/delta/balanceAfter 且 type∈{earn,use,refund}。已於 Console 發布。

### 設計決策 / 注意
- 電話輸入不可用 pos-page 的 openNumPad（走 Number() 會吃掉開頭 0），改用 settings-page 自製字串鍵盤 openPhonePad，與 points key（replace(/\D/g,'') 保留 0）對齊。
- 查詢區沿用 modalGoogle 容器（保留原 id 與開關機制），只換內容與綁定，降低風險。
- storeCode 來源統一為 state.settings.dashboard.storeId（與接單預扣、realtime getStoreCode 同源）。
- 待實機驗證：全鏈路（帶券下單→接單預扣→結帳賺點→查詢顯示）、作廢退點 pending/completed 差異。

## v20260603 — 結帳列印偵測逾時 / 客顯推送干擾列印（已驗證 2026-06-03）

## v20260603 — 結帳列印偵測逾時 / 客顯推送干擾列印（已驗證 2026-06-03）

### 問題
- 症狀：結帳不會自動印廚房單，改跳瀏覽器 PDF；從「訂單查詢」手動列印正常。
- 實機 log 證據（T2，08:43）：結帳當下 detectPrinters 對 127.0.0.1:8080 的 /ping
  逾時 1500ms → fallback BROWSER → 跳 PDF；閒置時同一支 ping 要 1248ms 才回。
- 根因（雙重）：
  1. 客顯（8081）POST 在結帳瞬間搶佔 T2（2GB RAM）連線池與 CPU，
     把緊接其後的列印 ping（8080）拖到逾時。
  2. print-bridge 的 PING_TIMEOUT_MS=1500 太短（實機閒置已要 1248ms，邊際幾乎為 0），
     且 fetchWithTimeout 只對 socket 死掉重試，timeout 不重試 → 一逾時就掉 browser。

### 修正一：js/modules/print-bridge.js（commit 1，已驗證直印恢復）
- PING_TIMEOUT_MS：1500 → 3500。
- fetchWithTimeout：重試條件新增 timeout（原僅 'Failed to fetch'/'NetworkError'，
  加上 || msg.indexOf('timeout')>=0），逾時也重試一次（間隔 250ms）。
- 驗證：2026-06-03 09:17 結帳，廚房單由 APK 直印實體紙（單號 OD1780478245090），不再跳 PDF。

### 修正二：js/modules/customer-display-service.js（v20260603-interval，commit baa1391→b9caf5a）
- 移除 400ms 節流（DISPLAY_THROTTLE_MS / _throttledSend）。
- 改為 _postNow(payload)：保留 _lastSentHash 去重，內容相同不重送。
- 新增固定間隔機制：IDLE_INTERVAL_MS=10000（10 秒），_ensureIdleTimer/_resetIdleTimer
  管理單一 setInterval；無購物車變動時每 10 秒重送 _lastPayload。
- 購物車變動（displayCart）：更新 _lastPayload → _resetIdleTimer() → _postNow() 立即推送。
- displayPaid 加 PAID_DELAY_MS=600ms 延遲再推，讓結帳列印 ping 先完成；推送後 5 秒回 displayIdle。
- collectSlideImages 優先序：customerDisplay.slides(含 slidesBaseUrl) → product.image/skuMap，上限 12。
- 設計原則落實：購物車有變動→立即推送；無變動→每 10 秒固定推送，避免結帳瞬間爆量 POST。

### 注意（非程式問題，已排除）
- 廚房單標題出現「Bd」並非 bug：getReceiptHtml 廚房單會先印 cfg.storeName 一行、
  再印「** 廚房單 **」一行。當時 printConfig.storeName 被設成「Bd」（測試殘留），
  故印成兩行黏在一起。解法為設定頁→列印設定→修正店名或取消廚房單「店名」欄位勾選，
  無需改程式。getPrintSettings 店名預設為 cfg.storeName || '我的店'。

---
v20260525 客顯功能）
Web POS（lcym346-byte/2237-1）
檔案	變更內容
js/modules/customer-display-service.js	新增。POST /display/update 推送客顯，5 秒節流，提供 displayCart() / displayPaid() / displayIdle() / pingDisplayServer()
js/core/store.js	新增 DEFAULT_CUSTOMER_DISPLAY，buildDefaultState() 與 applyHydrate() 均已加入
js/pages/pos-page.js	renderCart() 末尾加入 displayCart() / displayIdle() 呼叫，位於 if/else 外層
js/modules/order-service.js	createOrUpdateOrder() 與 markPendingOrderPaid() 結帳時呼叫 displayPaid()
js/pages/settings-page.js	新增 loadCustomerDisplayToForm() / saveCustomerDisplayFromForm() / initCustomerDisplaySettings()，並在 initSettingsPage() 內呼叫
index.html	設定頁新增客顯 Tile（data-customer-display-open="1"）與 customerDisplayModal
service-worker.js	CACHE_NAME 升為 pos-v20260618-display-cache，ASSETS 加入 customer-display-service.js
APK（jess0937588151-hue/sunmi-pos-v2）
檔案	變更內容
DisplayHttpServer.java	新增。監聽 0.0.0.0:8081，提供 GET /display/（內嵌 HTML 頁面）、GET /display/state（無需 Token）、POST /display/update（需 Token）、GET /display/ping
DisplayStateManager.java	新增。執行緒安全的記憶體狀態容器，提供 update() / reset() / getStateJson() / getType() / getUpdatedAt()
MainActivity.java	新增 DisplayHttpServer field，onCreate 呼叫 startDisplayServer()，onDestroy 停止並 reset
LogManager.java	新增 TAG_DISPLAY = "DisplayHttpServer" 常數
📱 客顯使用方式（已完成，供參考）
CopyAPK 健康檢查頁查看 Sunmi T2 的區域 IP（例如 192.168.1.50）
        ↓
iPad Safari 開啟：http://192.168.1.50:8081/display/
        ↓
頁面每秒輪詢 /display/state，自動切換三種畫面：
  idle → 深色待機 + 時鐘 + 歡迎語
  cart → 白底品項列表 + 右側藍色合計
  paid → 綠色感謝畫面 + 5 秒倒數後自動回待機
IP 變動時：重新查 APK 頁面的 IP，更新 iPad 書籤即可。若要固定 IP，在路由器 DHCP 設定綁定 Sunmi T2 MAC 地址。
## v20260617 線上點餐營業時間改為各店獨立（storeHours/{storeCode}）

問題：營業時間原本寫在共用菜單 menu/{projectId} 內，但規則是「只有 store001 能上傳菜單，其他店唯讀」，
導致 store002/003 永遠讀到 store001 的營業時間，各店無法各自設定營業時間。

解法：將 businessHours 從共用菜單抽離，改用各店獨立路徑 storeHours/{storeCode}，與菜單完全分開。

異動檔案（4 commit + service-worker 升版）：
1. js/modules/realtime-order-service.js
   - 新增 syncStoreHoursToFirebase()：每台 POS 都能上傳自己店的營業時間到 storeHours/{storeCode}，
     不受「只有主機能傳菜單」限制（內部 getStoreCode() + verifyPOSAccess()）。
   - 新增 fetchStoreHoursFromFirebase(storeCode)：顧客端傳 URL 的 storeCode、POS 端不傳則用本機，
     讀回寫入 state.settings.businessHours。
   - 移除 syncMenuToFirebase menuData 內的 businessHours（菜單回到只含 categories/products/modules/updatedAt，
     對齊 menu 規則的 .validate）。
   - 移除 fetchMenuFromFirebase / applyCloudMenu / watchMenuFromFirebase 三處讀取 businessHours 的程式碼，
     避免 store001 的菜單同步覆蓋各店營業時間。
2. js/pages/settings-page.js
   - saveBusinessHours() 改為 async，存本機後自動 import 並呼叫 syncStoreHoursToFirebase() 上傳本店，
     成功跳「營業時間已儲存並上傳雲端」、失敗提示需 Google 登入且已設定 storeId。
3. js/pages/online-order-page.js
   - init() 菜單載入後新增讀取本店營業時間：import fetchStoreHoursFromFirebase(onlineState.storeCode)，
     讓顧客端讀到「該店自己」的營業時間，預約時段才正確。
4. Firebase_Realtime_Database_安全規則.json
   - 新增 storeHours 節點規則：.read=true（顧客預約時段要讀），
     .write 為 admin 或 staff/{uid}/stores/{storeCode}===true，
     .validate 要求 hasChildren(['businessHours','updatedAt'])。
   - 已於 Firebase Console 發布。
5. service-worker.js
   - CACHE_NAME 升版至 pos-v20260617-swfix-cache。

實機驗證：store001 POS 設定營業時間→儲存→跳「已上傳雲端」；
Firebase Console 出現 storeHours/store001/businessHours（含 fri 15:00–23:30 等）；確認位置正確。

注意事項（供 store002 複製時參考）：
- 各店 POS 帳號要能上傳營業時間，需在 staff/{uid}/stores/{storeCode}=true（或 role=admin），否則 PERMISSION_DENIED。
- 預約時段維持「今天＋明天」兩天（buildReservationSlots dayOffset < 2，本次未改）。
## v20260616（2026-05-20）— 圖庫工具按鈕 + 多店部署疏失修正 + 線上點餐標題確認

### SKU 圖庫對應 Modal 新增「開啟圖庫對應工具」按鈕
- 需求：使用者希望在「圖庫網址（GitHub Pages）」輸入框後面，加一顆按鈕直接開啟外部圖庫工具 `gallery.html`。
- 修法：在 `index.html` 的「SKU 圖庫對應」Modal 內，於 `<input id="imageLibraryBaseUrl">` 之後新增一行 `.sm-btn-row`，內含 `<button class="sm-btn" onclick="window.open('https://jess0937588151-hue.github.io/2234/images/products/gallery.html','_blank','noopener')">🛠 開啟圖庫對應工具</button>`。
- 影響檔案：`index.html`
- 設計考量：不改動既有 `imageLibrary` 邏輯，純 UI 增加；用 `window.open` + `noopener` 在新分頁開啟避免主頁被遠端控制。

### 2234 範本 store-config.js 部署疏失修正（多店促銷隔離）
- 症狀：開兩台 POS（2234 jess0937588151-hue / 2237-1 lcym346-byte）時，雙方促銷資料互相覆蓋；2234 設定的促銷在線上點餐讀不到，反而讀到 2237-1 設的。
- 根因：**不是程式 bug**。2234 repo 是早期把整份 2237-1 程式碼覆蓋過去時，`js/core/store-config.js` 忘了同步調整為新 storeId，兩台 POS 的 `STORE_CONFIG.storeId` 同為 `store001` 且 `lockFromUrl:true`，導致都寫入 `publicOnlineStores/store001/promotions`。
- 修法：使用者在 2234 repo 手動編輯 `js/core/store-config.js`，將 `storeId` / `storeName` / `storeCode` 改為對應的新值（例：`store002` / 「桃園民族店」），commit 後 Ctrl+F5 重新整理 POS，雙店資料節點從此分離。
- 影響檔案（僅 2234 repo）：`js/core/store-config.js`
- 踩雷紀錄：複製整份 repo 到新店時，**`js/core/store-config.js` 是唯一一定要改的檔案**，但複製腳本/手動覆蓋很容易忘掉。已寫進規範第 18 條。
- 驗證：兩台 POS 在 Console 跑 `state.settings.store.storeId` / `state.settings.dashboard.storeId` 各自為不同值；Firebase Console 看到 `publicOnlineStores/` 下出現兩個獨立節點。

### 線上點餐標題來源確認（非程式修改）
- 症狀：線上點餐頁 (`online-order.html`) 標題顯示「我的店」，使用者以為無法修改。
- 根因：`js/pages/online-order-page.js` 的 `getStoreName()` 讀取優先順序為 `state.settings.realtimeOrder.onlineStoreTitle` → `state.settings.printConfig.storeName` → `'立即點餐'`。前者未設定（undefined），所以顯示後者「我的店」（出單店名預設值）。
- 修法：使用者於 POS 設定頁修改「列印設定 → 店名」即可同時改線上點餐標題與發票店名。若想兩者分開，可在「看板 / 即時接單」設定頁填寫 `onlineStoreTitle`。
- 影響檔案：無（純設定操作）
- 留存設計決策：未來若要做「線上點餐標題」獨立 UI，應綁到 `state.settings.realtimeOrder.onlineStoreTitle`，避免動到 `printConfig.storeName`。

### Google OAuth `invalid_client` 環境排查（已解決，無程式修改）
- 症狀：2234 POS（jess0937588151 帳號）點 Google Drive 登入跳 `401 invalid_client / The OAuth client was not found`；2237-1 POS（lcym346 帳號）正常。
- 排查過程：
  1. 雙方 `googleBackup.clientId` 在 state 內皆為 `undefined`，因為 `google-backup-service.js` 採 `DEFAULT_CLIENT_ID` 硬編碼，不寫進 state（state 路徑應是 `googleDriveBackup` 而非 `googleBackup`）。
  2. Client ID 屬於 Firebase 自動建立的 OAuth client（Web client auto created by Google Service），Project `webpos-1f626`、Project number `203764995518`。
  3. 確認 Authorized JavaScript origins 已包含 `https://jess0937588151-hue.github.io` 和 `https://lcym346-byte.github.io`，但 2234 仍 invalid_client。
- 真正解法：使用者改用 T2 主機（Sunmi POS）登入即正常，桌機 Chrome 帳號狀態 / Cookie 因素導致暫時無法登入，**並非程式或 OAuth 設定問題**。
- 留存 SOP：未來若再遇 `invalid_client`：(a) 先換裝置或無痕視窗排除 Cookie；(b) 確認 Authorized JavaScript origins 包含當前網址；(c) 確認 OAuth consent screen 已發佈或測試使用者名單包含當前帳號；(d) 確認 Firebase Authorized domains 包含當前網域。
- 影響檔案：無

### 廚房單字級設定確認（無程式修改）
- 症狀：使用者反映 POS 設定頁「列印設定」內調整字級對廚房單沒效果。
- 根因：`js/modules/print-service.js` 的 `getPrintSettings()` 只有 `receiptFontSize` / `labelFontSize`，沒有 `kitchenFontSize` 獨立欄位；廚房單實際共用 `receiptFontSize`。但實際列印走的是 Sunmi APK 端的 HTTP 路徑，APK 內部可能對廚房單字級有自己的邏輯，POS 端的 `fontSize` 不一定會被讀取。
- 暫時解法：使用者於 Sunmi APK 設定頁直接調整字級，已解決。
- 未來優化方向（未做）：在 `getPrintSettings()` 加 `kitchenFontSize` 欄位、設定頁加對應 UI、`buildBridgePayload` 把字級放進 payload、Sunmi APK 端讀取 `payload.fontSize` 套用。三端都要動才完整。
- 影響檔案：無（純 APK 端調整）

### 踩雷紀錄
- **「找不到設定」可能不是 UI bug 而是讀取優先順序**：線上點餐標題的 fallback chain 是 `onlineStoreTitle` → `printConfig.storeName` → 預設值；使用者去設定頁找「線上點餐標題」找不到時，要先講清楚實際讀的是哪個欄位，避免使用者瞎找。
- **複製 repo 必改清單要明文寫**：`store-config.js` 漏改造成多店資料覆蓋，影響範圍極大（促銷、雲端備份、線上訂單、看板四條路徑全混在一起）。已寫入規範第 18 條。
- **OAuth `invalid_client` 不一定是 OAuth 設定問題**：可能只是瀏覽器 Cookie / 帳號狀態問題，先換裝置/無痕視窗測試比直接動 Google Cloud Console 安全。
- **POS 字級設定不一定全程貫穿**：POS 前端 `print-service.js` 的字級欄位只影響瀏覽器列印與舊 WebView 列印；走 HTTP → Sunmi APK 那條路徑時，字級實際是 APK 端控制。改字級要先確認用哪條列印路徑。

---
---

## v20260615（2026-05-20）— 促銷整合 + 預約提醒 + 圖庫匯出


### 廣告促銷管理整合至設定頁 tile
- 需求：原本 POS 主畫面有浮動按鈕 `#promoOpenSettingsBtn` 觸發促銷管理 Modal，使用者希望統一從「設定」頁進入。
- 設計決策：不動 `promotion-ui.js` 內部邏輯（避免破壞 226 行的 `mountPromotionSettingsUI()` 與 `openSettingsModal`），改以新增 tile + 程式化 dispatch click 的方式整合。
- 修法：
  - `index.html`：在設定頁區塊新增 tile（`<div class="setting-tile" data-promo-open="1">🎁 廣告促銷管理</div>`）。
  - `js/pages/settings-page.js`：在 `initSettingsPage()` 內為 `[data-promo-open="1"]` 綁定 click：動態 import `promotion-ui.js`、確認 `mountPromotionSettingsUI` 存在 → 呼叫掛載 → 隱藏舊浮動按鈕 → 程式化 click 該按鈕觸發 modal。
- 影響檔案：`index.html`、`js/pages/settings-page.js`

### Firebase 安全規則修正（促銷資料寫入）
- 症狀：手機端與 POS 端皆無法寫入 `publicOnlineStores/{storeId}/promotions`，被規則擋下。
- 根因：原規則用 `hasChildren()` 與 `staff` 節點驗證，但部分情境下 staff 節點不存在或 staff 未登入時無法通過。
- 修法：放寬促銷節點規則為「已認證使用者可讀寫」，仍維持 storeId 路徑隔離。
- 影響檔案：`Firebase_Realtime_Database_安全規則.json`

### 修正 Google OAuth Client ID 拼字錯誤
- 症狀：Google 登入失敗，redirect 後跳「Invalid client」。
- 根因：Client ID 字串內有拼字錯誤（少/多字元）。
- 修法：更正為正確的 OAuth Client ID。
- 影響檔案：`index.html`（OAuth 設定區）/ Google Cloud Console 設定

### 線上優惠碼帶入訂單 payload
- 症狀：手機端套用優惠碼後送單，POS 收到的訂單金額未扣折扣、看不到優惠碼。
- 根因：`online-order-page.js` 的 `submitOnlineOrder()` 組 payload 時只送 `subtotal` 與 `total`，完全忽略 `getCurrentPromotionResult()` 的折扣資料。
- 修法：計算 subtotal 後呼叫 `getCurrentPromotionResult()`，若 `ok===true` 則帶入 `couponCode` / `discount` / `couponMessage`，`total` 改為 `Math.max(0, subtotal - discount)`。
- 影響檔案：`js/pages/online-order-page.js`

### POS 端接收優惠碼資料（buildRealtimeOrderForPOS）
- 症狀：即時接單彈窗顯示有折扣，但點擊接單後，訂單查詢「待付款」列表又顯示原價（無折扣）。
- 根因：`realtime-order-service.js` 的 `buildRealtimeOrderForPOS()` 把雲端訂單轉成 POS 本地訂單時，硬編碼 `discountType:'amount'`、`discountValue:0`、`discountAmount:0`、`total:subtotal`，完全忽略雲端傳來的 `remote.discount` / `remote.couponCode` / `remote.couponMessage`。
- 修法：計算 `remoteDiscount = Math.max(0, Math.min(Number(remote.discount||0), subtotal))`，回傳物件加入 `discountValue` / `discountAmount` / `couponCode` / `couponMessage`，`total = Math.max(0, subtotal - remoteDiscount)`。
- 影響檔案：`js/modules/realtime-order-service.js`

### 訂單卡顯示折扣明細
- 症狀：折扣已正確扣除，但訂單卡上只看到最終金額，看不到「優惠碼是什麼」「折了多少」。
- 修法：
  - `renderOrdersSection()`：`discountAmount > 0` 時，在金額區塊上方顯示劃掉的原始小計 `money(subtotal)`，主金額紅字呈現，並在金額下方追加一行綠底虛線框「🎁 優惠折扣（CODE）<message> -NN」。
  - `renderIncomingOnlineOrders()`：即時待確認單彈窗同樣顯示原價（劃掉）+ 折扣後總價 + 綠色優惠碼提示。
- 影響檔案：`js/pages/orders-page.js`
- 驗證：截圖確認 100→95 顯示正確，含原價劃掉、紅字 95、綠色「🎁 優惠折扣（DA999）滿100現金支付優惠 -5」。

### 預約 30 分鐘前提醒 Modal
- 症狀：預約單接單後，到了取餐前 30 分鐘沒有任何提醒。
- 根因：邏輯其實已存在於 `realtime-order-service.js`（`startReservationReminderLoop` / `checkReservationReminders` / `showReservationReminderOverlay`），`app.js` 也已 import 並啟動。但 `index.html` **缺少 `#reservationReminderOverlay` DOM 元素**，導致 `showReservationReminderOverlay()` 第一行 `if(!overlay) return;` 直接退出，沒有任何提示。
- 修法：在 `index.html` 結束值班 Modal 之前新增 `#reservationReminderOverlay` Modal，內含訂單編號、總金額、預約時間、顧客資訊、品項列表、「🔔 開始備餐並列印廚房單」與「稍後再提醒」兩顆按鈕。
- 影響檔案：`index.html`
- 觸發條件：每 60 秒輪詢 `state.orders`，若 `reservationAt - 30 分鐘 ≤ now < reservationAt` 且 `reservationReminded !== true` 且 status 不在已完成/拒絕/取消/作廢之列，即彈出。
- 驗證：使用者於 Console 用 `(async()=>{ const {state, persistAll}=await import('./js/core/store.js'); ... })()` 改一筆訂單的 `reservationAt` 為 10 分鐘後並重設 `reservationReminded`，60 秒內 Modal 正常彈出，顯示完整資訊。
- 待驗證：實機按下「開始備餐」是否會真的列印廚房單與顧客單（已記到「最新進度」待辦）。

### SKU 圖庫對應表反推工具（Console 操作）
- 症狀：使用者進入「設定 → SKU 圖庫對應」匯出後拿到空白 JSON，因為從未匯入過對應表。
- 根因：商品 `state.products[].image` 存的是完整 URL（例：`https://jess0937588151-hue.github.io/2234/images/products/48.jpg`），但對應表 `state.settings.imageLibrary.skuMap` 從未填過值，所以匯出空白。
- 修法：給使用者一段 Console 腳本，從現有 `state.products` 反推 `skuMap`（key=SKU, value=檔名部分），並自動設定 `baseUrl`，最後呼叫 `persistAll()` 寫回 IndexedDB / 雲端。
- 驗證：使用者成功寫入 57 筆對應表（略過 4 筆缺 SKU/缺圖商品），匯出 `sku-image-map-2026-05-20.json` 正常。
- 注意事項：商品 SKU 格式不統一（有 `A001` 也有 `347` / `0062`），建議未來統一為 `A001` 四碼，且新增商品時圖片檔名直接用 SKU 命名。

### 三個舊 bug 修復
- 必選/複選模組選項：修正模組規則驗證邏輯，min/max 計算正確，停售選項不參與計數。
- 購物車清空：修正特定操作後購物車殘留狀態的問題，確保結帳完成或手動清空按鈕能徹底重置 `state.cart`。
- 看板歷史：修正看板端歷史資料讀取相容性問題（沿襲 v20260613 BD 改造後的 key 並存策略）。

### 踩雷紀錄
- **DOM 元素缺失導致函式靜默退出**：v20260615 預約提醒功能在 `realtime-order-service.js` 早已實作完整，卻因為 `index.html` 缺對應 overlay 元素，導致整個功能無聲無息失效。教訓：日後若使用者回報「某功能完全沒反應」，先在 Console 用 `document.getElementById('xxx')` 確認 DOM 是否存在，再去看邏輯層。
- **promotion-ui.js 不能改 226 行**：使用者明確指示該檔不能動內部邏輯，整合策略只能在外圍包裝（tile + 程式化 click），避免重構造成回歸。
- **資料流斷點分散在三個檔案**：優惠碼從手機端送出到 POS 顯示中間經過 `online-order-page.js` → Firebase → `realtime-order-service.js` → `orders-page.js`，任何一個檔案漏接欄位都會讓使用者覺得「為什麼半路不見了」。修這類問題要一條 pipeline 從頭走到尾驗證，不能只看單一檔案。
- **SKU 圖庫的兩種資料來源**：`state.products[].image` 是「實際顯示用 URL」，`state.settings.imageLibrary.skuMap` 是「SKU → 檔名對應表」，兩者獨立。使用者以為「商品有圖 = 對應表有資料」，實際上對應表可能完全是空的。修這類問題要先釐清資料來源，再決定要不要從 A 反推到 B。

---

## 2026-05-15（晚）

### 新增成本管理模組
- 需求：報表內加「成本管理」按鈕，自動從現有菜單生成品項清單，可輸入成本、匯入/匯出 Excel；結束值班時根據販售品項計算預估獲利。
- 設計決策：
  - 成本儲存位置採用 `state.settings.costMap[productId] = { cost, updatedAt }`（**Option A**），不污染 `state.products` 欄位，與既有匯入/匯出邏輯解耦。
  - 成本資料**不跨店共用**（使用者明確指示），透過既有 `posBackup/{storeId}/state` 自動雲端備份。
  - Excel 欄位：`SKU | 品名 | 分類 | 售價 | 成本 | 毛利 | 毛利率`，匯入以 SKU 為主鍵，無 SKU 時用品名對應。
  - 未設成本品項處理方式：跳過並在 UI 顯示提示（選項 b）。
- 影響檔案：
  - `js/modules/cost-manage.js`（新檔，含 modal HTML、Excel 匯入匯出、`calcSessionProfit()` API）
  - `js/pages/reports-page.js`（新增 import、`costManageBtn` handler 改為 `openCostManageModal`、`renderCurrentSessionData()` 與 `openSessionSummaryModal()` 加入預估獲利卡片）
  - `service-worker.js`（升 CACHE_NAME + ASSETS 加入 cost-manage.js）
- 踩雷：modal 一開始用了 `modal-panel` class 導致樣式破掉（白底/置中/陰影都沒），改用既有 `modal-dialog wide` 即可。

### 修復看板異常單金額顯示 0 元
- 症狀：POS 端結帳並作廢一筆 $75 訂單後，看板「異常單金額」與「異常單數」始終顯示 0。
- 根因：POS 端 `dashboard-publish.js` v20260613 把 `today` 物件內的異常欄位名稱從 `voided` 改為 `abnormal`，但看板端 `pos-dashboard/index.html` 仍讀 `today.voided`。兩邊版號都標 v20260613，POS 在 5/12 21:58 改完之後，看板 5/13 11:09 的更新沒同步欄位名，導致欄位永遠對不上。
- 排除其他可能：完整檢查看板 `history-loader.js` 與 `print-service-dashboard.js`，兩者都不讀 `today.voided` 路徑，只用 `sessionHistory/` 與內部 `isVoidedStatus()`；POS 端內部其他模組也沒有回讀 `today.*`。因此改名只影響「即時看板首頁卡片」這一個地方。
- 修法：把 POS 端 `dashboard-publish.js` 內 `calcTodayStats()` 的 `abnormal` 全部還原為 `voided`（變數名、return key、檔頭註解共 7 處）。
- 影響檔案：`js/modules/dashboard-publish.js`（v20260515）
- 同步修改看板端：`pos-dashboard/index.html` 把 UI 文字「最後心跳」改為「最後更新」（heartbeat 在繁中語境應翻成「更新」/「連線狀態」，非直譯「心跳」；Firebase 節點名 `heartbeat`、變數名 `hb` 不動以保相容）。
- 教訓：未來修改任何 Firebase 寫入欄位名稱前，必須先 grep 看板 repo 是否有對應讀取碼，並同 commit 同步兩邊。已在 `aiREADME最新進度.md` 新增「v20260614 欄位命名規約」段落。

### POS 與線上點餐頁分類標籤「全部」改到最後
- 需求：使用者覺得「全部」放在第一個位置不順手，改放最後。
- 修法：
  - `js/pages/pos-page.js` 的 `renderTabs()`：`['全部', ...state.categories]` 改為 `[...state.categories.filter(c => c !== '全部'), '全部']`。
  - `js/pages/online-order-page.js` 的 `renderCategoryTabs()`：`['全部', ...cats.filter(...)]` 改為 `[...cats.filter(...), '全部']`。
- 過濾邏輯（`selectedCategory==='全部'` 顯示全部商品）不變，因為比對的是字串本身，跟順序無關。
- 影響檔案：`js/pages/pos-page.js`、`js/pages/online-order-page.js`、`service-worker.js`（升 CACHE_NAME）

## 2026-05-15


### 修復 orders-page.js addOrderToCart TypeError
- 症狀：訂單查詢頁按「加到購物車」會跳 `Uncaught TypeError: Cannot set properties of null (setting 'value') at addOrderToCart (orders-page.js:138)`，購物車內容不會帶過去。
- 根因：第 138 行 `document.getElementById('discountValue').value = o.discountValue || 0;` 中的 `#discountValue` 是舊版折扣機制的 input 欄位，已從 index.html 移除。新版折扣改用「負金額品項」直接 push 到 cart，原訂單的折扣已隨 `state.cart = deepCopy(o.items)` 一併帶過去，不需再單獨設定。
- 修法：刪除第 138 行（`discountValue.value = …`）與第 139 行（`state.settings.discountType = …`），保留 `orderType` 與 `tableNo` 兩行。
- 影響檔案：`js/pages/orders-page.js`（v20260515-d）
- 驗證：訂單頁按「加到購物車」→ 自動切到 POS 頁 → 購物車含原訂單品項與折扣品項 → 結帳產生新單 → 原訂單不變。

### 模組子選項可單獨停售
- 需求：「七選三」配料中某選項賣完時，要能單獨關閉該選項；模組規則、其他選項、其他商品都不受影響。
- 現況檢查：`store.js` 的 `normalizeModules` 已支援子選項 `enabled` 欄位；`pos-page.js`、`online-order-page.js` 渲染時已用 `.filter(o=>o.enabled!==false)` 過濾；`product-module-manager.js` 的 `saveModuleManage()` 已在 `cleanOpts` 保留 `enabled`。唯一缺口是管理 UI 無切換開關。
- 修法：在 `product-module-manager.js` 的 `renderOptions()` 為每個子選項列加入啟用/停售 checkbox，停售列以半透明灰底顯示。`addOption()` 新增時帶 `enabled:true`。
- 影響檔案：`js/modules/product-module-manager.js`（v20260515-c）
- 驗證：商品管理 → 模組 → 取消某選項勾選 → 儲存 → POS 與線上點餐均不顯示停售項目；模組規則（min/max）不變；勾回後恢復顯示。

### 修復 store.js localStorage 配額爆掉
- 症狀：顧客點餐頁空白；Console 紅字 `persistAll failed: DOMException: ... exceeded the quota at store.js:343`。
- 修法：`persistAll()` 內的 `localStorage.setItem` 加 try/catch，捕捉 `QuotaExceededError` 後 console.warn 並 `removeItem(LS_KEY)`，讓 IndexedDB 寫入仍正常進行。
- 影響檔案：`js/core/store.js`

### 修復 reports-page.js 重複 payKeys 宣告
- 症狀：報表頁開啟即掛掉，Console `SyntaxError: Identifier 'payKeys' has already been declared`。
- 修法：刪除重複的後 4 行 payKeys 宣告。
- 影響檔案：`js/pages/reports-page.js`

### 看板端 BD 查詢改造
- `pos-dashboard/js/history-loader.js`：從「自然日 60 天」改為「最近 60 個營業日」，跳過公休日，新舊 key 並存相容。
- `pos-dashboard/index.html`：多讀 `dashboards/{storeId}/businessHours`；UI 文字「淨營業額→營業額」「作廢/取消→異常」「最後心跳→最後更新」；新增外送 $X 顯示；移除淨營業額欄位。
- 對應原進度檔的 Commit 8、Commit 9。

### v20260614 圖片方案改採 GitHub Pages
- 原規劃的 Firebase Storage 方案因要收費而作廢。
- 改用既有的 `jess0937588151-hue/2234/images/products/gallery.html` 工具產生 SKU → URL 對應表，匯入到 POS `state.settings.imageLibrary.skuMap`，商品依 SKU 自動套圖。
- index.html 內的「SKU 圖庫對應」Modal、`imageLibraryBaseUrl`、`imageLibraryImportBtn` 與 store.js 的 `imageLibrary` 預設值即為此方案實作。

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
