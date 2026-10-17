# TASKS ON TRIAL: brief v2 (10:24)

> v2 = v1 recortada siguiendo la revisión del mentor (GO, 8,5/10 la versión recortada), más la opción de **interrogar a una tarea**.

## 1. La idea
**Pitch:** *"The calendar starts empty. Your tasks must earn their place."*

**En español:** tu tiempo no se reparte por defecto: tus tareas tienen que ganárselo.

- **Lo que damos por hecho:** cada tarea nueva es una obligación, y el planificador intenta meterlo todo.
- **El giro:** el calendario **empieza vacío** y no hay obligación de llenarlo. **La carga de la prueba recae en la tarea.** El juez puede declarar "no demostrado" y dejar el hueco libre.
- **El resultado que se ve:** **tiempo libre conservado**, con un contador grande en pantalla.

**Reto:** "Flip the script". Los jueces premian la creatividad ("go wild"). Usamos los modelos de Nebius.

## 2. Tiempo (4 h 30 de construcción efectiva, de 10:00 a 15:30)
| Hora | Entregable |
|---|---|
| 10:25–10:40 | Contrato cerrado (sección 6) y fixture compartida. Alcance congelado. |
| 10:40–11:00 | **Primera integración real:** el frontend llama al backend y muestra mensajes y agenda |
| 11:00–12:30 | Planificador válido (Python), decisión de la IA, estados de carga y error, agenda con tiempo protegido |
| **12:30** | **CHECKPOINT** con Nebius y agenda válida, de punta a punta. Si no funciona: una sola llamada, sin interrogatorio, y un orden fijo de reserva. Comida corta. |
| 13:00–13:30 | **Interrogatorio y apelación** (solo si el núcleo funciona) |
| 13:30–14:30 | Review cruzada. Se corrigen los bloqueos en cuanto aparecen. |
| 14:30–15:30 | Implementar e integrar, ejecutar los 8 casos de prueba y cerrar guion y diapositivas. **Grabar el vídeo de reserva antes de las 15:00.** |
| **15:30** | **FREEZE.** Dos ensayos cronometrados, el vídeo final y comprobar la entrega |
| **16:00** | Entrega del producto y el pitch |

## 3. Qué entra y qué no
**Entra (MVP):**
- Una sola pantalla: tribunal + agenda + pendientes + tiempo libre.
- Un modo. Un máximo de 6 tareas, y 3 en la demo.
- Una ronda de alegatos, un veredicto, el **interrogatorio** y una apelación de alcance.
- Personalidades y tono del juez. Es solo el prompt, así que el "wild" sale barato.

**Fuera hoy:** alianzas y traiciones, la escala de −3 a +3, los precedentes automáticos, los 3 modos y los ajustes finos, arrastrar y soltar libre, varias rondas, login y sincronización.

**Poderes del usuario:** **incluir**, **excluir**, **interrogar** y **confirmar** cambios de alcance. Si lo incluido no cabe, se devuelve un conflicto: ningún juez crea minutos.

**Dependencias:** solo `requires`, con dirección y sin ciclos.

## 4. Las reglas del alegato
Cada tarea responde a tres preguntas:
1. ¿Qué pasa si no me haces hoy?
2. ¿Qué pruebas hay?
3. ¿Cuál es mi versión mínima útil?

**No puede inventar plazos, sanciones ni beneficios.** La retórica no da prioridad.

**Rúbrica:** se queda con **evidencia/impacto** y **urgencia**, con pesos fijos. "Calidad del argumento" se elimina. El encaje no es una nota: se calcula al colocar la tarea en la agenda.

## 5. ⭐ Interrogar a una tarea (contrainterrogatorio)
**Tú haces de fiscal. La tarea tiene que justificarse con los datos que le diste.** Es el mejor instrumento de control del usuario, porque aplica la carga de la prueba.

### Preguntas rápidas (botones) y una libre
| Botón | Qué pone a prueba | Qué puede cambiar |
|---|---|---|
| **"¿Para qué sirves?"** | La utilidad: qué pasa si no se hace | Si no lo demuestra, su impacto queda como "no demostrado" |
| **"¿Por qué tardas tanto?"** | La duración: tiene que **desglosarse en pasos con minutos** | Si los pasos suman menos, propone una duración menor |
| **"¿Por qué hoy?"** | La urgencia: tiene que citar un plazo real de los datos | Sin plazo, la urgencia queda "no demostrada" |
| **"¿Quién te necesita?"** | El beneficiario y si se puede delegar | Puede proponer "delegar" o "pedir ayuda" como primer paso |
| **"¿Cuál es tu versión mínima?"** | El alcance | Propone una entrega más pequeña y concreta (la conecta con la apelación) |
| **Pregunta libre** | Lo que quieras | — |

### Cómo responde la tarea
- Solo con los datos introducidos. Si no tiene pruebas, lo dice: **"No comment."** Es un guiño a los interrogatorios policiales británicos y da risa en la demo.
- El juez marca cada respuesta:
  - ✅ **sustentada:** hay evidencia en los datos.
  - ⚠️ **evasiva:** responde sin pruebas.
  - ❌ **contradicción:** dice algo que no cuadra con los datos, como un plazo inexistente.
- Cada tarea tiene un **medidor de credibilidad** que cambia con sus respuestas. El juez lo tiene en cuenta en el veredicto.
- **Confesión:** si el interrogatorio demuestra que sobra alcance ("en realidad solo está mal la portada"), la tarea propone una versión reducida. **El usuario la confirma** antes de que cambie nada.
- La tarea también puede **retirarse del juicio**, y entonces el hueco queda libre.

### Límites
- Máximo **3 preguntas por tarea**.
- La interfaz se bloquea mientras llega la respuesta.
- Mensajes de 240 caracteres como máximo.
- Una llamada por pregunta, con el modelo rápido.

### Interrogatorio vs apelación
Usan **el mismo mecanismo de "propuesta de alcance"**. Solo cambia quién la inicia:
- **Apelación:** la inicia la tarea.
- **Interrogatorio:** lo inicias tú.

En los dos casos, la propuesta solo se aplica cuando el usuario la confirma.

## 6. Contrato: `POST /api/trial/run` (un solo endpoint)
```json
// request
{ "request_id": "demo-1", "revision": 1,
  "action": "initial | interrogate | appeal",
  "day": { "date": "2026-10-17", "timezone": "Europe/London", "start": "15:00", "end": "16:00",
           "fixed_blocks": [], "protected_blocks": [{ "start": "15:45", "end": "16:00" }] },
  "tasks": [{ "id": "slides", "title": "Polish slides", "duration_min": 45, "deadline_at": null,
              "requires": [], "category": "work", "evidence": "Basic deck already exists." }],
  "priorities": ["health", "work"],
  "forced_ids": [], "excluded_ids": [],
  "interrogation": { "task_id": "slides", "question_type": "why_so_long | purpose | why_today | who_needs | minimal | free", "question_text": null },
  "appeal": { "task_id": "slides", "proposed_title": "Fix title slide", "proposed_duration_min": 5,
              "proposed_steps": ["..."], "user_confirmed": true } }
```
```json
// response
{ "request_id": "demo-1", "revision": 1, "status": "ok",
  "provenance": "live | rule_fallback | replay",
  "messages": [{ "task_id": "slides", "kind": "pitch | answer | appeal | verdict", "text": "..." }],
  "interrogation_result": { "task_id": "slides", "answer": "...", "rating": "supported | evasive | contradiction",
                            "credibility": 0.4, "proposal": { "title": "Fix title slide", "duration_min": 5, "steps": ["..."] } },
  "decision": { "admitted": ["send", "walk"], "pending": [{ "task_id": "slides", "reason_code": "not_proven", "next_step": "..." }],
                "reason": "..." },
  "schedule": [{ "task_id": "send", "start": "15:00", "end": "15:10", "steps": ["..."] }],
  "free_min": 30, "conflicts": [{ "code": "no_fit", "task_ids": ["..."], "message": "..." }] }
```
- **El LLM propone el orden y los motivos. Python valida y devuelve la agenda real:** sin solapes, respetando los bloques fijos y protegidos, los plazos y los `requires`.
- **Errores:** 422 (entrada inválida), 409 (restricciones incompatibles) y 503 (IA caída). El frontend ignora las respuestas de revisiones antiguas.
- La clave de Nebius, los prompts y el razonamiento interno **nunca** llegan al navegador.

## 7. Demo de 3 minutos (escena preparada, datos ficticios anunciados)
**Ventana:** de 15:00 a 16:00, con 15:45–16:00 protegido.

**Tareas:** Enviar demo (10 min, plazo 15:15), Pasear (20 min, salud) y Pulir diapositivas (45 min).

1. **0:00–0:20:** *"Most planners ask how to fit everything in. We ask what deserves to get in."* Se ve la agenda vacía.
2. **0:20–0:45:** alegatos.
3. **0:45–1:20:** veredicto. Entran Enviar y Pasear, y las diapositivas quedan fuera. **30 minutos libres.**
4. **1:20–2:00:** **interrogatorio a Pulir diapositivas:** "¿Por qué tardas tanto?" → se desglosa → **confiesa**: "Only the title slide is broken." Propone 5 minutos y el usuario confirma. Quedan 25 minutos libres.
5. **2:00–2:30:** alguien pregunta "¿Por qué hoy?" a una tarea sin plazo → **"No comment."** → no demostrado.
6. **2:30–3:00:** una inclusión imposible devuelve un conflicto. Cierre: *"Your time is yours. Make your tasks earn it."*

## 8. Roles
- **Carlos (frontend, `frontend/`):** la pantalla única (v0), el formulario mínimo, los estados de carga y error, la agenda con el tiempo libre, el panel de interrogatorio, las fixtures según el contrato, y el guion y las diapositivas.
- **Gonzalo (backend, `backend/`):** el endpoint, los prompts acotados (alegato, juez e interrogatorio), el planificador y la validación en Python, el registro de latencia, tokens y modelo, los 8 casos de prueba, y el servicio durante la demo.
- **Juntos, ya:** cerrar el contrato y hacer una llamada real antes de las 11:00.

## 9. Casos de prueba (mínimo 8)
Éxito · no cabe · plazo · dependencia · ciclo · inclusión imposible · JSON malo · timeout. Además, interrogatorio: respuesta sustentada · "no comment" · contradicción.
