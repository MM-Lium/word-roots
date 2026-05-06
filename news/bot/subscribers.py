import json
import os

import config


def _ensure_dir() -> None:
    os.makedirs(config.DATA_DIR, exist_ok=True)


def load_subscribers() -> set[int]:
    _ensure_dir()
    if os.path.exists(config.SUBSCRIBERS_FILE):
        try:
            with open(config.SUBSCRIBERS_FILE, "r", encoding="utf-8") as f:
                return set(json.load(f))
        except (json.JSONDecodeError, IOError):
            return set()
    return set()


def save_subscribers(subscribers: set[int]) -> None:
    _ensure_dir()
    with open(config.SUBSCRIBERS_FILE, "w", encoding="utf-8") as f:
        json.dump(list(subscribers), f)


def add_subscriber(chat_id: int) -> bool:
    """回傳 True 表示新增成功，False 表示已存在。"""
    subscribers = load_subscribers()
    if chat_id in subscribers:
        return False
    subscribers.add(chat_id)
    save_subscribers(subscribers)
    return True


def remove_subscriber(chat_id: int) -> bool:
    """回傳 True 表示移除成功，False 表示本來不存在。"""
    subscribers = load_subscribers()
    if chat_id not in subscribers:
        return False
    subscribers.discard(chat_id)
    save_subscribers(subscribers)
    return True
