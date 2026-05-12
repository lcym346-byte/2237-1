📋 v20260613 任務清單（看板營業日 BD + 外送統計）
✅ 已完成
 Commit 1：POS js/core/biz-day.js（新檔 - BD 共用工具）
 Commit 2：POS js/modules/dashboard-publish.js（用 BD 計算今日 + publish businessHours + 心跳改稱更新）
 Commit 3：POS js/modules/report-session.js（外送欄位 + sessionHistory key 用 BD + 雲端清理 90 天）
⏳ 待完成
 Commit 4：POS index.html 結束值班 Modal 新增「熊貓 Grod 金額」「Uber 金額」兩個輸入欄位

 Commit 5：POS js/pages/reports-page.js 讀取結束值班 Modal 的兩個新欄位傳給 endSession()；班次摘要與列印報表顯示外送加總與「外送$X」

 Commit 6：POS service-worker.js CACHE_NAME 升至 pos-v20260613-cache + 把 js/core/biz-day.js 加入 ASSETS pre-cache 清單

 Commit 7：看板 pos-dashboard/js/biz-day.js（新檔） 看板用 BD 工具（與 POS 共用邏輯，獨立檔案）

 Commit 8：看板 pos-dashboard/js/history-loader.js 改用 BD 切日、最近 60 個營業日查詢（跳過公休）、新舊 key 並存相容

 Commit 9：看板 pos-dashboard/index.html

從 Firebase 多讀 businessHours 節點
用 BD 算今日/週/月（today 直接讀 POS publish 好的值，週/月用 BD 跳過公休）
UI 文字：「淨營業額」→「營業額」、「作廢/取消」→「異常」、「最後心跳」→「最後更新」
新增「外送 $X」顯示（從 today.delivery.total 讀）
移除「淨營業額」格
 Commit 10：POS aiREADME.md 更新「進度紀錄」段落新增 v20260613 紀錄

❌ 本次明確不做（你已說「等下處理」）
「修改」訂單按鈕錯誤（截圖 orders-page.js:135 的 TypeError）
設定頁營業時間 24 小時制（你已在系統設定處理）
預設營業時間改成 14:00–03:00（不改 DEFAULT_BUSINESS_HOURS）
