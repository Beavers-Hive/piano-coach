"""先生の声の A/B 比較。同じ 3 文を、条件を変えて合成し、客観指標つきで記録する。

使い方（モデルは 1 回だけ読み込む。本番サーバー 127.0.0.1:8790 は止めない）:
  cd vendor/Irodori-TTS && HF_HUB_DISABLE_IMPLICIT_TOKEN=1 uv run --no-sync python ../../spikes/irodori_ab.py \
      --stage 1                # 条件セット（下の STAGES）
      [--only name1,name2]     # 条件名で絞る
      [--conds-file FILE]      # 追加条件（STAGE dict を持つ python）
      [--analyze]              # 合成せず客観指標だけ計算
      [--checkpoint Aratako/Irodori-TTS-v4.1-Small-MF]

出力: spikes/tts_out/ab/<cond>.wav（3 文を 0.6 秒の間隔でつないだもの）、ab/parts/<cond>_<i>.wav、ab/results.json
"""
import argparse, json, re, sys, time
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "vendor" / "Irodori-TTS"))

from irodori_tts.inference_runtime import (InferenceRuntime, RuntimeKey, SamplingRequest,
                                           download_hf_checkpoint, save_wav)

OUT = Path(__file__).resolve().parent / "tts_out" / "ab"

CAP0 = "明るく優しい20代女性のピアノの先生。落ち着いたテンポで、はきはきと話す。"
CAP1 = "やわらかく自然な抑揚で、ゆっくり語りかけるように話す若い女性の先生。親しみやすい口調。"
CAP2 = "落ち着いた、近い距離感の若い女性。友達に話しかけるように、温かく自然な抑揚で話す。"
CAP3 = "優しくて親しみやすい女性のピアノの先生。生徒に寄り添って、感情をこめて、ゆっくり丁寧に話す。"
CAP4 = "やわらかく優しい女性の声。一語一語はっきりと、でも堅くならず、会話するように自然に話す。"

# 文（digits=算用数字のまま / kana=読みをひらがなにした版）と、モーラ数を数えるための読み
SENT = {
    "digits": [
        "メヌエットか、すてきな曲だね😊。まずどれくらいピアノをひいたことがあるか、おしえてね。",
        "音の流れがとても自然になってきたね😊。3しょうせつめで少しあわてちゃったから、そこだけゆっくりひいてみよう。",
        "次は右手で、1から4しょうせつめを、ゆっくりひいてみよう。",
    ],
    "kana": [
        "メヌエットか、すてきな曲だね😊。まずどれくらいピアノをひいたことがあるか、おしえてね。",
        "音の流れがとても自然になってきたね😊。さんしょうせつめで少しあわてちゃったから、そこだけゆっくりひいてみよう。",
        "次は右手で、いちからよんしょうせつめを、ゆっくりひいてみよう。",
    ],
}
SENT["ref"] = [  # 参照音声づくり用（評価文とは別の文）
    "こんにちは、ピアノの先生です😊。今日も楽しく練習していきましょう。",
    "ゆっくりで大丈夫だよ。まずは右手から、いっしょにやってみよう。",
    "とてもいい音だね😊。その調子で、もう一回ひいてみようか。",
]
READING_REF = [
    "こんにちは、ぴあののせんせいです。きょうもたのしくれんしゅうしていきましょう。",
    "ゆっくりでだいじょうぶだよ。まずはみぎてから、いっしょにやってみよう。",
    "とてもいいおとだね。そのちょうしで、もういちどひいてみようか。",
]
READING = [  # モーラ数カウント用（ひらがな）
    "めぬえっとか、すてきなきょくだね。まずどれくらいぴあのをひいたことがあるか、おしえてね。",
    "おとのながれがとてもしぜんになってきたね。さんしょうせつめですこしあわてちゃったから、そこだけゆっくりひいてみよう。",
    "つぎはみぎてで、いちからよんしょうせつめを、ゆっくりひいてみよう。",
]


def count_mora(s: str) -> int:
    n = 0
    for ch in s:
        if ch in "ぁぃぅぇぉゃゅょゎ":
            continue
        if re.match(r"[ぁ-ゖー]", ch):
            n += 1
    return n


MORAS = [count_mora(r) for r in READING]
MORAS_REF = [count_mora(r) for r in READING_REF]


def transform_text(t: str, emoji: str) -> str:
    """emoji: 'keep'（そのまま）/ 'none'（除去）/ 任意の絵文字（😊 を置換）"""
    if emoji == "keep":
        return t
    if emoji == "none":
        return t.replace("😊", "")
    return t.replace("😊", emoji)


def C(**kw):
    base = dict(caption=CAP0, steps=None, emoji="keep", nums="digits", dscale=1.0, seed=1234, ref=None, no_ref=True,
                extra={})
    base.update(kw)
    return base


STAGES = {
    # 1: 基準とステップ数・絵文字・数字・キャプション
    1: {
        "base": C(),
        "steps2": C(steps=2), "steps8": C(steps=8), "steps16": C(steps=16), "steps32": C(steps=32),
        "emoji_none": C(emoji="none"),
        "emoji_gentle": C(emoji="🫶"),
        "emoji_gentle2": C(emoji="🫶😊"),
        "nums_kana": C(nums="kana"),
        "cap_none": C(caption=None),
        "cap1": C(caption=CAP1), "cap2": C(caption=CAP2), "cap3": C(caption=CAP3), "cap4": C(caption=CAP4),
        "dscale110": C(dscale=1.1), "dscale120": C(dscale=1.2),
        "mf_sway_check": C(extra=dict(t_schedule_mode="sway", sway_coeff=-1.0)),
    },
}


def metrics(wav: np.ndarray, sr: int):
    import librosa
    x = wav.astype(np.float32)
    peak = float(np.max(np.abs(x)))
    rms = float(np.sqrt(np.mean(x ** 2)) + 1e-12)
    clip = int(np.sum(np.abs(x) >= 0.999))
    # 無音区間: ピーク -45dB 以下
    thr = peak * 10 ** (-45 / 20)
    idx = np.where(np.abs(x) > thr)[0]
    lead = float(idx[0] / sr) if len(idx) else 0.0
    trail = float((len(x) - 1 - idx[-1]) / sr) if len(idx) else 0.0
    # 短時間 RMS のばらつき（有声部のみ）
    hop = int(sr * 0.02)
    fr = np.array([np.sqrt(np.mean(x[i:i + hop] ** 2)) for i in range(0, len(x) - hop, hop)])
    db = 20 * np.log10(fr + 1e-9)
    speech = db[db > (20 * np.log10(peak) - 35)]
    loud_std = float(np.std(speech)) if len(speech) else 0.0
    # F0
    y = librosa.resample(x, orig_sr=sr, target_sr=16000)
    f0, vflag, _ = librosa.pyin(y, fmin=70, fmax=500, sr=16000, frame_length=1024)
    v = f0[~np.isnan(f0)]
    if len(v) > 5:
        semi = 12 * np.log2(v / np.median(v))
        f0_med = float(np.median(v)); f0_std = float(np.std(semi))
        f0_rng = float(np.percentile(semi, 95) - np.percentile(semi, 5))
    else:
        f0_med = f0_std = f0_rng = 0.0
    voiced = float(np.mean(~np.isnan(f0)))
    # HNR（自己相関法）: 有声フレームの中央値。高いほど雑音が少なく澄んだ声（低いとザラつき・機械っぽさの手がかり）
    fl = int(0.04 * sr); hp = int(0.02 * sr); hn = []
    lo, hi = int(sr / 400), int(sr / 75)
    for i in range(0, len(x) - fl, hp):
        fr = x[i:i + fl] * np.hanning(fl)
        if np.sqrt(np.mean(fr ** 2)) < peak * 10 ** (-35 / 20) * 0.5:
            continue
        ac = np.correlate(fr, fr, "full")[fl - 1:]
        if ac[0] <= 0:
            continue
        r = ac[lo:hi].max() / ac[0]
        if r > 0.5:  # 有声とみなす
            hn.append(10 * np.log10(min(r, 0.999) / (1 - min(r, 0.999))))
    hnr = float(np.median(hn)) if hn else 0.0
    # 発話区間の中の長い無音（ポーズ）の数: 0.25s 超
    active = np.abs(x) > thr
    pauses = 0; run = 0
    first, last = (idx[0], idx[-1]) if len(idx) else (0, 0)
    for a in active[first:last]:
        if not a:
            run += 1
        else:
            if run > 0.25 * sr: pauses += 1
            run = 0
    return dict(peak_db=round(20 * np.log10(peak + 1e-9), 1), rms_db=round(20 * np.log10(rms), 1), clip=clip,
                lead=round(lead, 2), trail=round(trail, 2), loud_std=round(loud_std, 1),
                f0_med=round(f0_med, 0), f0_std=round(f0_std, 2), f0_rng=round(f0_rng, 1),
                voiced=round(voiced, 2), pauses=pauses, hnr=round(hnr, 1))


def analyze(results, resf):
    # torch(MPS) と同じプロセスで librosa.pyin を呼ぶと止まるので、合成とは別プロセスで解析する
    for name, row in results.items():
        for i, sent in enumerate(row["sents"]):
            if "hnr" in sent:
                continue
            w, sr = sf.read(OUT / "parts" / f"{name}_{i}.wav", dtype="float32")
            m = metrics(w, sr)
            speech_dur = max(len(w) / sr - m["lead"] - m["trail"], 0.1)
            sent.update(m); sent["mora_s"] = round((MORAS_REF if row["cond"].get("nums") == "ref" else MORAS)[i] / speech_dur, 2)
        resf.write_text(json.dumps(results, ensure_ascii=False, indent=1))
        print("analyzed", name, flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default="Aratako/Irodori-TTS-v4.1-Small-MF")
    ap.add_argument("--stage", type=int, default=1)
    ap.add_argument("--only", default=None)
    ap.add_argument("--device", default="mps")
    ap.add_argument("--results", default=str(OUT / "results.json"))
    ap.add_argument("--analyze", action="store_true", help="モデルを読み込まず、parts/*.wav の客観指標を results.json に追記する")
    ap.add_argument("--conds-file", default=None, help="追加条件を定義した python ファイル（STAGE という dict を持つ）")
    a = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True); (OUT / "parts").mkdir(exist_ok=True)
    conds = dict(STAGES.get(a.stage, {}))
    if a.conds_file:
        ns = {"C": C, "CAP0": CAP0, "CAP1": CAP1, "CAP2": CAP2, "CAP3": CAP3, "CAP4": CAP4, "OUT": OUT}
        exec(Path(a.conds_file).read_text(), ns)
        conds = ns["STAGE"]
    if a.only:
        conds = {k: v for k, v in conds.items() if k in a.only.split(",")}

    resf = Path(a.results)
    results = json.loads(resf.read_text()) if resf.exists() else {}

    if a.analyze:
        analyze(results, resf)
        return

    t = time.perf_counter()
    ckpt = download_hf_checkpoint(a.checkpoint) if not Path(a.checkpoint).exists() else a.checkpoint
    rt = InferenceRuntime.from_key(RuntimeKey(checkpoint=ckpt, model_device=a.device, model_precision="fp32",
                                              codec_device=a.device))
    print(f"load {time.perf_counter() - t:.1f}s", flush=True)

    ref_cache = {}

    def ref_latent_path(wavs):
        """wav のリスト -> 連結した latent を 1 回だけ計算して .pt に保存（本番ではこれで毎回の参照準備 0.35 秒を省く）"""
        import torch
        from irodori_tts.inference_runtime import _load_audio
        key = "_".join(Path(w).stem for w in wavs)
        if key not in ref_cache:
            t0 = time.perf_counter(); pieces = []
            for w in wavs:
                wav, sr = _load_audio(w)
                pieces.append(rt.codec.encode_waveform(wav.unsqueeze(0), sample_rate=int(sr), normalize_db=-16.0,
                                                       ensure_max=True).cpu())
            lat = torch.cat(pieces, dim=1)[0]
            (OUT / "refs").mkdir(exist_ok=True)
            path = OUT / "refs" / f"{key}.pt"
            torch.save(lat, path)
            print(f"  ref latent {key}: {tuple(lat.shape)} in {time.perf_counter() - t0:.2f}s", flush=True)
            ref_cache[key] = str(path)
        return ref_cache[key]

    def synth(text, c):
        kw = dict(text=text, caption=c["caption"], no_ref=c["ref"] is None,
                  ref_latent=ref_latent_path(c["ref"]) if c["ref"] else None,
                  num_steps=c["steps"], seed=c["seed"], duration_scale=c["dscale"])
        kw.update(c["extra"])
        t0 = time.perf_counter(); r = rt.synthesize(SamplingRequest(**kw)); dt = time.perf_counter() - t0
        return r, dt

    synth("ウォームアップです。", C())
    model_tag = a.checkpoint.split("/")[-1]
    for name, c in conds.items():
        texts = [transform_text(s, c["emoji"]) for s in SENT[c["nums"]]]
        row = dict(cond={k: v for k, v in c.items() if k != "extra"}, extra=c["extra"], model=model_tag, sents=[])
        parts = []; sr = None
        for i, tx in enumerate(texts):
            r, dt = synth(tx, c)
            sr = r.sample_rate
            w = r.audio.detach().cpu().float().numpy().reshape(-1)
            sf.write(OUT / "parts" / f"{name}_{i}.wav", w, sr)
            dur = len(w) / sr
            m = dict(gen=round(dt, 2), dur=round(dur, 2), text=tx)
            row["sents"].append(m); parts.append(w)
            print(f"  [{name}:{i}] gen={dt:.2f}s dur={dur:.2f}s", flush=True)
        gap = np.zeros(int(0.6 * sr), dtype=np.float32)
        cat = np.concatenate([parts[0], gap, parts[1], gap, parts[2]])
        sf.write(OUT / f"{name}.wav", cat, sr)
        results[name] = row
        resf.write_text(json.dumps(results, ensure_ascii=False, indent=1))
        print(f"== {name}: gen avg {np.mean([s['gen'] for s in row['sents']]):.2f}s", flush=True)


if __name__ == "__main__":
    main()
