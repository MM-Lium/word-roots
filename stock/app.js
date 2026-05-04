/* ============================================================
   Portfolio Tracker - app.js
   美股: Yahoo Finance via allorigins.win proxy
   台股: TWSE OpenAPI (盤後，直接支援 CORS)
   ============================================================ */

'use strict';

// ── State ──────────────────────────────────────────────────
const STATE = {
  holdings: [],       // { id, market, symbol, name, shares, cost, price, change, changePct, note }
  usdRate: null,
  activeTab: 'all',
  sortBy: 'pnl-desc',
  loading: new Set(),
  editingId: null,
  confirmCallback: null,
  chartRange: '30',
};

// ── Storage ────────────────────────────────────────────────
function saveHoldings() {
  localStorage.setItem('portfolio_holdings_v2', JSON.stringify(STATE.holdings));
  syncPush();
}
function loadHoldings() {
  try {
    const raw = localStorage.getItem('portfolio_holdings_v2');
    STATE.holdings = raw ? JSON.parse(raw) : [];
  } catch { STATE.holdings = []; }
}

// ── ID Generator ───────────────────────────────────────────
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ── TWSE Data Cache ────────────────────────────────────────
let _twseCache = null;
let _twseCacheTime = 0;

async function getTWSEData() {
  const now = Date.now();
  // Cache for 5 minutes
  if (_twseCache && (now - _twseCacheTime) < 5 * 60 * 1000) return _twseCache;
  const res = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', {
    signal: AbortSignal.timeout(12000)
  });
  if (!res.ok) throw new Error('TWSE API error');
  const data = await res.json();
  _twseCache = data;
  _twseCacheTime = now;
  return data;
}

// Also cache OTC (TPEx) data
let _tpexCache = null;
let _tpexCacheTime = 0;

async function getTPExData() {
  const now = Date.now();
  if (_tpexCache && (now - _tpexCacheTime) < 5 * 60 * 1000) return _tpexCache;
  const res = await fetch('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes', {
    signal: AbortSignal.timeout(12000)
  });
  if (!res.ok) throw new Error('TPEx API error');
  const data = await res.json();
  _tpexCache = data;
  _tpexCacheTime = now;
  return data;
}

// ── USD Rate ───────────────────────────────────────────────
async function fetchUsdRate() {
  try {
    // Use allorigins to proxy Yahoo Finance USDTWD
    const target = encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/USDTWD=X?interval=1d&range=1d');
    const res = await fetch(`https://api.allorigins.win/get?url=${target}`, { signal: AbortSignal.timeout(10000) });
    const json = await res.json();
    const data = JSON.parse(json.contents);
    const rate = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (rate && rate > 0) {
      STATE.usdRate = rate;
      document.getElementById('usd-rate').textContent = rate.toFixed(2);
      return rate;
    }
  } catch (e) { console.warn('USD rate fetch failed:', e); }
  // Fallback to a reasonable rate
  if (!STATE.usdRate) STATE.usdRate = 32.5;
  document.getElementById('usd-rate').textContent = STATE.usdRate.toFixed(2);
  return STATE.usdRate;
}

// ── Fetch US Stock (Yahoo Finance via allorigins proxy) ─────
async function fetchUSPrice(symbol) {
  const sym = symbol.toUpperCase();
  const proxies = [
    url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  ];

  // ── Try v8 chart API first ──────────────────────────────
  // range=1d gives only today's candles — much faster and avoids stale multi-day data
  const chartEndpoints = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=5m&range=1d&includePrePost=true`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${sym}?interval=5m&range=1d&includePrePost=true`,
  ];

  let lastError;
  for (const endpoint of chartEndpoints) {
    for (const proxy of proxies) {
      try {
        const res = await fetch(proxy(endpoint), { signal: AbortSignal.timeout(12000) });
        const json = await res.json();
        // allorigins wraps in {contents}, corsproxy returns raw
        const raw = json.contents !== undefined ? json.contents : (typeof json === 'string' ? json : JSON.stringify(json));
        const data = JSON.parse(raw);
        const result = data?.chart?.result?.[0];
        if (!result) continue;

        const meta = result.meta;
        const timestamps = result.timestamp || [];
        const closes = result.indicators?.quote?.[0]?.close || [];

        let lastTime = null;
        let lastPrice = null;
        for (let i = closes.length - 1; i >= 0; i--) {
          if (closes[i] != null && closes[i] > 0) {
            lastTime = timestamps[i];
            lastPrice = closes[i];
            break;
          }
        }

        // Fallback to meta prices when intraday candles are empty (e.g. weekend / leveraged ETF)
        if (lastPrice === null) {
          lastPrice = meta.regularMarketPrice || null;
          lastTime = meta.regularMarketTime || null;
        }
        if (lastPrice === null) continue;

        const periods = meta.currentTradingPeriod;
        let sessionLabel = 'closed';

        if (periods && lastTime) {
          if (lastTime >= periods.pre.start && lastTime < periods.pre.end) {
            sessionLabel = 'pre';
          } else if (lastTime >= periods.regular.start && lastTime < periods.regular.end) {
            sessionLabel = 'regular';
          } else if (lastTime >= periods.post.start && lastTime < periods.post.end) {
            sessionLabel = 'post';
          }
        }

        let price = lastPrice;
        let prev = meta.chartPreviousClose;

        if (sessionLabel === 'pre' || sessionLabel === 'post') {
          prev = meta.regularMarketPrice;
        } else if (sessionLabel === 'closed') {
          price = meta.regularMarketPrice || lastPrice;
        }

        const change = price - (prev || price);
        const changePct = prev ? (change / prev) * 100 : 0;
        const name = meta.longName || meta.shortName || sym;
        const week52High = meta.fiftyTwoWeekHigh || null;

        return { price, change, changePct, name, marketState: sessionLabel, week52High };
      } catch (e) {
        lastError = e;
      }
    }
  }

  // ── Fallback: v7 quote API (includes pre/post market fields) ──────────────────────────────
  const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${sym}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,preMarketPrice,preMarketChange,preMarketChangePercent,postMarketPrice,postMarketChange,postMarketChangePercent,marketState,longName,shortName,fiftyTwoWeekHigh`;
  for (const proxy of proxies) {
    try {
      const res = await fetch(proxy(quoteUrl), { signal: AbortSignal.timeout(12000) });
      const json = await res.json();
      const raw = json.contents !== undefined ? json.contents : (typeof json === 'string' ? json : JSON.stringify(json));
      const data = JSON.parse(raw);
      const q = data?.quoteResponse?.result?.[0];
      if (!q || !q.regularMarketPrice) continue;

      const mktState = (q.marketState || '').toUpperCase();
      let price, change, changePct, marketState;

      if (mktState === 'PRE' && q.preMarketPrice) {
        price = q.preMarketPrice;
        change = q.preMarketChange ?? 0;
        changePct = q.preMarketChangePercent ?? 0;
        marketState = 'pre';
      } else if ((mktState === 'POST' || mktState === 'POSTPOST') && q.postMarketPrice) {
        price = q.postMarketPrice;
        change = q.postMarketChange ?? 0;
        changePct = q.postMarketChangePercent ?? 0;
        marketState = 'post';
      } else {
        price = q.regularMarketPrice;
        change = q.regularMarketChange ?? 0;
        changePct = q.regularMarketChangePercent ?? 0;
        marketState = mktState === 'REGULAR' ? 'regular' : 'closed';
      }

      return {
        price, change, changePct,
        name: q.longName || q.shortName || sym,
        marketState: 'closed',
        week52High: q.fiftyTwoWeekHigh || null,
      };
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError ?? new Error(`查無代號：${sym}`);
}

// ── Fetch TW Stock (TWSE/TPEx OpenAPI) ─────────────────────
async function fetchTWPrice(symbol) {
  const code = symbol.replace(/\.TW$/i, '').toUpperCase();
  const ticker = `${code}.TW`;

  // 1. Try Yahoo Finance (same as US stocks, reliable)
  try {
    const data = await fetchUSPrice(ticker);
    if (data?.price > 0) return data;
  } catch {}

  // Helper: fetch TWSE/TPEx MIS via proxy
  async function tryMIS(exCh, proxy) {
    const bust = Date.now();
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${exCh}&json=1&delay=0&_=${bust}`;
    let res;
    if (proxy === 'allorigins') {
      res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000) });
      const json = await res.json();
      return JSON.parse(json.contents);
    } else {
      res = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000) });
      return await res.json();
    }
  }

  function parseMIS(data) {
    const item = data?.msgArray?.[0];
    if (!item) return null;
    const price = parseFloat(item.z || item.y) || 0;
    const prev  = parseFloat(item.y) || price;
    const change = price - prev;
    const changePct = prev ? (change / prev) * 100 : 0;
    if (price > 0) return { price, change, changePct, name: item.n || code };
    return null;
  }

  // 1. Try TWSE (上市) via allorigins
  try {
    const data = await tryMIS(`tse_${code}.tw`, 'allorigins');
    const result = parseMIS(data);
    if (result) return result;
  } catch {}

  // 2. Try TPEx (上櫃) via allorigins
  try {
    const data = await tryMIS(`otc_${code}.tw`, 'allorigins');
    const result = parseMIS(data);
    if (result) return result;
  } catch {}

  // 3. Try TWSE via corsproxy.io
  try {
    const data = await tryMIS(`tse_${code}.tw`, 'corsproxy');
    const result = parseMIS(data);
    if (result) return result;
  } catch {}

  // 4. Try TPEx via corsproxy.io
  try {
    const data = await tryMIS(`otc_${code}.tw`, 'corsproxy');
    const result = parseMIS(data);
    if (result) return result;
  } catch {}

  // 5. Fallback: TWSE OpenAPI 盤後
  try {
    const today = new Date();
    for (let d = 0; d < 5; d++) {
      const dt = new Date(today); dt.setDate(dt.getDate() - d);
      const dateStr = `${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,'0')}${String(dt.getDate()).padStart(2,'0')}`;
      const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${dateStr}&stockNo=${code}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const data = await res.json();
      const rows = data?.data;
      if (rows && rows.length > 0) {
        const last = rows[rows.length - 1];
        const price  = parseFloat(last[6].replace(/,/g, '')) || 0;
        const change = parseFloat(last[7].replace(/,/g, '')) || 0;
        const changePct = price ? (change / (price - change)) * 100 : 0;
        if (price > 0) return { price, change, changePct, name: code };
      }
    }
  } catch {}

  // 6. Fallback: TPEx OpenAPI 盤後
  try {
    const today = new Date();
    for (let d = 0; d < 5; d++) {
      const dt = new Date(today); dt.setDate(dt.getDate() - d);
      const yy = dt.getFullYear() - 1911;
      const mm = String(dt.getMonth()+1).padStart(2,'0');
      const dd = String(dt.getDate()).padStart(2,'0');
      const dateStr = `${yy}/${mm}/${dd}`;
      const url = `https://www.tpex.org.tw/web/stock/aftertrading/daily_trading_info/st43_result.php?l=zh-tw&d=${dateStr}&s=${code}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const data = await res.json();
      const rows = data?.aaData;
      if (rows && rows.length > 0) {
        const last = rows[rows.length - 1];
        const price  = parseFloat(last[2].replace(/,/g, '')) || 0;
        const change = parseFloat(last[3].replace(/,/g, '')) || 0;
        const changePct = price ? (change / (price - change)) * 100 : 0;
        if (price > 0) return { price, change, changePct, name: code };
      }
    }
  } catch {}

  throw new Error('無法取得報價');
}

// ── Lookup (for modal) ─────────────────────────────────────
async function lookupSymbol(symbol, market) {
  if (market === 'us') {
    return await fetchUSPrice(symbol);
  } else {
    return await fetchTWPrice(symbol);
  }
}

// ── Fetch all prices ───────────────────────────────────────
async function refreshAllPrices() {
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('spinning');
  setLastUpdated('更新中...');

  const promises = STATE.holdings.map(async (h) => {
    try {
      const data = h.market === 'us' ? await fetchUSPrice(h.symbol) : await fetchTWPrice(h.symbol);
      const oldPrice = h.price;
      h.price       = data.price;
      h.change      = data.change;
      h.changePct   = data.changePct;
      h.marketState = data.marketState ?? null;  // 'pre' | 'regular' | 'post' | 'closed'
      if (data.week52High) h.week52High = data.week52High;
      if (!h.name || h.name === h.symbol) h.name = data.name;
      h._priceDir = oldPrice ? (data.price > oldPrice ? 'up' : data.price < oldPrice ? 'down' : '') : '';
    } catch (e) {
      console.warn(`Failed to fetch ${h.symbol}:`, e);
    }
  });

  await Promise.allSettled(promises);
  await fetchUsdRate();
  saveHoldings();
  renderHoldings();
  updateSummary();

  btn.classList.remove('spinning');
  setLastUpdated(new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  showToast('報價已更新', 'success');
  recordSnapshot();
}

function setLastUpdated(text) {
  document.getElementById('last-updated-text').textContent = text;
}

// ── Summary ────────────────────────────────────────────────
function updateSummary() {
  const rate = STATE.usdRate || 32;
  let totalValue = 0, totalCost = 0;
  let usValue = 0, twValue = 0, usCost = 0, twCost = 0;

  STATE.holdings.forEach(h => {
    if (!h.price) return;
    const multiplier = h.market === 'us' ? rate : 1;
    const val  = h.price * h.shares * multiplier;
    const cost = h.cost  * h.shares * multiplier;
    totalValue += val;
    totalCost  += cost;
    if (h.market === 'us') { usValue += val; usCost += cost; }
    else                   { twValue += val; twCost += cost; }
  });

  const pnl = totalValue - totalCost;
  const pnlPct = totalCost ? (pnl / totalCost) * 100 : 0;
  const usPnl = usValue - usCost;
  const twPnl = twValue - twCost;

  setText('total-value', totalValue ? formatTWD(totalValue) : '--');
  setText('total-cost',  totalCost  ? formatTWD(totalCost)  : '--');

  // Breakdown lines
  const mkBreakdown = (us, tw) => {
    if (!us && !tw) return '';
    const parts = [];
    if (us) parts.push(`🇺🇸 ${formatTWD(us)}`);
    if (tw) parts.push(`🇹🇼 ${formatTWD(tw)}`);
    return parts.join('&nbsp;&nbsp;');
  };
  const vbEl = document.getElementById('value-breakdown');
  const cbEl = document.getElementById('cost-breakdown');
  if (vbEl) vbEl.innerHTML = mkBreakdown(usValue, twValue);
  if (cbEl) cbEl.innerHTML = mkBreakdown(usCost, twCost);

  // P&L breakdown
  const mkPnlBreakdown = (us, tw) => {
    if (!usCost && !twCost) return '';
    const fmt = v => (v >= 0 ? '+' : '') + formatTWD(v);
    const col = v => v >= 0 ? `color:var(--green)` : `color:var(--red)`;
    const parts = [];
    if (usCost) parts.push(`<span style="${col(us)}">🇺🇸 ${fmt(us)}</span>`);
    if (twCost) parts.push(`<span style="${col(tw)}">🇹🇼 ${fmt(tw)}</span>`);
    return parts.join('&nbsp;&nbsp;');
  };
  const pbEl = document.getElementById('pnl-breakdown');
  if (pbEl) pbEl.innerHTML = mkPnlBreakdown(usPnl, twPnl);

  const pnlEl = document.getElementById('total-pnl');
  const pnlPctEl = document.getElementById('total-pnl-pct');
  if (totalCost) {
    pnlEl.textContent = (pnl >= 0 ? '+' : '') + formatTWD(pnl);
    pnlEl.className = 'summary-card__value ' + (pnl >= 0 ? 'positive' : 'negative');
    pnlPctEl.textContent = (pnl >= 0 ? '+' : '') + pnlPct.toFixed(2) + '%';
  } else {
    pnlEl.textContent = '--';
    pnlEl.className = 'summary-card__value';
    pnlPctEl.textContent = '-- %';
  }
}

// ── Render Holdings ────────────────────────────────────────
function renderHoldings() {
  const body = document.getElementById('holdings-body');
  const emptyEl = document.getElementById('holdings-empty');
  const rate = STATE.usdRate || 32;

  let items = [...STATE.holdings];

  // Filter by tab
  if (STATE.activeTab !== 'all') items = items.filter(h => h.market === STATE.activeTab);

  // Sort
  items.sort((a, b) => {
    const valA = rowValue(a, rate), valB = rowValue(b, rate);
    const pnlA = rowPnl(a, rate),   pnlB = rowPnl(b, rate);
    switch (STATE.sortBy) {
      case 'pnl-desc':  return pnlB - pnlA;
      case 'pnl-asc':   return pnlA - pnlB;
      case 'value-desc': return valB - valA;
      case 'value-asc':  return valA - valB;
      case 'name-asc':   return a.symbol.localeCompare(b.symbol);
      default: return 0;
    }
  });

  body.innerHTML = '';

  if (items.length === 0) {
    emptyEl.style.display = '';
    updateSummary();
    return;
  }
  emptyEl.style.display = 'none';

  items.forEach(h => {
    const row = buildRow(h, rate);
    body.appendChild(row);
  });

  updateSummary();
}

function rowValue(h, rate) {
  if (!h.price) return 0;
  return h.price * h.shares * (h.market === 'us' ? rate : 1);
}
function rowPnl(h, rate) {
  if (!h.price) return 0;
  const m = h.market === 'us' ? rate : 1;
  return (h.price - h.cost) * h.shares * m;
}

function buildRow(h, rate) {
  const wrapper = document.createElement('div');
  wrapper.className = 'row-swipe-wrapper';
  wrapper.dataset.id = h.id;

  const row = document.createElement('div');
  row.className = 'holding-row';
  row.dataset.id = h.id;

  const priceStr    = h.price    != null ? formatPrice(h.price, h.market) : '<span class="skeleton" style="width:60px;display:inline-block;"></span>';
  const changeStr   = h.change   != null ? formatChange(h.change, h.changePct, h.market) : '<span class="change-badge change-badge--flat">--</span>';
  const multiplier  = h.market === 'us' ? rate : 1;
  const value       = h.price ? h.price * h.shares * multiplier : null;
  const pnl         = h.price ? (h.price - h.cost) * h.shares * multiplier : null;
  const pnlPct      = h.cost  ? ((h.price - h.cost) / h.cost) * 100 : 0;

  const currency = h.market === 'us' ? 'USD' : 'TWD';

  let sessionBadge = '';
  if (h.market === 'us' && h.marketState) {
    const badges = {
      pre:     { label: '盤前', cls: 'session--pre' },
      post:    { label: '盤後', cls: 'session--post' },
      closed:  { label: '收盤', cls: 'session--closed' },
    };
    const b = badges[h.marketState];
    if (b) sessionBadge = `<span class="session-badge ${b.cls}">${b.label}</span>`;
  }

  // 52-week high cell
  const w52 = h.week52High;
  let week52Str = '--';
  let week52PctStr = '';
  let week52Cls = '';
  if (w52 && h.price) {
    week52Str = formatPrice(w52, h.market);
    const distPct = ((h.price - w52) / w52) * 100;
    week52PctStr = (distPct >= 0 ? '+' : '') + distPct.toFixed(1) + '%';
    week52Cls = distPct >= -5 ? 'w52-near' : distPct >= -15 ? 'w52-mid' : 'w52-far';
  } else if (w52) {
    week52Str = formatPrice(w52, h.market);
  }

  row.innerHTML = `
    <div class="row__name">
      <span class="row__symbol">${esc(h.symbol)}</span>
      <span class="row__badge row__badge--${h.market}">${h.market === 'us' ? '🇺🇸 US' : '🇹🇼 TW'}</span>
    </div>
    <div class="row__cell row__price-change" data-price>
      ${sessionBadge ? `<div class="session-badge-row">${sessionBadge}</div>` : ''}
      <div class="price-line">
        ${priceStr}
        <span style="font-size:0.68rem;color:var(--text-muted);margin-left:3px;">${currency}</span>
      </div>
      <div class="change-line">${changeStr}</div>
    </div>
    <div class="row__cell shares-cell">${fmt(h.shares)}</div>
    <div class="row__cell cost-cell row__cell--muted">${formatPrice(h.cost, h.market)}</div>
    <div class="row__cell value-cell">${value != null ? formatTWD(value) : '--'}</div>
    <div class="row__cell week52-cell">
      ${w52 ? `
        <div class="week52-wrap ${week52Cls}">
          <span class="week52-price">${week52Str}</span>
          ${week52PctStr ? `<span class="week52-dist">${week52PctStr}</span>` : ''}
        </div>` : '<span style="color:var(--text-muted)">--</span>'}
    </div>
    <div class="row__pnl">
      ${pnl != null ? `
        <div class="pnl-cell ${pnl >= 0 ? 'positive' : 'negative'}">
          <span class="pnl-amount">${(pnl >= 0 ? '+' : '') + formatTWD(pnl)}</span>
          <span class="pnl-pct">${(pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(2)}%</span>
        </div>` : '<span style="color:var(--text-muted)">--</span>'}
    </div>
    <div class="row__actions desktop-actions">
      <button class="action-btn" data-action="edit" data-id="${h.id}" title="編輯">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="action-btn action-btn--delete" data-action="delete" data-id="${h.id}" title="刪除">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      </button>
    </div>
  `;

  // Swipe action panel (mobile)
  const swipeActions = document.createElement('div');
  swipeActions.className = 'swipe-actions';
  swipeActions.innerHTML = `
    <button class="swipe-btn swipe-btn--edit" data-action="edit" data-id="${h.id}">編輯</button>
    <button class="swipe-btn swipe-btn--delete" data-action="delete" data-id="${h.id}">刪除</button>
  `;

  wrapper.appendChild(row);
  wrapper.appendChild(swipeActions);

  // Touch swipe logic
  let startX = 0, startY = 0, currentX = 0, swiped = false;
  const SWIPE_THRESHOLD = 60;
  const SWIPE_OPEN = 120;

  function openSwipe() {
    row.style.transform = `translateX(-${SWIPE_OPEN}px)`;
    swipeActions.style.transform = `translateX(0)`;
    swiped = true;
    row.classList.add('swiped');
  }
  function closeSwipe() {
    row.style.transform = '';
    swipeActions.style.transform = `translateX(100%)`;
    swiped = false;
    row.classList.remove('swiped');
  }
  function closeOtherRows() {
    document.querySelectorAll('.holding-row.swiped').forEach(r => {
      if (r !== row) {
        r.style.transition = 'transform 0.25s ease';
        r.style.transform = '';
        r.classList.remove('swiped');
        const sa = r.closest('.row-swipe-wrapper')?.querySelector('.swipe-actions');
        if (sa) { sa.style.transition = 'transform 0.25s ease'; sa.style.transform = 'translateX(100%)'; }
      }
    });
  }

  row.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    currentX = 0;
    row.style.transition = 'none';
    swipeActions.style.transition = 'none';
  }, { passive: true });

  row.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (Math.abs(dy) > Math.abs(dx)) return; // vertical scroll
    if (dx > 0 && !swiped) return; // right swipe: only allow close
    currentX = Math.max(-SWIPE_OPEN, Math.min(0, dx + (swiped ? -SWIPE_OPEN : 0)));
    row.style.transform = `translateX(${currentX}px)`;
    // swipe-actions moves from 100% toward 0% as row slides left
    const actionPct = 100 + (currentX / SWIPE_OPEN * 100);
    swipeActions.style.transform = `translateX(${actionPct}%)`;
  }, { passive: true });

  row.addEventListener('touchend', () => {
    row.style.transition = 'transform 0.25s ease';
    swipeActions.style.transition = 'transform 0.25s ease';
    if (!swiped && currentX < -SWIPE_THRESHOLD) {
      closeOtherRows();
      openSwipe();
    } else if (swiped && currentX > -SWIPE_OPEN + SWIPE_THRESHOLD) {
      closeSwipe();
    } else {
      // snap back to open or closed state
      if (swiped) { openSwipe(); } else { closeSwipe(); }
    }
  });

  // Tap elsewhere to close
  document.addEventListener('touchstart', e => {
    if (swiped && !wrapper.contains(e.target)) {
      row.style.transition = 'transform 0.25s ease';
      swipeActions.style.transition = 'transform 0.25s ease';
      closeSwipe();
    }
  }, { passive: true });

  // Flash animation
  if (h._priceDir) {
    const priceCell = row.querySelector('[data-price]');
    priceCell?.classList.add(`price-flash-${h._priceDir}`);
    h._priceDir = '';
  }

  return wrapper;
}


// ── Modal ──────────────────────────────────────────────────
function openModal(holdingId = null) {
  STATE.editingId = holdingId;
  const modal    = document.getElementById('modal-overlay');
  const title    = document.getElementById('modal-title');
  const form     = document.getElementById('stock-form');
  const hint     = document.getElementById('symbol-hint');

  form.reset();
  hint.textContent = '';
  hint.className = 'form-hint';

  if (holdingId) {
    const h = STATE.holdings.find(x => x.id === holdingId);
    if (!h) return;
    title.textContent = '編輯持股';
    document.getElementById('edit-id').value = h.id;
    document.querySelector(`input[name="market"][value="${h.market}"]`).checked = true;
    document.getElementById('symbol-input').value = h.symbol;
    document.getElementById('name-input').value   = h.name || '';
    document.getElementById('shares-input').value = h.shares;
    document.getElementById('cost-input').value   = h.cost;
    document.getElementById('note-input').value   = h.note || '';
    updateCostLabel(h.market);
  } else {
    title.textContent = '新增持股';
    document.getElementById('radio-us').checked = true;
    updateCostLabel('us');
  }

  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('symbol-input').focus(), 100);
}

function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  STATE.editingId = null;
}

function updateCostLabel(market) {
  document.getElementById('cost-currency-label').textContent = market === 'us' ? '(USD)' : '(TWD)';
}

// ── Form Submit ────────────────────────────────────────────
async function handleFormSubmit(e) {
  e.preventDefault();
  const symbol  = document.getElementById('symbol-input').value.trim().toUpperCase();
  const name    = document.getElementById('name-input').value.trim();
  const shares  = parseFloat(document.getElementById('shares-input').value);
  const cost    = parseFloat(document.getElementById('cost-input').value);
  const note    = document.getElementById('note-input').value.trim();
  const market  = document.querySelector('input[name="market"]:checked').value;
  const saveBtn = document.getElementById('modal-save');

  if (!symbol || isNaN(shares) || shares <= 0 || isNaN(cost) || cost <= 0) {
    showToast('請填入所有必填欄位', 'error'); return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = '儲存中...';

  const id = STATE.editingId || genId();
  const existing = STATE.holdings.find(h => h.id === id);

  const holding = {
    id, market, symbol, shares, cost, note,
    name: name || (existing?.name) || symbol,
    price:     existing?.price     ?? null,
    change:    existing?.change    ?? null,
    changePct: existing?.changePct ?? null,
  };

  if (STATE.editingId) {
    const idx = STATE.holdings.findIndex(h => h.id === id);
    if (idx !== -1) STATE.holdings[idx] = holding;
  } else {
    STATE.holdings.push(holding);
  }

  saveHoldings();
  closeModal();
  renderHoldings();

  saveBtn.disabled = false;
  saveBtn.textContent = '儲存';

  showToast(STATE.editingId ? '持股已更新' : '持股已新增', 'success');

  // Fetch price for this single holding
  try {
    const data = market === 'us' ? await fetchUSPrice(symbol) : await fetchTWPrice(symbol);
    const h = STATE.holdings.find(x => x.id === id);
    if (h) {
      h.price       = data.price;
      h.change      = data.change;
      h.changePct   = data.changePct;
      h.marketState = data.marketState ?? null;
      if (data.week52High) h.week52High = data.week52High;
      if (!name) h.name = data.name;
      saveHoldings();
      renderHoldings();
    }
  } catch {}
}

// ── Delete ─────────────────────────────────────────────────
function confirmDelete(id) {
  const h = STATE.holdings.find(x => x.id === id);
  if (!h) return;
  document.getElementById('confirm-msg').textContent = `確定要刪除「${h.symbol}」嗎？`;
  document.getElementById('confirm-overlay').style.display = 'flex';
  STATE.confirmCallback = () => {
    STATE.holdings = STATE.holdings.filter(x => x.id !== id);
    saveHoldings();
    renderHoldings();
    showToast('已刪除持股', 'info');
  };
}

// ── Lookup Button ──────────────────────────────────────────
async function handleLookup() {
  const symbol = document.getElementById('symbol-input').value.trim().toUpperCase();
  const market = document.querySelector('input[name="market"]:checked').value;
  const hint   = document.getElementById('symbol-hint');
  const btn    = document.getElementById('lookup-btn');
  if (!symbol) return;

  btn.disabled = true;
  btn.textContent = '查詢中...';
  hint.textContent = '正在查詢...';
  hint.className = 'form-hint';

  try {
    const data = await lookupSymbol(symbol, market);
    document.getElementById('name-input').value = data.name || symbol;
    hint.textContent = `✓ ${data.name} — 現價 ${formatPrice(data.price, market)} (${data.changePct >= 0 ? '+' : ''}${data.changePct.toFixed(2)}%)`;
    hint.className = 'form-hint success';
  } catch (e) {
    hint.textContent = '❌ 查無此代號，請確認後重試';
    hint.className = 'form-hint error';
  }

  btn.disabled = false;
  btn.textContent = '查詢';
}

// ── Toast ──────────────────────────────────────────────────
// ── Cloud Sync (JSONBin.io) ────────────────────────────────
const SYNC_CFG_KEY = 'portfolio_sync_cfg_v1';
const JSONBIN_API  = 'https://api.jsonbin.io/v3';

// Cookie helpers (fallback when localStorage is cleared)
function setCookie(name, value, days) {
  const exp = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${exp};path=/;SameSite=Lax`;
}
function getCookie(name) {
  const m = document.cookie.match('(?:^|;)\\s*' + name + '=([^;]*)');
  return m ? decodeURIComponent(m[1]) : null;
}

function getSyncConfig() {
  // Try localStorage first, fall back to cookie
  try {
    const raw = localStorage.getItem(SYNC_CFG_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  try {
    const raw = getCookie(SYNC_CFG_KEY);
    if (raw) {
      const cfg = JSON.parse(raw);
      // Restore to localStorage while we're at it
      localStorage.setItem(SYNC_CFG_KEY, raw);
      return cfg;
    }
  } catch {}
  return null;
}
function setSyncConfig(cfg) {
  const val = JSON.stringify(cfg);
  localStorage.setItem(SYNC_CFG_KEY, val);
  setCookie(SYNC_CFG_KEY, val, 365); // 1 year cookie backup
}
function clearSyncConfig() {
  localStorage.removeItem(SYNC_CFG_KEY);
  setCookie(SYNC_CFG_KEY, '', -1); // delete cookie
}

// Put bin ID in URL query string so bookmarking the URL is enough on a new device
function updateHashBinId(binId) {
  const url = new URL(window.location.href);
  if (binId) {
    url.searchParams.set('b', binId);
  } else {
    url.searchParams.delete('b');
  }
  history.replaceState(null, '', url.toString());
}
function getBinIdFromHash() {
  const url = new URL(window.location.href);
  // Support both ?b= (new) and #b= (legacy)
  return url.searchParams.get('b') || (window.location.hash.match(/[#&]b=([^&]+)/)?.[1] ?? null);
}

function setSyncDot(state) { // 'active' | 'inactive' | 'syncing' | 'error'
  const el = document.getElementById('sync-dot');
  if (!el) return;
  el.className = `sync-dot sync-dot--${state}`;
}

// Strip live price fields before cloud sync
function holdingsForSync(holdings) {
  return holdings.map(({ id, market, symbol, name, shares, cost, note }) =>
    ({ id, market, symbol, name, shares, cost, note })
  );
}

async function syncPush() {
  const cfg = getSyncConfig();
  if (!cfg?.apiKey || !cfg?.binId) return;
  setSyncDot('syncing');
  try {
    const payload = {
      holdings:  holdingsForSync(JSON.parse(localStorage.getItem('portfolio_holdings_v2') || '[]')),
      snapshots: JSON.parse(localStorage.getItem(SNAP_KEY) || '[]'),
      updatedAt: Date.now(),
    };
    const res = await fetch(`${JSONBIN_API}/b/${cfg.binId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Access-Key': cfg.apiKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    setSyncDot(res.ok ? 'active' : 'error');
  } catch { setSyncDot('error'); }
}

async function syncPull() {
  const cfg = getSyncConfig();
  if (!cfg?.apiKey || !cfg?.binId) return false;
  setSyncDot('syncing');
  try {
    const res = await fetch(`${JSONBIN_API}/b/${cfg.binId}/latest`, {
      headers: { 'X-Access-Key': cfg.apiKey },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) { setSyncDot('error'); return false; }
    const data = await res.json();
    const payload = data.record;
    // Only overwrite if cloud data is newer
    if (payload.holdings) {
      // Strip stale live-price fields from cloud data
      const clean = payload.holdings.map(({ id, market, symbol, name, shares, cost, note }) =>
        ({ id, market, symbol, name, shares, cost, note })
      );
      localStorage.setItem('portfolio_holdings_v2', JSON.stringify(clean));
      loadHoldings();
      renderHoldings();
    }
    if (payload.snapshots) {
      localStorage.setItem(SNAP_KEY, JSON.stringify(payload.snapshots));
    }
    setSyncDot('active');
    return true;
  } catch { setSyncDot('error'); return false; }
}

async function setupAndEnableSync(apiKey, binId) {
  const hint = document.getElementById('sync-hint');
  const btn  = document.getElementById('sync-save');
  hint.textContent = '連線中...'; hint.className = 'form-hint';
  btn.disabled = true;

  try {
    if (!binId) {
      // Create a new private bin
      const payload = {
        holdings:  holdingsForSync(JSON.parse(localStorage.getItem('portfolio_holdings_v2') || '[]')),
        snapshots: JSON.parse(localStorage.getItem(SNAP_KEY) || '[]'),
        updatedAt: Date.now(),
      };
      const res = await fetch(`${JSONBIN_API}/b`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Access-Key': apiKey,
          'X-Bin-Name': 'portfolio-tracker',
          'X-Bin-Private': 'true',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`建立 Bin 失敗 (${res.status})`);
      const data = await res.json();
      binId = data.metadata.id;
    } else {
      // Verify existing bin is accessible
      const res = await fetch(`${JSONBIN_API}/b/${binId}/latest`, {
        headers: { 'X-Access-Key': apiKey },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`無法讀取 Bin，請確認 API Key 和 Bin ID (${res.status})`);
      // Pull cloud data into local storage
      const data = await res.json();
      const payload = data.record;
      if (payload.holdings) localStorage.setItem('portfolio_holdings_v2', JSON.stringify(payload.holdings));
      if (payload.snapshots) localStorage.setItem(SNAP_KEY, JSON.stringify(payload.snapshots));
      loadHoldings();
      renderHoldings();
      renderChart();
    }

    setSyncConfig({ apiKey, binId });
    updateHashBinId(binId);
    setSyncDot('active');
    document.getElementById('sync-binid').value = binId;
    hint.textContent = `✓ 同步已啟用！Bin ID: ${binId}`;
    hint.className = 'form-hint success';
    showToast('雲端同步已啟用 ✓', 'success');
    if (STATE.holdings.length > 0) setTimeout(refreshAllPrices, 400);
  } catch(e) {
    hint.textContent = '❌ ' + e.message;
    hint.className = 'form-hint error';
    setSyncDot('error');
  }
  btn.disabled = false;
}

function openSyncModal() {
  const cfg = getSyncConfig();
  const binFromHash = getBinIdFromHash();
  document.getElementById('sync-apikey').value = cfg?.apiKey || '';
  document.getElementById('sync-binid').value  = cfg?.binId || binFromHash || '';
  document.getElementById('sync-hint').textContent = cfg
    ? `目前 Bin ID: ${cfg.binId}`
    : (binFromHash ? `偵測到 URL 中的 Bin ID: ${binFromHash}，填入 API Key 即可連線` : '');
  document.getElementById('sync-hint').className = 'form-hint';
  document.getElementById('sync-overlay').style.display = 'flex';
}
function closeSyncModal() {
  document.getElementById('sync-overlay').style.display = 'none';
}

// ── Export / Import ───────────────────────────────────────────
function exportData() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    holdings: JSON.parse(localStorage.getItem('portfolio_holdings_v2') || '[]'),
    snapshots: JSON.parse(localStorage.getItem(SNAP_KEY) || '[]'),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `portfolio_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('資料已匹出 ✓', 'success');
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const payload = JSON.parse(e.target.result);
      if (!payload.holdings || !Array.isArray(payload.holdings)) throw new Error('invalid');
      localStorage.setItem('portfolio_holdings_v2', JSON.stringify(payload.holdings));
      if (payload.snapshots) localStorage.setItem(SNAP_KEY, JSON.stringify(payload.snapshots));
      loadHoldings();
      renderHoldings();
      renderChart();
      showToast(`已匯入 ${payload.holdings.length} 筆持股 ✓`, 'success');
      if (STATE.holdings.length > 0) setTimeout(refreshAllPrices, 300);
    } catch {
      showToast('檔案格式錯誤，請選擇正確的 JSON 匹出檔', 'error');
    }
  };
  reader.readAsText(file);
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('out');
    toast.addEventListener('animationend', () => toast.remove());
  }, 3000);
}

// ── Helpers ────────────────────────────────────────────────
function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function fmt(n) { return Number(n).toLocaleString('zh-TW'); }
function formatTWD(n) { return 'NT$' + Math.round(n).toLocaleString('zh-TW'); }
function formatPrice(p, market) {
  if (p == null) return '--';
  if (market === 'us') return '$' + p.toFixed(2);
  return p.toFixed(2);
}
function formatChange(change, pct, market) {
  if (change == null) return '<span class="change-badge change-badge--flat">--</span>';
  const dir = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  const arrow = change > 0 ? '▲' : change < 0 ? '▼' : '–';
  const sign  = change > 0 ? '+' : '';
  const priceStr = market === 'us' ? `${sign}$${Math.abs(change).toFixed(2)}` : `${sign}${Math.abs(change).toFixed(2)}`;
  const pctStr = `${sign}${pct.toFixed(2)}%`;
  return `<span class="change-badge change-badge--${dir}">${arrow} ${priceStr} (${pctStr})</span>`;
}

// ── Backfill Snapshots (last 5 trading days) ─────────────
async function backfillSnapshots() {
  if (STATE.holdings.length === 0) {
    showToast('尚無持股，無法補齊', 'error'); return;
  }
  const btn = document.getElementById('backfill-btn');
  if (btn) { btn.disabled = true; btn.textContent = '補齊中...'; }

  const rate = STATE.usdRate || 32.5;
  let existingSnaps = loadSnapshots();
  // Remove any snaps where US value is suspiciously 0 but holdings contain US stocks
  // (artifacts from the old broken backfill) so they can be re-generated correctly
  const hasUSHoldings = STATE.holdings.some(h => h.market === 'us');
  if (hasUSHoldings) {
    existingSnaps = existingSnaps.filter(s => s.us > 0 || s.tw > 0 && s.us === 0 && !STATE.holdings.some(h => h.market === 'us'));
    // Simpler: just drop backfilled entries (label ends in '收') where us===0 but we have US holdings
    existingSnaps = existingSnaps.filter(s => !(s.us === 0 && hasUSHoldings && s.label.endsWith('收')));
  }
  const existingKeys = new Set(existingSnaps.map(s => s.sKey));

  // histMap: holdingId -> { 'YYYY/MM/DD': price }
  const histMap = {};

  await Promise.allSettled(STATE.holdings.map(async h => {
    try {
      if (h.market === 'us') {
        const sym = h.symbol.toUpperCase();
        const proxies = [
          url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
          url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
        ];
        const endpoint = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=20d&includePrePost=false`;
        let result = null;
        for (const proxy of proxies) {
          try {
            const res = await fetch(proxy(endpoint), { signal: AbortSignal.timeout(12000) });
            const json = await res.json();
            const raw = json.contents !== undefined ? json.contents : (typeof json === 'string' ? json : JSON.stringify(json));
            const data = JSON.parse(raw);
            result = data?.chart?.result?.[0];
            if (result) break;
          } catch(e) { console.warn(`[backfill] proxy failed for ${sym}:`, e); }
        }
        if (!result) { console.warn(`[backfill] no result for ${sym}`); return; }
        const timestamps = result.timestamp || [];
        const closes = result.indicators?.quote?.[0]?.close || [];
        histMap[h.id] = {};
        timestamps.forEach((ts, i) => {
          if (closes[i] == null || closes[i] <= 0) return;
          const d = new Date((ts + 8 * 3600) * 1000);
          const ymd = `${d.getUTCFullYear()}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${String(d.getUTCDate()).padStart(2,'0')}`;
          histMap[h.id][ymd] = closes[i];
        });
        console.log(`[backfill] ${sym} dates:`, Object.keys(histMap[h.id]));
      } else {
        const code = h.symbol.replace(/\.TW$/i, '');
        const now = new Date();
        histMap[h.id] = {};
        // Fetch current month + previous month to cover early-month edge cases
        for (let mo = 0; mo <= 1; mo++) {
          const dt = new Date(now.getFullYear(), now.getMonth() - mo, 1);
          const dateStr = `${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,'0')}01`;
          const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${dateStr}&stockNo=${code}`;
          try {
            const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
            const d = await res.json();
            (d?.data || []).forEach(row => {
              // Row[0] is ROC date like "114/04/25"
              const parts = row[0].split('/');
              const year = parseInt(parts[0]) + 1911;
              const month = parts[1].padStart(2, '0');
              const day   = parts[2].padStart(2, '0');
              const ymd   = `${year}/${month}/${day}`;
              const price = parseFloat(row[6].replace(/,/g, ''));
              if (price > 0) histMap[h.id][ymd] = price;
            });
          } catch {}
        }
      }
    } catch (e) {
      console.warn('backfill fetch:', h.symbol, e);
    }
  }));

  // Build sorted [date, price] arrays per holding for carry-forward lookup
  const histSorted = {};
  Object.entries(histMap).forEach(([id, dateMap]) => {
    histSorted[id] = Object.entries(dateMap).sort(([a], [b]) => a.localeCompare(b));
  });
  // Return latest price on or before target date (carry-forward over holidays/different calendars)
  function priceOnOrBefore(id, ymd) {
    const entries = histSorted[id];
    if (!entries || entries.length === 0) return null;
    let result = null;
    for (const [d, p] of entries) {
      if (d <= ymd) result = p;
      else break;
    }
    return result;
  }

  // Union of all available dates, take the 5 most recent
  const allDates = new Set();
  Object.values(histMap).forEach(m => Object.keys(m).forEach(d => allDates.add(d)));
  const sortedDates = [...allDates].sort().slice(-5);
  console.log('[backfill] sortedDates:', sortedDates);
  console.log('[backfill] histMap keys:', Object.fromEntries(Object.entries(histMap).map(([id,m])=>[id, Object.keys(m)])));

  let added = 0;
  sortedDates.forEach(ymd => {
    const sKey = `${ymd}-pm`;
    if (existingKeys.has(sKey)) return;
    let usVal = 0, twVal = 0;
    STATE.holdings.forEach(h => {
      const price = priceOnOrBefore(h.id, ymd);
      if (!price) return;
      const v = price * h.shares * (h.market === 'us' ? rate : 1);
      if (h.market === 'us') usVal += v; else twVal += v;
    });
    const total = usVal + twVal;
    if (total <= 0) return;
    const parts = ymd.split('/');
    const label = `${parts[1]}/${parts[2]} 收`;
    const ts = new Date(`${parts[0]}-${parts[1]}-${parts[2]}T16:00:00`).getTime();
    existingSnaps.push({ ts, sKey, label, total, us: usVal, tw: twVal });
    added++;
  });

  if (added > 0) {
    existingSnaps.sort((a, b) => a.ts - b.ts);
    localStorage.setItem(SNAP_KEY, JSON.stringify(existingSnaps.slice(-180)));
    renderChart();
    showToast(`已補齊 ${added} 天歷史資料 ✓`, 'success');
  } else {
    showToast('無新增資料（已存在或無法取得）', 'info');
  }

  if (btn) { btn.disabled = false; btn.textContent = '補齊歷史'; }
}

// ── Snapshot ───────────────────────────────────────────────
const SNAP_KEY = 'portfolio_snapshots_v1';

function loadSnapshots() {
  try { return JSON.parse(localStorage.getItem(SNAP_KEY) || '[]'); }
  catch { return []; }
}

function recordSnapshot() {
  const rate = STATE.usdRate || 32;
  let usVal = 0, twVal = 0;
  STATE.holdings.forEach(h => {
    if (!h.price) return;
    const v = h.price * h.shares * (h.market === 'us' ? rate : 1);
    if (h.market === 'us') usVal += v; else twVal += v;
  });
  const total = usVal + twVal;
  if (total <= 0) return false;

  const now = new Date();
  const ymd = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')}`;
  const session = now.getHours() < 13 ? 'am' : 'pm';
  const sKey = `${ymd}-${session}`;
  const label = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  let snaps = loadSnapshots().filter(s => s.sKey !== sKey);
  snaps.push({ ts: now.getTime(), sKey, label, total, us: usVal, tw: twVal });
  snaps.sort((a, b) => a.ts - b.ts);
  localStorage.setItem(SNAP_KEY, JSON.stringify(snaps.slice(-180)));
  syncPush();
  renderChart();
  return true;
}

// ── Chart ──────────────────────────────────────────────────
let _chart = null;

function renderChart() {
  let snaps = loadSnapshots();
  if (STATE.chartRange !== 'all') {
    const cutoff = Date.now() - parseInt(STATE.chartRange) * 86400000;
    snaps = snaps.filter(s => s.ts >= cutoff);
  }

  const emptyEl = document.getElementById('chart-empty');
  const canvasEl = document.getElementById('asset-chart');
  const legendEl = document.getElementById('chart-legend');

  if (snaps.length === 0) {
    emptyEl.style.display = 'flex';
    canvasEl.style.display = 'none';
    legendEl.style.visibility = 'hidden';
    if (_chart) { _chart.destroy(); _chart = null; }
    return;
  }

  emptyEl.style.display = 'none';
  canvasEl.style.display = 'block';
  legendEl.style.visibility = '';

  const hasUS = snaps.some(s => s.us > 0);
  const hasTW = snaps.some(s => s.tw > 0);
  const ptR = snaps.length <= 20 ? 3 : snaps.length <= 60 ? 2 : 0;

  const ctx = canvasEl.getContext('2d');
  const gradUs = ctx.createLinearGradient(0, 0, 0, 260);
  gradUs.addColorStop(0, 'rgba(79,82,217,0.28)');
  gradUs.addColorStop(1, 'rgba(79,82,217,0.02)');
  const gradTw = ctx.createLinearGradient(0, 0, 0, 260);
  gradTw.addColorStop(0, 'rgba(5,150,105,0.28)');
  gradTw.addColorStop(1, 'rgba(5,150,105,0.03)');

  if (_chart) { _chart.destroy(); _chart = null; }

  const datasets = [];
  if (hasTW) datasets.push({
    label: '台股 (TWD)',
    data: snaps.map(s => s.tw),
    fill: true,
    backgroundColor: gradTw,
    borderColor: '#059669',
    borderWidth: 2,
    tension: 0.4,
    pointRadius: ptR,
    pointHoverRadius: 5,
    pointBackgroundColor: '#059669',
  });
  if (hasUS) datasets.push({
    label: '美股 (TWD)',
    data: snaps.map(s => s.us),
    fill: true,
    backgroundColor: gradUs,
    borderColor: '#4f52d9',
    borderWidth: 2.5,
    tension: 0.4,
    pointRadius: ptR,
    pointHoverRadius: 5,
    pointBackgroundColor: '#4f52d9',
  });
  if (!hasUS && !hasTW) datasets.push({
    label: '總資產 (TWD)',
    data: snaps.map(s => s.total),
    fill: true,
    backgroundColor: gradUs,
    borderColor: '#4f52d9',
    borderWidth: 2.5,
    tension: 0.4,
    pointRadius: ptR,
    pointHoverRadius: 5,
    pointBackgroundColor: '#4f52d9',
  });

  _chart = new Chart(ctx, {
    type: 'line',
    data: { labels: snaps.map(s => s.label), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(255,255,255,0.97)',
          borderColor: 'rgba(0,0,0,0.1)',
          borderWidth: 1,
          titleColor: '#1e293b',
          bodyColor: '#475569',
          padding: 12,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label.split(' ')[0]}: NT$${Math.round(ctx.raw).toLocaleString('zh-TW')}`,
            afterBody: items => {
              if (items.length <= 1) return [];
              const total = items.reduce((s, i) => s + i.raw, 0);
              return [``, ` 合計: NT$${Math.round(total).toLocaleString('zh-TW')}`];
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#64748b', font: { size: 11 }, maxTicksLimit: 10, maxRotation: 30 },
          border: { display: false },
        },
        y: {
          grid: { color: 'rgba(0,0,0,0.06)' },
          ticks: {
            color: '#64748b',
            font: { size: 11 },
            callback: v => v >= 1_000_000 ? 'NT$' + (v/1_000_000).toFixed(1) + 'M' : 'NT$' + Math.round(v/1000) + 'K',
          },
          border: { display: false },
        },
      },
    },
  });

  // Update subtitle with latest snapshot info
  const last = snaps[snaps.length - 1];
  if (last) {
    document.getElementById('chart-last-snap').textContent =
      `最近記錄：${last.label} — NT$${Math.round(last.total).toLocaleString('zh-TW')}`;
  }
}

// ── Event Wiring ───────────────────────────────────────────
function init() {
  // Detect touch device immediately (before rendering)
  if (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) {
    document.body.classList.add('touch-device');
  }

  loadHoldings();
  fetchUsdRate();
  renderHoldings();

  // Init sync UI dot
  const cfg = getSyncConfig();
  setSyncDot(cfg ? 'active' : 'inactive');
  // If URL has bin ID but no config yet, pre-fill the modal trigger
  const binFromHash = getBinIdFromHash();
  if (!cfg && binFromHash) setSyncDot('inactive');

  document.getElementById('export-btn').addEventListener('click', exportData);
  document.getElementById('import-file').addEventListener('change', e => {
    importData(e.target.files[0]);
    e.target.value = '';
  });

  // Sync modal
  document.getElementById('sync-btn').addEventListener('click', openSyncModal);
  document.getElementById('sync-close').addEventListener('click', closeSyncModal);
  document.getElementById('sync-overlay').addEventListener('click', e => {
    if (e.target.id === 'sync-overlay') closeSyncModal();
  });
  document.getElementById('sync-save').addEventListener('click', () => {
    const apiKey = document.getElementById('sync-apikey').value.trim();
    const binId  = document.getElementById('sync-binid').value.trim();
    if (!apiKey) {
      document.getElementById('sync-hint').textContent = '請填入 API Key';
      document.getElementById('sync-hint').className = 'form-hint error';
      return;
    }
    setupAndEnableSync(apiKey, binId || null);
  });
  document.getElementById('sync-disable').addEventListener('click', () => {
    clearSyncConfig();
    updateHashBinId(null);
    setSyncDot('inactive');
    closeSyncModal();
    showToast('已停用同步', 'info');
  });

  // Hamburger menu (mobile)
  const hamburgerBtn = document.getElementById('hamburger-btn');
  const headerActions = document.getElementById('header-actions');
  function closeHamburger() {
    headerActions.classList.remove('open');
    hamburgerBtn.setAttribute('aria-expanded', 'false');
  }
  hamburgerBtn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = headerActions.classList.toggle('open');
    hamburgerBtn.setAttribute('aria-expanded', String(isOpen));
  });
  // Close when clicking outside
  document.addEventListener('click', e => {
    if (!headerActions.contains(e.target) && e.target !== hamburgerBtn) closeHamburger();
  });
  // Close after any action button clicked
  headerActions.addEventListener('click', () => setTimeout(closeHamburger, 150));

  // Header
  document.getElementById('add-stock-btn').addEventListener('click', () => openModal());
  document.getElementById('refresh-btn').addEventListener('click', refreshAllPrices);

  // Empty state
  document.getElementById('empty-add-btn').addEventListener('click', () => openModal());

  // Modal
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target.id === 'modal-overlay') closeModal(); });
  document.getElementById('stock-form').addEventListener('submit', handleFormSubmit);
  document.getElementById('lookup-btn').addEventListener('click', handleLookup);

  // Market radio → update cost label
  document.querySelectorAll('input[name="market"]').forEach(radio => {
    radio.addEventListener('change', e => updateCostLabel(e.target.value));
  });

  // Symbol input Enter → lookup
  document.getElementById('symbol-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handleLookup(); } });

  // Tabs
  document.getElementById('market-tabs').addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('tab--active'));
    tab.classList.add('tab--active');
    STATE.activeTab = tab.dataset.tab;
    renderHoldings();
  });

  // Sort
  document.getElementById('sort-select').addEventListener('change', e => {
    STATE.sortBy = e.target.value;
    renderHoldings();
  });

  // Row actions (delegated)
  document.getElementById('holdings-body').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'edit')   openModal(id);
    if (action === 'delete') confirmDelete(id);
  });

  // Confirm dialog
  document.getElementById('confirm-cancel').addEventListener('click', () => {
    document.getElementById('confirm-overlay').style.display = 'none';
    STATE.confirmCallback = null;
  });
  document.getElementById('confirm-ok').addEventListener('click', () => {
    document.getElementById('confirm-overlay').style.display = 'none';
    if (STATE.confirmCallback) { STATE.confirmCallback(); STATE.confirmCallback = null; }
  });
  document.getElementById('confirm-overlay').addEventListener('click', e => {
    if (e.target.id === 'confirm-overlay') {
      document.getElementById('confirm-overlay').style.display = 'none';
      STATE.confirmCallback = null;
    }
  });

  // ESC key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeModal();
      document.getElementById('confirm-overlay').style.display = 'none';
    }
  });

  // Auto-refresh: 1 min during US pre/regular/post market (TWN time 16:00–06:00), 5 min otherwise
  function scheduleRefresh() {
    const h = new Date().getHours();
    // US market active hours in Taiwan time:
    // Pre-market:  16:00 – 21:30  (EDT pre: 04:00–09:30)
    // Regular:     21:30 – 04:00  (EDT regular: 09:30–16:00)
    // Post-market: 04:00 – 08:00  (EDT post: 16:00–20:00)
    // Combined window: 16:00 ~ 08:00 (next day)
    const isActiveWindow = h >= 16 || h < 8;
    return isActiveWindow ? 5 * 60 * 1000 : 5 * 60 * 1000;
  }

  let _refreshTimer = null;
  function armRefresh() {
    if (_refreshTimer) clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(async () => {
      await refreshAllPrices();
      armRefresh();
    }, scheduleRefresh());
  }
  armRefresh();

  // Auto-snapshot scheduler: trigger refresh at 09:00 and 16:00 if page is open
  setInterval(() => {
    const h = new Date().getHours(), m = new Date().getMinutes();
    if ((h === 9 || h === 16) && m === 0 && STATE.holdings.length > 0) {
      refreshAllPrices();
    }
  }, 60 * 1000);

  // Chart range buttons
  document.getElementById('chart-range-btns').addEventListener('click', e => {
    const btn = e.target.closest('.chart-range-btn');
    if (!btn) return;
    document.querySelectorAll('.chart-range-btn').forEach(b => b.classList.remove('chart-range-btn--active'));
    btn.classList.add('chart-range-btn--active');
    STATE.chartRange = btn.dataset.range;
    renderChart();
  });

  // Manual snapshot
  document.getElementById('manual-snap-btn').addEventListener('click', () => {
    if (!STATE.holdings.some(h => h.price)) {
      showToast('請先更新報價再記錄快照', 'error'); return;
    }
    if (recordSnapshot()) showToast('資產快照已記錄 ✓', 'success');
    else showToast('無法記錄：尚無有效報價', 'error');
  });

  // Backfill historical snapshots
  document.getElementById('backfill-btn').addEventListener('click', backfillSnapshots);

  // Initial chart render
  renderChart();

  // If we have holdings, auto-fetch prices on load
  if (STATE.holdings.length > 0) {
    setTimeout(async () => {
      await refreshAllPrices();
      if (loadSnapshots().length === 0) backfillSnapshots();
    }, 500);
  }

  // On load: pull from cloud first, then refresh prices, then push clean data back
  const syncCfg = getSyncConfig();
  if (syncCfg?.apiKey && syncCfg?.binId) {
    syncPull().then(async pulled => {
      if (pulled) {
        loadHoldings();
        renderHoldings();
        renderChart();
        if (STATE.holdings.length > 0) {
          await new Promise(r => setTimeout(r, 400));
          await refreshAllPrices();
          // Push clean data (no live prices) back to bin, overwriting any stale prices
          syncPush();
        }
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
