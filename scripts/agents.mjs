#!/usr/bin/env node
// Canal entre agentes: tablero de tareas + mensajes con el porqué.
// Sin dependencias. Uso: npm run agents -- <comando>. Ver `npm run agents -- help`.
import { execSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const BOARD_PATH = join(ROOT, "agents", "board.json");
export const CHANNEL_PATH = join(ROOT, "agents", "channel.jsonl");

export const AGENTS = ["A", "B", "user"];
export const MESSAGE_TYPES = ["note", "question", "answer", "decision", "handoff", "claim", "release", "done"];
const STATUSES = ["todo", "doing", "blocked", "done"];
const STATUS_ICON = { todo: "·", doing: "▶", blocked: "■", done: "✓" };

// ---------- lógica pura (testeada en agents.test.mjs) ----------

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      flags[key] = next === undefined || next.startsWith("--") ? true : (i += 1, next);
    } else positional.push(token);
  }
  return { positional, flags };
}

export function requireAgent(value) {
  if (!AGENTS.includes(value)) throw new Error(`--as debe ser uno de: ${AGENTS.join(", ")}.`);
  return value;
}

export function findTask(board, id) {
  const task = board.tasks.find((item) => item.id === id);
  if (!task) throw new Error(`No existe la tarea ${id}. Mirá \`npm run agents -- status\`.`);
  return task;
}

/** Reclamar exige el porqué y que nadie más la tenga en curso. */
export function claimTask(board, id, agent, why, now) {
  const task = findTask(board, id);
  if (!why) throw new Error("claim necesita --why: el otro agente tiene que saber por qué la tomás.");
  if (task.status === "doing" && task.owner !== agent) {
    throw new Error(`${id} ya la tiene el agente ${task.owner} desde ${task.updated}.`);
  }
  if (task.status === "done") throw new Error(`${id} ya está terminada.`);
  const busy = board.tasks.filter((item) => item.status === "doing" && item.owner !== agent);
  const overlap = busy.flatMap((item) => (task.files ?? [])
    .filter((file) => (item.files ?? []).some((other) => sameArea(file, other)))
    .map((file) => `${file} (${item.id}, agente ${item.owner})`));
  Object.assign(task, { status: "doing", owner: agent, updated: now });
  return overlap;
}

export function setTaskStatus(board, id, agent, status, now) {
  if (!STATUSES.includes(status)) throw new Error(`Estado inválido: ${status}.`);
  const task = findTask(board, id);
  if (task.owner && task.owner !== agent && agent !== "user") {
    throw new Error(`${id} es del agente ${task.owner}; pedile un handoff por el canal.`);
  }
  Object.assign(task, { status, owner: status === "todo" ? null : agent, updated: now });
  return task;
}

/** Un archivo y una carpeta se pisan si uno contiene al otro. */
export function sameArea(a, b) {
  const clean = (path) => path.replace(/\\/g, "/").replace(/\/+$/, "");
  const [x, y] = [clean(a), clean(b)];
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}

/** Archivos modificados (git status) que caen en tareas en curso de otro agente. */
export function conflictsFor(board, agent, changedFiles) {
  return board.tasks
    .filter((task) => task.status === "doing" && task.owner !== agent)
    .flatMap((task) => changedFiles
      .filter((file) => (task.files ?? []).some((area) => sameArea(file, area)))
      .map((file) => ({ file, task: task.id, owner: task.owner })));
}

export function makeMessage({ from, to = "all", type = "note", task, text, why }, now, id) {
  requireAgent(from);
  if (!MESSAGE_TYPES.includes(type)) throw new Error(`Tipo inválido: ${type}.`);
  if (!text) throw new Error("El mensaje necesita texto.");
  if (["decision", "handoff"].includes(type) && !why) throw new Error(`Un ${type} necesita --why.`);
  return { id, ts: now, from, to, type, ...(task ? { task } : {}), text, ...(why ? { why } : {}) };
}

/** Preguntas dirigidas a `agent` (o a todos) que todavía no tienen respuesta. */
export function openQuestions(messages, agent) {
  const answered = new Set(messages.filter((m) => m.type === "answer" && m.replyTo).map((m) => m.replyTo));
  return messages.filter((m) => m.type === "question" && !answered.has(m.id) && m.from !== agent && (m.to === agent || m.to === "all"));
}

/** Resumen corto para arrancar una sesión sin leer todo el historial. */
export function renderStatus(board, messages, agent, conflicts, limit = 8) {
  const lines = [`# Canal BrowserMind · ${board.goal}`, ""];
  for (const status of ["doing", "blocked", "todo"]) {
    const tasks = board.tasks.filter((task) => task.status === status);
    if (!tasks.length) continue;
    lines.push(`## ${status}`);
    for (const task of tasks) {
      const owner = task.owner ? `@${task.owner}` : task.proposedOwner ? `(propuesta: @${task.proposedOwner})` : "(libre)";
      lines.push(`${STATUS_ICON[status]} ${task.id} [${task.priority}] ${task.title} ${owner}`);
      lines.push(`    por qué: ${task.why}`);
    }
    lines.push("");
  }
  const done = board.tasks.filter((task) => task.status === "done").length;
  lines.push(`Terminadas: ${done}/${board.tasks.length}`, "");
  if (agent) {
    const pending = openQuestions(messages, agent);
    if (pending.length) {
      lines.push(`## Preguntas para ${agent} sin responder`);
      pending.forEach((m) => lines.push(`? ${m.id} de ${m.from}: ${m.text}`));
      lines.push("");
    }
  }
  if (conflicts.length) {
    lines.push("## ⚠ Conflictos: tenés cambios en archivos de tareas ajenas en curso");
    conflicts.forEach((c) => lines.push(`! ${c.file} → ${c.task} (agente ${c.owner})`));
    lines.push("");
  }
  lines.push(`## Últimos ${Math.min(limit, messages.length)} mensajes`);
  messages.slice(-limit).forEach((m) => {
    const target = m.to === "all" ? "" : ` → ${m.to}`;
    const task = m.task ? ` [${m.task}]` : "";
    lines.push(`${m.id} ${m.ts.slice(5, 16).replace("T", " ")} ${m.from}${target} ${m.type}${task}: ${m.text}${m.why ? ` — porque ${m.why}` : ""}`);
  });
  return lines.join("\n");
}

// ---------- E/S ----------

function loadBoard() {
  return JSON.parse(readFileSync(BOARD_PATH, "utf8"));
}

function saveBoard(board) {
  writeFileSync(BOARD_PATH, `${JSON.stringify(board, null, 2)}\n`);
}

function loadMessages() {
  if (!existsSync(CHANNEL_PATH)) return [];
  return readFileSync(CHANNEL_PATH, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

/** Id único entre máquinas: el agente y su propio contador (A7, B12). Los m1..m9 viejos se conservan. */
export function nextId(messages, from) {
  const own = messages.filter((m) => m.from === from).length;
  let n = own + 1;
  while (messages.some((m) => m.id === `${from}${n}`)) n += 1;
  return `${from}${n}`;
}

/**
 * Une mensajes de varias copias del canal (por ejemplo, la rama de la nube) sin duplicar.
 * La clave es id + fecha: el mismo agente escribiendo en dos ramas puede repetir un id,
 * y deduplicar sólo por id perdería uno de los dos mensajes sin aviso.
 */
export function mergeMessages(...sources) {
  const byKey = new Map();
  for (const list of sources) for (const m of list) if (!byKey.has(`${m.id}|${m.ts}`)) byKey.set(`${m.id}|${m.ts}`, m);
  return [...byKey.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}

function remoteMessages(ref) {
  try {
    execSync(`git fetch --quiet origin`, { cwd: ROOT, stdio: "ignore" });
    const text = execSync(`git show ${ref}:agents/channel.jsonl`, { cwd: ROOT, encoding: "utf8" });
    return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    console.error(`(no se pudo leer el canal de ${ref})`);
    return [];
  }
}

function post(fields) {
  const messages = loadMessages();
  const message = makeMessage(fields, new Date().toISOString(), nextId(messages, fields.from));
  appendFileSync(CHANNEL_PATH, `${JSON.stringify(message)}\n`);
  return message;
}

function changedFiles() {
  try {
    return execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" })
      .split("\n").filter(Boolean).map((line) => line.slice(3).trim());
  } catch {
    return [];
  }
}

const HELP = `Canal entre agentes (A = Claude Code, B = el agente de AGENTS.md, user = el usuario)

  status [--as A] [--with origin/rama] tablero, preguntas, conflictos y últimos mensajes
                                       (--with suma los mensajes de otra rama, ej. la sesión en la nube)
  claim <tarea> --as A --why "..."     tomar una tarea (avisa si pisa archivos de otra en curso)
  done <tarea> --as A --note "..."     cerrar una tarea con evidencia (ej. resultado de npm run qa)
  block <tarea> --as A --note "..."    marcar bloqueada y explicar qué falta
  release <tarea> --as A --note "..."  devolverla al tablero
  say "texto" --as A [--to B] [--type note|question|decision|handoff] [--task T1] [--why "..."]
  answer <mN> "texto" --as B           responder una pregunta
  log [--last 20]                      historial completo del canal`;

function main(argv) {
  const { positional, flags } = parseArgs(argv);
  const [command = "status", ...rest] = positional;
  const now = new Date().toISOString();

  if (command === "help") return console.log(HELP);
  if (command === "status") {
    const board = loadBoard();
    const agent = flags.as ? requireAgent(flags.as) : undefined;
    const conflicts = agent ? conflictsFor(board, agent, changedFiles()) : [];
    const refs = flags.with ? String(flags.with).split(",") : [];
    const messages = mergeMessages(loadMessages(), ...refs.map(remoteMessages));
    return console.log(renderStatus(board, messages, agent, conflicts));
  }
  if (command === "log") {
    const last = Number(flags.last ?? 1e9);
    return loadMessages().slice(-last).forEach((m) => console.log(JSON.stringify(m)));
  }

  const agent = requireAgent(flags.as);
  if (command === "claim") {
    const board = loadBoard();
    const overlap = claimTask(board, rest[0], agent, flags.why, now);
    saveBoard(board);
    post({ from: agent, type: "claim", task: rest[0], text: `Tomo ${rest[0]}: ${findTask(board, rest[0]).title}`, why: flags.why });
    if (overlap.length) console.log(`⚠ Comparte archivos con tareas en curso: ${overlap.join("; ")}. Coordiná con \`say --type question\`.`);
    return console.log(`✓ ${rest[0]} en curso para ${agent}.`);
  }
  if (["done", "block", "release"].includes(command)) {
    const status = { done: "done", block: "blocked", release: "todo" }[command];
    if (command !== "release" && !flags.note) throw new Error(`${command} necesita --note con evidencia o motivo.`);
    const board = loadBoard();
    setTaskStatus(board, rest[0], agent, status, now);
    saveBoard(board);
    post({ from: agent, type: command === "block" ? "note" : command, task: rest[0], text: flags.note ?? "Libero la tarea." });
    return console.log(`✓ ${rest[0]} → ${status}.`);
  }
  if (command === "say") {
    const message = post({ from: agent, to: flags.to ?? "all", type: flags.type ?? "note", task: flags.task, text: rest.join(" "), why: flags.why });
    return console.log(`✓ ${message.id} enviado.`);
  }
  if (command === "answer") {
    const [replyTo, ...text] = rest;
    if (!loadMessages().some((m) => m.id === replyTo && m.type === "question")) throw new Error(`${replyTo} no es una pregunta del canal.`);
    const message = makeMessage({ from: agent, type: "answer", text: text.join(" "), to: "all" }, now, nextId(loadMessages(), agent));
    appendFileSync(CHANNEL_PATH, `${JSON.stringify({ ...message, replyTo })}\n`);
    return console.log(`✓ ${message.id} responde a ${replyTo}.`);
  }
  throw new Error(`Comando desconocido: ${command}.\n\n${HELP}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}
