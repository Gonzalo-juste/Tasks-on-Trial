"""Apply trusted rules to untrusted recommendations and build court orders."""
import re
from .schemas import (Task, Case, Decision, Persona, PlanStep, Release, Need, Recommendation,
                       RunProposal, TrialResult, Meta, Replacement, Proposal, Conflict)
from .scheduler import plan, effective_budget, effective_buffer
from .validation import verify_result
from .presentation import character, natural_language
from .evaluation import burden_score
from .courtroom import populate_exchanges


def normalize_plan(steps: list[PlanStep], minutes: int, title: str) -> list[PlanStep]:
    """Keep balanced plans; replace incompatible wording instead of rescaling it."""
    if not 1 <= len(steps) <= 4 or sum(s.minutes for s in steps) != minutes:
        # A title can itself mention an obsolete duration, so do not repeat it.
        return [PlanStep(step='Work on the approved task scope', minutes=minutes)]
    return [step.model_copy(deep=True) for step in steps]


def consistent_order(steps: list[PlanStep], minutes: int, title: str,
                     first_move: str | None, done_when: str | None,
                     proposed_min: int | None = None):
    """Treat the plan and its surrounding instructions as one time-dependent unit."""
    changed = proposed_min is not None and proposed_min != minutes
    incompatible = not 1 <= len(steps) <= 4 or sum(s.minutes for s in steps) != minutes
    if changed or incompatible:
        return (
            'Prepare the materials needed for the approved task scope.',
            normalize_plan([], minutes, title),
            'The approved task scope is completed.',
        )
    return (
        first_move or f'Prepare to start {title}'[:500],
        normalize_plan(steps, minutes, title),
        done_when or f'{title} done'[:500],
    )


def fallback_recommendation(task: Task) -> Recommendation:
    return Recommendation(task_id=task.id, persona=character(task),
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
    # A shorter permitted allocation is a reduction even when the model labels
    # it APPROVED. Keep the validated minutes rather than losing useful scope.
    if r.recommendation == 'APPROVED' and task.allow_reduction and 0 < r.approved_min < task.duration_min:
        r = r.model_copy(update={'recommendation':'REDUCED'})
    verdict, minutes, adjusted = r.recommendation, task.duration_min, True
    if verdict == 'DISMISSED':
        if task.mandatory:
            verdict, adjusted = 'APPROVED', False
            reason = 'Mandatory task protected; confirmed scope retained.'
        elif r.fact_cited is not None and r.fact_cited not in task.facts:
            verdict, adjusted = 'APPROVED', False
            reason = 'The dismissal cited an unconfirmed fact; confirmed scope retained.'
        else:
            minutes = 0
            reason = 'Not justified for today; no time allocated. You can question this decision.'
    elif verdict == 'REDUCED':
        if not task.allow_reduction:
            verdict, adjusted = 'APPROVED', False
            reason = 'Reduction not authorised; confirmed scope retained.'
        elif r.fact_cited is not None and r.fact_cited not in task.facts:
            verdict, adjusted = 'APPROVED', False
            reason = 'The reduction cited an unconfirmed fact; confirmed scope retained.'
        elif r.approved_min >= task.duration_min:
            verdict, adjusted = 'APPROVED', False
            reason = 'Increases are forbidden; confirmed scope retained.'
        else:
            minutes = max(task.minimum_min, r.approved_min)
            if minutes >= task.duration_min:
                verdict, adjusted = 'APPROVED', False
                reason = 'Confirmed minimum requires the full duration.'
            else:
                buffer_fact = r.fact_cited and re.search(
                    r'\b(travel|commut\w*|setup|getting there|there and back|transport\w*|viaje|traslado|desplazamiento|preparación)\b',
                    r.fact_cited, re.I)
                reason = (f'Authorised smaller scope based on your fact: {r.fact_cited}'[:500]
                          if r.fact_cited and not buffer_fact else 'The judge approved a smaller scope within your authorised minimum.')
    else:
        reason = 'Confirmed scope and duration retained.'
        if r.approved_min != task.duration_min:
            adjusted = False
            reason = 'Proposed minutes contradicted the approval; confirmed scope and duration retained.'
    title = r.effective_title if adjusted and verdict == 'REDUCED' else task.title
    useful = r if adjusted else fallback_recommendation(task)
    need = r.suggested_need.model_copy(update={'status':'unconfirmed'}) if r.suggested_need else None
    dismissed = verdict == 'DISMISSED'
    first_move, action_plan, done_when = (None, [], None) if dismissed else consistent_order(
        useful.action_plan, minutes, title, useful.first_move, useful.done_when,
        proposed_min=useful.approved_min)
    persona = r.persona.model_copy(deep=True)
    default = character(task)
    if persona.name == 'The Task Advocate':
        persona = default
    elif persona.archetype is None:
        persona.archetype = default.archetype
    return Decision(task_id=task.id, persona=persona, defense=natural_language(r.defense), prosecution=natural_language(r.prosecution),
        exchanges=[e.model_copy(deep=True) for e in r.exchanges],
        verdict=verdict, original_min=task.duration_min, approved_min=minutes,
        saved_min=task.duration_min-minutes+(task.buffer_min if dismissed else 0), effective_title=title, reason=reason,
        cut_scope=r.cut_scope if adjusted and verdict != 'APPROVED' else [],
        first_move=first_move, action_plan=action_plan, done_when=done_when,
        release=(r.release or Release(note='Not today. Revisit if your needs change.')) if dismissed else None,
        schedule_status='NOT_APPLICABLE' if dismissed else 'PENDING',
        suggested_need=need)


NEED_CATEGORIES = {'work', 'health', 'learning', 'family', 'money'}


def allocate_work(task, decision, minutes, reason):
    """Change one allocation and rebuild every time-dependent court-order field."""
    decision.verdict = 'APPROVED' if minutes == task.duration_min else 'REDUCED'
    decision.approved_min, decision.saved_min = minutes, task.duration_min-minutes+task.buffer_min-effective_buffer(task,decision)
    decision.reason = reason[:500]
    decision.cut_scope = [] if minutes == task.duration_min else ['Scope beyond the approved time is deferred.']
    decision.first_move, decision.action_plan, decision.done_when = consistent_order(
        [], minutes, decision.effective_title, None, None)
    decision.release = None
    decision.schedule_status, decision.pending_reason = 'PENDING', None


def refill_allocations(case, decisions, scores, ceilings, cut_ids, categories):
    """Restore useful work only when the actual calendar can place every retained task."""
    tasks = {t.id:t for t in case.tasks}
    ordered = sorted(case.tasks, key=lambda t:(-scores[t.id].total,t.id))
    budget = effective_budget(case)

    def try_restore(task, minutes):
        current = next(d for d in decisions if d.task_id == task.id)
        trial = [d.model_copy(deep=True) for d in decisions]
        candidate = next(d for d in trial if d.task_id == task.id)
        allocate_work(task,candidate,minutes,'budget_refill: Restored within available time after higher-priority work; calendar validated.')
        if sum(d.approved_min+effective_buffer(tasks[d.task_id],d) for d in trial if d.verdict != 'DISMISSED') > budget:
            return False
        plan(case,trial,categories)
        if any(d.verdict != 'DISMISSED' and d.schedule_status != 'SCHEDULED' for d in trial):
            return False
        index = decisions.index(current)
        decisions[index] = candidate
        return True

    # Admit missing useful tasks before restoring extra minutes to retained work.
    # Revisit for dependencies: a prerequisite may be admitted later in score order.
    for _ in case.tasks:
        changed = False
        for task in ordered:
            decision = next(d for d in decisions if d.task_id == task.id)
            if decision.verdict != 'DISMISSED' or decision.merged_into:
                continue
            category = categories.get(task.id,task.category)
            if category == 'leisure' and not scores[task.id].supporting:
                continue  # Unsupported leisure remains a merits dismissal.
            minimum = task.minimum_min if task.allow_reduction else task.duration_min
            if try_restore(task,minimum):
                cut_ids.add(task.id)
                changed = True
        if not changed:
            break
    for task in ordered:
        decision = next(d for d in decisions if d.task_id == task.id)
        if task.id in cut_ids and decision.verdict == 'REDUCED' and ceilings[task.id] > decision.approved_min:
            try_restore(task,ceilings[task.id])


def fit_recommendations_to_budget(case: Case, decisions: list[Decision], categories=None, recommendations=None):
    """Reduce legitimate needs before dismissal, then refill validated free capacity."""
    tasks = {t.id:t for t in case.tasks}
    by_id = {d.task_id:d for d in decisions}
    categories, recommendations = categories or {}, recommendations or {}
    scores = {t.id:burden_score(case,t,recommendations.get(t.id),categories.get(t.id)) for t in case.tasks}
    ceilings = {t.id:(by_id[t.id].approved_min if by_id[t.id].verdict != 'DISMISSED' else t.duration_min) for t in case.tasks}
    cut_ids = set()
    ordered = sorted(case.tasks,key=lambda t:(
        not (categories.get(t.id,t.category) == 'leisure' and not scores[t.id].supporting),
        scores[t.id].total,t.id))
    budget = effective_budget(case)
    def load():
        return sum(d.approved_min+effective_buffer(tasks[d.task_id],d) for d in decisions if d.verdict != 'DISMISSED')
    def needs_cuts():
        if not case.constitution.break_min:
            return load() > budget
        trial = [d.model_copy(deep=True) for d in decisions]
        plan(case,trial,categories)
        return any(d.verdict != 'DISMISSED' and d.schedule_status != 'SCHEDULED' for d in trial)
    def discard(task):
        d,score = by_id[task.id],scores[task.id]
        if any(task.id in other.depends_on and by_id[other.id].verdict != 'DISMISSED' for other in case.tasks):
            return False
        category = categories.get(task.id,task.category)
        code = 'budget_dismissal' if category in NEED_CATEGORIES or score.supporting else 'not_proven'
        driver = ('Confirmed budget cannot fit this task alongside retained work' if code == 'budget_dismissal'
                  else 'No supporting evidence this is needed today')
        d.verdict,d.approved_min,d.saved_min = 'DISMISSED',0,task.duration_min+task.buffer_min
        d.reason = f'{code}: {driver}; lowest eligible score {score.total:g}.'
        d.cut_scope = ['Deferred today because the confirmed budget is exhausted.']
        d.first_move,d.action_plan,d.done_when = None,[],None
        d.release = Release(action='defer',note='Deferred to fit the budget. Add supporting evidence or request a pardon.')
        d.schedule_status,d.pending_reason = 'NOT_APPLICABLE',None
        cut_ids.add(task.id)
        return True

    # Unsupported leisure is the first place to recover capacity.
    for task in ordered:
        if not needs_cuts():
            break
        if not task.mandatory and by_id[task.id].verdict != 'DISMISSED' and categories.get(task.id,task.category) == 'leisure' and not scores[task.id].supporting:
            discard(task)
    # Give every reducible legitimate need its minimum before cancelling one whole.
    for task in ordered:
        if not needs_cuts():
            break
        d,score = by_id[task.id],scores[task.id]
        category = categories.get(task.id,task.category)
        if task.mandatory or d.verdict == 'DISMISSED' or not task.allow_reduction or d.approved_min <= task.minimum_min:
            continue
        if category in NEED_CATEGORIES or score.supporting:
            driver = f'Confirmed {category} need retained at its minimum' if category in NEED_CATEGORIES else 'Supporting evidence retained at the confirmed minimum'
            allocate_work(task,d,task.minimum_min,f'budget_reduction: {driver}; lowest eligible score {score.total:g}.')
            cut_ids.add(task.id)
    for task in ordered:
        if not needs_cuts():
            break
        if not task.mandatory and by_id[task.id].verdict != 'DISMISSED':
            discard(task)
    refill_allocations(case,decisions,scores,ceilings,cut_ids,categories)


def build_result(case: Case, proposal: RunProposal | None, request_id: str, source: str,
                 meta: Meta, revision=1, appeals_used=0, decisions=None, categories=None) -> TrialResult:
    if decisions is None:
        if proposal:
            validate_proposal(case, proposal)
        by_id = {r.task_id:r for r in proposal.decisions} if proposal else {}
        decisions = [decide(t, by_id.get(t.id) or fallback_recommendation(t)) for t in case.tasks]
        names = set()
        for task, decision in zip(case.tasks, decisions):
            if decision.persona.name.casefold() in names:
                decision.persona = character(task)
            names.add(decision.persona.name.casefold())
        if proposal is not None:
            fit_recommendations_to_budget(case, decisions, categories, by_id)
    if source != 'replay' or any(d.exchanges for d in decisions):
        populate_exchanges(case, decisions, include_fallback=source == 'fallback')
    schedule, metrics, conflicts = plan(case, decisions, categories)
    tasks = {t.id: t for t in case.tasks}
    mandatory_load = sum(d.approved_min + effective_buffer(tasks[d.task_id],d)
                         for d in decisions if tasks[d.task_id].mandatory)
    if mandatory_load > effective_budget(case):
        conflicts.append(Conflict(code='impossible_as_filed',
            task_ids=[t.id for t in case.tasks if t.mandatory],
            message='Mandatory work and its buffers exceed the effective budget. Change the case or increase the budget.'))
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
    first_move, action_plan, done_when = consistent_order(
        steps, minutes, replacement.title, replacement.first_move, replacement.done_when)
    exchanges = [e.model_copy(deep=True) for e in old.exchanges]
    if exchanges:
        exchanges[0].text = natural_language(old.defense)[:200]
        exchanges[1].text = natural_language(old.prosecution)[:200]
    buffer = effective_buffer(task,old) if replacement.buffer_min is None else replacement.buffer_min
    return old.model_copy(update={
        'buffer_min':buffer if replacement.buffer_min is not None or old.buffer_min is not None else None,
        'defense':natural_language(old.defense), 'prosecution':natural_language(old.prosecution),
        'exchanges':exchanges,
        'verdict':'REDUCED' if minutes < task.duration_min else 'APPROVED',
        'approved_min':minutes, 'saved_min':task.duration_min-minutes+task.buffer_min-buffer,
        'effective_title':replacement.title,
        'reason':'Replacement explicitly accepted by the user; confirmed minimum preserved.',
        'cut_scope':replacement.cut_scope,
        'first_move':first_move, 'action_plan':action_plan, 'done_when':done_when,
        'release':None, 'schedule_status':'PENDING', 'pending_reason':None,
        'suggested_need':Need(need=replacement.need, status='confirmed') if replacement.need else None,
    }, deep=True)


def make_proposal(task: Task, replacement: Replacement | None) -> Proposal | None:
    if replacement is None or not task.minimum_min <= replacement.duration_min < task.duration_min:
        return None
    steps = replacement.action_plan or [PlanStep(step=s, minutes=1) for s in (replacement.steps or [])]
    first_move, action_plan, done_when = consistent_order(
        steps, replacement.duration_min, replacement.title,
        replacement.first_move, replacement.done_when)
    return Proposal(title=replacement.title, duration_min=replacement.duration_min,
        need=replacement.need, saved_min=task.duration_min-replacement.duration_min,
        cut_scope=replacement.cut_scope,
        first_move=first_move, action_plan=action_plan, done_when=done_when)
