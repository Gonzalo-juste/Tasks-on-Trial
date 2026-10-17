"""Transparent burden-of-proof heuristic; supporting evidence is not a fact count."""
import re
from dataclasses import dataclass

BUFFER_FACT = re.compile(r'\b(travel|commut\w*|setup|getting there|there and back|transport\w*|viaje|traslado|desplazamiento)\b', re.I)
NEGATIVE = re.compile(r'\b(not today|can wait|optional|not urgent|must not|not required|not mandatory|no .*need.*today|no .*needed today|no .*necesit.*hoy|puede esperar|opcional)\b', re.I)
PROTECT = re.compile(r'\b(protect (?:this |my |the )?(?:downtime|rest|break|leisure)|must|required|promised|debo|tengo que)\b', re.I)
TODAY = re.compile(r'\b(today|tonight|hoy|esta noche)\b', re.I)
SUPPORT = re.compile(r'\b(need\w*|must|required|urgent|enough|sufficient|due|deadline|promis\w*|essential|neces\w*|suficiente|basta|vence|entregar)\b', re.I)
LATER_DAY = re.compile(r'\b(tomorrow|next week|mañana|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunes|martes|miércoles|jueves|viernes|sábado|domingo)\b', re.I)


def supporting_facts(task):
    """Conservative lexical evidence for today; overhead and mere titles do not count."""
    result, seen = [], set()
    for fact in task.facts:
        key = ' '.join(fact.casefold().split())
        if key not in seen and not BUFFER_FACT.search(fact) and not NEGATIVE.search(fact) and (
                PROTECT.search(fact) or (TODAY.search(fact) and SUPPORT.search(fact))):
            result.append(fact); seen.add(key)
    return result


@dataclass(frozen=True)
class BurdenScore:
    total: float
    supporting: tuple[str, ...]
    evidence: int
    urgency: int
    priority: int
    cost: float
    leisure: int
    adjustment: int
    adjustment_reason: str | None

    def payload(self):
        return dict(score=self.total, supporting_facts=list(self.supporting), evidence=self.evidence,
                    urgency=self.urgency, priority=self.priority, cost=self.cost,
                    leisure_penalty=self.leisure)


def burden_score(case, task, recommendation=None, category=None):
    facts = supporting_facts(task)
    inside = task.deadline is not None and case.constitution.start <= task.deadline <= case.constitution.end
    evidence = 3 * len(facts)
    # A typed deadline is itself confirmed evidence; avoid counting its textual copy twice.
    if inside and not any(re.search(r'\b(due|deadline|vence|entregar)\b', fact, re.I) for fact in facts):
        evidence += 3
        facts.append(f'Confirmed deadline: {task.deadline.isoformat()}')
    later_mention = any(LATER_DAY.search(fact) and re.search(
        r'\b(deadline|due|exam|examen|present\w*|submit|submission|interview|appointment|entregar)\b',fact,re.I)
        for fact in task.facts if not NEGATIVE.search(fact) and not BUFFER_FACT.search(fact)
        and not re.search(r'\b(last|previous|yesterday|ayer|pasado|pasada)\b',fact,re.I))
    urgency = 3 if inside else (1 if (task.deadline and task.deadline > case.constitution.end) or later_mention else 0)
    category = category or task.category
    priorities = case.constitution.priorities
    rank = priorities.index(category) if category in priorities else 99
    priority = 2 if rank == 0 else 1 if rank == 1 else 0
    cost = (task.duration_min + task.buffer_min) / 30
    leisure = 1 if category == 'leisure' and not facts else 0
    adjustment = recommendation.score_adjustment if recommendation and recommendation.score_reason else 0
    reason = recommendation.score_reason if adjustment else None
    return BurdenScore(round(evidence+urgency+priority-cost-leisure+adjustment, 4),
                       tuple(facts), evidence, urgency, priority, round(cost, 4), leisure, adjustment, reason)
