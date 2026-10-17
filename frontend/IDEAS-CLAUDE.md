# Ideas de Claude para "Flip the script"

Criterio de los jueces: **creatividad, "go wild"**. Restricciones: unas 5 h de build, 2 personas (frontend con v0 y backend con Nebius), modelos de Nebius de texto y visión. La generación de imágenes no está confirmada: mirad en la consola si hay FLUX.

> Descartada a propósito: el **"Turing test al revés"**. Ya hay docenas de versiones (papers, juegos, game jams) y los jueces lo habrán visto.

---

## ⭐ 1. EXHIBIT: el museo donde la obra eres tú

- **Lo que damos por hecho:** en un museo, las personas miran el arte y lo juzgan.
- **El giro:** el arte te mira a ti. La webcam te "cuelga" en la pared y los cuadros te critican. Se genera una cartela de museo sobre ti, por ejemplo *"Hombre con portátil y café frío, 2026. Técnica mixta: ansiedad sobre lino"*, y un curador pedante te explica como obra. Los propios cuadros comentan entre ellos qué les pareces.
- **Por qué IA:** un modelo de visión de Nebius describe a la persona y un LLM escribe la cartela, la audioguía y el diálogo entre cuadros.
- **Flujo:** 1) foto con la webcam → 2) se te "enmarca" en una sala de museo → 3) la cartela y la crítica de los cuadros aparecen en pantalla.
- **Demo de 3 min:** apuntáis la webcam **a los jueces** en directo y se convierten en exposición: "Retrato de jurado escéptico". Es interactiva y da risa, que es justo lo que piden con "go wild".
- **Reparto:** v0 hace la sala del museo (marcos, cartelas, iluminación); el backend hace visión + LLM. El frontend tiene mucho peso, así que encaja bien contigo.
- **Riesgo:** bajo-medio. Lo único crítico es la cámara y que el modelo de visión funcione bien. Plan B: subir una foto.
- **Puntos extra si sobra tiempo:** una "subasta" de cuánto vale cada asistente como obra, o una "sala permanente" con todas las fotos del día.

## ⭐ 2. SHARK TASK: tus tareas te venden su proyecto a ti

- **Lo que damos por hecho:** tú gestionas tu lista de tareas, y las tareas son ítems pasivos.
- **El giro:** las tareas compiten por ti. Cada una se convierte en un emprendedor que hace un pitch tipo *Shark Tank / Dragons' Den* para conseguir tus horas. Tú eres el inversor y les pagas con tu tiempo. Las tareas que no consiguen inversión se pican y se atacan entre ellas.
- **Por qué IA:** el LLM le da a cada tarea una personalidad, un pitch, objeciones y réplicas a las otras.
- **Flujo:** 1) pegas tu lista de tareas → 2) cada tarea sale al escenario con su pitch → 3) repartes tus 8 horas como inversión y las rechazadas protestan.
- **Demo de 3 min:** la lista de tareas de un juez o del público, en directo. "Hacer la declaración de la renta" suplicando inversión.
- **Reparto:** v0 hace las tarjetas, el escenario y la barra de horas; el backend, el LLM con personajes. Solo texto, así que es muy viable.
- **Riesgo:** bajo. Su punto débil es ser algo menos "wow" visualmente que EXHIBIT.

## ⭐ 3. MY TERMS: tú pones los términos y condiciones a las empresas

- **Lo que damos por hecho:** las empresas escriben los términos y tú haces clic en "Acepto" sin leer.
- **El giro:** escribes **tus** términos en lenguaje normal ("no me vendas datos", "déjame borrar la cuenta en un clic") y la IA los convierte en un contrato legal formal. Luego lee la política de privacidad de cualquier web y genera la **carta de rechazo a la empresa**: "Lamentamos informarle de que su solicitud para usar a Carlos no ha sido aceptada."
- **Por qué IA:** un LLM que lee políticas largas, las compara cláusula a cláusula con las tuyas y redacta en registro legal.
- **Flujo:** 1) escribes tus 5 condiciones → 2) pegas la URL o el texto de una política → 3) sale un veredicto con sello "RECHAZADA" y la carta.
- **Demo de 3 min:** la política de privacidad de una app que usen todos los jueces.
- **Riesgo:** bajo técnicamente. Tiene más mensaje social pero es menos loca, así que puntúa menos en "go wild".

---

## Otras con potencial

4. **Lost & Found al revés: los objetos buscan a su dueño.** Subes la foto de algo y el objeto escribe su propio cartel de "SE BUSCA DUEÑO" con su personalidad y su versión del abandono. Es divertida, pero tiene menos recorrido para una demo.
5. **Buscador inverso.** Le das una respuesta (algo que sabes o tienes) y encuentra las preguntas y las personas que la necesitan. El concepto es potente, pero cuesta más hacerlo visual en 3 minutos.
6. **La reseña te reseña.** Fotografías tu plato vacío o tu mesa y el restaurante escribe una reseña tipo TripAdvisor sobre ti como cliente. Es una versión pequeña de EXHIBIT y podría ser un modo dentro de ella.

## Mi recomendación

**EXHIBIT** es la que mejor encaja con "go wild": es visual, se puede hacer en directo con los jueces, se entiende en 5 segundos y el giro es evidente. Además pesa mucho en el frontend, lo que encaja con v0. **SHARK TASK** es la reserva más segura, porque solo usa texto. El criterio para cambiar a ella sería que a las 11:30 la visión de Nebius no describa bien a las personas.

## Fuentes consultadas
- [Nebius Token Factory](https://tokenfactory.nebius.com/) y [docs](https://docs.tokenfactory.nebius.com/ai-models-inference/overview): hay modelos de texto, visión (image-to-text) y embeddings. Las imágenes generativas no están confirmadas en la documentación.
- [Nemotron Nano 2 VL en Nebius](https://nebius.com/blog/posts/nemotron3-super-now-available): ejemplo de modelo de visión.
- Turing test al revés ya hecho: [ACM 2025](https://dl.acm.org/doi/10.1145/3706599.3720317), [Live Science](https://www.livescience.com/technology/artificial-intelligence/reverse-turing-test-asks-ai-agents-to-spot-a-human-imposter-youll-never-guess-how-they-figure-it-out), [dev.to](https://dev.to/dannwaneri/proof-of-human-i-built-a-reverse-turing-test-after-getting-flagged-as-ai-31e7).
