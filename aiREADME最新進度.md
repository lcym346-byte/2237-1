# 📋 最新進度（v20260613）

> 本檔記錄**當前版本進行中的項目、待處理事項、已知問題**。
> 已完成項目請見 `aiREADME已完成紀錄.md`。
> 規範與架構說明請見 `aiREADME.md`。

最後更新：2026-05-13

---

## 🚨 已知問題（優先處理）

### 1. reports-page.js 重複貼上造成 SyntaxError（待修）

**現象**：`openSessionSummaryModal()` 內「付款方式」區塊出現兩次 `const payKeys = Object.keys(payMap)`，會丟出 `SyntaxError: Identifier 'payKeys' has already been declared`，整個 `reports-page.js` 模組載入失敗，POS 報表頁開啟即掛掉。

**位置**：約在 v20260613 Commit 5 修改點 4 附近。

**錨點**（找這段重複的部分）：
```javascript
  const payKeys = Object.keys(payMap);
  document.getElementById('summaryPayments').innerHTML = payKeys.length
    ? payKeys.map(k=>`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f1f5f9"><span>${escapeHtml(k)}</span><strong>${money(payMap[k])}</strong></div>`).join('')
    : '<div class="muted">無</div>';
  const payKeys = Object.keys(payMap);
  document.getElementById('summaryPayments').innerHTML = payKeys.length
    ? payKeys.map(k=>`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f1f5f9"><span>${escapeHtml(k)}</span><strong>${money(payMap[k])}</strong></div>`).join('')
    : '<div class="muted">無</div>';
```

**修法**：刪除重複的後 4 行，只保留前 4 行。

**Commit 訊息**：`fix(reports-page)：移除誤貼的重複 payKeys 宣告（修復 SyntaxError）`

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

#### POS service-worker.js（依使用者指示暫不做）
- 升 CACHE_NAME 至 `pos-v20260613-cache`
- 加入 `js/core/biz-day.js` 到 ASSETS pre-cache 清單
- **狀態**：使用者明確說「不做第六點」，需等使用者再下指示才執行

#### 訂單頁「修改」TypeError（早先回報，截圖顯示 orders-page.js:135）
- **狀態**：v20260613 已透過「加到購物車」流程繞過此 bug，但原本的 `loadOrderToCart` 路徑被移除後是否還會跳錯需實機驗證
- 若使用者切到 v20260613 後仍會出錯，需另外開 commit 查找根因

---

## ❌ 本次明確不做（使用者已說明）

- 設定頁營業時間 24 小時制（使用者已在系統設定處理）
- 預設營業時間改為 14:00–03:00（不改 `DEFAULT_BUSINESS_HOURS`，避免影響既有店）
- POS service-worker.js CACHE_NAME 升版（暫不做，但未來其他改動觸發 PWA 需要時要記得做）

---

## 🧪 待實機驗證項目（v20260613）

下列 v20260613 改動已 commit 但尚未實機驗證，下次接手時請排程驗證：

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
  - 計入「其他」付款，不計入現金
  - 值班中不能輸入（中間可能換班），只能結班時手動輸入
  - 已結班的外送加總計入該 BD 今日總覽
- **訂單修改流程**：加到購物車 → 結帳產生新單 → 另外作廢原單（封閉就地修改的營業額漏洞）
- **資料保存**：本地與雲端 `sessionHistory` 都保留 90 自然日（避免長期休業導致儲存負擔過大）
- **歷史報表**：顯示最近 60 個營業日，自動跳過公休日

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
