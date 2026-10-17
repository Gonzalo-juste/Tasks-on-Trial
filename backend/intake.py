"""Unconfirmed intake estimates; only input text becomes established evidence."""
import re
from decimal import Decimal
from .errors import ApiError
from .schemas import (Case, Task, InitResult, InitQuestion, QuestionOption, TaskPatch,
                      validate_case)


def lines_for(request):
    lines = [line.strip() for line in request.raw_text.splitlines() if line.strip()]
    if not 1 <= len(lines) <= 6 or any(len(line) > 200 for line in lines):
        raise ApiError('INVALID_INPUT', 'Enter one to six tasks, one per line, each at most 200 characters.', ['raw_text'])
    for line in lines:
        explicit_duration(line)
    # Validate the supplied calendar before considering an external call.
    validate_case(Case(tasks=[Task(id='check', title='Calendar check', duration_min=1, minimum_min=1)], constitution=request.constitution))
    return lines


def required(line):
    # Exam tasks are mandatory by default, unless explicitly marked optional.
    if re.search(r'\b(not mandatory|not required|optional|no es obligatori[oa]|opcional)\b', line, re.I):
        return False
    return bool(re.search(r'\b(exams?|examen|exámenes|must|required|mandatory|have to|debo|tengo que|obligatori[oa]|deadline|due|vence|vencimiento|fecha límite)\b', line, re.I))


def learning_task(line):
    # Keep communication tasks about maths in their own category.
    if re.match(r'\s*(email|answer|reply|send|enviar|responder|correo)\b', line, re.I):
        return False
    return bool(re.search(r'\b(maths?|mathematics|matemáticas|study|studying|estudiar|estudiando|repasar|examen|exam)\b', line, re.I))


def explicit_duration(line):
    match = re.search(r'\b(\d+(?:\.\d+)?)\s*(minutes?|mins?|minutos?|hours?|horas?|hrs?|h|m)\b', line, re.I)
    if match is None:
        return None
    minutes = Decimal(match[1]) * (60 if match[2].lower().startswith(('hour', 'hora', 'hr', 'h')) else 1)
    if minutes != int(minutes) or not 1 <= minutes <= 1440:
        raise ApiError('INVALID_INPUT', 'Use a whole-minute duration between 1 and 1440.', ['raw_text'])
    return int(minutes)


def fallback_tasks(lines):
    tasks = []
    for index, line in enumerate(lines):
        lower = line.casefold()
        duration, minimum, buffer, category = 30, 15, 0, 'other'
        if learning_task(line):
            duration, minimum, category = 120, 45, 'learning'
        elif any(word in lower for word in ['gym', 'gimnas']):
            duration, minimum, buffer, category = 60, 30, 20, 'health'
        elif any(word in lower for word in ['email', 'correo']):
            category = 'work'
        elif any(word in lower for word in ['presentation', 'presentación']):
            duration, minimum, category = 120, 90, 'work'
        elif any(word in lower for word in ['instagram', 'scroll']):
            duration, minimum, category = 45, 15, 'leisure'
        explicit = explicit_duration(line)
        if explicit is not None:
            duration = explicit
            minimum = min(minimum, duration)
        mandatory = required(line)
        tasks.append(Task(id=f'task-{index+1}', title=line, duration_min=duration,
                          minimum_min=duration if mandatory else minimum, mandatory=mandatory,
                          allow_reduction=not mandatory, category=category,
                          buffer_min=buffer, facts=[line]))
    return tasks


def fallback_questions(tasks):
    questions = []
    for task in tasks:
        lower = task.title.casefold()
        if any(word in lower for word in ['email', 'correo']):
            questions.append(InitQuestion(id=f'q-{task.id}', task_id=task.id,
                question='How many emails actually need a reply today?', options=[
                    QuestionOption(label='None', fact='No emails need a reply today'),
                    QuestionOption(label='1–5', fact='Between one and five emails need a reply today'),
                    QuestionOption(label='6–15', fact='Up to fifteen emails need a reply today'),
                    QuestionOption(label='All of them', fact='Every email needs a reply today')]))
        elif task.buffer_min:
            questions.append(InitQuestion(id=f'q-{task.id}', task_id=task.id,
                question='Does the gym include getting there and back?', options=[
                    QuestionOption(label='About 20 minutes travel', fact='Travel to the gym takes about 20 minutes', patch=TaskPatch(buffer_min=20)),
                    QuestionOption(label='I train at home', fact='I train at home', patch=TaskPatch(buffer_min=0))]))
    return questions[:3]


def prepare(request, draft=None):
    lines = lines_for(request)
    source = 'fallback' if draft is None else 'live'
    if draft is None:
        tasks = fallback_tasks(lines)
        questions, relations = fallback_questions(tasks), []
    else:
        if [task.source_line for task in draft.tasks] != lines:
            raise ValueError('Intake must cover each original line in order.')
        tasks = []
        for row in draft.tasks:
            task = Task.model_validate(row.model_dump(exclude={'source_line'}))
            # Generated assertions never become facts. Retain the original words.
            task.facts = [row.source_line]
            duration = explicit_duration(row.source_line)
            if duration is not None:
                task.duration_min = duration
                task.minimum_min = min(task.minimum_min, duration)
            task.deadline = None  # Relative dates need user confirmation before scheduling.
            if learning_task(row.source_line):
                task.category = 'learning'
            task.mandatory = required(row.source_line)
            task.allow_reduction = not task.mandatory
            if learning_task(row.source_line) and not task.mandatory and row.mandatory and task.minimum_min == task.duration_min:
                task.minimum_min = min(task.minimum_min, fallback_tasks([row.source_line])[0].minimum_min)
            if task.mandatory:
                task.minimum_min = task.duration_min
            tasks.append(task)
        questions, relations = draft.questions, draft.relations
    by_id = {task.id: task for task in tasks}
    for relation in relations:
        if relation.a not in by_id or relation.b not in by_id or relation.a == relation.b:
            raise ValueError('Unknown relation task.')
        if relation.type == 'depends' and relation.b not in by_id[relation.a].depends_on:
            by_id[relation.a].depends_on.append(relation.b)
    if len({q.id for q in questions}) != len(questions):
        raise ValueError('Duplicate question IDs.')
    for question in questions:
        if question.task_id not in by_id:
            raise ValueError('Unknown question task.')
        for option in question.options:
            if option.patch:
                data = by_id[question.task_id].model_dump()
                data.update(option.patch.model_dump(exclude_none=True))
                patched = Task.model_validate(data)
                if patched.minimum_min > patched.duration_min:
                    raise ValueError('Question patch violates minimum.')
    case = Case(tasks=tasks, constitution=request.constitution.model_copy(deep=True), relations=relations)
    validate_case(case)
    return InitResult(request_id=request.request_id, source=source, case=case,
        estimated={task.id: ([] if explicit_duration(line) is not None else ['duration_min']) +
                            ['minimum_min', 'buffer_min', 'category', 'mandatory', 'allow_reduction']
                   for task, line in zip(tasks, lines)},
        questions=questions, relations=relations)
