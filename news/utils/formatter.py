_MAX_LEN = 4000  # Telegram 上限 4096，保留緩衝


def split_message(text: str) -> list[str]:
    """將過長訊息按換行切割，以符合 Telegram 4096 字元上限。"""
    if not text:
        return []
    if len(text) <= _MAX_LEN:
        return [text]

    chunks: list[str] = []
    while len(text) > _MAX_LEN:
        split_pos = text.rfind("\n", 0, _MAX_LEN)
        if split_pos == -1:
            split_pos = _MAX_LEN
        chunks.append(text[:split_pos])
        text = text[split_pos:].lstrip("\n")
    if text:
        chunks.append(text)
    return chunks
