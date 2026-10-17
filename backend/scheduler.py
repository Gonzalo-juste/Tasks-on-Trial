"""Deterministic, indivisible first-fit scheduling; no LLM arithmetic."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from .schemas import Case, Decision, ScheduleSlot, Metrics, Conflict


def free_intervals(case: Case) -> list[tuple[datetime, datetime]]:
    c = case.constitution
    start, end = c.start.astimezone(timezone.utc), c.end.astimezone(timezone.utc)
    merged = []
    for block in sorted(c.fixed_blocks, key=lambda b: b.start):
        left, right = block.start.astimezone(timezone.utc), block.end.astimezone(timezone.utc)
        if merged and left <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], right))
        else:
            merged.append((left, right))
    cursor, free = start, []
    for left, right in merged:
        if cursor < left:
            free.append((cursor, left))
        cursor = max(cursor, right)
    if cursor < end:
        free.append((cursor, end))
    return free


def effective_budget(case: Case) -> int:
    available = sum(int((end-start).total_seconds() // 60) for start, end in free_intervals(case))
    return available if case.budget_min is None else min(case.budget_min, available)


def plan(case: Case, decisions: list[Decision], categories=None):
    tasks = {t.id: t for t in case.tasks}
    by_id = {d.task_id: d for d in decisions}
    if set(tasks) != set(by_id) or len(decisions) != len(tasks):
        raise ValueError('Decisions must cover the case exactly once.')
    categories = categories or {}
    free = free_intervals(case)
    usable = effective_budget(case)
    remaining_budget = usable
    priorities = {value:i for i,value in enumerate(case.constitution.priorities)}
    far_future = datetime.max.replace(tzinfo=timezone.utc)
    ranked = sorted(case.tasks, key=lambda t: (
        not t.mandatory, t.deadline or far_future,
        priorities.get(categories.get(t.id, t.category), 99), t.id))
    ordered, visited = [], set()
    def visit(task):
        if task.id in visited:
            return
        for dep in sorted(task.depends_on):
            visit(tasks[dep])
        visited.add(task.id)
        ordered.append(task)
    for task in ranked:
        visit(task)
    scheduled, conflicts = {}, []
    zone = ZoneInfo(case.constitution.timezone)
    for task in ordered:
        d = by_id[task.id]
        d.pending_reason = None
        if d.verdict == 'DISMISSED':
            d.schedule_status = 'NOT_APPLICABLE'
            continue
        d.schedule_status = 'PENDING'
        if any(dep not in scheduled for dep in task.depends_on):
            d.pending_reason = 'depends_unmet'
        elif d.approved_min + task.buffer_min > remaining_budget:
            d.pending_reason = 'no_fit'
        else:
            earliest = max([case.constitution.start.astimezone(timezone.utc)] +
                           [scheduled[dep].end.astimezone(timezone.utc) for dep in task.depends_on])
            duration = timedelta(minutes=d.approved_min + task.buffer_min)
            fits_without_deadline = False
            for i, (left, right) in enumerate(free):
                begin = max(left, earliest)
                finish = begin + duration
                if finish > right:
                    continue
                fits_without_deadline = True
                if task.deadline is not None and finish > task.deadline:
                    continue
                scheduled[task.id] = ScheduleSlot(task_id=task.id, start=begin.astimezone(zone), end=finish.astimezone(zone), buffer_min=task.buffer_min)
                replacement = []
                if left < begin:
                    replacement.append((left, begin))
                if finish < right:
                    replacement.append((finish, right))
                free[i:i+1] = replacement
                d.schedule_status = 'SCHEDULED'
                remaining_budget -= d.approved_min + task.buffer_min
                break
            if d.schedule_status == 'PENDING':
                d.pending_reason = 'deadline' if task.deadline and fits_without_deadline else 'no_fit'
        if task.mandatory and d.schedule_status == 'PENDING':
            conflicts.append(Conflict(code='MANDATORY_PENDING', task_ids=[task.id],
                message=f'No valid placement found for mandatory task {task.id}: {d.pending_reason}.'))
    schedule = sorted(scheduled.values(), key=lambda slot: (slot.start, slot.task_id))
    verify_schedule(case, decisions, schedule)
    original = sum(t.duration_min + t.buffer_min for t in case.tasks)
    approved = sum(d.approved_min + (tasks[d.task_id].buffer_min if d.verdict != 'DISMISSED' else 0) for d in decisions)
    metrics = Metrics(original_min=original, approved_min=approved,
        minutes_recovered=original-approved,
        pending_min=sum(d.approved_min + tasks[d.task_id].buffer_min for d in decisions if d.schedule_status == 'PENDING'),
        free_capacity_min=usable-sum(d.approved_min + tasks[d.task_id].buffer_min for d in decisions if d.schedule_status == 'SCHEDULED'))
    return schedule, metrics, conflicts


def verify_schedule(case: Case, decisions: list[Decision], schedule: list[ScheduleSlot]):
    """Independent final invariant check, also used for supplied replay data."""
    by_id = {d.task_id:d for d in decisions}
    slots = {s.task_id:s for s in schedule}
    if len(slots) != len(schedule):
        raise ValueError('Duplicate schedule IDs.')
    if not set(slots) <= set(by_id):
        raise ValueError('Unknown schedule task IDs.')
    previous_end = None
    for slot in sorted(schedule, key=lambda s:s.start):
        task = next(t for t in case.tasks if t.id == slot.task_id)
        decision = by_id[slot.task_id]
        if not case.constitution.start <= slot.start < slot.end <= case.constitution.end:
            raise ValueError('Schedule outside window.')
        if previous_end and slot.start < previous_end:
            raise ValueError('Schedule overlap.')
        previous_end = slot.end
        if slot.buffer_min != task.buffer_min:
            raise ValueError('Scheduled buffer does not match task.')
        if int((slot.end-slot.start).total_seconds()) != (decision.approved_min+task.buffer_min)*60:
            raise ValueError('Scheduled minutes do not match decision.')
        if task.deadline and slot.end > task.deadline:
            raise ValueError('Deadline violated.')
        for block in case.constitution.fixed_blocks:
            if slot.start < block.end and block.start < slot.end:
                raise ValueError('Schedule overlaps fixed block.')
        if any(dep not in slots or slots[dep].end > slot.start for dep in task.depends_on):
            raise ValueError('Dependency violated.')
    for d in decisions:
        if (d.schedule_status == 'SCHEDULED') != (d.task_id in slots):
            raise ValueError('Schedule state inconsistent.')
    if sum(int((s.end-s.start).total_seconds() // 60) for s in schedule) > effective_budget(case):
        raise ValueError('Schedule exceeds the confirmed budget.')
