"""
Telegram 推播服務
使用 Bot API 傳送訊息至指定 Chat
設定方式：在 .env 加入 TELEGRAM_BOT_TOKEN 與 TELEGRAM_CHAT_ID
"""
import os
import httpx
import logging

logger = logging.getLogger(__name__)

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
CHAT_ID   = os.environ.get("TELEGRAM_CHAT_ID", "")


async def send_message(text: str) -> bool:
    """傳送訊息，回傳是否成功。若未設定 Token 則靜默略過。"""
    if not BOT_TOKEN or not CHAT_ID:
        logger.debug("Telegram 未設定，跳過推播")
        return False
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json={
                "chat_id": CHAT_ID,
                "text": text,
                "parse_mode": "HTML",
            })
            if resp.status_code == 200:
                return True
            logger.warning(f"Telegram 推播失敗: {resp.status_code} {resp.text}")
    except Exception as e:
        logger.warning(f"Telegram 推播例外: {e}")
    return False
