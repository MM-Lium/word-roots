import asyncio
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import aiohttp
import finnhub

import config

logger = logging.getLogger(__name__)

_finnhub_client = finnhub.Client(api_key=config.FINNHUB_API_KEY)


# ── 已發送紀錄（防重複推播）────────────────────────────────────────────────────

def _load_sent_ids() -> set[str]:
    if not os.path.exists(config.SENT_NEWS_FILE):
        return set()
    try:
        with open(config.SENT_NEWS_FILE, "r", encoding="utf-8") as f:
            data: dict[str, float] = json.load(f)
        cutoff = time.time() - 86400  # 保留最近 24 小時
        return {k for k, v in data.items() if v > cutoff}
    except Exception:
        return set()


def _mark_sent(new_ids: set[str]) -> None:
    os.makedirs(config.DATA_DIR, exist_ok=True)
    existing: dict[str, float] = {}
    if os.path.exists(config.SENT_NEWS_FILE):
        try:
            with open(config.SENT_NEWS_FILE, "r", encoding="utf-8") as f:
                existing = json.load(f)
        except Exception:
            existing = {}
    now = time.time()
    for nid in new_ids:
        existing[nid] = now
    # 清除 24 小時前的紀錄
    cutoff = now - 86400
    existing = {k: v for k, v in existing.items() if v > cutoff}
    with open(config.SENT_NEWS_FILE, "w", encoding="utf-8") as f:
        json.dump(existing, f)


# ── 資料來源抓取 ──────────────────────────────────────────────────────────────

async def _fetch_finnhub_news() -> list[dict[str, Any]]:
    """從 Finnhub 抓取近 2 小時的通用市場新聞。"""
    loop = asyncio.get_event_loop()
    try:
        raw: list[dict] = await loop.run_in_executor(
            None, lambda: _finnhub_client.general_news("general", min_id=0)
        )
        cutoff = datetime.now(timezone.utc).timestamp() - 7200
        recent = [n for n in raw if n.get("datetime", 0) > cutoff]
        return recent[:30]
    except Exception as e:
        logger.error("Finnhub news fetch error: %s", e)
        return []


async def _fetch_newsapi_news() -> list[dict[str, Any]]:
    """從 NewsAPI 抓取近 2 小時的美股相關新聞（免費 100 次/天，僅排程時使用）。"""
    if not config.NEWSAPI_KEY:
        return []
    from_time = (datetime.now(timezone.utc) - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    params = {
        "q": "stock market OR earnings OR Federal Reserve OR S&P500 OR NASDAQ OR NYSE",
        "language": "en",
        "sortBy": "publishedAt",
        "from": from_time,
        "pageSize": 20,
        "apiKey": config.NEWSAPI_KEY,
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                "https://newsapi.org/v2/everything",
                params=params,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                data = await resp.json()
                articles = data.get("articles", [])
                return [
                    {
                        "id": a.get("url", ""),
                        "headline": a.get("title", ""),
                        "summary": a.get("description", ""),
                        "source": a.get("source", {}).get("name", ""),
                        "url": a.get("url", ""),
                    }
                    for a in articles
                    if a.get("title")
                ]
    except Exception as e:
        logger.error("NewsAPI fetch error: %s", e)
        return []


def _normalize_finnhub(articles: list[dict]) -> list[dict[str, Any]]:
    return [
        {
            "id": str(a.get("id", "")),
            "headline": a.get("headline", ""),
            "summary": a.get("summary", ""),
            "source": a.get("source", ""),
            "url": a.get("url", ""),
        }
        for a in articles
        if a.get("headline")
    ]


def _deduplicate(articles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    result = []
    for a in articles:
        key = a["headline"][:60].lower()
        if key not in seen:
            seen.add(key)
            result.append(a)
    return result


# ── 公開 API ──────────────────────────────────────────────────────────────────

async def fetch_market_news() -> list[dict[str, Any]]:
    """抓取全部近期市場新聞（用於指令 /news）。"""
    finnhub_raw, newsapi_raw = await asyncio.gather(
        _fetch_finnhub_news(),
        _fetch_newsapi_news(),
    )
    combined = _normalize_finnhub(finnhub_raw) + newsapi_raw
    return _deduplicate(combined)[: config.MAX_NEWS_ITEMS]


async def fetch_market_news_new_only() -> list[dict[str, Any]]:
    """只回傳尚未推播過的新聞（用於排程自動推播）。"""
    all_news = await fetch_market_news()
    sent_ids = _load_sent_ids()
    new_articles = [a for a in all_news if str(a["id"]) not in sent_ids]
    if new_articles:
        _mark_sent({str(a["id"]) for a in new_articles})
    return new_articles
