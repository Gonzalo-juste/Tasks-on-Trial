"""Round negotiation, structural validation and explicitly non-live fallback speech."""
import re
import logging
from .schemas import Exchange
from .presentation import natural_language


def round_count(case):
    rules = case.rules
    if rules is None: return 1
    if rules.rounds is not None: return rules.rounds
    if rules.mode == 'grand': return 3
    if rules.mode == 'standard': return 2
    # Transitional frontend sends quick plus high drama for Grand.
    return 3 if rules.mode == 'quick' and rules.drama >= .85 else 1


def validate_exchanges(exchanges, rounds, defense, prosecution):
    if len(exchanges) != 2*rounds:
        raise ValueError('Exchange count does not match requested rounds.')
    texts = set()
    for i, exchange in enumerate(exchanges):
        if exchange.round != i//2+1 or exchange.speaker != ('defense' if i%2 == 0 else 'prosecution'):
            raise ValueError('Exchanges must alternate defense and prosecution each round.')
        key = ' '.join(exchange.text.casefold().split())
        if key in texts: raise ValueError('Repeated exchange text.')
        texts.add(key)
    if exchanges[0].text != defense or exchanges[1].text != prosecution:
        raise ValueError('Compatibility speeches must equal round one.')


def validate_personal_history(exchanges, task):
    """Reject obvious invented autobiography; this is not a semantic truth verifier."""
    pattern = re.compile(r'\bI (?:have|had) [^.!?]{0,100}\b(?:before|previously|last week|last month)\b|\bI (?:usually|always|never)\b',re.I)
    for exchange in exchanges:
        if pattern.search(exchange.text) and not any(
                fact.casefold() in exchange.text.casefold() for fact in task.facts):
            raise ValueError('Unconfirmed personal history in exchange.')


def fallback_exchanges(task, decision, rounds):
    # Additional speeches report known inputs, not a fabricated model debate.
    texts = [(decision.defense[:200], decision.prosecution[:200]),
             ((f'My recorded evidence is: {task.facts[0]}' if task.facts else f'My confirmed minimum is {task.minimum_min} minutes.')[:200],
              'Recorded evidence can be checked, but a new model rebuttal is unavailable. Necessity today remains unassessed.'),
             (f'My category in the docket is {task.category}; my setup and travel allowance is {task.buffer_min} minutes.',
              'These are recorded inputs, not proof of necessity today. A live final argument is unavailable.')]
    return [Exchange(round=r+1,speaker=speaker,text=natural_language(text)[:200])
            for r,pair in enumerate(texts[:rounds])
            for speaker,text in zip(['defense','prosecution'],pair)]


def populate_exchanges(case, decisions, include_fallback=False):
    tasks = {task.id:task for task in case.tasks}
    rounds = round_count(case)
    for decision in decisions:
        if not decision.exchanges and include_fallback:
            decision.exchanges = fallback_exchanges(tasks[decision.task_id],decision,rounds)
        elif decision.exchanges:
            decision.exchanges = [e.model_copy(update={'text':natural_language(e.text)[:200]},deep=True)
                                  for e in decision.exchanges]
        if not decision.exchanges:
            continue
        try:
            validate_exchanges(decision.exchanges,rounds,
                natural_language(decision.defense)[:200],natural_language(decision.prosecution)[:200])
        except ValueError:
            logging.getLogger('uvicorn.error.tribunal').warning('result_exchanges_dropped reason=invalid_optional_exchanges')
            decision.exchanges = []
            continue
        decision.defense,decision.prosecution = decision.exchanges[0].text,decision.exchanges[1].text
