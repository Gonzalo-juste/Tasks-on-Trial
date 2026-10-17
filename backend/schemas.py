"""Public contract matches frontend/fixtures; provider proposals are separate."""
from datetime import datetime
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from pydantic import BaseModel, ConfigDict, Field, AwareDatetime, StrictInt, field_validator
from .errors import ApiError

Category = Literal['health', 'learning', 'work', 'money', 'family', 'leisure', 'other']
Verdict = Literal['APPROVED', 'REDUCED', 'DISMISSED']
Source = Literal['live', 'fallback', 'replay']
QuestionType = Literal['purpose', 'why_so_long', 'why_today', 'who_needs', 'minimal', 'free']
PositiveMinutes = Annotated[StrictInt, Field(gt=0, le=1440)]
Text = Annotated[str, Field(min_length=1, max_length=500)]

class Model(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)

class Task(Model):
    id: Annotated[str, Field(min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')]
    title: Annotated[str, Field(min_length=1, max_length=200)]
    duration_min: PositiveMinutes
    minimum_min: PositiveMinutes
    mandatory: Annotated[bool, Field(strict=True)] = False
    deadline: AwareDatetime | None = None
    depends_on: Annotated[list[str], Field(max_length=6)] = []
    category: Category = 'other'
    allow_reduction: Annotated[bool, Field(strict=True)] = False
    facts: Annotated[list[Text], Field(max_length=12)] = []
    buffer_min: Annotated[StrictInt, Field(ge=0, le=1440, exclude_if=lambda v: v == 0)] = 0

class FixedBlock(Model):
    start: AwareDatetime
    end: AwareDatetime
    label: Annotated[str, Field(max_length=100)] = ''

class Constitution(Model):
    timezone: str = 'Europe/London'
    start: AwareDatetime
    end: AwareDatetime
    fixed_blocks: Annotated[list[FixedBlock], Field(max_length=24)] = []
    priorities: Annotated[list[Category], Field(max_length=7)] = []

class Rules(Model):
    mode: Literal['quick', 'immediate'] = 'quick'
    severity: Annotated[float, Field(ge=0, le=1)] = 0.5
    drama: Annotated[float, Field(ge=0, le=1)] = 0.5

class Relation(Model):
    a: str
    b: str
    type: Literal['ally', 'rival', 'depends']
    reason: Text

class Case(Model):
    tasks: Annotated[list[Task], Field(min_length=1, max_length=6)]
    constitution: Constitution
    rules: Rules | None = Field(default=None, exclude_if=lambda v: v is None)
    relations: list[Relation] = Field(default_factory=list, max_length=15, exclude_if=lambda v: not v)

class Envelope(Model):
    request_id: Annotated[str, Field(min_length=1, max_length=128)]
    api_version: Literal['1'] = '1'

class RunRequest(Envelope):
    confirmed: Literal[True]
    case: Case

    @field_validator('confirmed', mode='before')
    @classmethod
    def explicit_confirmation(cls, value):
        if value is not True:
            raise ValueError('Confirmation must be the boolean true.')
        return value

class Persona(Model):
    emoji: Annotated[str, Field(min_length=1, max_length=32)] = '⚖️'
    name: Annotated[str, Field(min_length=1, max_length=80)] = 'The Task Advocate'
    archetype: Literal['dumbbell', 'envelope', 'book', 'slides', 'phone', 'broom', 'cart', 'briefcase', 'heart', 'note'] | None = Field(default=None, exclude_if=lambda v: v is None)

class PlanStep(Model):
    step: Text
    minutes: PositiveMinutes

class Need(Model):
    need: Text
    status: Literal['unconfirmed', 'confirmed'] = 'unconfirmed'

class Release(Model):
    action: Literal['drop', 'defer', 'delegate'] = 'drop'
    note: Text

class Decision(Model):
    task_id: str
    persona: Persona
    defense: Annotated[str, Field(max_length=240)]
    prosecution: Annotated[str, Field(max_length=240)]
    verdict: Verdict
    original_min: PositiveMinutes
    approved_min: Annotated[StrictInt, Field(ge=0, le=1440)]
    saved_min: Annotated[StrictInt, Field(ge=0, le=1440)]
    effective_title: Text
    reason: Text
    cut_scope: Annotated[list[Text], Field(max_length=8)] = []
    first_move: Text | None = None
    action_plan: Annotated[list[PlanStep], Field(max_length=4)] = []
    done_when: Text | None = None
    release: Release | None = None
    schedule_status: Literal['SCHEDULED', 'PENDING', 'NOT_APPLICABLE']
    pending_reason: Literal['no_fit', 'deadline', 'depends_unmet'] | None = None
    suggested_need: Need | None = None

class ScheduleSlot(Model):
    task_id: str
    start: AwareDatetime
    end: AwareDatetime
    buffer_min: Annotated[StrictInt, Field(ge=0, le=1440, exclude_if=lambda v: v == 0)] = 0

class Metrics(Model):
    original_min: Annotated[StrictInt, Field(ge=0)]
    approved_min: Annotated[StrictInt, Field(ge=0)]
    minutes_recovered: Annotated[StrictInt, Field(ge=0)]
    pending_min: Annotated[StrictInt, Field(ge=0)]
    free_capacity_min: Annotated[StrictInt, Field(ge=0)]

class Conflict(Model):
    code: str
    task_ids: list[str]
    message: str

class Change(Model):
    task_id: str
    previous_verdict: Verdict
    new_verdict: Verdict
    previous_minutes_recovered: int
    delta_minutes_recovered: int
    new_fact: str | None

class Meta(Model):
    model: str | None = None
    llm_calls: Annotated[StrictInt, Field(ge=0)] = 0
    latency_ms: Annotated[StrictInt, Field(ge=0)] = 0

class TrialResult(Envelope):
    revision: Annotated[StrictInt, Field(ge=1)]
    source: Source
    status: Literal['ok', 'conflict']
    judge_summary: Annotated[str, Field(max_length=200)]
    decisions: list[Decision]
    schedule: list[ScheduleSlot]
    metrics: Metrics
    conflicts: list[Conflict] = []
    appeals_used: Annotated[StrictInt, Field(ge=0, le=1)] = 0
    change: Change | None = None
    meta: Meta = Meta()

class PreviousRequest(Envelope):
    case: Case
    previous_result: TrialResult
    base_revision: Annotated[StrictInt, Field(ge=1)]
    task_id: str

class InterrogateRequest(PreviousRequest):
    question_type: QuestionType
    question_text: Annotated[str, Field(min_length=1, max_length=500)] | None = None

class Replacement(Model):
    title: Text
    duration_min: PositiveMinutes
    need: Text | None = None
    saved_min: int | None = None  # client value ignored and recalculated
    cut_scope: Annotated[list[Text], Field(max_length=8)] = []
    first_move: Text | None = None
    action_plan: Annotated[list[PlanStep], Field(max_length=4)] = []
    steps: Annotated[list[Text], Field(max_length=4)] | None = None  # handoff compatibility
    done_when: Text | None = None

class Proposal(Model):
    title: Text
    duration_min: PositiveMinutes
    need: Text | None = None
    saved_min: int
    cut_scope: list[Text] = []
    first_move: Text
    action_plan: list[PlanStep]
    done_when: Text

class InterrogateResult(Envelope):
    base_revision: int
    source: Source
    status: Literal['ok'] = 'ok'
    task_id: str
    question_type: QuestionType
    answer: Annotated[str, Field(max_length=240)]
    rating: Literal['supported', 'evasive', 'contradiction']
    credibility_delta: Annotated[float, Field(ge=-0.3, le=0.3)]
    proposal: Proposal | None = None

class AppealRequest(PreviousRequest):
    pardon: Annotated[bool, Field(strict=True)] = False
    new_fact: Text | None = None
    accepted_replacement: Replacement | None = None

# Provider schemas deliberately exclude schedule, metrics and final verdict reasons.
class Recommendation(Model):
    task_id: str
    persona: Persona = Persona()
    defense: Annotated[str, Field(max_length=240)]
    prosecution: Annotated[str, Field(max_length=240)]
    recommendation: Verdict
    approved_min: Annotated[StrictInt, Field(ge=0, le=1440)]
    effective_title: Text
    fact_cited: Text | None = None
    cut_scope: Annotated[list[Text], Field(max_length=8)] = []
    first_move: Text | None = None
    action_plan: Annotated[list[PlanStep], Field(max_length=4)] = []
    done_when: Text | None = None
    release: Release | None = None
    suggested_need: Need | None = None

class RunProposal(Model):
    decisions: Annotated[list[Recommendation], Field(min_length=1, max_length=6)]
    judge_summary: Annotated[str, Field(max_length=200)] = ''

class InterrogationProposal(Model):
    answer: Annotated[str, Field(max_length=240)]
    rating: Literal['supported', 'evasive', 'contradiction']
    credibility_delta: Annotated[float, Field(ge=-0.3, le=0.3)]
    proposal: Replacement | None = None

class InitRequest(Envelope):
    raw_text: Annotated[str, Field(min_length=1, max_length=4000)]
    constitution: Constitution

class TaskPatch(Model):
    buffer_min: Annotated[StrictInt, Field(ge=0, le=1440)] | None = Field(default=None, exclude_if=lambda v: v is None)
    duration_min: PositiveMinutes | None = Field(default=None, exclude_if=lambda v: v is None)
    minimum_min: PositiveMinutes | None = Field(default=None, exclude_if=lambda v: v is None)

class QuestionOption(Model):
    label: Annotated[str, Field(min_length=1, max_length=100)]
    fact: Text
    patch: TaskPatch | None = None

class InitQuestion(Model):
    id: Annotated[str, Field(min_length=1, max_length=64)]
    task_id: str
    question: Text
    options: Annotated[list[QuestionOption], Field(min_length=2, max_length=5)]

class InitResult(Envelope):
    source: Literal['live', 'fallback']
    status: Literal['ok'] = 'ok'
    case: Case
    estimated: dict[str, list[str]]
    questions: Annotated[list[InitQuestion], Field(max_length=3)] = []
    relations: Annotated[list[Relation], Field(max_length=15)] = []

class DraftTask(Task):
    source_line: Text

class InitDraft(Model):
    tasks: Annotated[list[DraftTask], Field(min_length=1, max_length=6)]
    questions: Annotated[list[InitQuestion], Field(max_length=3)] = []
    relations: Annotated[list[Relation], Field(max_length=15)] = []

class ReviseRequest(PreviousRequest):
    instruction: Text

class DetailedStep(PlanStep):
    detail: Text
    tip: Text | None = None

class RevisedOrder(Model):
    first_move: Text
    done_when: Text
    action_plan: Annotated[list[DetailedStep], Field(min_length=1, max_length=5)]

class ReviseResult(Envelope, RevisedOrder):
    source: Literal['live', 'fallback']
    status: Literal['ok'] = 'ok'
    task_id: str


def validate_case(case: Case) -> None:
    """Field-specific semantic errors before any provider call."""
    c = case.constitution
    def invalid(message, field):
        raise ApiError('INVALID_INPUT', message, [f'case.{field}'])
    try:
        zone = ZoneInfo(c.timezone)
    except (ZoneInfoNotFoundError, ValueError):
        invalid('Unknown timezone.', 'constitution.timezone')
    if c.end <= c.start:
        invalid('The day must end after it starts.', 'constitution.end')
    if c.start.astimezone(zone).date() != c.end.astimezone(zone).date():
        invalid('Only one local calendar day is supported.', 'constitution.end')
    for name, value in [('start', c.start), ('end', c.end)]:
        if value.second or value.microsecond:
            invalid('Use whole-minute times.', f'constitution.{name}')
        if value.utcoffset() != value.astimezone(zone).utcoffset():
            invalid('UTC offset does not match the timezone.', f'constitution.{name}')
    if len(c.priorities) != len(set(c.priorities)):
        invalid('Priorities must not repeat.', 'constitution.priorities')
    for i, block in enumerate(c.fixed_blocks):
        if not c.start <= block.start < block.end <= c.end:
            invalid('Fixed blocks must fit inside the day.', f'constitution.fixed_blocks[{i}]')
        if any(v.second or v.microsecond for v in [block.start, block.end]):
            invalid('Use whole-minute times.', f'constitution.fixed_blocks[{i}]')
    ids = [t.id for t in case.tasks]
    if len(ids) != len(set(ids)):
        invalid('Task IDs must be unique.', 'tasks')
    graph = {t.id: t.depends_on for t in case.tasks}
    for i, relation in enumerate(case.relations):
        if relation.a not in graph or relation.b not in graph or relation.a == relation.b:
            invalid('Relations must reference two existing distinct tasks.', f'relations[{i}]')
        if relation.type == 'depends' and relation.b not in graph[relation.a]:
            invalid('A depends relation must also be in depends_on.', f'relations[{i}]')
    for i, task in enumerate(case.tasks):
        if task.minimum_min > task.duration_min:
            invalid('Minimum cannot exceed confirmed duration.', f'tasks[{i}].minimum_min')
        if len(task.depends_on) != len(set(task.depends_on)) or any(x not in graph for x in task.depends_on):
            invalid('Dependencies must reference distinct existing IDs.', f'tasks[{i}].depends_on')
        if task.deadline and (task.deadline.second or task.deadline.microsecond):
            invalid('Use a whole-minute deadline.', f'tasks[{i}].deadline')
    visiting, done = set(), set()
    def visit(task_id):
        if task_id in visiting:
            invalid('Dependencies contain a cycle.', 'tasks')
        if task_id in done:
            return
        visiting.add(task_id)
        for dep in graph[task_id]:
            visit(dep)
        visiting.remove(task_id)
        done.add(task_id)
    for task_id in graph:
        visit(task_id)
