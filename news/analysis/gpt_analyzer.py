import logging
from typing import Any

from openai import AsyncOpenAI

import config

logger = logging.getLogger(__name__)

_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=config.OPENAI_API_KEY)
    return _client

# ── Prompt 模板 ───────────────────────────────────────────────────────────────

_NEWS_PROMPT = """\
你是一位專業的美股市場分析師。請分析以下新聞，並以**繁體中文**回應。

分析規則：
1. 只保留市場影響力為「高」或「中」的新聞。
2. 對每則符合條件的新聞：
   - 用 2-3 句話摘要新聞內容
   - 列出受影響的美股上市公司（附股票代碼，例如 AAPL、NVDA）
   - 對每家公司評估影響方向並說明原因：📈 利多 / 📉 利空 / ➡️ 中立
   - 標記市場重要性：🔴 高 / 🟡 中
3. 若所有新聞影響力均為「低」，請回傳空字串（不輸出任何文字）。

輸出格式使用 HTML（僅支援 <b>、<i>、<code> 標籤），每則新聞用 <b>▪</b> 隔開。

---
新聞列表：
{articles}
"""

_EARNINGS_PROMPT = """\
你是一位專業的美股財報分析師。請分析以下財報資料，並以**繁體中文**回應。

分析背景：{context}

對每家公司進行分析，包含：
1. 📊 <b>EPS</b>：實際 vs 預期（Beat ✅ / Miss ❌ / In-Line ➡️ / 待公布 ⏳）
2. 💰 <b>營收</b>：實際 vs 預期（Beat ✅ / Miss ❌ / In-Line ➡️ / 待公布 ⏳）
3. 🔑 <b>重點亮點</b>（1-2 句）
4. 📋 <b>展望指引</b>（上調 ⬆️ / 下調 ⬇️ / 維持 ➡️ / 未提供 —）
5. 🎯 <b>預期市場反應</b>（一句話）

輸出格式使用 HTML（僅支援 <b>、<i>、<code> 標籤）。

---
財報資料：
{earnings}
"""


# ── 資料格式化 ────────────────────────────────────────────────────────────────

def _fmt_articles(articles: list[dict[str, Any]]) -> str:
    lines = []
    for i, a in enumerate(articles, 1):
        lines.append(
            f"{i}. [{a.get('source', 'Unknown')}] {a.get('headline', '')}\n"
            f"   摘要：{a.get('summary', '（無）')}\n"
            f"   來源：{a.get('url', '')}"
        )
    return "\n\n".join(lines)


def _fmt_earnings(earnings: list[dict[str, Any]]) -> str:
    lines = []
    for e in earnings:
        symbol = e.get("symbol", "N/A")
        quarter = e.get("quarter", "?")
        year = e.get("year", "?")
        eps_actual = e.get("epsActual")
        eps_est = e.get("epsEstimate")
        rev_actual = e.get("revenueActual")
        rev_est = e.get("revenueEstimate")

        line = f"<b>{symbol}</b>  Q{quarter} {year}\n"

        if eps_actual is not None and eps_est is not None:
            line += f"  EPS：實際 ${eps_actual:.2f}  /  預期 ${eps_est:.2f}\n"
        elif eps_est is not None:
            line += f"  EPS 預期：${eps_est:.2f}（待公布）\n"
        else:
            line += "  EPS：資料待公布\n"

        if rev_actual is not None and rev_est is not None:
            line += f"  營收：實際 ${rev_actual/1e9:.2f}B  /  預期 ${rev_est/1e9:.2f}B"
        elif rev_est is not None:
            line += f"  營收預期：${rev_est/1e9:.2f}B（待公布）"
        else:
            line += "  營收：資料待公布"

        lines.append(line)
    return "\n\n".join(lines)


# ── GPT 呼叫 ──────────────────────────────────────────────────────────────────

async def _call_gpt(prompt: str) -> str:
    response = await _get_client().chat.completions.create(
        model=config.GPT_MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=config.GPT_MAX_TOKENS,
        temperature=0.3,
    )
    return response.choices[0].message.content.strip()


# ── 公開 API ──────────────────────────────────────────────────────────────────

async def analyze_news(articles: list[dict[str, Any]]) -> str:
    """
    用 GPT 分析新聞，回傳 HTML 格式的分析字串。
    若無重要新聞則回傳空字串。
    """
    if not articles:
        return ""
    prompt = _NEWS_PROMPT.format(articles=_fmt_articles(articles))
    try:
        result = await _call_gpt(prompt)
        if not result:
            return ""
        return "📰 <b>美股重點事件分析</b>\n\n" + result
    except Exception as e:
        logger.error("GPT news analysis error: %s", e)
        return ""


async def analyze_earnings(earnings: list[dict[str, Any]], session: str = "premarket") -> str:
    """
    用 GPT 分析財報，回傳 HTML 格式的財報摘要。
    session: 'premarket' | 'afterhours'
    """
    if not earnings:
        return ""

    if session == "premarket":
        header = "📊 <b>今日盤前財報摘要</b>（台灣時間 21:00）"
        context = "以下為今日開盤前（BMO）公布財報的公司，部分數字可能為預期值。"
    else:
        header = "🌙 <b>今日盤後財報摘要</b>（台灣時間 06:00）"
        context = "以下為今日收盤後（AMC）公布財報的公司，部分較晚公布的數字可能仍為預期值。"

    prompt = _EARNINGS_PROMPT.format(context=context, earnings=_fmt_earnings(earnings))
    try:
        result = await _call_gpt(prompt)
        if not result:
            return ""
        return header + "\n\n" + result
    except Exception as e:
        logger.error("GPT earnings analysis error: %s", e)
        return ""
