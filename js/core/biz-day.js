/* 中文備註：營業日 (Business Day, BD) 共用工具 v20260613
 * 用途：把跨日的營業時段視為同一個營業日。
 *
 * 範例：店家設定 14:00–03:00
 *   - 5/1 14:00 ~ 5/2 03:00 → 全部屬於「5/1 BD」
 *   - 5/2 03:01 ~ 5/2 13:59（沒營業時段）→ 屬於「5/2 BD」（即將開始）
 *   - 5/2 14:00 ~ 5/3 03:00 → 全部屬於「5/2 BD」
 *
 * 公開 API：
 *   getBusinessDay(time, businessHours)       - 取某時間點的營業日 YYYY-MM-DD
 *   getCurrentBusinessDay(businessHours)      - 取「現在」的營業日
 *   getBDRange(bdDateStr, businessHours)      - 取某 BD 的起訖時間（含跨日尾巴）
 *   getRecentBDs(n, businessHours, fromDate)  - 取最近 n 個營業日（跳過公休）
 *   isOpenDay(dateStr, businessHours)         - 該日是否為營業日（非公休）
 */

const WEEKDAY_KEYS = ['sun','mon','tue','wed','thu','fri','sat'];

function pad2(n){ return String(n).padStart(2,'0'); }

function fmtDate(d){
  return d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate());
}

function parseDateStr(s){
  // 'YYYY-MM-DD' → Date（本地時區 00:00）
  if(!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return null;
  return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
}

// 'HH:MM' → 分鐘數（0–1439）
function timeToMinutes(t){
  if(!t || typeof t !== 'string') return -1;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if(!m) return -1;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if(h < 0 || h > 23 || mi < 0 || mi > 59) return -1;
  return h * 60 + mi;
}

// 取得指定日期的星期 key（sun/mon/.../sat）
function getWeekdayKey(date){
  return WEEKDAY_KEYS[date.getDay()];
}

// 安全取得某日的時段陣列（公休或無設定回 []）
function getSlotsOfDay(date, businessHours){
  if(!businessHours || typeof businessHours !== 'object') return [];
  const key = getWeekdayKey(date);
  const slots = businessHours[key];
  return Array.isArray(slots) ? slots : [];
}

/**
 * 取某時間點所屬的營業日 (BD)
 * @param {Date|string|number} time - 任意可轉成 Date 的輸入
 * @param {object} businessHours - {sun:[], mon:[{start,end},...], ...}
 * @returns {string} 'YYYY-MM-DD' （該時間所屬的 BD；fallback = 該時間的本地日期）
 */
export function getBusinessDay(time, businessHours){
  let d;
  try {
    d = (time instanceof Date) ? time : new Date(time);
    if(isNaN(d.getTime())) return '';
  } catch(e){
    return '';
  }

  const T = d.getHours() * 60 + d.getMinutes(); // 當下分鐘數
  const todaySlots = getSlotsOfDay(d, businessHours);

  // 1) 檢查當日所有時段
  //    - 不跨日 (end >= start)：T 落在 [start, end] → BD = 當日
  //    - 跨日   (end < start) ：T >= start → BD = 當日（屬於當日開始那段）
  for(const slot of todaySlots){
    const s = timeToMinutes(slot.start);
    const e = timeToMinutes(slot.end);
    if(s < 0 || e < 0) continue;
    if(e >= s){
      // 不跨日
      if(T >= s && T <= e) return fmtDate(d);
    } else {
      // 跨日（例 14:00 → 03:00）
      if(T >= s) return fmtDate(d);
    }
  }

  // 2) 檢查前一日的「跨日尾巴」
  //    若 D-1 有跨日時段 (end < start) 且 T <= end → BD = D-1
  const prev = new Date(d);
  prev.setDate(prev.getDate() - 1);
  const prevSlots = getSlotsOfDay(prev, businessHours);
  for(const slot of prevSlots){
    const s = timeToMinutes(slot.start);
    const e = timeToMinutes(slot.end);
    if(s < 0 || e < 0) continue;
    if(e < s){
      // 跨日時段
      if(T <= e) return fmtDate(prev);
    }
  }

  // 3) fallback：T 落在沒營業時段（例 03:01–13:59）
  //    視為「即將開始」的當日 BD
  return fmtDate(d);
}

/**
 * 取「現在」所屬的營業日
 */
export function getCurrentBusinessDay(businessHours){
  return getBusinessDay(new Date(), businessHours);
}

/**
 * 取某 BD 的起訖時間（含跨日尾巴）
 * @param {string} bdDateStr - 'YYYY-MM-DD'
 * @param {object} businessHours
 * @returns {{start: Date, end: Date} | null}
 *   - 若該日有營業 → start = 當日最早 slot 的 start；end = 含跨日尾巴的最晚時間
 *   - 若該日公休 → null
 */
export function getBDRange(bdDateStr, businessHours){
  const base = parseDateStr(bdDateStr);
  if(!base) return null;
  const slots = getSlotsOfDay(base, businessHours);
  if(slots.length === 0) return null; // 公休

  let minStart = Infinity;
  let maxEnd = -Infinity;
  let hasCrossDay = false;

  for(const slot of slots){
    const s = timeToMinutes(slot.start);
    const e = timeToMinutes(slot.end);
    if(s < 0 || e < 0) continue;
    if(s < minStart) minStart = s;
    if(e < s){
      // 跨日：end 視為「+24h」
      hasCrossDay = true;
      if(e + 1440 > maxEnd) maxEnd = e + 1440;
    } else {
      if(e > maxEnd) maxEnd = e;
    }
  }
  if(minStart === Infinity || maxEnd === -Infinity) return null;

  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  start.setMinutes(minStart);

  const end = new Date(base);
  end.setHours(0, 0, 0, 0);
  end.setMinutes(maxEnd);
  // setMinutes(>1440) 會自動進位到隔天

  return { start, end, hasCrossDay };
}

/**
 * 該日是否為營業日（非公休）
 */
export function isOpenDay(dateStr, businessHours){
  const d = parseDateStr(dateStr);
  if(!d) return false;
  return getSlotsOfDay(d, businessHours).length > 0;
}

/**
 * 取最近 N 個營業日（從 fromDate 往回掃，跳過公休日）
 * @param {number} n - 要幾個營業日
 * @param {object} businessHours
 * @param {Date} [fromDate] - 起點（含），預設今天
 * @returns {string[]} ['YYYY-MM-DD', ...] 由新到舊；若全週公休則回傳 []
 */
export function getRecentBDs(n, businessHours, fromDate){
  const out = [];
  if(!n || n < 1) return out;

  // 防止全週公休造成無限迴圈：最多掃 365 天
  const MAX_SCAN = 365;

  const cur = fromDate ? new Date(fromDate) : new Date();
  cur.setHours(0, 0, 0, 0);

  for(let i = 0; i < MAX_SCAN && out.length < n; i++){
    if(getSlotsOfDay(cur, businessHours).length > 0){
      out.push(fmtDate(cur));
    }
    cur.setDate(cur.getDate() - 1);
  }
  return out;
}

/**
 * 取兩個 BD 之間的所有 BD（含端點，跳過公休日）
 * @param {string} fromBD - 'YYYY-MM-DD'
 * @param {string} toBD - 'YYYY-MM-DD'
 * @param {object} businessHours
 * @returns {string[]} 由舊到新
 */
export function getBDsBetween(fromBD, toBD, businessHours){
  const out = [];
  const start = parseDateStr(fromBD);
  const end = parseDateStr(toBD);
  if(!start || !end || start > end) return out;

  const cur = new Date(start);
  while(cur <= end){
    if(getSlotsOfDay(cur, businessHours).length > 0){
      out.push(fmtDate(cur));
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}
