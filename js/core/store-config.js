/* 中文備註：店家設定（v20260608）
 * 每間店把此檔案的 storeId / storeName / storeCode 改成自己的即可，
 * 其他檔案完全不用動。複製到 2234 (JESS) 時只改這兩三行。
 * 強制鎖定：即使網址帶 ?storeId=xxx 也以本檔為準，避免誤切店。
 */
export const STORE_CONFIG = {
  storeId:   'store001',     // 內部識別碼，Firebase 路徑與 Google Sheet 分頁名稱
  storeName: '測試店',         // 顯示名稱（報表、收據抬頭備援）
  storeCode: 'store001',     // 線上點餐 URL 用的 storeCode（可與 storeId 相同）
  lockFromUrl: true          // true = 忽略 URL 的 storeId / storeName 參數
};
