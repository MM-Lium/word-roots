import logging
import sys

from bot.telegram_bot import create_application
import config

logging.basicConfig(
    format="%(asctime)s | %(levelname)-8s | %(name)s — %(message)s",
    level=logging.INFO,
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)


def _validate_config() -> None:
    missing = [
        name
        for name, val in [
            ("TELEGRAM_BOT_TOKEN", config.TELEGRAM_BOT_TOKEN),
            ("OPENAI_API_KEY", config.OPENAI_API_KEY),
            ("FINNHUB_API_KEY", config.FINNHUB_API_KEY),
        ]
        if not val
    ]
    if missing:
        logger.error("Missing required environment variables: %s", ", ".join(missing))
        sys.exit(1)


def main() -> None:
    _validate_config()
    logger.info("Starting US Stock News Bot…")
    app = create_application()
    app.run_polling(allowed_updates=["message"])


if __name__ == "__main__":
    main()
