import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

import finnhub

import config

logger = logging.getLogger(__name__)

_finnhub_client = finnhub.Client(api_key=config.FINNHUB_API_KEY)


async def _fetch_earnings_calendar(date_str: str) -> list[dict[str, Any]]:
    """向 Finnhub 查詢指定日期的財報行事曆。"""
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None,
            lambda: _finnhub_client.earnings_calendar(
                _from=date_str, to=date_str, symbol="", international=False
            ),
        )
        return result.get("earningsCalendar", [])
    except Exception as e:
        logger.error("Finnhub earnings calendar error: %s", e)
        return []


async def fetch_premarket_earnings() -> list[dict[str, Any]]:
    """
    取得今日盤前（BMO = Before Market Open）財報。
    於 13:00 UTC（台灣 21:00 / 美東 09:00）執行。
    """
    today = datetime.now(timezone.utc).date().isoformat()
    all_earnings = await _fetch_earnings_calendar(today)
    bmo = [
        e for e in all_earnings
        if e.get("hour", "").lower() in ("bmo", "before market open")
    ]
    bmo.sort(key=lambda x: x.get("symbol", ""))
    logger.info("BMO earnings on %s: %d items", today, len(bmo))
    return bmo[: config.MAX_EARNINGS_ITEMS]


async def fetch_afterhours_earnings() -> list[dict[str, Any]]:
    """
    取得今日盤後（AMC = After Market Close）財報。
    於 22:00 UTC（台灣 06:00 / 美東 18:00）執行。
    """
    today = datetime.now(timezone.utc).date().isoformat()
    all_earnings = await _fetch_earnings_calendar(today)
    amc = [
        e for e in all_earnings
        if e.get("hour", "").lower() in ("amc", "after market close")
    ]
    amc.sort(key=lambda x: x.get("symbol", ""))
    logger.info("AMC earnings on %s: %d items", today, len(amc))
    return amc[: config.MAX_EARNINGS_ITEMS]
