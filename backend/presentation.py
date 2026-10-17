"""Local presentation defaults, independent of model reasoning."""
import re
from .schemas import Persona


def character(task):
    title = task.title.casefold()
    choices = [
        (('gym', 'gimnas', 'workout'), 'dumbbell', 'Coach Thunder', '💪'),
        (('email', 'correo', 'message', 'mensaje'), 'envelope', 'Inbox Baron', '✉️'),
        (('presentation', 'presentación', 'slides'), 'slides', 'Captain Keynote', '📊'),
        (('instagram', 'scroll', 'phone', 'teléfono'), 'phone', 'Lord Scrollington', '📱'),
        (('study', 'exam', 'math', 'estudi', 'leer', 'read'), 'book', 'The Exam Hawk', '📚'),
        (('clean', 'limpi'), 'broom', 'Dust Marshal', '🧹'),
        (('shop', 'compra'), 'cart', 'Captain Cart', '🛒'),
        (('care', 'cuid', 'break', 'rest', 'descans'), 'heart', 'The Care Keeper', '❤️'),
    ]
    for words, archetype, name, emoji in choices:
        if any(word in title for word in words):
            return Persona(name=f'{name} · {task.id}'[:80], emoji=emoji, archetype=archetype)
    archetype = 'briefcase' if task.category == 'work' else 'note'
    return Persona(name=f'{task.id}: The Advocate for {task.title}'[:80], emoji='⚖️', archetype=archetype)


def natural_language(text):
    for phrase, replacement in [
        ('allow_reduction is false', 'The user has not authorised a shorter version'),
        ('allow_reduction=false', 'The user has not authorised a shorter version'),
        ('allow_reduction', 'permission to shorten this task'),
        ('minimum_min', 'confirmed minimum duration'),
        ('duration_min', 'requested duration'),
        ('approved_min', 'approved duration'),
        ('buffer_min', 'travel and setup time'),
        ('depends_on', 'prerequisites'),
        ('saved_min', 'time recovered'),
        ('fact_cited', 'supporting fact'),
    ]:
        text = re.sub(re.escape(phrase), replacement, text, flags=re.IGNORECASE)
    return re.sub(r'\b\w+_\w+\b', lambda m: m.group().replace('_', ' '), text)[:240]
