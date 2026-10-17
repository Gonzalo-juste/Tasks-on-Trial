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


def expected_rest(case, slot, next_slot):
    if next_slot is None:
        return 0
    work_end = slot.end-timedelta(minutes=slot.rest_after_min)
    if any(work_end <= block.start and block.end <= next_slot.start for block in case.constitution.fixed_blocks):
        return 0
    return case.constitution.break_min


def plan(case: Case, decisions: list[Decision], categories=None):
    if not case.constitution.break_min:
        return _plan_greedy(case,decisions,categories)
    # At most six tasks: enumerate the possible segment-final tasks. A zero
    # break closes its free interval, so later work waits until after the fixed
    # commitment (or is earlier in the day). This avoids circular last-task rules.
    tasks = sorted(case.tasks,key=lambda t:t.id)
    priorities = {value:i for i,value in enumerate(case.constitution.priorities)}
    ranked = sorted(tasks,key=lambda t:(not t.mandatory,
        t.deadline or datetime.max.replace(tzinfo=timezone.utc),
        priorities.get((categories or {}).get(t.id,t.category),99),t.id))
    best_key,best_rests = None,None
    for mask in range(1 << len(tasks)):
        rests = {t.id:(case.constitution.break_min if mask & (1 << i) else 0) for i,t in enumerate(tasks)}
        schedule,_,_ = _plan_greedy(case,decisions,categories,rests,verify=False)
        if any(slot.rest_after_min != expected_rest(case,slot,schedule[i+1] if i+1 < len(schedule) else None)
               for i,slot in enumerate(schedule)):
            continue
        scheduled_ids = {slot.task_id for slot in schedule}
        key = (tuple(t.id in scheduled_ids for t in ranked),
            -max((s.end.timestamp() for s in schedule),default=0),
            -sum(s.rest_after_min for s in schedule))
        if best_key is None or key > best_key:
            best_key,best_rests = key,rests
    if best_rests is None:
        raise ValueError('No valid break allocation.')
    return _plan_greedy(case,decisions,categories,best_rests)


def _plan_greedy(case: Case, decisions: list[Decision], categories=None, rests=None, verify=True):
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
        rest = (rests or {}).get(task.id,0)
        d.pending_reason = None
        if d.verdict == 'DISMISSED':
            d.schedule_status = 'NOT_APPLICABLE'
            continue
        d.schedule_status = 'PENDING'
        if any(dep not in scheduled for dep in task.depends_on):
            d.pending_reason = 'depends_unmet'
        elif d.approved_min + task.buffer_min + rest > remaining_budget:
            d.pending_reason = 'no_fit'
        else:
            earliest = max([case.constitution.start.astimezone(timezone.utc)] +
                           [scheduled[dep].end.astimezone(timezone.utc) for dep in task.depends_on])
            duration = timedelta(minutes=d.approved_min + task.buffer_min + rest)
            fits_without_deadline = False
            for i, (left, right) in enumerate(free):
                begin = max(left, earliest)
                finish = begin + duration
                if finish > right:
                    continue
                fits_without_deadline = True
                if task.deadline is not None and finish-timedelta(minutes=rest) > task.deadline:
                    continue
                scheduled[task.id] = ScheduleSlot(task_id=task.id, start=begin.astimezone(zone), end=finish.astimezone(zone), buffer_min=task.buffer_min,rest_after_min=rest)
                replacement = []
                if left < begin:
                    replacement.append((left, begin))
                if finish < right and (rests is None or rest):
                    replacement.append((finish, right))
                free[i:i+1] = replacement
                d.schedule_status = 'SCHEDULED'
                remaining_budget -= d.approved_min + task.buffer_min + rest
                break
            if d.schedule_status == 'PENDING':
                d.pending_reason = 'deadline' if task.deadline and fits_without_deadline else 'no_fit'
        if task.mandatory and d.schedule_status == 'PENDING':
            conflicts.append(Conflict(code='MANDATORY_PENDING', task_ids=[task.id],
                message=f'No valid placement found for mandatory task {task.id}: {d.pending_reason}.'))
    schedule = sorted(scheduled.values(), key=lambda slot: (slot.start, slot.task_id))
    if verify:
        verify_schedule(case, decisions, schedule)
    original = sum(t.duration_min + t.buffer_min for t in case.tasks)
    approved = sum(d.approved_min + (tasks[d.task_id].buffer_min if d.verdict != 'DISMISSED' else 0) for d in decisions)
    metrics = Metrics(original_min=original, approved_min=approved,
        minutes_recovered=original-approved,
        pending_min=sum(d.approved_min + tasks[d.task_id].buffer_min for d in decisions if d.schedule_status == 'PENDING'),
        free_capacity_min=usable-sum(d.approved_min + tasks[d.task_id].buffer_min for d in decisions if d.schedule_status == 'SCHEDULED')-sum(s.rest_after_min for s in schedule))
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
    ordered_slots = sorted(schedule,key=lambda s:s.start)
    for i,slot in enumerate(ordered_slots):
        task = next(t for t in case.tasks if t.id == slot.task_id)
        decision = by_id[slot.task_id]
        if not case.constitution.start <= slot.start < slot.end <= case.constitution.end:
            raise ValueError('Schedule outside window.')
        if previous_end and slot.start < previous_end:
            raise ValueError('Schedule overlap.')
        previous_end = slot.end
        if slot.buffer_min != task.buffer_min:
            raise ValueError('Scheduled buffer does not match task.')
        if slot.rest_after_min != expected_rest(case,slot,ordered_slots[i+1] if i+1 < len(ordered_slots) else None):
            raise ValueError('Incorrect break after task.')
        if int((slot.end-slot.start).total_seconds()) != (decision.approved_min+task.buffer_min+slot.rest_after_min)*60:
            raise ValueError('Scheduled minutes do not match decision.')
        if task.deadline and slot.end-timedelta(minutes=slot.rest_after_min) > task.deadline:
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
