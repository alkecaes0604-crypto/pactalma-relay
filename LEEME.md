# Servidor de relevo de PactAlma

Junta a los jugadores por internet con un **código de sala** de 5 letras y les
pasa los mensajes de unos a otros. No guarda partidas ni datos personales: solo
sabe qué jugadores están en cada sala mientras juegan.

- Arrancar: `npm install` y luego `npm start` (usa el puerto de la variable `PORT`, o 8080).
- Comprobar: abrir la dirección del servidor en el navegador → `PactAlma relay OK · salas: N · jugadores: M`.
- El juego se conecta a la dirección escrita en `scripts/minijuegos/red.gd` (`SERVIDOR`, con `wss://`).
  Para probar con otra sin rehacer el juego: archivo `user://red.cfg` con
  `[internet]` / `servidor="wss://…"`, o la variable de entorno `PACTALMA_RELAY`.
- Máximo 4 jugadores por sala; si el anfitrión sale, la sala se cierra.

Godot ignora esta carpeta (archivo `.gdignore`).
