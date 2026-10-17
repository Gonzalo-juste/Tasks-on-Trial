"""Apply trusted rules to untrusted recommendations and build court orders."""
from .schemas import (Task, Case, Decision, Persona, PlanStep, Release, Need, Recommendation,
                       RunProposal, TrialResult, Meta, Replacement, Proposal)
from .scheduler import plan
from .validation import verify_result


def normalize_plan(steps: list[PlanStep], minutes: int, title: str) -> list[PlanStep]:
    """Preserve positive whole-minute steps and exactly conserve the time budget."""
    if not steps:
        return [PlanStep(step=f'Work on {title}'[:500], minutes=minutes)]
    steps = steps[:min(4, minutes)]
    total = sum(s.minutes for s in steps)
    # Reserve a minute per step, distribute the rest by largest remainder.
    budget = minutes - len(steps)
    shares = [budget*s.minutes/total for s in steps]
    allocated = [1+int(v) for v in shares]
    remaining = minutes-sum(allocated)
    order = sorted(range(len(steps)), key=lambda i: (-(shares[i]-int(shares[i])), i))
    for i in order[:remaining]:
        allocated[i] += 1
    if total == minutes:
        allocated = [s.minutes for s in steps]
    return [PlanStep(step=s.step, minutes=n) for s,n in zip(steps, allocated)]


def fallback_recommendation(task: Task) -> Recommendation:
    return Recommendation(task_id=task.id, persona=Persona(),
        defense=f'I request the confirmed {task.duration_min} minutes for {task.title}.'[:240],
        prosecution='No live assessment is available. The court preserves your confirmed scope.',
        recommendation='APPROVED', approved_min=task.duration_min,
        effective_title=task.title, first_move=f'Prepare to start {task.title}'[:500],
        action_plan=[PlanStep(step=f'Work on {task.title}', minutes=task.duration_min)],
        done_when=f'{task.title} done')


def validate_proposal(case: Case, proposal: RunProposal):
    ids = [d.task_id for d in proposal.decisions]
    if len(ids) != len(set(ids)) or set(ids) != {t.id for t in case.tasks}:
        raise ValueError('Provider decision IDs do not match requested tasks.')


def decide(task: Task, r: Recommendation) -> Decision:
    verdict, minutes, adjusted = r.recommendation, task.duration_min, True
    if verdict == 'DISMISSED':
        if task.mandatory:
            verdict, adjusted = 'APPROVED', False
            reason = 'Mandatory task protected; confirmed scope retained.'
        else:
            minutes = 0
            reason = 'Not justified for today; no time allocated. You can question this decision.'
    elif verdict == 'REDUCED':
        if not task.allow_reduction:
            verdict, adjusted = 'APPROVED', False
            reason = 'Reduction not authorised; confirmed scope retained.'
        elif r.fact_cited not in task.facts:
            verdict, adjusted = 'APPROVED', False
            reason = 'No confirmed fact cited for the reduction; confirmed scope retained.'
        elif r.approved_min >= task.duration_min:
            verdict, adjusted = 'APPROVED', False
            reason = 'Increases are forbidden; confirmed scope retained.'
        else:
            minutes = max(task.minimum_min, r.approved_min)
            if minutes >= task.duration_min:
                verdict, adjusted = 'APPROVED', False
                reason = 'Confirmed minimum requires the full duration.'
            else:
                reason = f'Authorised smaller scope based on your fact: {r.fact_cited}'[:500]
    else:
        reason = 'Confirmed scope and duration retained.'
    title = r.effective_title if adjusted and verdict == 'REDUCED' else task.title
    useful = r if adjusted else fallback_recommendation(task)
    need = r.suggested_need.model_copy(update={'status':'unconfirmed'}) if r.suggested_need else None
    dismissed = verdict == 'DISMISSED'
    return Decision(task_id=task.id, persona=r.persona, defense=r.defense, prosecution=r.prosecution,
        verdict=verdict, original_min=task.duration_min, approved_min=minutes,
        saved_min=task.duration_min-minutes, effective_title=title, reason=reason,
        cut_scope=r.cut_scope if adjusted and verdict != 'APPROVED' else [],
        first_move=None if dismissed else (useful.first_move or f'Prepare to start {title}'[:500]),
        action_plan=[] if dismissed else normalize_plan(useful.action_plan, minutes, title),
        done_when=None if dismissed else (useful.done_when or f'{title} done'[:500]),
        release=(r.release or Release(note='Not today. Revisit if your needs change.')) if dismissed else None,
        schedule_status='NOT_APPLICABLE' if dismissed else 'PENDING',
        suggested_need=need)


def build_result(case: Case, proposal: RunProposal | None, request_id: str, source: str,
                 meta: Meta, revision=1, appeals_used=0, decisions=None, categories=None) -> TrialResult:
    if decisions is None:
        if proposal:
            validate_proposal(case, proposal)
        by_id = {r.task_id:r for r in proposal.decisions} if proposal else {}
        decisions = [decide(t, by_id.get(t.id) or fallback_recommendation(t)) for t in case.tasks]
    schedule, metrics, conflicts = plan(case, decisions, categories)
    counts = {v:sum(d.verdict == v for d in decisions) for v in ['APPROVED','REDUCED','DISMISSED']}
    if conflicts:
        summary = f'The court found a scheduling conflict. {metrics.pending_min} approved minutes remain pending.'
    elif source == 'fallback' and appeals_used:
        summary = f'Your accepted replacement has been applied without a live assessment. {metrics.minutes_recovered} minutes recovered.'
    elif source == 'fallback':
        summary = 'Live assessment unavailable. Your confirmed durations are preserved; the calendar is still validated.'
    else:
        summary = (f'{counts["APPROVED"]} approved, {counts["REDUCED"]} reduced, {counts["DISMISSED"]} dismissed. '
                   f'The court returns {metrics.minutes_recovered} minutes to you.')
    result = TrialResult(request_id=request_id, revision=revision, source=source,
        status='conflict' if conflicts else 'ok', judge_summary=summary,
        decisions=decisions, schedule=schedule, metrics=metrics, conflicts=conflicts,
        appeals_used=appeals_used, meta=meta)
    verify_result(case,result)
    return result


def accepted_decision(task: Task, old: Decision, replacement: Replacement) -> Decision:
    """User acceptance is the authority for a scope replacement, not provider text."""
    minutes = replacement.duration_min
    if not task.minimum_min <= minutes <= task.duration_min:
        raise ValueError('Replacement must fit the confirmed minimum and duration.')
    if minutes == task.duration_min and replacement.title != task.title:
        raise ValueError('This MVP requires replacements to reduce duration.')
    steps = replacement.action_plan or [PlanStep(step=s, minutes=1) for s in (replacement.steps or [])]
    return old.model_copy(update={
        'verdict':'REDUCED' if minutes < task.duration_min else 'APPROVED',
        'approved_min':minutes, 'saved_min':task.duration_min-minutes,
        'effective_title':replacement.title,
        'reason':'Replacement explicitly accepted by the user; confirmed minimum preserved.',
        'cut_scope':replacement.cut_scope,
        'first_move':replacement.first_move or f'Prepare to start {replacement.title}'[:500],
        'action_plan':normalize_plan(steps, minutes, replacement.title),
        'done_when':replacement.done_when or f'{replacement.title} done'[:500],
        'release':None, 'schedule_status':'PENDING', 'pending_reason':None,
        'suggested_need':Need(need=replacement.need, status='confirmed') if replacement.need else None,
    }, deep=True)


def make_proposal(task: Task, replacement: Replacement | None) -> Proposal | None:
    if replacement is None or not task.minimum_min <= replacement.duration_min < task.duration_min:
        return None
    steps = replacement.action_plan or [PlanStep(step=s, minutes=1) for s in (replacement.steps or [])]
    return Proposal(title=replacement.title, duration_min=replacement.duration_min,
        need=replacement.need, saved_min=task.duration_min-replacement.duration_min,
        cut_scope=replacement.cut_scope,
        first_move=replacement.first_move or f'Prepare to start {replacement.title}'[:500],
        action_plan=normalize_plan(steps, replacement.duration_min, replacement.title),
        done_when=replacement.done_when or f'{replacement.title} done'[:500])
