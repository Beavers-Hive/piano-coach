import type { Plan } from "../types";
import { IconCheck } from "./icons";

/** 指導計画。縦のロードマップで、現在地を光らせ、終わったステップにはチェックを付ける。 */
export function Roadmap({ plan }: { plan: Plan }) {
  const currentIndex = plan.steps.findIndex(
    (step) =>
      step.status === "doing" ||
      (plan.currentStepId !== null && step.id === plan.currentStepId),
  );
  const doneCount = plan.steps.filter((step) => step.status === "done").length;
  return (
    <aside className="plan" aria-label="今日の練習プラン">
      <p className="eyebrow">TODAY&apos;S PLAN</p>
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
                {status === "done" ? <IconCheck size={11} /> : index + 1}
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
