import type { Plan } from "../types";
import { IconCheck } from "./icons";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/**
 * 指導計画。「本日のプログラム」として、番号とステップ名を縦に並べる。
 * 現在地は真鍮色の印、終わったステップにはチェックを付ける。
 * belowScore: 楽譜のパネルが上にあるとき、その下に置く。
 */
export function Roadmap({
  plan,
  belowScore = false,
}: {
  plan: Plan;
  belowScore?: boolean;
}) {
  const currentIndex = plan.steps.findIndex(
    (step) =>
      step.status === "doing" ||
      (plan.currentStepId !== null && step.id === plan.currentStepId),
  );
  const doneCount = plan.steps.filter((step) => step.status === "done").length;
  return (
    <aside
      className={`plan${belowScore ? " below-score" : ""}`}
      aria-label="本日のプログラム（今日の練習プラン）"
    >
      <p className="eyebrow">本日のプログラム</p>
      <b className="plan-goal">{plan.goal}</b>
      <ol>
        {plan.steps.map((step, index) => {
          const status =
            step.status === "todo" && index === currentIndex
              ? "doing"
              : step.status;
          return (
            <li
              className={`${status}${index < doneCount || status === "done" ? " passed" : ""}`}
              key={step.id}
              aria-current={status === "doing" ? "step" : undefined}
            >
              <span className="node">
                {status === "done" ? (
                  <IconCheck size={13} />
                ) : status === "doing" ? null : (
                  (ROMAN[index] ?? index + 1)
                )}
              </span>
              <span className="body">
                <span className="title">{step.title}</span>
                {status === "doing" && step.description && (
                  <span className="desc">{step.description}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
