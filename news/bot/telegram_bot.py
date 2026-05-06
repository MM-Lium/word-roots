import logging
from datetime import time as dt_time

from telegram import Update
from telegram.constants import ParseMode
from telegram.ext import Application, CommandHandler, ContextTypes

import config
from bot.subscribers import add_subscriber, remove_subscriber
from utils.formatter import split_message

logger = logging.getLogger(__name__)


# ── 指令處理器 ────────────────────────────────────────────────────────────────

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id
    if add_subscriber(chat_id):
        await update.message.reply_text(
            "✅ <b>訂閱成功！</b>\n\n"
            "您將收到以下自動推播：\n"
            "• 📰 美股重點事件分析（每小時偵測）\n"
            "• 📊 盤前財報摘要（台灣時間 21:00）\n"
            "• 🌙 盤後財報摘要（台灣時間 06:00）\n\n"
            "輸入 /help 查看所有指令",
            parse_mode=ParseMode.HTML,
        )
    else:
        await update.message.reply_text("您已訂閱，將持續收到推播通知。\n輸入 /help 查看所有指令。")


async def stop_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id
    if remove_subscriber(chat_id):
        await update.message.reply_text("❌ 已取消訂閱，不再推播通知。")
    else:
        await update.message.reply_text("您尚未訂閱。輸入 /start 可開始訂閱。")


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(
        "<b>📖 指令列表</b>\n\n"
        "/start — 訂閱自動推播\n"
        "/stop — 取消訂閱\n"
        "/news — 立即取得最新美股重點事件分析\n"
        "/premarket — 立即取得今日盤前財報摘要\n"
        "/afterhours — 立即取得今日盤後財報摘要\n"
        "/help — 顯示此說明",
        parse_mode=ParseMode.HTML,
    )


async def news_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text("🔍 正在抓取最新新聞並分析中，請稍候…")
    await _deliver_news(context.bot, update.effective_chat.id)


async def premarket_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text("📊 正在整理盤前財報，請稍候…")
    await _deliver_premarket(context.bot, update.effective_chat.id)


async def afterhours_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text("🌙 正在整理盤後財報，請稍候…")
    await _deliver_afterhours(context.bot, update.effective_chat.id)


# ── 內部傳送函式 ──────────────────────────────────────────────────────────────

async def _deliver_news(bot, chat_id: int) -> None:
    from fetchers.news_fetcher import fetch_market_news
    from analysis.gpt_analyzer import analyze_news

    try:
        articles = await fetch_market_news()
        if not articles:
            await bot.send_message(chat_id, "目前無最新重點新聞。")
            return
        analysis = await analyze_news(articles)
        if not analysis:
            await bot.send_message(chat_id, "目前新聞市場影響力偏低，暫無值得推播的事件。")
            return
        for chunk in split_message(analysis):
            await bot.send_message(chat_id, chunk, parse_mode=ParseMode.HTML)
    except Exception as e:
        logger.error("_deliver_news error: %s", e)
        await bot.send_message(chat_id, "⚠️ 取得新聞時發生錯誤，請稍後再試。")


async def _deliver_premarket(bot, chat_id: int) -> None:
    from fetchers.earnings_fetcher import fetch_premarket_earnings
    from analysis.gpt_analyzer import analyze_earnings

    try:
        earnings = await fetch_premarket_earnings()
        if not earnings:
            await bot.send_message(chat_id, "今日無盤前財報資料。")
            return
        analysis = await analyze_earnings(earnings, session="premarket")
        for chunk in split_message(analysis):
            await bot.send_message(chat_id, chunk, parse_mode=ParseMode.HTML)
    except Exception as e:
        logger.error("_deliver_premarket error: %s", e)
        await bot.send_message(chat_id, "⚠️ 取得盤前財報時發生錯誤，請稍後再試。")


async def _deliver_afterhours(bot, chat_id: int) -> None:
    from fetchers.earnings_fetcher import fetch_afterhours_earnings
    from analysis.gpt_analyzer import analyze_earnings

    try:
        earnings = await fetch_afterhours_earnings()
        if not earnings:
            await bot.send_message(chat_id, "今日無盤後財報資料。")
            return
        analysis = await analyze_earnings(earnings, session="afterhours")
        for chunk in split_message(analysis):
            await bot.send_message(chat_id, chunk, parse_mode=ParseMode.HTML)
    except Exception as e:
        logger.error("_deliver_afterhours error: %s", e)
        await bot.send_message(chat_id, "⚠️ 取得盤後財報時發生錯誤，請稍後再試。")


# ── Application 工廠 ──────────────────────────────────────────────────────────

def create_application() -> Application:
    from scheduler.tasks import (
        job_premarket_digest,
        job_afterhours_digest,
        job_news_check,
    )

    app = Application.builder().token(config.TELEGRAM_BOT_TOKEN).build()

    # 指令路由
    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("stop", stop_command))
    app.add_handler(CommandHandler("help", help_command))
    app.add_handler(CommandHandler("news", news_command))
    app.add_handler(CommandHandler("premarket", premarket_command))
    app.add_handler(CommandHandler("afterhours", afterhours_command))

    # 定時排程
    jq = app.job_queue

    # 盤前摘要（每天 13:00 UTC = 台灣 21:00 = 美東 09:00）
    jq.run_daily(
        job_premarket_digest,
        time=dt_time(hour=config.PREMARKET_HOUR_UTC, minute=config.PREMARKET_MINUTE_UTC),
        name="premarket_digest",
    )

    # 盤後摘要（每天 22:00 UTC = 台灣 06:00 = 美東 18:00）
    jq.run_daily(
        job_afterhours_digest,
        time=dt_time(hour=config.AFTERHOURS_HOUR_UTC, minute=config.AFTERHOURS_MINUTE_UTC),
        name="afterhours_digest",
    )

    # 新聞自動偵測（首次延遲 60 秒後，每隔 NEWS_CHECK_INTERVAL 秒執行一次）
    jq.run_repeating(
        job_news_check,
        interval=config.NEWS_CHECK_INTERVAL,
        first=60,
        name="news_check",
    )

    return app
