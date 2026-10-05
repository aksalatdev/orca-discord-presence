// src/main.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join as join2 } from "node:path";
import { homedir } from "node:os";

// src/discord.ts
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
var OP = {
  HANDSHAKE: 0,
  FRAME: 1,
  CLOSE: 2
};
var PIPE_COUNT = 10;
var MAX_FRAME_BYTES = 1048576;
var SHUTDOWN_TIMEOUT_MS = 250;
function defaultPipePath(index) {
  if (process.platform === "win32") {
    return `\\\\?\\pipe\\discord-ipc-${index}`;
  }
  const prefix = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || tmpdir();
  return join(prefix, `discord-ipc-${index}`);
}
var DiscordPresence = class {
  clientId;
  onDiagnostic;
  connectTimeoutMs;
  handshakeTimeoutMs;
  baseBackoffMs;
  maxBackoffMs;
  activityFlushMs;
  pipePath;
  connectSocket;
  socket = null;
  connectingSocket = null;
  readBuffer = Buffer.alloc(0);
  connected = false;
  connecting = false;
  destroyed = false;
  backoffMs;
  reconnectTimer = null;
  flushTimer = null;
  handshakeTimer = null;
  handshakeResolve = null;
  pendingActivity = null;
  lastSent = null;
  nonce = 0;
  shutdownPromise = null;
  constructor(options) {
    this.clientId = options.clientId;
    this.onDiagnostic = options.onDiagnostic;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 2e3;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? 5e3;
    this.baseBackoffMs = options.baseBackoffMs ?? 1e3;
    this.maxBackoffMs = options.maxBackoffMs ?? 3e4;
    this.activityFlushMs = options.activityFlushMs ?? 50;
    this.pipePath = options.pipePath ?? defaultPipePath;
    this.connectSocket = options.connectSocket ?? ((path) => createConnection({ path }));
    this.backoffMs = this.baseBackoffMs;
  }
  get isConnected() {
    return this.connected;
  }
  /** Begin connecting. Idempotent; safe to call repeatedly. */
  start() {
    this.connect();
  }
  /** Queue a presence update; coalesced and deduplicated before send. */
  setActivity(activity) {
    if (this.destroyed) return;
    this.pendingActivity = activity;
    if (this.flushTimer == null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, this.activityFlushMs);
    }
  }
  /**
   * Cancel all timers, best-effort clear presence, and close the socket.
   * Idempotent.
   */
  destroy() {
    if (this.shutdownPromise != null) return this.shutdownPromise;
    if (this.destroyed) return Promise.resolve();
    this.destroyed = true;
    this.clearTimers();
    this.connectingSocket?.destroy();
    this.connectingSocket = null;
    const socket = this.socket;
    this.socket = null;
    this.readBuffer = Buffer.alloc(0);
    this.connected = false;
    this.resolveHandshake(false);
    if (socket == null || socket.destroyed) return Promise.resolve();
    this.shutdownPromise = new Promise((resolve) => {
      const timer = setTimeout(() => socket.destroy(), SHUTDOWN_TIMEOUT_MS);
      socket.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        socket.write(this.frame(OP.FRAME, this.activityPayload({})));
        socket.end(this.frame(OP.CLOSE, "{}"));
      } catch {
        socket.destroy();
      }
    });
    return this.shutdownPromise;
  }
  // ── connection ──────────────────────────────────────────────────────────
  connect() {
    if (this.connecting || this.connected || this.destroyed) return;
    this.connecting = true;
    void this.discoverAndHandshake().then((socket) => {
      this.connecting = false;
      if (socket == null) this.scheduleReconnect();
    }).catch(() => {
      this.connecting = false;
      if (!this.connected && !this.destroyed) this.scheduleReconnect();
    });
  }
  async discoverAndHandshake() {
    for (let i = 0; i < PIPE_COUNT; i++) {
      if (this.destroyed) return null;
      const socket = await this.connectPipe(i);
      if (socket == null) continue;
      if (this.destroyed) {
        socket.destroy();
        return null;
      }
      this.socket = socket;
      this.readBuffer = Buffer.alloc(0);
      this.attach(socket);
      try {
        socket.write(this.frame(OP.HANDSHAKE, JSON.stringify({ v: 1, client_id: this.clientId })));
      } catch {
        this.socket = null;
        socket.destroy();
        continue;
      }
      if (await this.waitReady()) {
        return socket;
      }
      this.socket = null;
      socket.destroy();
    }
    return null;
  }
  connectPipe(index) {
    const { promise, resolve } = Promise.withResolvers();
    const socket = this.connectSocket(this.pipePath(index));
    this.connectingSocket = socket;
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (this.connectingSocket === socket) this.connectingSocket = null;
      resolve(result);
    };
    const timer = setTimeout(() => {
      settle(null);
      socket.destroy();
    }, this.connectTimeoutMs);
    socket.on("error", () => {
      settle(null);
      socket.destroy();
    });
    socket.once("close", () => settle(null));
    socket.once("connect", () => {
      if (this.destroyed || settled) {
        settle(null);
        socket.destroy();
      } else {
        settle(socket);
      }
    });
    return promise;
  }
  // ── socket wiring ───────────────────────────────────────────────────────
  attach(socket) {
    socket.on("data", (chunk) => this.onData(socket, chunk));
    socket.on("error", () => {
    });
    socket.once("close", () => this.onClose(socket));
  }
  onClose(socket) {
    if (this.socket !== socket) return;
    this.socket = null;
    this.readBuffer = Buffer.alloc(0);
    this.connected = false;
    this.lastSent = null;
    this.resolveHandshake(false);
    if (!this.destroyed) this.scheduleReconnect();
  }
  onData(socket, chunk) {
    if (this.socket !== socket || this.destroyed) return;
    if (this.readBuffer.length + chunk.length > MAX_FRAME_BYTES + 8) {
      this.onDiagnostic?.("Discord RPC frame exceeded the size limit; reconnecting");
      socket.destroy();
      return;
    }
    this.readBuffer = Buffer.concat([this.readBuffer, chunk]);
    while (this.readBuffer.length >= 8) {
      const opcode = this.readBuffer.readUInt32LE(0);
      const length = this.readBuffer.readUInt32LE(4);
      if (length > MAX_FRAME_BYTES) {
        this.onDiagnostic?.("Discord RPC frame exceeded the size limit; reconnecting");
        socket.destroy();
        return;
      }
      if (this.readBuffer.length < 8 + length) return;
      const payload = this.readBuffer.subarray(8, 8 + length).toString("utf8");
      this.readBuffer = this.readBuffer.subarray(8 + length);
      this.onFrame(opcode, payload);
    }
  }
  onFrame(opcode, json) {
    if (opcode !== OP.FRAME) return;
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;
    const message = parsed;
    if (message.evt === "READY" && this.handshakeResolve != null) {
      this.connected = true;
      this.backoffMs = this.baseBackoffMs;
      this.resolveHandshake(true);
      this.flush();
    } else if (message.evt === "ERROR") {
      const data = message.data;
      const code = typeof data === "object" && data !== null ? data.code : void 0;
      const suffix = typeof code === "number" && Number.isSafeInteger(code) ? ` (code ${code})` : "";
      this.onDiagnostic?.(`Discord RPC rejected a request${suffix}`);
    }
  }
  waitReady() {
    const { promise, resolve } = Promise.withResolvers();
    this.handshakeResolve = resolve;
    this.handshakeTimer = setTimeout(() => this.resolveHandshake(false), this.handshakeTimeoutMs);
    return promise;
  }
  resolveHandshake(ready) {
    const resolve = this.handshakeResolve;
    this.handshakeResolve = null;
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
    resolve?.(ready);
  }
  // ── reconnect ───────────────────────────────────────────────────────────
  scheduleReconnect() {
    if (this.destroyed || this.reconnectTimer != null) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
  }
  // ── activity send ───────────────────────────────────────────────────────
  flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.connected || this.socket == null) return;
    const activity = this.pendingActivity;
    if (activity == null) return;
    if (this.lastSent != null && JSON.stringify(activity) === JSON.stringify(this.lastSent)) {
      return;
    }
    this.socket.write(this.frame(OP.FRAME, this.activityPayload(activity)));
    this.lastSent = activity;
  }
  activityPayload(activity) {
    return JSON.stringify({
      cmd: "SET_ACTIVITY",
      args: { pid: process.pid, activity },
      nonce: this.nextNonce()
    });
  }
  nextNonce() {
    this.nonce += 1;
    return `odp-${this.nonce}`;
  }
  frame(opcode, json) {
    const payload = Buffer.from(json, "utf8");
    const header = Buffer.alloc(8);
    header.writeUInt32LE(opcode, 0);
    header.writeUInt32LE(payload.length, 4);
    return Buffer.concat([header, payload]);
  }
  clearTimers() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }
};

// src/presence.ts
var FIELD_LIMIT = 128;
var WORKSPACE_FALLBACK = "Using Orca ADE";
var ACTIVITY_FALLBACK = "In Orca ADE";
function truncate(value, limit = FIELD_LIMIT) {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}\u2026`;
}
function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function normalizeBranch(branch) {
  return branch.trim().replace(/^refs\/heads\//, "").replace(/^refs\/remotes\/[^/]+\//, "");
}
function buildPresence(context, status, startedAt) {
  const displayName = hasText(context?.displayName) ? context.displayName.trim() : void 0;
  const branch = hasText(context?.branch) ? normalizeBranch(context.branch) : void 0;
  return {
    activity: {
      details: truncate(workspaceLine(displayName, branch)),
      state: truncate(activityLine(status)),
      timestamps: { start: Math.floor(startedAt / 1e3) }
    },
    startedAt
  };
}
function workspaceLine(displayName, branch) {
  if (displayName && branch && branch.toLowerCase() !== displayName.toLowerCase()) {
    return `${displayName} \xB7 ${branch}`;
  }
  return displayName ?? branch ?? WORKSPACE_FALLBACK;
}
function activityLine(status) {
  if (status?.state === "working") return "Agent working";
  return ACTIVITY_FALLBACK;
}

// src/main.ts
var CLIENT_ID_RE = /^\d{17,20}$/;
var REFRESH_INTERVAL_MS = 6e4;
var START_COMMAND_ID = "start-presence";
var active = null;
function activate(orca, deps = {}) {
  active = new Runtime(orca, deps);
  active.wire();
}
async function deactivate() {
  const runtime = active;
  active = null;
  await runtime?.dispose();
}
var Runtime = class {
  orca;
  createClient;
  loadConfig;
  refreshIntervalMs;
  client = null;
  refreshTimer = null;
  refreshing = false;
  stopped = false;
  context = null;
  status = null;
  startedAt = null;
  constructor(orca, deps) {
    this.orca = orca;
    this.createClient = deps.createClient ?? ((clientId) => new DiscordPresence({
      clientId,
      onDiagnostic: (message) => this.log(message)
    }));
    this.loadConfig = deps.loadConfig ?? defaultLoadConfig;
    this.refreshIntervalMs = deps.refreshIntervalMs ?? REFRESH_INTERVAL_MS;
  }
  wire() {
    this.orca.commands.register(START_COMMAND_ID, () => this.start());
    this.orca.events.on("agent.status.changed", (payload) => {
      const state = payload?.state;
      if (typeof state === "string") this.status = { state };
      this.publish();
    });
    this.orca.events.on("worktree.created", () => void this.refresh());
    this.orca.events.on("worktree.removed", () => void this.refresh());
  }
  log(message) {
    this.orca.log(`[orca-discord-presence] ${message}`);
  }
  async start() {
    if (this.client != null) return { ok: true, started: false };
    const { clientId } = this.loadConfig();
    if (clientId == null) {
      this.log("missing clientId: set a Discord application ID in ~/.orca-discord-presence/config.json");
      return { ok: false, error: "missing clientId" };
    }
    this.startedAt = Date.now();
    this.client = this.createClient(clientId);
    this.client.start();
    await this.refresh();
    return { ok: true, started: true };
  }
  tick() {
    this.refreshTimer = null;
    void this.refresh();
  }
  async refresh() {
    if (this.stopped) return;
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      try {
        this.context = await this.readContext();
      } catch {
        this.context = null;
        this.log("workspace context unavailable; showing generic presence");
      }
      this.publish();
    } finally {
      this.refreshing = false;
      if (!this.stopped && this.client != null && this.refreshTimer == null) {
        this.refreshTimer = setTimeout(() => this.tick(), this.refreshIntervalMs);
      }
    }
  }
  async readContext() {
    const raw = await this.orca.host.call("workspace.readContext");
    if (raw == null) return null;
    return {
      displayName: typeof raw.displayName === "string" ? raw.displayName : void 0,
      branch: typeof raw.branch === "string" ? raw.branch : void 0
    };
  }
  publish() {
    if (this.client == null || this.stopped || this.startedAt == null) return;
    this.client.setActivity(buildPresence(this.context, this.status, this.startedAt).activity);
  }
  async dispose() {
    this.stopped = true;
    if (this.refreshTimer != null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    const client = this.client;
    this.client = null;
    await client?.destroy();
  }
};
function validClientId(value) {
  return typeof value === "string" && CLIENT_ID_RE.test(value) ? value : null;
}
function defaultLoadConfig() {
  const entryDir = dirname(fileURLToPath(import.meta.url));
  const root = join2(entryDir, "..");
  return loadConfigFromPaths([
    join2(root, "config.json"),
    join2(homedir(), ".orca-discord-presence", "config.json")
  ]);
}
function loadConfigFromPaths(paths) {
  for (const path of paths) {
    try {
      const raw = JSON.parse(readFileSync(path, "utf8"));
      const clientId = validClientId(
        typeof raw === "object" && raw !== null ? raw.clientId : null
      );
      if (clientId != null) return { clientId };
    } catch {
    }
  }
  return { clientId: null };
}
var _internal = { START_COMMAND_ID, REFRESH_INTERVAL_MS, validClientId, loadConfigFromPaths };
export {
  DiscordPresence,
  _internal,
  deactivate,
  activate as default
};
