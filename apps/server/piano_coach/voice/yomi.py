"""TTS に送る文字列の読み補正と、絵文字の扱い。

字幕用のテキストは変更しない。補正は TTS に送る文字列にだけ適用する。
"""
from __future__ import annotations

import re
import unicodedata

# Irodori の感情制御に使う絵文字。TTS には渡すが、字幕からは除く。
TTS_EMOJI = "😊🤔😮💪"

# 絵文字とその修飾子（異体字セレクタ、ZWJ、肌色修飾子）。
_EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\u2705\u2728\u2764\u2B50\uFE0F\u200D]"
)

# 長い語から先に照合する（正規表現の選択肢は、並べた順に試されるため）。
# 「連弾」は先頭にあるので、「弾」の置き換えより前に処理される。
YOMI_DICT: dict[str, str] = {
    "連弾": "れんだん",
    # 弾く系
    "弾ける": "ひける",
    "弾いた": "ひいた",
    "弾こう": "ひこう",
    "弾く": "ひく",
    "弾いて": "ひいて",
    "弾き": "ひき",
    "弾け": "ひけ",
    "弾か": "ひか",
    # 楽譜・指づかい
    "小節目": "しょうせつめ",
    "小節": "しょうせつ",
    "運指": "うんし",
    "和音": "わおん",
    "右手": "みぎて",
    "左手": "ひだりて",
    "両手": "りょうて",
    "親指": "おやゆび",
    "人差し指": "ひとさしゆび",
    "中指": "なかゆび",
    "薬指": "くすりゆび",
    "小指": "こゆび",
    "BPM": "ビーピーエム",
}

_YOMI_RE = re.compile(
    "|".join(re.escape(k) for k in sorted(YOMI_DICT, key=len, reverse=True)),
    re.IGNORECASE,
)


_DIGITS = ["", "いち", "に", "さん", "よん", "ご", "ろく", "なな", "はち", "きゅう"]
_HUNDREDS = ["", "ひゃく", "にひゃく", "さんびゃく", "よんひゃく", "ごひゃく", "ろっぴゃく", "ななひゃく", "はっぴゃく", "きゅうひゃく"]


def number_to_kana(n: int) -> str:
    """0〜999 を、ひらがなの読みにする（小節番号とテンポ用）。"""
    if not 0 <= n <= 999:
        raise ValueError(n)
    if n == 0:
        return "ぜろ"
    h, rest = divmod(n, 100)
    t, o = divmod(rest, 10)
    tens = "" if t == 0 else ("じゅう" if t == 1 else _DIGITS[t] + "じゅう")
    return _HUNDREDS[h] + tens + _DIGITS[o]


# 「3小節目」「80BPM」の数字は、Irodori が確実に読めるようひらがなにする。
_NUM_BEFORE_RE = re.compile(r"([0-9０-９]{1,3})(?=\s?(?:小節|BPM))", re.IGNORECASE)


def _num_sub(m: re.Match) -> str:
    return number_to_kana(int(unicodedata.normalize("NFKC", m.group(1))))


def apply_yomi(text: str) -> str:
    """読み補正を適用する。辞書は 1 回の走査で、長い語から先に照合する（置き換えた結果は再照合しない）。"""
    text = _NUM_BEFORE_RE.sub(_num_sub, text)
    return _YOMI_RE.sub(lambda m: YOMI_DICT[m.group(0).upper() if m.group(0).isascii() else m.group(0)], text)


def strip_emoji(text: str) -> str:
    """すべての絵文字を除く（字幕用）。"""
    return _EMOJI_RE.sub("", text)


def keep_tts_emoji_only(text: str) -> str:
    """TTS に渡してよい絵文字（😊🤔😮💪）以外の絵文字を除く。"""
    return _EMOJI_RE.sub(lambda m: m.group(0) if m.group(0) in TTS_EMOJI else "", text)


def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def subtitle_text(sentence: str) -> str:
    """字幕用: 絵文字なし、読み補正なし。"""
    return normalize_space(strip_emoji(sentence))


def tts_text(sentence: str) -> str:
    """TTS に送る文字列: 読み補正あり、感情用の絵文字は残す。"""
    return normalize_space(keep_tts_emoji_only(apply_yomi(sentence)))
