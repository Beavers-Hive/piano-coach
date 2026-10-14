"""テキストのストリームを、文末（。！？!?）で 1 文ずつ区切る。"""
from __future__ import annotations

import re

TERMINATORS = "。！？!?"
# 文末記号の直後に付く文字は、同じ文に含める（「！？」「！😊」「！」」など）。
_CLOSERS = "」』）)】］]"
_EMOJI = "[\U0001F000-\U0001FAFF\u2705\u2728\u2764\u2B50\uFE0F\u200D]"
_TRAILER_RE = re.compile(f"[{re.escape(TERMINATORS + _CLOSERS)}\\s]|{_EMOJI}")


class SentenceSplitter:
    """feed() でテキストを足すと、文末までそろった文を返す。finish() で残りを返す。

    文末記号がバッファの末尾にあるときは、直後の絵文字や「？」が次のチャンクで
    続くかもしれないので、次の入力か finish() まで確定を待つ。
    空白だけの文は捨てる。改行も文の区切りとして扱う。
    """

    def __init__(self) -> None:
        self._buf = ""

    def feed(self, chunk: str) -> list[str]:
        self._buf += chunk
        return self._drain(final=False)

    def finish(self) -> list[str]:
        out = self._drain(final=True)
        rest = self._buf.strip()
        self._buf = ""
        if rest:
            out.append(rest)
        return out

    def _drain(self, final: bool) -> list[str]:
        out: list[str] = []
        while True:
            end = self._find_end()
            if end is None:
                break
            sentence, self._buf = self._buf[:end], self._buf[end:]
            if sentence.strip():
                out.append(sentence.strip())
        return out

    def _find_end(self) -> int | None:
        buf = self._buf
        for i, ch in enumerate(buf):
            if ch in TERMINATORS or ch == "\n":
                j = i + 1
                while j < len(buf) and _TRAILER_RE.match(buf[j]):
                    j += 1
                if j == len(buf):
                    return None  # 続きが来るかもしれないので待つ
                return j
        return None


def split_sentences(text: str) -> list[str]:
    s = SentenceSplitter()
    return s.feed(text) + s.finish()
