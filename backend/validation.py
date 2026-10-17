"""Independent conservation checks on the final public result."""
from .schemas import Case, TrialResult
from .scheduler import effective_budget, verify_schedule
from .courtroom import round_count, validate_exchanges


def verify_result(case: Case, result: TrialResult) -> None:
    tasks = {t.id:t for t in case.tasks}
    ids = [d.task_id for d in result.decisions]
    if len(ids) != len(set(ids)) or set(ids) != set(tasks):
        raise ValueError('Result must contain each input task exactly once.')
    for d in result.decisions:
        task = tasks[d.task_id]
        if d.exchanges:
            validate_exchanges(d.exchanges,round_count(case),d.defense,d.prosecution)
        elif result.source != 'replay':
            raise ValueError('Generated decisions need courtroom exchanges.')
        saved = task.duration_min - d.approved_min + (task.buffer_min if d.verdict == 'DISMISSED' else 0)
        if d.original_min != task.duration_min or d.saved_min != saved:
            raise ValueError('Per-task minutes are inconsistent.')
        if d.verdict == 'DISMISSED':
            if task.mandatory or d.approved_min != 0:
                raise ValueError('Invalid dismissal.')
            if d.schedule_status != 'NOT_APPLICABLE' or d.action_plan or not d.release or d.first_move or d.done_when:
                raise ValueError('Dismissed task must have only a release, not an action plan.')
        else:
            if not task.minimum_min <= d.approved_min <= task.duration_min:
                raise ValueError('Approved duration violates confirmed limits.')
            if d.verdict == 'APPROVED' and d.approved_min != task.duration_min:
                raise ValueError('Approved tasks must retain confirmed duration.')
            if d.verdict == 'REDUCED' and d.approved_min >= task.duration_min:
                raise ValueError('Reduced tasks need a real duration reduction.')
            if d.schedule_status == 'NOT_APPLICABLE' or d.release:
                raise ValueError('Retained task has dismissal-only fields.')
            if not d.first_move or not d.done_when or not 1 <= len(d.action_plan) <= 4:
                raise ValueError('Retained task needs complete court orders.')
            if any(s.minutes <= 0 for s in d.action_plan) or sum(s.minutes for s in d.action_plan) != d.approved_min:
                raise ValueError('Action plan does not conserve approved minutes.')
        if (d.schedule_status == 'PENDING') != (d.pending_reason is not None):
            raise ValueError('Pending reason does not match schedule status.')
    verify_schedule(case,result.decisions,result.schedule)
    m = result.metrics
    original = sum(t.duration_min + t.buffer_min for t in case.tasks)
    approved = sum(d.approved_min + (tasks[d.task_id].buffer_min if d.verdict != 'DISMISSED' else 0) for d in result.decisions)
    usable = effective_budget(case)
    scheduled = sum(d.approved_min + tasks[d.task_id].buffer_min for d in result.decisions if d.schedule_status == 'SCHEDULED')
    pending = sum(d.approved_min + tasks[d.task_id].buffer_min for d in result.decisions if d.schedule_status == 'PENDING')
    expected = (original,approved,original-approved,pending,usable-scheduled)
    observed = (m.original_min,m.approved_min,m.minutes_recovered,m.pending_min,m.free_capacity_min)
    if observed != expected or sum(d.saved_min for d in result.decisions) != m.minutes_recovered:
        raise ValueError('Result metrics do not conserve task and calendar minutes.')
    mandatory_pending = {d.task_id for d in result.decisions if tasks[d.task_id].mandatory and d.schedule_status == 'PENDING'}
    conflict_ids = {task_id for c in result.conflicts for task_id in c.task_ids}
    if bool(mandatory_pending) != (result.status == 'conflict') or not mandatory_pending <= conflict_ids:
        raise ValueError('Mandatory scheduling conflicts are not correctly exposed.')
    mandatory_load = sum(d.approved_min + tasks[d.task_id].buffer_min for d in result.decisions
                         if tasks[d.task_id].mandatory)
    impossible = any(c.code == 'impossible_as_filed' for c in result.conflicts)
    if impossible != (mandatory_load > usable):
        raise ValueError('Mandatory budget impossibility is not correctly exposed.')
