"""voice モジュールのテスト（TTS サーバーは httpx.MockTransport で差し替える）。

実行: uv run --with httpx --with pytest --with pytest-asyncio python -m pytest apps/server/tests/test_voice*.py
"""
import asyncio
import hashlib
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from piano_coach.voice import VoiceClip, VoiceService  # noqa: E402
from piano_coach.voice.service import WARMUP_PHRASES, cache_key  # noqa: E402
from piano_coach.voice.splitter import SentenceSplitter, split_sentences  # noqa: E402
from piano_coach.voice.yomi import apply_yomi, number_to_kana, subtitle_text, tts_text  # noqa: E402

WAV = b"RIFF" + b"\x00" * 40


# ---- 文の分割 ---------------------------------------------------------

def test_split_basic():
    assert split_sentences("ナイス！いいね。次いこう？はい") == ["ナイス！", "いいね。", "次いこう？", "はい"]


def test_split_ascii_terminators_and_runs():
    assert split_sentences("Great!? ok! next") == ["Great!?", "ok!", "next"]


def test_split_keeps_trailing_emoji_and_quote_with_sentence():
    assert split_sentences("いいね！😊次は？」おわり") == ["いいね！😊", "次は？」", "おわり"]


def test_split_drops_blank_sentences():
    assert split_sentences("  \n 。 ") == ["。"]  # 句点だけは文として残る（字幕側で捨てる）
    assert split_sentences("   \n  ") == []


def test_split_streaming_holds_terminator_until_next_chunk():
    s = SentenceSplitter()
    assert s.feed("いいね！") == []  # 直後に絵文字が続くかもしれない
    assert s.feed("😊つぎ") == ["いいね！😊"]
    assert s.feed("は右手。") == []
    assert s.finish() == ["つぎは右手。"]


def test_split_finish_flushes_remainder_without_terminator():
    s = SentenceSplitter()
    assert s.feed("もう一回") == []
    assert s.finish() == ["もう一回"]


def test_split_newline_is_boundary():
    assert split_sentences("一行目\n二行目") == ["一行目", "二行目"]


# ---- 読み補正 ---------------------------------------------------------

@pytest.mark.parametrize(
    "src,dst",
    [
        ("弾く", "ひく"), ("弾いて", "ひいて"), ("弾き", "ひき"), ("弾け", "ひけ"), ("弾こう", "ひこう"),
        ("弾か", "ひか"), ("弾いた", "ひいた"), ("弾ける", "ひける"),
        ("連弾", "れんだん"), ("連弾を弾く", "れんだんをひく"),
        ("小節", "しょうせつ"), ("運指", "うんし"), ("和音", "わおん"), ("右手", "みぎて"), ("左手", "ひだりて"),
        ("両手", "りょうて"), ("親指", "おやゆび"), ("人差し指", "ひとさしゆび"), ("中指", "なかゆび"),
        ("薬指", "くすりゆび"), ("小指", "こゆび"), ("BPM", "ビーピーエム"), ("メトロノーム", "メトロノーム"),
    ],
)
def test_yomi_dictionary(src, dst):
    assert apply_yomi(src) == dst


def test_yomi_longest_first_and_no_rematch():
    # 「弾ける」は「弾け」+「る」ではなく「ひける」。「人差し指」は「指」に分解されない
    assert apply_yomi("弾けるよ") == "ひけるよ"
    assert apply_yomi("人差し指") == "ひとさしゆび"
    # 「弾」だけが単独で残る語は置き換えない
    assert apply_yomi("弾力") == "弾力"


def test_yomi_measure_numbers():
    assert apply_yomi("3小節目") == "さんしょうせつめ"
    assert apply_yomi("12小節") == "じゅうにしょうせつ"
    assert apply_yomi("１６小節目") == "じゅうろくしょうせつめ"
    assert apply_yomi("80BPM") == "はちじゅうビーピーエム"
    assert apply_yomi("80 bpm") == "はちじゅう ビーピーエム"
    # 小節に続かない数字はそのまま
    assert apply_yomi("3回") == "3回"


def test_number_to_kana():
    assert [number_to_kana(n) for n in (1, 10, 11, 20, 100, 300, 600, 800, 999)] == [
        "いち", "じゅう", "じゅういち", "にじゅう", "ひゃく", "さんびゃく", "ろっぴゃく", "はっぴゃく", "きゅうひゃくきゅうじゅうきゅう",
    ]


def test_subtitle_unchanged_but_emoji_removed():
    src = "いいね😊、3小節目を弾いてみよう💪"
    assert subtitle_text(src) == "いいね、3小節目を弾いてみよう"


def test_tts_text_keeps_allowed_emoji_drops_others():
    assert tts_text("いいね😊🤔😮💪🎉✨") == "いいね😊🤔😮💪"
    assert tts_text("右手で弾いて😊") == "みぎてでひいて😊"


# ---- キャッシュのキー --------------------------------------------------

def test_cache_key_is_sha256_prefix_of_text_and_seed():
    k = cache_key("ひいて", 1234)
    assert len(k) == 16 and k == hashlib.sha256("ひいて\n1234".encode()).hexdigest()[:16]
    assert cache_key("ひいて", 1234) == k
    assert cache_key("ひいて", 1) != k
    assert cache_key("ひく", 1234) != k


# ---- VoiceService ------------------------------------------------------

class FakeTTS:
    def __init__(self, delay=0.0, fail=None):
        self.calls: list[dict] = []
        self.delay = delay
        self.fail = fail

    async def handler(self, request: httpx.Request) -> httpx.Response:
        import json
        self.calls.append(json.loads(request.content))
        if self.fail:
            raise self.fail
        if self.delay:
            await asyncio.sleep(self.delay)
        return httpx.Response(200, content=WAV, headers={"content-type": "audio/wav"})


def make_service(tmp_path, fake: FakeTTS, **kw) -> VoiceService:
    client = httpx.AsyncClient(transport=httpx.MockTransport(fake.handler))
    return VoiceService(tts_url="http://tts", cache_dir=tmp_path, client=client, **kw)


async def collect(agen) -> list[VoiceClip]:
    return [c async for c in agen]


@pytest.mark.asyncio
async def test_speak_text_sends_corrected_text_but_subtitle_is_original(tmp_path):
    fake = FakeTTS()
    v = make_service(tmp_path, fake)
    clips = await collect(v.speak_text("u1", "次は右手だけで弾いてみましょう！"))
    assert len(clips) == 1
    c = clips[0]
    assert c.text == "次は右手だけで弾いてみましょう！"
    assert c.last is True and c.seq == 0 and c.utterance_id == "u1"
    assert fake.calls == [{"text": "次はみぎてだけでひいてみましょう！", "seed": 1234}]
    key = cache_key("次はみぎてだけでひいてみましょう！", 1234)
    assert c.url == f"/api/tts/{key}.wav"
    assert (tmp_path / f"{key}.wav").read_bytes() == WAV


@pytest.mark.asyncio
async def test_speak_stream_seq_last_and_order(tmp_path):
    fake = FakeTTS()
    v = make_service(tmp_path, fake)

    async def stream():
        for chunk in ["いいね😊", "！つぎは", "ゆっくり。もう", "一回"]:
            yield chunk

    clips = await collect(v.speak("u2", stream()))
    assert [c.text for c in clips] == ["いいね！", "つぎはゆっくり。", "もう一回"]
    assert [c.seq for c in clips] == [0, 1, 2]
    assert [c.last for c in clips] == [False, False, True]
    assert all(c.url for c in clips)
    assert fake.calls[0]["text"] == "いいね😊！"  # TTS には感情の絵文字を渡す


@pytest.mark.asyncio
async def test_cache_hit_skips_synthesis(tmp_path):
    fake = FakeTTS()
    v = make_service(tmp_path, fake)
    a = await collect(v.speak_text("a", "ナイス！"))
    b = await collect(v.speak_text("b", "ナイス！"))
    assert len(fake.calls) == 1
    assert a[0].url == b[0].url


@pytest.mark.asyncio
async def test_blank_input_yields_nothing(tmp_path):
    fake = FakeTTS()
    v = make_service(tmp_path, fake)
    assert await collect(v.speak_text("u", "  😊 \n ")) == []
    assert fake.calls == []


@pytest.mark.asyncio
async def test_fallback_when_tts_unreachable(tmp_path):
    fake = FakeTTS(fail=httpx.ConnectError("refused"))
    v = make_service(tmp_path, fake)
    clips = await collect(v.speak_text("u", "ナイス！もう一回。"))
    assert [(c.url, c.text, c.last) for c in clips] == [(None, "ナイス！", False), (None, "もう一回。", True)]
    assert list(tmp_path.iterdir()) == []


@pytest.mark.asyncio
async def test_fallback_on_timeout_only_for_that_sentence(tmp_path):
    class SlowFirst(FakeTTS):
        async def handler(self, request):
            import json
            if "ゆっくり" in json.loads(request.content)["text"]:
                await asyncio.sleep(1)
            return await super().handler(request)

    fake = SlowFirst()
    v = make_service(tmp_path, fake, timeout_s=0.1)
    clips = await collect(v.speak_text("u", "ゆっくりやろう。ナイス！"))
    assert clips[0].url is None and clips[0].text == "ゆっくりやろう。"
    assert clips[1].url is not None and clips[1].last is True


@pytest.mark.asyncio
async def test_fallback_on_http_error(tmp_path):
    async def handler(request):
        return httpx.Response(500)

    v = VoiceService(tts_url="http://tts", cache_dir=tmp_path,
                     client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    clips = await collect(v.speak_text("u", "ナイス！"))
    assert clips[0].url is None


@pytest.mark.asyncio
async def test_synthesis_overlaps_with_receiving(tmp_path):
    """前の文を合成している間も、テキストの受信は止まらない。"""
    fake = FakeTTS(delay=0.2)
    v = make_service(tmp_path, fake)
    received: list[str] = []

    async def stream():
        for s in ["一つ目。", "二つ目。", "三つ目。", "おわり"]:
            received.append(s)
            yield s

    gen = v.speak("u", stream())
    first = await gen.__anext__()  # 1 文目のクリップが出た時点で
    assert first.text == "一つ目。"
    assert len(received) == 4  # ストリームはもう受信し終わっている
    rest = [c async for c in gen]
    assert [c.last for c in [first, *rest]] == [False, False, False, True]


@pytest.mark.asyncio
async def test_first_clip_is_not_delayed_by_next_synthesis(tmp_path):
    fake = FakeTTS(delay=0.3)
    v = make_service(tmp_path, fake)
    loop = asyncio.get_running_loop()
    t0 = loop.time()
    times = []
    async for _ in v.speak_text("u", "一つ目。二つ目。"):
        times.append(loop.time() - t0)
    assert times[0] < 0.55  # 1 文目の合成(0.3s)だけで出る。2 文目(+0.3s)を待たない


@pytest.mark.asyncio
async def test_cancel_drops_unsynthesized_sentences(tmp_path):
    fake = FakeTTS(delay=0.1)
    v = make_service(tmp_path, fake)

    async def stream():
        for s in ["一つ目。", "二つ目。", "三つ目。"]:
            yield s

    out = []
    async for c in v.speak("old", stream()):
        out.append(c)
        v.cancel("old")
    assert len(out) <= 1
    assert len(fake.calls) <= 2  # 3 文目は合成されない
    # 他の発話には影響しない
    assert len(await collect(v.speak_text("new", "ナイス！"))) == 1


@pytest.mark.asyncio
async def test_warmup_phrases_cached(tmp_path):
    fake = FakeTTS()
    v = make_service(tmp_path, fake)
    await v.warmup_phrases()
    assert len(fake.calls) == len(WARMUP_PHRASES) == 6
    await v.warmup_phrases()
    assert len(fake.calls) == 6
    clips = await collect(v.speak_text("u", "ナイス！"))
    assert clips[0].url is not None and len(fake.calls) == 6


@pytest.mark.asyncio
async def test_warmup_survives_tts_down(tmp_path):
    v = make_service(tmp_path, FakeTTS(fail=httpx.ConnectError("x")))
    await v.warmup_phrases()  # 例外を出さない
