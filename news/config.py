import os
from dotenv import load_dotenv

load_dotenv()

# ── API 金鑰 ──────────────────────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN: str = os.getenv("TELEGRAM_BOT_TOKEN", "")
OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
FINNHUB_API_KEY: str = os.getenv("FINNHUB_API_KEY", "")
NEWSAPI_KEY: str = os.getenv("NEWSAPI_KEY", "")

# ── GPT 設定 ─────────────────────────────────────────────────────────────────
GPT_MODEL: str = os.getenv("GPT_MODEL", "gpt-4o-mini")
GPT_MAX_TOKENS: int = 2500

# ── 排程時間（UTC）────────────────────────────────────────────────────────────
# 盤前摘要：13:00 UTC = 台灣 21:00 = 美東 09:00
PREMARKET_HOUR_UTC: int = int(os.getenv("PREMARKET_HOUR_UTC", "13"))
PREMARKET_MINUTE_UTC: int = int(os.getenv("PREMARKET_MINUTE_UTC", "0"))

# 盤後摘要：22:00 UTC = 台灣 06:00 = 美東 18:00
AFTERHOURS_HOUR_UTC: int = int(os.getenv("AFTERHOURS_HOUR_UTC", "22"))
AFTERHOURS_MINUTE_UTC: int = int(os.getenv("AFTERHOURS_MINUTE_UTC", "0"))

# 新聞自動偵測間隔（秒）
NEWS_CHECK_INTERVAL: int = int(os.getenv("NEWS_CHECK_INTERVAL", "60")) * 60

# ── 資料存放路徑 ──────────────────────────────────────────────────────────────
BASE_DIR: str = os.path.dirname(os.path.abspath(__file__))
DATA_DIR: str = os.path.join(BASE_DIR, "data")
SUBSCRIBERS_FILE: str = os.path.join(DATA_DIR, "subscribers.json")
SENT_NEWS_FILE: str = os.path.join(DATA_DIR, "sent_news.json")

# ── 推播上限 ──────────────────────────────────────────────────────────────────
MAX_NEWS_ITEMS: int = 5       # 每次推播最多幾則新聞
MAX_EARNINGS_ITEMS: int = 20  # 每次財報摘要最多幾家
