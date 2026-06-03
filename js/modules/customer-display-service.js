/**
 * js/modules/customer-display-service.js
 * 客顯推送服務 v20260603-interval
 *
 * 職責：
 *   - 向 APK 的 DisplayHttpServer (127.0.0.1:8081) POST 客顯資料
 *   - 支援三種狀態：cart（購物車更新）、paid（付款完成）、idle（待機）
 *   - 讀取 state.settings.customerDisplay.enabled / port / token 設定
 *   - v20260603-interval：購物車變動即時推送；無變動時由 10 秒計時器定時推送
 *     （避免結帳瞬間客顯 POST 扎堆，害 8080 列印偵測 ping timeout 而跳瀏覽器列印）
 *   - 付款完成推送延後 600ms，把結帳列印偵測的瞬間讓出來，不搶連線
 *   - 失敗時只 console.warn，絕不影響列印功能
 *
 * 設計原則：
 *   - 與 print-bridge.js 完全獨立，不共用任何變數
 *   - 使用與 PrintHttpServer 相同的 X-API-Token 驗證機制
 *   - 所有 export function 不會 throw，失敗靜默 warn
 *   - 所有推送統一經過 _lastSentHash 比對：內容沒變就不發（待機時幾乎不送）
 */

import { state } from '../core/store.js';
import { getApiToken } from './print-bridge.js';

const MAX_SLIDES = 12;            // 輪播圖最多張數（避免 payload 過大）
const IDLE_INTERVAL_MS = 10000;   // 無變動時，每 10 秒定時推送一次
const PAID_DELAY_MS = 600;        // 付款完成推送延後，讓結帳列印偵測先跑

let _lastSentHash = '';
let _idleTimer = null;            // 10 秒定時器
let _lastPayload = null;          // 最近一次「應顯示」的 payload（供定時器重送）

// ==================== 設定讀取 ====================

function getDisplayConfig() {
  const cfg = (state.settings && state.settings.customerDisplay) || {};
  let token = '';
  try { token = getApiToken() || ''; } catch (e) {}
  if (!token) token = cfg.token || '';
  return {
    enabled: cfg.enabled !== false,
    host:    (cfg.host && String(cfg.host).trim()) || '127.0.0.1',
    port:    cfg.port    || 8081,
    token:   token
  };
}

function getBaseUrl(cfg) {
  return 'http://' + cfg.host + ':' + cfg.port;
}

// ==================== 輪播圖收集 ====================

/**
 * 收集輪播圖 URL 陣列，供客顯右半邊輪播。
 * 優先順序：
 *   1) 客顯獨立輪播圖（customerDisplay.slides + slidesBaseUrl）→ 與餐點圖無關
 *   2) 沒設時退回商品圖（product.image，或 sku 在 imageLibrary.skuMap 的對應）
 * 去重、限制最多 MAX_SLIDES 張。
 */
function collectSlideImages() {
  try {
    const cd = (state.settings && state.settings.customerDisplay) || {};
    let cdBase = (cd.slidesBaseUrl || '').trim();
    if (cdBase && !/\/$/.test(cdBase)) cdBase = cdBase + '/';
    const cdSlides = Array.isArray(cd.slides) ? cd.slides : [];
    const independent = [];
    for (const name of cdSlides) {
      const n = (name || '').trim();
      if (!n) continue;
      independent.push(/^https?:\/\//i.test(n) ? n : (cdBase + n));
    }
    if (independent.length > 0) return independent.slice(0, MAX_SLIDES);

    const products = Array.isArray(state.products) ? state.products : [];
    const lib = (state.settings && state.settings.imageLibrary) || {};
    let base = (lib.baseUrl || '').trim();
    if (base && !/\/$/.test(base)) base = base + '/';
    const skuMap = (lib.skuMap && typeof lib.skuMap === 'object') ? lib.skuMap : {};

    const urls = [];
    const seen = {};
    for (const p of products) {
      if (!p || p.enabled === false) continue;
      let url = '';
      if (p.image && String(p.image).trim()) {
        url = String(p.image).trim();
      } else if (p.sku && skuMap[p.sku] && base) {
        url = base + skuMap[p.sku];
      }
      if (url && !seen[url]) {
        seen[url] = true;
        urls.push(url);
        if (urls.length >= MAX_SLIDES) break;
      }
    }
    return urls;
  } catch (e) {
    console.warn('[customer-display] collectSlideImages error:', e && e.message);
    return [];
  }
}

// ==================== 核心推送 ====================

/**
 * 真正發 POST（內部用）。hash 比對：內容沒變就不發。
 * @param {object} payload
 */
async function _postNow(payload) {
  const cfg = getDisplayConfig();
  if (!cfg.enabled) return;

  const body = JSON.stringify(payload);
  if (body === _lastSentHash) return; // 內容沒變，不重複送
  _lastSentHash = body;

  const url = getBaseUrl(cfg) + '/display/update';
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Token':  cfg.token
      },
      body
    });
    if (!resp.ok) {
      console.warn('[customer-display] POST failed status=' + resp.status);
    } else {
      console.log('[customer-display] sent type=' + payload.type);
    }
  } catch (e) {
    console.warn('[customer-display] unreachable (normal if APK not running):', e && e.message);
  }
}

/**
 * 啟動 / 重置 10 秒定時器。
 * 到點時重送 _lastPayload（hash 比對會擋掉沒變動的，所以待機時幾乎不發）。
 */
function _ensureIdleTimer() {
  if (_idleTimer) return;
  _idleTimer = setInterval(() => {
    const cfg = getDisplayConfig();
    if (!cfg.enabled) return;
    if (_lastPayload) _postNow(_lastPayload).catch(() => {});
  }, IDLE_INTERVAL_MS);
}

function _resetIdleTimer() {
  if (_idleTimer) {
    clearInterval(_idleTimer);
    _idleTimer = null;
  }
  _ensureIdleTimer();
}

// ==================== 公開 API ====================

/**
 * 購物車更新：記錄 payload 並「立刻推送」一次，同時重置 10 秒計時器。
 * 供 pos-page.js 的 renderCart() 呼叫。
 */
export function displayCart() {
  try {
    const cfg = getDisplayConfig();
    if (!cfg.enabled) return;

    const storeName = (state.settings &&
      state.settings.printConfig &&
      state.settings.printConfig.storeName) || '';

    const items = (state.cart || []).map(item => ({
      name:      item.name      || '',
      qty:       item.qty       || 1,
      price:     (Number(item.basePrice||0) + Number(item.extraPrice||0)) * Number(item.qty||1),
      options:   (item.selections || []).map(s => s.optionName).filter(Boolean).join('、'),
      basePrice: Number(item.basePrice || 0),
      extraPrice:Number(item.extraPrice || 0),
      selections:(item.selections || []).map(s => ({
        moduleName: s.moduleName || '',
        optionName: s.optionName || ''
      })),
      note:      item.note || ''
    }));

    const subtotal = (state.cart || []).reduce(
      (s, x) => s + (x.basePrice + x.extraPrice) * x.qty, 0
    );

    _lastPayload = {
      type:      'cart',
      storeName,
      items,
      subtotal,
      total:     subtotal,
      slides:    collectSlideImages()
    };

    // 購物車有變動 → 立刻推送 + 重置 10 秒計時器
    _resetIdleTimer();
    _postNow(_lastPayload).catch(() => {});
  } catch (e) {
    console.warn('[customer-display] displayCart error:', e && e.message);
  }
}

/**
 * 付款完成：延後 PAID_DELAY_MS 再推送，把結帳列印偵測的瞬間讓出來，
 * 避免客顯 POST 與 8080 列印 ping 搶連線。
 * 供 order-service.js 結帳完成後呼叫。
 * @param {object} order
 */
export async function displayPaid(order) {
  try {
    const cfg = getDisplayConfig();
    if (!cfg.enabled) return;

    const storeName = (state.settings &&
      state.settings.printConfig &&
      state.settings.printConfig.storeName) || '';

    const items = (order.items || []).map(item => ({
      name:    item.name    || '',
      qty:     item.qty     || 1,
      price:   (item.basePrice + item.extraPrice) * item.qty,
      options: (item.selections || []).map(s => s.optionName).filter(Boolean).join('、')
    }));

    const paidPayload = {
      type:          'paid',
      storeName,
      items,
      subtotal:      order.subtotal  || 0,
      total:         order.total     || 0,
      paymentMethod: order.paymentMethod || '',
      orderNo:       order.orderNo   || ''
    };

    // 延後推送，讓結帳列印偵測先跑（不搶連線）
    setTimeout(() => {
      _lastPayload = paidPayload;
      _resetIdleTimer();
      _postNow(paidPayload).catch(() => {});
      // 付款完成後 5 秒回到待機
      setTimeout(() => { displayIdle(); }, 5000);
    }, PAID_DELAY_MS);

  } catch (e) {
    console.warn('[customer-display] displayPaid error:', e && e.message);
  }
}

/**
 * 待機：記錄待機 payload。不立刻硬發，交給 10 秒計時器處理
 * （hash 比對會擋掉重複，所以待機畫面其實幾乎不送，只有輪播圖內容變了才送）。
 * 供 pos-page.js 清空購物車時呼叫。
 */
export function displayIdle() {
  try {
    const cfg = getDisplayConfig();
    if (!cfg.enabled) return;

    const storeName = (state.settings &&
      state.settings.printConfig &&
      state.settings.printConfig.storeName) || '';

    const message = (state.settings &&
      state.settings.customerDisplay &&
      state.settings.customerDisplay.idleMessage) || '歡迎光臨';

    _lastPayload = {
      type:      'idle',
      storeName,
      items:     [],
      subtotal:  0,
      total:     0,
      message,
      slides:    collectSlideImages()
    };

    // 不立刻硬發：重置計時器，由 10 秒定時器推送（hash 比對擋重複）
    _resetIdleTimer();
    _postNow(_lastPayload).catch(() => {});
  } catch (e) {
    console.warn('[customer-display] displayIdle error:', e && e.message);
  }
}

/**
 * 偵測客顯 Server 是否在線
 * @returns {Promise<boolean>}
 */
export async function pingDisplayServer() {
  try {
    const cfg = getDisplayConfig();
    const url = getBaseUrl(cfg) + '/display/ping';
    const resp = await fetch(url, { method: 'GET' });
    if (resp.ok) {
      const data = await resp.json();
      return !!(data && data.ok);
    }
    return false;
  } catch (e) {
    return false;
  }
}
