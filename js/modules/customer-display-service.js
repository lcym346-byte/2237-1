/**
 * js/modules/customer-display-service.js
 * 客顯推送服務 v20260602
 *
 * 職責：
 *   - 向 APK 的 DisplayHttpServer (127.0.0.1:8081) POST 客顯資料
 *   - 支援三種狀態：cart（購物車更新）、paid（付款完成）、idle（待機）
 *   - 讀取 state.settings.customerDisplay.enabled / port / token 設定
 *   - v20260602：附帶 slides（商品輪播圖 URL 陣列），供客顯右半邊輪播
 *   - 失敗時只 console.warn，絕不影響列印功能
 *   - 採 0.4 秒節流（DISPLAY_THROTTLE_MS），避免快速點擊打爆 APK
 *
 * 設計原則：
 *   - 與 print-bridge.js 完全獨立，不共用任何變數
 *   - 使用與 PrintHttpServer 相同的 X-API-Token 驗證機制
 *   - 所有 export function 不會 throw，失敗靜默 warn
 */

import { state } from '../core/store.js';
import { getApiToken } from './print-bridge.js';

const DISPLAY_THROTTLE_MS = 400; // 0.4 秒節流
const MAX_SLIDES = 12;           // 輪播圖最多張數（避免 payload 過大）
let _displayThrottleTimer = null;
let _lastSentHash = '';

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



// ==================== 輪播圖收集（v20260602） ====================

/**
 * 收集商品輪播圖 URL 陣列，供客顯右半邊輪播。
 * 來源優先順序（兩種設圖方式皆相容）：
 *   1) product.image 有值（手動貼的完整 URL）→ 直接用
 *   2) product.sku 在 imageLibrary.skuMap 有對應檔名 → baseUrl + 檔名 拼出 URL
 * 只取啟用中的商品，去重、限制最多 MAX_SLIDES 張。
 */
function collectSlideImages() {
  try {
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
 * 推送客顯資料（內部使用，帶節流）
 * @param {object} payload - 符合 DisplayHttpServer /display/update 規格的物件
 */
async function _sendToDisplay(payload) {
  const cfg = getDisplayConfig();
  if (!cfg.enabled) return;

  const body = JSON.stringify(payload);

  // 避免相同內容重複推送（hash 比對）
  const hash = body;
  if (hash === _lastSentHash) return;
  _lastSentHash = hash;

  const url = getBaseUrl(cfg) + '/display/update';
  const url = getBaseUrl(cfg) + '/display/ping';
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
    // 靜默失敗（APK 未啟動時正常）
    console.warn('[customer-display] unreachable (normal if APK not running):', e && e.message);
  }
}

/**
 * 節流推送：節流窗內多次呼叫只送最後一次
 * @param {object} payload
 */
function _throttledSend(payload) {
  if (_displayThrottleTimer) {
    clearTimeout(_displayThrottleTimer);
  }
  _displayThrottleTimer = setTimeout(() => {
    _displayThrottleTimer = null;
    _sendToDisplay(payload).catch(() => {});
  }, DISPLAY_THROTTLE_MS);
}

// ==================== 公開 API ====================

/**
 * 購物車更新時推送（節流）
 * 供 pos-page.js 的 renderCart() 呼叫
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
      // 同時帶兩種欄位：price/options 給舊版客顯頁；basePrice/extraPrice/selections 給 APK 內嵌客顯頁
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

    _throttledSend({
      type:      'cart',
      storeName,
      items,
      subtotal,
      total:     subtotal,
      slides:    collectSlideImages()   // v20260602 右半邊輪播圖
    });
  } catch (e) {
    console.warn('[customer-display] displayCart error:', e && e.message);
  }
}

/**
 * 付款完成時立即推送（不節流，付款完成需即時顯示）
 * 供 order-service.js 結帳完成後呼叫
 * @param {object} order - createOrUpdateOrder 回傳的訂單物件
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

    await _sendToDisplay({
      type:          'paid',
      storeName,
      items,
      subtotal:      order.subtotal  || 0,
      total:         order.total     || 0,
      paymentMethod: order.paymentMethod || '',
      orderNo:       order.orderNo   || ''
    });

    // 付款完成後 5 秒自動回到待機畫面
    setTimeout(() => {
      displayIdle();
    }, 5000);

  } catch (e) {
    console.warn('[customer-display] displayPaid error:', e && e.message);
  }
}

/**
 * 清空購物車或 POS 閒置時推送待機狀態
 * 供 pos-page.js 清空購物車時呼叫
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

    _sendToDisplay({
      type:      'idle',
      storeName,
      items:     [],
      subtotal:  0,
      total:     0,
      message,
      slides:    collectSlideImages()   // v20260602 待機時也輪播商品圖
    }).catch(() => {});
  } catch (e) {
    console.warn('[customer-display] displayIdle error:', e && e.message);
  }
}

/**
 * 更新偵測：檢查客顯 Server 是否在線
 * @returns {Promise<boolean>}
 */
export async function pingDisplayServer() {
  try {
    const cfg = getDisplayConfig();
    const url = getBaseUrl(cfg) + '/display/update';
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
