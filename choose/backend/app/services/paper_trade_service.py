"""
模擬下單服務（Paper Trading）
- 盤中每 10 分鐘自動掃描強勢股（量突破前日2倍 + 在MA5/MA20上方）
- 訊號出現時模擬進場，記錄進場價與時間
- 停損 -3%、停利 +6%，13:20 強制平倉
- 每次訊號 / 進場 / 出場同步推播 Telegram
"""
import asyncio
import logging
import os
from datetime import datetime, date, time as dtime
from typing import Optional

from app.services.data_service import fetch_market_day_all, fetch_price_data_fast, fetch_ma_volume_batch
from app.services.technical_analysis import compute_indicators, compute_technical_score
from app.services.telegram_service import send_message

logger = logging.getLogger(__name__)

# ── 設定 ──
STOP_LOSS_PCT   = float(os.environ.get("PAPER_STOP_LOSS",   "-3.0"))   # -3%
TAKE_PROFIT_PCT = float(os.environ.get("PAPER_TAKE_PROFIT", "6.0"))    # +6%
FORCE_CLOSE_TIME = dtime(13, 20)   # 13:20 強制平倉

# ── 狀態（in-memory，重啟後重置） ──
_positions: dict[str, dict] = {}     # stock_id → position
_closed_trades: list[dict]  = []     # 今日已平倉紀錄
_notified_today: set[str]   = set()  # 今日已推播過訊號（避免重複）
_last_scan_time: Optional[datetime] = None
_last_scan_date: Optional[date]     = None


# ── 公開 API（供 router 查詢） ──

def get_positions() -> list[dict]:
    return list(_positions.values())

def get_closed_trades() -> list[dict]:
    return list(_closed_trades)

def get_summary() -> dict:
    total_pnl = sum(t["profit_loss"] for t in _closed_trades)
    win = sum(1 for t in _closed_trades if t["profit_loss"] > 0)
    total = len(_closed_trades)
    return {
        "date": str(_last_scan_date or date.today()),
        "last_scan": _last_scan_time.strftime("%H:%M:%S") if _last_scan_time else None,
        "open_positions": len(_positions),
        "closed_trades": total,
        "win_count": win,
        "win_rate": round(win / total * 100, 1) if total > 0 else 0.0,
        "total_pnl_pct": round(total_pnl, 2),
    }

def clear_today():
    """手動重置（換日或測試用）"""
    _positions.clear()
    _closed_trades.clear()
    _notified_today.clear()


# ── 核心掃描任務 ──

async def run_scan():
    """每 10 分鐘呼叫一次，掃描強勢股、管理模擬倉位。"""
    global _last_scan_time, _last_scan_date

    now = datetime.now()
    today = now.date()

    # 換日時重置
    if _last_scan_date and _last_scan_date != today:
        clear_today()
    _last_scan_date = today
    _last_scan_time = now

    # 只在盤中執行（9:00 ~ 13:30）
    t = now.time()
    if not (dtime(9, 0) <= t <= dtime(13, 30)):
        logger.info(f"[PaperTrade] 非盤中時間 ({t})，跳過掃描")
        return

    logger.info(f"[PaperTrade] 開始掃描 {now.strftime('%H:%M:%S')}")

    # ── 1. 更新持倉現價，檢查停損/停利/強制平倉 ──
    if _positions:
        await _check_exits(now)

    # ── 2. 掃描新訊號 ──
    if t <= dtime(13, 0):   # 13:00 後不開新倉
        await _scan_signals(now)


async def _check_exits(now: datetime):
    """對每個持倉更新現價，觸發停損/停利/強制平倉。"""
    all_data = await fetch_market_day_all()
    price_map = {r["stock_id"]: r["close"] for r in all_data}

    to_close = []
    for sid, pos in _positions.items():
        current = price_map.get(sid, pos["entry_price"])
        pnl_pct = (current - pos["entry_price"]) / pos["entry_price"] * 100

        reason = None
        if now.time() >= FORCE_CLOSE_TIME:
            reason = "強制平倉（收盤）"
        elif pnl_pct <= STOP_LOSS_PCT:
            reason = f"觸停損 {pnl_pct:.1f}%"
        elif pnl_pct >= TAKE_PROFIT_PCT:
            reason = f"觸停利 {pnl_pct:.1f}%"

        if reason:
            to_close.append((sid, current, pnl_pct, reason))

    for sid, exit_price, pnl_pct, reason in to_close:
        pos = _positions.pop(sid)
        trade = {
            "stock_id":    sid,
            "stock_name":  pos["stock_name"],
            "entry_time":  pos["entry_time"],
            "exit_time":   now.strftime("%H:%M"),
            "entry_price": pos["entry_price"],
            "exit_price":  exit_price,
            "profit_loss": round(pnl_pct, 2),
            "reason":      reason,
        }
        _closed_trades.append(trade)
        emoji = "💰" if pnl_pct > 0 else "🔴"
        msg = (
            f"{emoji} <b>模擬出場</b>\n"
            f"{sid} {pos['stock_name']}\n"
            f"進場 {pos['entry_price']} → 出場 {exit_price:.2f}\n"
            f"損益 <b>{pnl_pct:+.1f}%</b>  ({reason})"
        )
        await send_message(msg)
        logger.info(f"[PaperTrade] 出場 {sid} {pnl_pct:+.1f}% ({reason})")


async def _scan_signals(now: datetime):
    """掃描強勢股訊號，符合條件且未持倉則模擬進場。"""
    all_data = await fetch_market_day_all()
    if not all_data:
        return

    # 初篩：振幅 ≥ 2%、量 ≥ 3000 張、股價 ≥ 10
    candidates = [
        r for r in all_data
        if r["volume_lots"] >= 3000
        and r["amplitude"] >= 2.0
        and r["close"] >= 10.0
    ]
    if not candidates:
        return

    # MA + 前日量資料
    ids = [c["stock_id"] for c in candidates]
    ma_data = await fetch_ma_volume_batch(ids)

    for c in candidates:
        sid = c["stock_id"]
        md = ma_data.get(sid, {})
        ma5       = md.get("ma5")
        ma20      = md.get("ma20")
        prev_vol  = md.get("prev_volume_lots")
        close     = c["close"]

        # 條件：在 MA5 + MA20 之上，且今日量 ≥ 前日 2 倍
        if ma5 is None or ma20 is None:
            continue
        if close < ma5 or close < ma20:
            continue
        if prev_vol is None or prev_vol <= 0:
            continue
        if c["volume_lots"] < prev_vol * 2:
            continue

        signal_key = f"{sid}_{now.strftime('%Y%m%d')}"

        # 推播訊號（每日每股只推一次）
        if signal_key not in _notified_today:
            _notified_today.add(signal_key)
            msg = (
                f"🚨 <b>強勢股訊號</b>\n"
                f"{sid} {c['stock_name']}  @{close}\n"
                f"漲幅 {c['change_pct']:+.1f}%  振幅 {c['amplitude']:.1f}%\n"
                f"成交量 {c['volume_lots']:,} 張（前日 {prev_vol:,} 張）\n"
                f"MA5={ma5}  MA20={ma20}\n"
                f"停損 {STOP_LOSS_PCT}%  停利 +{TAKE_PROFIT_PCT}%"
            )
            await send_message(msg)
            logger.info(f"[PaperTrade] 訊號 {sid} {c['stock_name']} @{close}")

        # 若尚未持倉，模擬進場
        if sid not in _positions:
            _positions[sid] = {
                "stock_id":    sid,
                "stock_name":  c["stock_name"],
                "entry_time":  now.strftime("%H:%M"),
                "entry_price": close,
                "current_price": close,
                "pnl_pct":     0.0,
                "ma5":         ma5,
                "ma20":        ma20,
            }
            msg = (
                f"✅ <b>模擬進場</b>\n"
                f"{sid} {c['stock_name']}  進場價 {close}\n"
                f"停損 {close * (1 + STOP_LOSS_PCT/100):.2f}  "
                f"停利 {close * (1 + TAKE_PROFIT_PCT/100):.2f}"
            )
            await send_message(msg)
            logger.info(f"[PaperTrade] 進場 {sid} @{close}")
