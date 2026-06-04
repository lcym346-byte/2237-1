/* 中文備註：促銷 UI 整合模組
 * 1. mountPromotionSettingsUI()：在設定頁注入「廣告促銷」按鈕 + 設定 modal
 * 2. mountPromotionOnlineUI()：在線上點餐頁渲染廣告橫幅 + 優惠碼輸入區
 * 設計原則：完全獨立，不依賴 settings-page.js / online-order-page.js 的內部變數
 */
import {
  ensurePromotionsConfig,
  setPromotionsConfig,
  applyPromotionTemplate,
  getPromotionTemplates,
  getPublicPromotionsConfig,
  calculatePromotion,
  pushPromotionsToCloud,
  pullPromotionsFromCloud
} from './promotion-service.js';


// ====================================================================
// 共用工具
// ====================================================================
function esc(v){
  return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}
function money(v){ return Number(v || 0).toLocaleString('zh-TW'); }
function toast(msg){
  var t = document.getElementById('__promoToast');
  if(!t){
    t = document.createElement('div');
    t.id = '__promoToast';
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 18px;border-radius:8px;font-size:14px;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,.3);opacity:0;transition:opacity .2s';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(function(){ t.style.opacity = '0'; }, 1800);
}

// ====================================================================
// 1) 設定頁 UI
// ====================================================================

function buildSettingsModalHtml(){
  return '' +
'<div id="promoSettingsModal" class="promo-modal" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:9998;align-items:center;justify-content:center;padding:20px">' +
'  <div style="background:#fff;max-width:780px;width:100%;max-height:90vh;overflow:auto;border-radius:12px;box-shadow:0 20px 40px rgba(0,0,0,.3)">' +
'    <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #e2e8f0;position:sticky;top:0;background:#fff;z-index:1">' +
'      <h3 style="margin:0;font-size:18px;color:#0f172a">廣告促銷管理</h3>' +
'      <button id="promoCloseBtn" type="button" style="background:none;border:none;font-size:24px;cursor:pointer;color:#64748b">×</button>' +
'    </div>' +
'    <div style="padding:20px">' +
'      <div style="margin-bottom:16px;padding:12px;background:#f1f5f9;border-radius:8px">' +
'        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">' +
'          <input type="checkbox" id="promoEnabledChk" style="width:18px;height:18px">' +
'          <strong>啟用線上點餐廣告與優惠碼</strong>' +
'        </label>' +
'        <div style="margin-top:8px;color:#64748b;font-size:13px">關閉後，線上點餐頁不會顯示任何廣告橫幅，優惠碼也無法套用。</div>' +
'      </div>' +
'      <div style="margin-bottom:16px">' +
'        <label style="display:block;margin-bottom:6px;font-weight:600">套用內建模板（快速設定）</label>' +
'        <div style="display:flex;gap:8px;flex-wrap:wrap">' +
'          <select id="promoTemplateSelect" style="flex:1;min-width:200px;padding:8px;border:1px solid #cbd5e1;border-radius:6px"></select>' +
'          <button id="promoApplyTemplateBtn" type="button" style="padding:8px 16px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer">套用模板</button>' +
'        </div>' +
'        <div style="margin-top:6px;color:#64748b;font-size:12px">套用後會覆蓋下方所有設定，請先確認。</div>' +
'      </div>' +
'      <fieldset style="border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:16px">' +
'        <legend style="padding:0 8px;font-weight:600;color:#0f172a">主橫幅內容</legend>' +
'        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
'          <label style="display:block"><div style="font-size:13px;color:#475569;margin-bottom:4px">主標題（可留白）</div><input type="text" id="promoHeroTitle" maxlength="80" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;box-sizing:border-box"></label>' +
'          <label style="display:block"><div style="font-size:13px;color:#475569;margin-bottom:4px">徽章文字</div><input type="text" id="promoHeroBadge" maxlength="24" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;box-sizing:border-box"></label>' +
'          <label style="display:block;grid-column:1/-1"><div style="font-size:13px;color:#475569;margin-bottom:4px">副標題（可留白）</div><input type="text" id="promoHeroSubtitle" maxlength="160" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;box-sizing:border-box"></label>' +
'          <label style="display:block"><div style="font-size:13px;color:#475569;margin-bottom:4px">配色主題</div>' +
'            <select id="promoTheme" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;box-sizing:border-box">' +
'              <option value="orange">橘色（活動）</option>' +
'              <option value="red">紅色（限時/節慶）</option>' +
'              <option value="green">綠色（會員/套餐）</option>' +
'              <option value="blue">藍色（預購/外帶）</option>' +
'            </select>' +
'          </label>' +
'          <label style="display:block"><div style="font-size:13px;color:#475569;margin-bottom:4px">活動類型代碼（內部用）</div><input type="text" id="promoCampaignType" maxlength="32" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;box-sizing:border-box"></label>' +
'        </div>' +
'      </fieldset>' +
'      <fieldset style="border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:16px">' +
'        <legend style="padding:0 8px;font-weight:600;color:#0f172a">優惠碼清單</legend>' +
'        <div id="promoCouponList" style="display:flex;flex-direction:column;gap:8px"></div>' +
'        <button id="promoAddCouponBtn" type="button" style="margin-top:10px;padding:6px 12px;background:#f1f5f9;border:1px dashed #94a3b8;border-radius:6px;cursor:pointer;width:100%">+ 新增優惠碼</button>' +
'        <div style="margin-top:14px;padding-top:12px;border-top:1px dashed #cbd5e1">' +
'          <div style="font-weight:600;color:#0f172a;margin-bottom:4px">付款方式回饋（不折現金，改送點數）</div>' +
'          <div style="color:#64748b;font-size:12px;margin-bottom:8px">顧客在線上點餐按「現金／電子支付」時，自動套用所選優惠碼，折扣金額 1:1 轉成本次回饋點數（結帳完成才入帳）。不選＝不回饋。</div>' +
'          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
'            <label style="display:block"><div style="font-size:13px;color:#475569;margin-bottom:4px">現金按鈕套用</div>' +
'              <select id="promoCashCouponSelect" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;box-sizing:border-box"></select>' +
'            </label>' +
'            <label style="display:block"><div style="font-size:13px;color:#475569;margin-bottom:4px">電子支付按鈕套用</div>' +
'              <select id="promoEpayCouponSelect" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;box-sizing:border-box"></select>' +
'            </label>' +
'          </div>' +
'        </div>' +
'      </fieldset>' +

'      <div id="promoLastSave" style="font-size:12px;color:#64748b;margin-bottom:12px"></div>' +
'    </div>' +
'    <div style="padding:14px 20px;border-top:1px solid #e2e8f0;display:flex;gap:8px;justify-content:flex-end;position:sticky;bottom:0;background:#fff">' +
'      <button id="promoCancelBtn" type="button" style="padding:8px 16px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer">取消</button>' +
'      <button id="promoSaveBtn" type="button" style="padding:8px 16px;background:#16a34a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600">儲存促銷設定</button>' +
'    </div>' +
'  </div>' +
'</div>';
}

function renderCouponRow(coupon){
  var c = coupon || {};
  return '' +
'<div class="promo-coupon-row" data-id="' + esc(c.id || '') + '" style="display:grid;grid-template-columns:auto 1.2fr 1.5fr 1fr 1fr 1fr auto auto;gap:6px;align-items:center;padding:8px;background:#f8fafc;border-radius:6px">' +
'  <label style="display:flex;align-items:center"><input type="checkbox" class="cp-enabled" ' + (c.enabled !== false ? 'checked' : '') + '></label>' +
'  <input type="text" class="cp-code" placeholder="代碼" value="' + esc(c.code || '') + '" maxlength="24" style="padding:6px;border:1px solid #cbd5e1;border-radius:4px;font-family:monospace;text-transform:uppercase">' +
'  <input type="text" class="cp-title" placeholder="顯示名稱" value="' + esc(c.title || '') + '" maxlength="80" style="padding:6px;border:1px solid #cbd5e1;border-radius:4px">' +
'  <select class="cp-type" style="padding:6px;border:1px solid #cbd5e1;border-radius:4px">' +
'    <option value="amount"' + (c.type === 'amount' ? ' selected' : '') + '>折金額</option>' +
'    <option value="percent"' + (c.type === 'percent' ? ' selected' : '') + '>折百分比</option>' +
'  </select>' +
'  <input type="number" class="cp-value" placeholder="折扣值" value="' + Number(c.value || 0) + '" min="0" style="padding:6px;border:1px solid #cbd5e1;border-radius:4px">' +
'  <input type="number" class="cp-minspend" placeholder="最低消費" value="' + Number(c.minSpend || 0) + '" min="0" style="padding:6px;border:1px solid #cbd5e1;border-radius:4px">' +
'  <label class="cp-show-wrap" title="是否顯示在客人點餐頁的可用優惠碼清單" style="display:flex;flex-direction:column;align-items:center;font-size:11px;color:#475569;gap:2px"><input type="checkbox" class="cp-show" ' + (c.showToCustomer !== false ? 'checked' : '') + '><span>顯示</span></label>' +
'  <button type="button" class="cp-del" style="background:#fee2e2;color:#dc2626;border-radius:4px;padding:6px 10px;cursor:pointer">刪</button>' +
'</div>';

}

function loadFormFromConfig(){
  var cfg = ensurePromotionsConfig();
  document.getElementById('promoEnabledChk').checked = cfg.enabled !== false;
  document.getElementById('promoHeroTitle').value = cfg.heroTitle || '';
  document.getElementById('promoHeroSubtitle').value = cfg.heroSubtitle || '';
  document.getElementById('promoHeroBadge').value = cfg.heroBadge || '';
  document.getElementById('promoTheme').value = cfg.theme || 'orange';
  document.getElementById('promoCampaignType').value = cfg.campaignType || '';

  var list = document.getElementById('promoCouponList');
  list.innerHTML = (cfg.coupons || []).map(renderCouponRow).join('') || '<div style="color:#94a3b8;font-size:13px;padding:8px;text-align:center">尚未設定優惠碼</div>';

  // v20260603-v2：填入「現金／電支回饋碼」兩個下拉（選項來自目前優惠碼清單）
  fillRewardCouponSelects(cfg);

  var saveLbl = document.getElementById('promoLastSave');
  saveLbl.textContent = cfg.updatedAt ? '最後儲存：' + new Date(cfg.updatedAt).toLocaleString('zh-TW') : '尚未儲存';
}

// v20260603-v2：用目前優惠碼清單填入現金/電支回饋碼下拉，並選回已存的 id
function fillRewardCouponSelects(cfg){
  var cashSel = document.getElementById('promoCashCouponSelect');
  var epaySel = document.getElementById('promoEpayCouponSelect');
  if(!cashSel || !epaySel) return;
  var opts = '<option value="">不回饋（不套用）</option>' +
    (cfg.coupons || []).map(function(c){
      var label = (c.code || '') + '（' + (c.title || '') + '・' + (c.type === 'percent' ? c.value + '%' : '折' + c.value) + '）';
      return '<option value="' + esc(c.id || '') + '">' + esc(label) + '</option>';
    }).join('');
  cashSel.innerHTML = opts;
  epaySel.innerHTML = opts;
  cashSel.value = cfg.cashCouponId || '';
  epaySel.value = cfg.epayCouponId || '';
}

function collectFormToConfig(){
  var heroTitle = document.getElementById('promoHeroTitle').value;
  var heroSubtitle = document.getElementById('promoHeroSubtitle').value;
  var heroBadge = document.getElementById('promoHeroBadge').value;
  var theme = document.getElementById('promoTheme').value;
  var coupons = [];
  document.querySelectorAll('#promoCouponList .promo-coupon-row').forEach(function(row){
    var code = (row.querySelector('.cp-code').value || '').trim();
    if(!code) return;
    coupons.push({
      id: row.dataset.id || '',
      enabled: row.querySelector('.cp-enabled').checked,
      showToCustomer: row.querySelector('.cp-show') ? row.querySelector('.cp-show').checked : true,
      code: code,
      title: (row.querySelector('.cp-title').value || '').trim(),
      type: row.querySelector('.cp-type').value,
      value: Number(row.querySelector('.cp-value').value || 0),
      minSpend: Number(row.querySelector('.cp-minspend').value || 0)
    });

  });
    return {
    enabled: document.getElementById('promoEnabledChk').checked,
    heroTitle: heroTitle,
    heroSubtitle: heroSubtitle,
    heroBadge: heroBadge,
    theme: theme,
    campaignType: document.getElementById('promoCampaignType').value,
    banners: [{
      id: 'banner_main',
      enabled: true,
      title: heroTitle,
      subtitle: heroSubtitle,
      badge: heroBadge,
      theme: theme,
      sortOrder: 1,
      startsAt: '',
      endsAt: ''
    }],
    coupons: coupons,
    cashCouponId: (document.getElementById('promoCashCouponSelect') || {}).value || '',
    epayCouponId: (document.getElementById('promoEpayCouponSelect') || {}).value || ''
  };
}


function fillTemplateSelect(){
  var sel = document.getElementById('promoTemplateSelect');
  sel.innerHTML = getPromotionTemplates().map(function(t){
    return '<option value="' + esc(t.key) + '">' + esc(t.name) + '</option>';
  }).join('');
}

function openSettingsModal(){
  var modal = document.getElementById('promoSettingsModal');
  if(!modal){
    document.body.insertAdjacentHTML('beforeend', buildSettingsModalHtml());
    modal = document.getElementById('promoSettingsModal');
    fillTemplateSelect();

    document.getElementById('promoCloseBtn').onclick = closeSettingsModal;
    document.getElementById('promoCancelBtn').onclick = closeSettingsModal;
    modal.addEventListener('click', function(e){ if(e.target === modal) closeSettingsModal(); });

    document.getElementById('promoApplyTemplateBtn').onclick = function(){
      var key = document.getElementById('promoTemplateSelect').value;
      if(!confirm('套用模板會覆蓋目前的設定，確定要套用嗎？')) return;
      applyPromotionTemplate(key);
      loadFormFromConfig();
      toast('已套用模板');
    };

    document.getElementById('promoAddCouponBtn').onclick = function(){
      var list = document.getElementById('promoCouponList');
      if(list.querySelector('.promo-coupon-row')){
        list.insertAdjacentHTML('beforeend', renderCouponRow({ enabled: true, type: 'amount' }));
      } else {
        list.innerHTML = renderCouponRow({ enabled: true, type: 'amount' });
      }
    };

    document.getElementById('promoCouponList').addEventListener('click', function(e){
      if(e.target.classList.contains('cp-del')){
        if(confirm('刪除這筆優惠碼？')) e.target.closest('.promo-coupon-row').remove();
      }
    });

           document.getElementById('promoSaveBtn').onclick = async function(){
      try{
        var payload = collectFormToConfig();
        setPromotionsConfig(payload, true);
        toast('促銷設定已儲存，雲端同步中...');
        loadFormFromConfig();
        // 推送到 publicOnlineStores/{storeCode}/promotions
        var result = await pushPromotionsToCloud();
        if(result.ok){
          toast('✅ 已同步至雲端，所有裝置共用');
        } else {
          toast('⚠️ 已存本機，雲端同步失敗（' + (result.reason || '') + '）');
          console.warn('[promo] cloud push failed:', result);
        }
      }catch(err){
        alert('儲存失敗：' + (err && err.message ? err.message : err));
      }
    };
  }
  loadFormFromConfig();
  modal.style.display = 'flex';
}

function closeSettingsModal(){
  var modal = document.getElementById('promoSettingsModal');
  if(modal) modal.style.display = 'none';
}


/**
 * 在設定頁掛載「廣告促銷」按鈕（會自動找一個合適的容器；找不到就掛在 body 角落）
 */
export function mountPromotionSettingsUI(){
  if(document.getElementById('promoOpenSettingsBtn')) return;

  var btn = document.createElement('button');
  btn.id = 'promoOpenSettingsBtn';
  btn.type = 'button';
  btn.textContent = '🎁 廣告促銷管理';
  btn.style.cssText = 'padding:10px 16px;background:linear-gradient(135deg,#f97316,#ef4444);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:14px;margin:8px 4px;box-shadow:0 2px 8px rgba(239,68,68,.3)';
  btn.onclick = openSettingsModal;

  // 嘗試找設定頁的容器
  var host =
    document.querySelector('#settingsPage .settings-actions') ||
    document.querySelector('#settingsPage .settings-buttons') ||
    document.querySelector('#settingsPage .button-group') ||
    document.querySelector('#settingsPage .settings-list') ||
    document.querySelector('#settingsPage') ||
    document.querySelector('.settings-container') ||
    document.querySelector('[data-page="settings"]');

  if(host){
    host.appendChild(btn);
  } else {
    // 找不到容器：作為浮動按鈕掛右下角
    btn.style.position = 'fixed';
    btn.style.right = '20px';
    btn.style.bottom = '20px';
    btn.style.zIndex = '500';
    document.body.appendChild(btn);
  }
}

// ====================================================================
// 2) 線上點餐頁 UI
// ====================================================================

var onlinePromoState = {
  couponCode: '',
  cartGetter: null,   // 由呼叫端注入：function(){ return [...] }
  onChange: null      // 由呼叫端注入：折扣變動時通知（可選）
};

function themeColor(theme){
  switch(String(theme || '').toLowerCase()){
    case 'red': return '#ef4444';
    case 'green': return '#16a34a';
    case 'blue': return '#2563eb';
    default: return '#f97316';
  }
}

function renderBannerArea(){
  var area = document.getElementById('onlinePromotionArea');
  if(!area) return;
  var promo = getPublicPromotionsConfig();
  if(!promo.enabled || !Array.isArray(promo.banners) || !promo.banners.length){
    area.style.display = 'none';
    area.innerHTML = '';
    return;
  }
  var visibleCoupons = (Array.isArray(promo.coupons) ? promo.coupons : []).filter(function(c){ return c && c.showToCustomer !== false; });
  var couponText = visibleCoupons.length
    ? '<div style="font-size:12px;margin-top:6px;opacity:.9">可用優惠碼：' + visibleCoupons.map(function(c){
        return esc(c.code) + '（' + esc(c.title || '') + '）';
      }).join('、') + '</div>'
    : '';

  area.style.display = 'block';
  area.innerHTML = promo.banners.slice(0, 3).map(function(b){
    var color = themeColor(b.theme || promo.theme);
    var title = Object.prototype.hasOwnProperty.call(b || {}, 'title') ? String(b.title || '').trim() : String(promo.heroTitle || '').trim();
    var subtitle = Object.prototype.hasOwnProperty.call(b || {}, 'subtitle') ? String(b.subtitle || '').trim() : String(promo.heroSubtitle || '').trim();
    var titleHtml = title ? '<div style="font-size:20px;font-weight:800;letter-spacing:.02em">' + esc(title) + '</div>' : '';
    var subtitleHtml = subtitle ? '<div style="font-size:13px;opacity:.92;margin-top:4px;line-height:1.5">' + esc(subtitle) + '</div>' : '';
    return '' +
'<div style="background:linear-gradient(135deg,' + color + ',#0f172a);color:#fff;border-radius:16px;padding:16px;margin-bottom:10px;box-shadow:0 12px 28px rgba(15,23,42,.18)">' +
'  <div>' +
'    <div style="display:inline-block;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.28);border-radius:999px;padding:3px 10px;font-size:12px;margin-bottom:8px">' + esc(b.badge || promo.heroBadge || '活動') + '</div>' +
titleHtml + subtitleHtml + couponText +
'  </div>' +
'</div>';
  }).join('');
}

function buildCouponBoxHtml(){
  return '' +
'<div id="onlineCouponBox" style="margin-top:10px;padding:12px;background:#fff;border:1px solid #e2e8f0;border-radius:10px">' +
'  <div style="display:flex;gap:6px;align-items:center">' +
'    <input id="onlineCouponInput" type="text" placeholder="輸入優惠碼" style="flex:1;padding:8px;border:1px solid #cbd5e1;border-radius:6px;font-family:monospace;text-transform:uppercase" maxlength="24">' +
'    <button id="onlineCouponApplyBtn" type="button" style="padding:8px 14px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer">套用</button>' +
'    <button id="onlineCouponClearBtn" type="button" style="padding:8px 10px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer">清除</button>' +
'  </div>' +
'  <div id="onlineCouponMessage" style="margin-top:6px;font-size:12px;color:#64748b">若有店家提供的優惠碼，可在此輸入。</div>' +
'  <div id="onlineDiscountRow" style="display:none;margin-top:8px;justify-content:space-between;font-size:14px">' +
'    <span style="color:#475569">折扣</span>' +
'    <strong id="onlineDiscountText" style="color:#16a34a">-0</strong>' +
'  </div>' +
'</div>';

}

function applyCoupon(){
  var input = document.getElementById('onlineCouponInput');
  onlinePromoState.couponCode = (input ? input.value : '').trim().toUpperCase();
  refreshPromotionDisplay();
  if(typeof onlinePromoState.onChange === 'function') onlinePromoState.onChange(getCurrentPromotion());
  if(typeof window !== 'undefined' && typeof window.__refreshOnlinePromotion === 'function') window.__refreshOnlinePromotion();
}


function clearCoupon(){
  onlinePromoState.couponCode = '';
  var input = document.getElementById('onlineCouponInput');
  if(input) input.value = '';
  refreshPromotionDisplay();
  if(typeof onlinePromoState.onChange === 'function') onlinePromoState.onChange(getCurrentPromotion());
  if(typeof window !== 'undefined' && typeof window.__refreshOnlinePromotion === 'function') window.__refreshOnlinePromotion();
}


function getCurrentPromotion(){
  var cart = typeof onlinePromoState.cartGetter === 'function' ? onlinePromoState.cartGetter() : [];
  if(!onlinePromoState.couponCode) return { ok: false, discount: 0, total: 0, code: '', message: '' };
  return calculatePromotion(cart || [], onlinePromoState.couponCode);
}

/**
 * 重新計算並更新折扣顯示。可由外部（購物車變動時）呼叫。
 */
export function refreshPromotionDisplay(){
  var cart = typeof onlinePromoState.cartGetter === 'function' ? onlinePromoState.cartGetter() : [];
  var subtotal = (cart || []).reduce(function(sum, it){
    return sum + (Number(it.basePrice || 0) + Number(it.extraPrice || 0)) * Math.max(1, Number(it.qty || 1));
  }, 0);

  var discountRow = document.getElementById('onlineDiscountRow');
  var discountText = document.getElementById('onlineDiscountText');
  var grandTotalText = document.getElementById('onlineGrandTotalText');
  var msg = document.getElementById('onlineCouponMessage');

  var discount = 0;
  if(onlinePromoState.couponCode){
    var result = calculatePromotion(cart || [], onlinePromoState.couponCode);
    if(result.ok){
      discount = Number(result.discount || 0);
      if(discountRow) discountRow.style.display = 'flex';
      if(discountText) discountText.textContent = '-' + money(discount);
      if(msg){ msg.style.color = '#16a34a'; msg.textContent = result.message || ('已套用 ' + result.code); }
    } else {
      if(discountRow) discountRow.style.display = 'none';
      if(msg){ msg.style.color = '#ef4444'; msg.textContent = result.message || '無法套用'; }
    }
  } else {
    if(discountRow) discountRow.style.display = 'none';
    if(msg){ msg.style.color = '#64748b'; msg.textContent = '若有店家提供的優惠碼，可在此輸入。'; }
  }

  if(grandTotalText) grandTotalText.textContent = money(Math.max(0, subtotal - discount));
}

/**
 * 在線上點餐頁掛載廣告橫幅 + 優惠碼區
 * @param {Object} opts
 * @param {Function} opts.getCart  - 回傳目前購物車陣列的函式（必要）
 * @param {Function} [opts.onChange] - 折扣變動時的 callback
 */
export function mountPromotionOnlineUI(opts){
  opts = opts || {};
  onlinePromoState.cartGetter = typeof opts.getCart === 'function' ? opts.getCart : function(){ return []; };
  onlinePromoState.onChange = typeof opts.onChange === 'function' ? opts.onChange : null;

  // 1. 廣告橫幅區（掛在商品清單上方）
  if(!document.getElementById('onlinePromotionArea')){
    var area = document.createElement('div');
    area.id = 'onlinePromotionArea';
    area.style.cssText = 'margin:10px 0;padding:0 10px';
    var host =
      document.getElementById('onlineCategoryTabs') ||
      document.getElementById('onlineProductGrid') ||
      document.querySelector('.online-main') ||
      document.body;
    if(host && host.parentNode){
      host.parentNode.insertBefore(area, host);
    } else {
      document.body.insertBefore(area, document.body.firstChild);
    }
  }
  renderBannerArea();

        // 2. 優惠碼輸入區（v20260603-v3：插在捲動區小計下、點數列之前）
  if(!document.getElementById('onlineCouponBox')){
    var pointsRow = document.getElementById('onlinePointsRow');
    if(pointsRow && pointsRow.parentNode){
      pointsRow.insertAdjacentHTML('beforebegin', buildCouponBoxHtml());
    } else {
      var couponHost =
        document.querySelector('.online-summary') ||
        document.getElementById('onlineCartList') ||
        document.body;
      couponHost.insertAdjacentHTML('beforeend', buildCouponBoxHtml());
    }

    document.getElementById('onlineCouponApplyBtn').onclick = applyCoupon;
    document.getElementById('onlineCouponClearBtn').onclick = clearCoupon;
    document.getElementById('onlineCouponInput').addEventListener('keydown', function(e){
      if(e.key === 'Enter'){ e.preventDefault(); applyCoupon(); }
    });
  }
  refreshPromotionDisplay();
}

/**
 * 取得目前套用的促銷結果（給送單時帶入訂單用）
 */
export function getCurrentPromotionResult(){
  return getCurrentPromotion();
}

