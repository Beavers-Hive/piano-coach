"""M0 spike: Irodori-TTS の 1 文あたりの生成時間を計測する。

使い方（vendor/Irodori-TTS で uv sync --extra cpu 済みの前提）:
  cd vendor/Irodori-TTS && uv run --no-sync python ../../spikes/irodori_bench.py --checkpoint Aratako/Irodori-TTS-v4.1-Small-MF
"""
import argparse, sys, time
from pathlib import Path

from irodori_tts.inference_runtime import (InferenceRuntime, download_hf_checkpoint, RuntimeKey, SamplingRequest,
                                           list_available_runtime_precisions, save_wav)

CAPTION = "明るく優しい20代女性のピアノの先生。落ち着いたテンポで、はきはきと話す。"
LINES = [
    "ナイス！",
    "いいね😊、音は全部合ってたよ！",
    "次は右手だけで、いちから四しょうせつめを弾いてみましょう！",
    "さんしょうせつめでちょっと走っちゃったね🤔。テンポを少し落として、もう一回いってみよう💪",
]

ap = argparse.ArgumentParser()
ap.add_argument("--checkpoint", default="Aratako/Irodori-TTS-v4.1-Small-MF")
ap.add_argument("--device", default="mps")
ap.add_argument("--codec-device", default="mps")
ap.add_argument("--precision", default="fp32")
ap.add_argument("--steps", type=int, default=None)
ap.add_argument("--ref-wav", default=None)
ap.add_argument("--out", default=str(Path(__file__).parent / "tts_out"))
a = ap.parse_args()

print("precisions on", a.device, list_available_runtime_precisions(a.device))
out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
tag = a.checkpoint.split("/")[-1] + f"-{a.device}-{a.precision}" + (f"-s{a.steps}" if a.steps else "")

t = time.perf_counter()
ckpt = download_hf_checkpoint(a.checkpoint) if not Path(a.checkpoint).exists() else a.checkpoint
print(f"download: {time.perf_counter()-t:.1f}s"); t = time.perf_counter()
rt = InferenceRuntime.from_key(RuntimeKey(checkpoint=ckpt, model_device=a.device,
                                          model_precision=a.precision, codec_device=a.codec_device))
print(f"load: {time.perf_counter()-t:.1f}s")

def synth(text, seed=1234):
    req = SamplingRequest(text=text, caption=CAPTION, no_ref=a.ref_wav is None, ref_wav=a.ref_wav,
                          num_steps=a.steps, seed=seed)
    t = time.perf_counter(); r = rt.synthesize(req); dt = time.perf_counter() - t
    return r, dt

synth("ウォームアップです。")  # 初回のカーネルコンパイル等を除外する
for i, line in enumerate(LINES):
    r, dt = synth(line)
    dur = r.audio.shape[-1] / r.sample_rate
    p = save_wav(out / f"{tag}-{i}.wav", r.audio, r.sample_rate)
    print(f"[{i}] gen={dt:.2f}s audio={dur:.2f}s RTF={dt/dur:.2f} chars={len(line)} -> {Path(p).name}")
    print("     stages:", ", ".join(f"{k}={v:.2f}" for k, v in r.stage_timings))
