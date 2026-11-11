// SERVIDOR DE RELEVO de PactAlma · jugar por internet con un CÓDIGO DE SALA.
//
// No sabe nada del juego: solo junta a los jugadores de una sala y les pasa los
// mensajes de unos a otros (como un cartero). El juego sigue funcionando igual
// que por WiFi: el anfitrión es el número 1 y los demás 2, 3, 4…
//
// Protocolo (WebSocket):
//   · Texto JSON para el control:
//       cliente → {"op":"crear","juego":"pactalma","v":1,"nombre":"…"}
//       cliente → {"op":"unirse","codigo":"ABCD","juego":"pactalma","v":1,"nombre":"…"}
//       cliente (anfitrión) → {"op":"info","modo":"mundo"}   (en qué está la sala)
//       servidor → {"op":"ok","id":N,"codigo":"ABCD","peers":[1,2…],"modo":"…"}
//       servidor → {"op":"error","motivo":"no_existe|llena|version|codigo"}
//       servidor → {"op":"entra","id":N} · {"op":"sale","id":N} · {"op":"cerrada"}
//   · Binario para los datos del juego:
//       cliente → [destino int32 LE][datos]   (0 = todos; -N = todos menos N)
//       servidor → [origen int32 LE][datos]
//
// Uso: node servidor.js        (puerto = variable PORT o 8080)
// Salud: GET /  → "PactAlma relay OK · salas: N · jugadores: M"
"use strict";
const http = require("http");
const { WebSocketServer } = require("ws");

const PUERTO = parseInt(process.env.PORT || "8080", 10);
const MAX_JUGADORES = 4;
const VERSION = 1;
const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin O/0/I/1 para no confundir
const MAX_MENSAJE = 256 * 1024;
const MAX_POR_SEGUNDO = 400; // mensajes por jugador por segundo (anti-abuso)

const salas = new Map(); // codigo -> {codigo, jugadores: Map(id -> ws), siguiente, creada}

function nuevoCodigo() {
  for (let intento = 0; intento < 1000; intento++) {
    let c = "";
    for (let i = 0; i < 5; i++) c += LETRAS[Math.floor(Math.random() * LETRAS.length)];
    if (!salas.has(c)) return c;
  }
  return null;
}

function enviarJSON(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function salir(ws) {
  const sala = ws.sala;
  if (!sala) return;
  ws.sala = null;
  sala.jugadores.delete(ws.id);
  if (ws.id === 1) {
    // se fue el anfitrión: la sala se cierra para todos
    for (const otro of sala.jugadores.values()) {
      enviarJSON(otro, { op: "cerrada" });
      otro.sala = null;
      otro.close(1000, "sala cerrada");
    }
    salas.delete(sala.codigo);
    return;
  }
  for (const otro of sala.jugadores.values()) enviarJSON(otro, { op: "sale", id: ws.id });
  if (sala.jugadores.size === 0) salas.delete(sala.codigo);
}

function entrar(ws, sala, id) {
  ws.sala = sala;
  ws.id = id;
  const antes = [...sala.jugadores.keys()];
  sala.jugadores.set(id, ws);
  enviarJSON(ws, { op: "ok", id, codigo: sala.codigo, peers: antes, modo: sala.modo || "" });
  for (const otro of sala.jugadores.values()) if (otro !== ws) enviarJSON(otro, { op: "entra", id });
}

function control(ws, txt) {
  let m;
  try { m = JSON.parse(txt); } catch { return; }
  if (!m || typeof m !== "object") return;
  if (m.op === "ping") return enviarJSON(ws, { op: "pong" });
  if (ws.sala) {
    // el anfitrión avisa en qué está la sala ("sala" o "mundo"): así quien
    // entra tarde con el código sabe si debe ir directo al mundo
    if (m.op === "info" && ws.id === 1) ws.sala.modo = String(m.modo || "").slice(0, 16);
    return;
  }
  if (m.juego !== "pactalma" || m.v !== VERSION) return enviarJSON(ws, { op: "error", motivo: "version" });
  if (m.op === "crear") {
    const codigo = nuevoCodigo();
    if (!codigo) return enviarJSON(ws, { op: "error", motivo: "lleno" });
    const sala = { codigo, jugadores: new Map(), siguiente: 2, creada: Date.now() };
    salas.set(codigo, sala);
    entrar(ws, sala, 1);
    console.log(`[sala ${codigo}] creada (${salas.size} salas)`);
  } else if (m.op === "unirse") {
    const codigo = String(m.codigo || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const sala = salas.get(codigo);
    if (!sala) return enviarJSON(ws, { op: "error", motivo: "no_existe" });
    if (sala.jugadores.size >= MAX_JUGADORES) return enviarJSON(ws, { op: "error", motivo: "llena" });
    entrar(ws, sala, sala.siguiente++);
    console.log(`[sala ${codigo}] entra ${ws.id} (${sala.jugadores.size} jugadores)`);
  }
}

function datos(ws, buf) {
  const sala = ws.sala;
  if (!sala || buf.length < 4) return;
  const destino = buf.readInt32LE(0);
  const salida = Buffer.from(buf);
  salida.writeInt32LE(ws.id, 0); // el destino se cambia por el origen
  if (destino > 0) {
    const otro = sala.jugadores.get(destino);
    if (otro && otro.readyState === otro.OPEN) otro.send(salida);
    return;
  }
  const excepto = destino < 0 ? -destino : 0;
  for (const [id, otro] of sala.jugadores) {
    if (otro === ws || id === excepto) continue;
    if (otro.readyState === otro.OPEN) otro.send(salida);
  }
}

const servidor = http.createServer((req, res) => {
  let n = 0;
  for (const s of salas.values()) n += s.jugadores.size;
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end(`PactAlma relay OK · salas: ${salas.size} · jugadores: ${n}\n`);
});

const wss = new WebSocketServer({ server: servidor, maxPayload: MAX_MENSAJE });
wss.on("connection", (ws) => {
  ws.sala = null;
  ws.id = 0;
  ws.vivo = true;
  ws.cuenta = 0;
  ws.ventana = Date.now();
  ws.on("pong", () => { ws.vivo = true; });
  ws.on("message", (msg, esBinario) => {
    const ahora = Date.now();
    if (ahora - ws.ventana > 1000) { ws.ventana = ahora; ws.cuenta = 0; }
    if (++ws.cuenta > MAX_POR_SEGUNDO) return; // demasiados mensajes: se ignoran
    if (esBinario) datos(ws, msg);
    else control(ws, msg.toString());
  });
  ws.on("close", () => salir(ws));
  ws.on("error", () => salir(ws));
});

// Cada 20 s se revisa que sigan conectados (y se mantiene viva la conexión
// en servicios que cortan lo que está en silencio).
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.vivo) { ws.terminate(); continue; }
    ws.vivo = false;
    try { ws.ping(); } catch {}
  }
}, 20000);

servidor.listen(PUERTO, () => console.log(`PactAlma relay escuchando en el puerto ${PUERTO}`));
