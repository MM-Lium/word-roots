import logging

from telegram.constants import ParseMode
from telegram.ext import ContextTypes

from bot.subscribers import load_subscribers
from utils.formatter import split_message

logger = logging.getLogger(__name__)


async def _broadcast(context: ContextTypes.DEFAULT_TYPE, message: str) -> None:
    """將訊息廣播給所有訂閱者。"""
    subscribers = load_subscribers()
    if not subscribers:
        logger.info("No subscribers to broadcast to.")
        return
    for chat_id in subscribers:
        try:
            for chunk in split_message(message):
                await context.bot.send_message(
                    chat_id, chunk, parse_mode=ParseMode.HTML
                )
        except Exception as e:
            logger.error("Failed to send message to %s: %s", chat_id, e)


async def job_premarket_digest(context: ContextTypes.DEFAULT_TYPE) -> None:
    """每日 13:00 UTC 執行：推播今日盤前財報摘要。"""
    from fetchers.earnings_fetcher import fetch_premarket_earnings
    from analysis.gpt_analyzer import analyze_earnings

    logger.info("Running pre-market digest job")
    try:
        earnings = await fetch_premarket_earnings()
        if not earnings:
            logger.info("No pre-market earnings today.")
            return
        analysis = await analyze_earnings(earnings, session="premarket")
        if analysis:
            await _broadcast(context, analysis)
    except Exception as e:
        logger.error("Pre-market digest job failed: %s", e)


async def job_afterhours_digest(context: ContextTypes.DEFAULT_TYPE) -> None:
    """每日 22:00 UTC 執行：推播今日盤後財報摘要。"""
    from fetchers.earnings_fetcher import fetch_afterhours_earnings
    from analysis.gpt_analyzer import analyze_earnings

    logger.info("Running after-hours digest job")
    try:
        earnings = await fetch_afterhours_earnings()
        if not earnings:
            logger.info("No after-hours earnings today.")
            return
        analysis = await analyze_earnings(earnings, session="afterhours")
        if analysis:
            await _broadcast(context, analysis)
    except Exception as e:
        logger.error("After-hours digest job failed: %s", e)


async def job_news_check(context: ContextTypes.DEFAULT_TYPE) -> None:
    """定時執行：偵測新重點新聞並自動推播。"""
    from fetchers.news_fetcher import fetch_market_news_new_only
    from analysis.gpt_analyzer import analyze_news

    logger.info("Running news check job")
    try:
        articles = await fetch_market_news_new_only()
        if not articles:
            logger.info("No new articles since last check.")
            return
        analysis = await analyze_news(articles)
        if analysis:
            await _broadcast(context, analysis)
    except Exception as e:
        logger.error("News check job failed: %s", e)
