"""デモ曲の曲解析と運指を、事前に作ってキャッシュしておく（DESIGN.md F-50）。

本物の Claude（サブスク）を使う。キャッシュ済みの曲は飛ばす。作り直すときは data/songs/<songId>/ の
analysis.json と fingering.json を消してから実行する。

    cd apps/server && uv run python scripts/precompute_song_cache.py
    # 運指だけを Opus で作り直す（成功したときだけ上書き。曲名の一部で絞り込める）
    cd apps/server && uv run python scripts/precompute_song_cache.py --force-fingering --song メヌエット
"""
from __future__ import annotations

import argparse
import asyncio
import os
import time

from piano_coach.brain.claude import ClaudeBrain
from piano_coach.lesson.orchestrator import LessonOrchestrator
from piano_coach.score.importer import ScoreRepository, rasterize_pages


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force-fingering", action="store_true", help="運指をキャッシュがあっても作り直す")
    parser.add_argument("--song", default="", help="曲名の一部（指定した曲だけ処理する）")
    args = parser.parse_args()
    if os.environ.get("ANTHROPIC_API_KEY"):
        raise SystemExit("ANTHROPIC_API_KEY を外して実行してください（サブスクのログインを使う）")
    repo = ScoreRepository()

    async def ignore(kind: str, payload: dict) -> None:  # 送り先のクライアントはいない
        return None

    for score in repo.all():
        if args.song and args.song not in score.title:
            continue
        started = time.perf_counter()
        lesson = LessonOrchestrator(ignore, brain=ClaudeBrain())
        lesson.score = score
        song_dir = lesson._song_dir()
        pdf = repo.source_pdf(score.songId)
        pages = rasterize_pages(pdf, score.songId) if pdf else []
        if not (song_dir / "analysis.json").exists():
            analysis = await lesson._analysis(pages)
            print(f"[{score.title}] 解析: {analysis.get('summary')}")
        if args.force_fingering or not (song_dir / "fingering.json").exists():
            before = (song_dir / "fingering.json").stat().st_mtime if (song_dir / "fingering.json").exists() else 0
            await lesson.estimate_fingering(force=args.force_fingering)
            after = (song_dir / "fingering.json").stat().st_mtime if (song_dir / "fingering.json").exists() else 0
            print(f"[{score.title}] 運指: {'作り直した' if after > before else '失敗（以前のキャッシュを維持）'}")
        print(f"[{score.title}] {time.perf_counter() - started:.0f} 秒")


if __name__ == "__main__":
    asyncio.run(main())
