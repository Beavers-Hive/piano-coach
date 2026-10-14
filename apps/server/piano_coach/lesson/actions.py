from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, Field, model_validator

from piano_coach.exercise.builder import ExerciseSpec

IMPLEMENTED_ACTIONS = {"ask", "set_plan", "start_exercise", "demo", "retry", "next", "finish"}


class Question(BaseModel):
    id: str = Field(min_length=1)
    text: str = Field(min_length=1)
    options: list[str] = Field(default_factory=list)
    allowFree: bool


class PlanStepInput(BaseModel):
    title: str
    description: str
    exercise: ExerciseSpec


class PlanInput(BaseModel):
    goal: str
    steps: list[PlanStepInput] = Field(min_length=1)


class AgentAction(BaseModel):
    type: Literal["ask", "set_plan", "start_exercise", "demo", "retry", "next", "finish"]
    question: Question | None = None
    plan: PlanInput | None = None
    exercise: ExerciseSpec | dict | None = None
    summary: str | None = None
    ui: dict | None = None

    @model_validator(mode="after")
    def required_payloads(self) -> "AgentAction":
        if self.type == "ask" and not self.question:
            raise ValueError("ask needs question")
        if self.type == "set_plan" and not self.plan:
            raise ValueError("set_plan needs plan")
        if self.type in {"start_exercise", "demo"} and not self.exercise:
            raise ValueError(f"{self.type} needs exercise")
        if self.type == "finish" and not self.summary:
            raise ValueError("finish needs summary")
        return self


ALLOWED_STATES = {
    "hearing": {"ask", "set_plan"}, "planning": {"set_plan", "start_exercise", "demo"},
    "briefing": {"start_exercise", "demo"}, "reviewing": {"retry", "next", "finish", "start_exercise", "demo"},
}


def validate_action(raw: dict, state: str, *, current_spec: ExerciseSpec | None = None, measure_count: int | None = None) -> AgentAction:
    action = AgentAction.model_validate(raw)
    if action.type not in ALLOWED_STATES.get(state, set()):
        raise ValueError(f"{action.type} is not allowed in {state}")
    if action.type == "retry" and action.exercise is None:
        if current_spec is None:
            raise ValueError("retry needs a current exercise")
        action.exercise = current_spec
    if action.type in {"start_exercise", "demo"} and isinstance(action.exercise, dict):
        action.exercise = ExerciseSpec.model_validate(action.exercise)
    if action.type == "retry" and isinstance(action.exercise, dict):
        if current_spec is None:
            raise ValueError("retry needs a current exercise")
        action.exercise = ExerciseSpec.model_validate({**current_spec.model_dump(), **action.exercise})
    if action.type in {"start_exercise", "retry"} and action.exercise and action.exercise.mode == "watch":
        raise ValueError("watch requires demo action")
    if action.exercise and measure_count and action.exercise.measures[1] > measure_count:
        raise ValueError("exercise exceeds score measure range")
    if action.plan and measure_count:
        for step in action.plan.steps:
            if step.exercise.measures[1] > measure_count:
                raise ValueError("plan exercise exceeds score measure range")
    if action.type == "next" and current_spec is None:
        raise ValueError("next needs a plan/current exercise")
    return action
