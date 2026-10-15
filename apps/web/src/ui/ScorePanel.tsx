import { useEffect, useRef, useState } from "react";
import { getPlayheadMs } from "../midi/clock";
import { useAppStore } from "../state/store";
import { renderMusicXml } from "../score/verovio";
import {
  scoreElementsAt,
  scoreElementsForHit,
  scoreResultClass,
  type TimemapEntry,
} from "../score/timemap";
import "./score.css";

type LoadState = "idle" | "loading" | "ready" | "error";

export function ScorePanel() {
  const timeline = useAppStore((state) => state.timeline);
  const viewMode = useAppStore((state) => state.viewMode);
  const hit = useAppStore((state) => state.hit);
  const [svg, setSvg] = useState("");
  const [timemap, setTimemap] = useState<TimemapEntry[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!timeline) {
      setSvg("");
      setTimemap([]);
      setLoadState("idle");
      return;
    }
    let cancelled = false;
    const mock = new URLSearchParams(location.search).get("mock") === "1";
    const url = mock
      ? "/mock/exercise-minuet-1-8.musicxml"
      : `/api/exercises/${encodeURIComponent(timeline.exerciseId)}/score.musicxml`;
    setLoadState("loading");
    setError("");
    void fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(renderMusicXml)
      .then((rendered) => {
        if (cancelled) return;
        setSvg(rendered.svg);
        setTimemap(rendered.timemap);
        setLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setSvg("");
        setTimemap([]);
        setLoadState("error");
        setError("楽譜を表示できませんでした");
      });
    return () => {
      cancelled = true;
    };
  }, [timeline?.exerciseId, timeline?.exerciseVersion]);

  useEffect(() => {
    if (!timeline || !timemap.length || !svg) return;
    let frame = 0;
    let activeIds = new Set<string>();
    const update = () => {
      const host = svgRef.current;
      const panel = scrollRef.current;
      const cursor = cursorRef.current;
      if (!host || !panel || !cursor) return;
      const nextIds = new Set(scoreElementsAt(timemap, getPlayheadMs()));
      for (const id of activeIds) {
        if (!nextIds.has(id))
          elementForId(host, id)?.classList.remove("is-current");
      }
      for (const id of nextIds) {
        if (!activeIds.has(id))
          elementForId(host, id)?.classList.add("is-current");
      }
      activeIds = nextIds;
      const note = [...nextIds]
        .map((id) => elementForId(host, id))
        .find((element): element is Element => Boolean(element));
      if (note) {
        const noteBox = note.getBoundingClientRect();
        const panelBox = panel.getBoundingClientRect();
        const x =
          noteBox.left - panelBox.left + panel.scrollLeft + noteBox.width / 2;
        cursor.style.transform = `translateX(${x}px)`;
        const target = Math.max(0, x - panel.clientWidth * 0.38);
        if (Math.abs(panel.scrollLeft - target) > 2) panel.scrollLeft = target;
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [svg, timemap, timeline]);

  useEffect(() => {
    if (!timeline || !hit || !timemap.length) return;
    const result = scoreResultClass(hit.kind);
    if (!result) return;
    const host = svgRef.current;
    if (!host) return;
    for (const id of scoreElementsForHit(
      timeline,
      timemap,
      hit.pitch,
      getPlayheadMs(),
    )) {
      const element = elementForId(host, id);
      if (!element) continue;
      element.classList.remove(
        "score-result-perfect",
        "score-result-good",
        "score-result-miss",
      );
      element.classList.add(result);
    }
  }, [hit, timeline, timemap]);

  if (viewMode === "notes" || !timeline) return null;
  return (
    <section
      className="score-panel"
      aria-label="課題の楽譜"
      data-testid="score-panel"
    >
      <div className="score-panel-heading">
        <span>楽譜</span>
        <b>
          {timeline.spec.drill
            ? "基礎練習"
            : `${timeline.spec.measures.join("〜")} 小節`}
        </b>
      </div>
      <div className="score-scroll" ref={scrollRef}>
        {loadState === "loading" && (
          <div className="score-loading" role="status">
            楽譜を準備中…
          </div>
        )}
        {loadState === "error" && <div className="score-loading">{error}</div>}
        <div
          aria-hidden={loadState !== "ready"}
          className="score-svg"
          ref={svgRef}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        {loadState === "ready" && (
          <div className="score-cursor" ref={cursorRef} />
        )}
      </div>
    </section>
  );
}

function elementForId(host: HTMLElement, id: string): Element | null {
  return host.querySelector(`[id="${CSS.escape(id)}"]`);
}
