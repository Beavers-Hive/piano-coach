from piano_coach.exercise import ExerciseSpec
from piano_coach.lesson.verdict import RealtimeSummary, suggested_verdict


def spec(mode: str = "play") -> ExerciseSpec:
    return ExerciseSpec(measures=(1, 2), hand="right", tempoPercent=60, mode=mode, loop=1, metronome=True)


def test_suggested_verdict_uses_wait_without_timing():
    summary = RealtimeSummary(total=10, perfect=9, good=1, miss=0, extra=1, timingStdMs=None, aborted=False)
    assert suggested_verdict(summary, spec("wait"))[0] == "next"


def test_suggested_verdict_slow_retry_and_aborted_never_next():
    bad = RealtimeSummary(total=10, perfect=5, good=1, miss=4, extra=0, timingStdMs=20, aborted=False)
    verdict, changed = suggested_verdict(bad, spec())
    assert (verdict, changed.tempoPercent) == ("retry", 45)
    aborted = RealtimeSummary(total=10, perfect=10, good=0, miss=0, extra=0, timingStdMs=10, aborted=True)
    assert suggested_verdict(aborted, spec())[0] == "retry"
