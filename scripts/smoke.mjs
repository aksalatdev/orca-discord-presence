// Real-Node IPC smoke against the BUILT entry. A named-pipe peer stands in for
// Discord; the compiled bundle's own DiscordPresence client is constructed via
// the activate() seam and redirected to the smoke pipe. Asserts a real
// HANDSHAKE + SET_ACTIVITY reach the peer. Controlled peer, not real Discord.
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PIPE = process.platform === 'win32'
  ? `\\\\?\\pipe\\discord-ipc-smoke-${process.pid}`
  : join(tmpdir(), `discord-ipc-smoke-${process.pid}`)

function frame(opcode, json) {
  const payload = Buffer.from(json, 'utf8')
  const header = Buffer.alloc(8)
  header.writeUInt32LE(opcode, 0)
  header.writeUInt32LE(payload.length, 4)
  return Buffer.concat([header, payload])
}

const seen = { handshake: 0, activity: 0, clear: 0 }
const server = createServer((socket) => {
  let pending = Buffer.alloc(0)
  socket.on('data', (data) => {
    pending = Buffer.concat([pending, data])
    while (pending.length >= 8) {
      const opcode = pending.readUInt32LE(0)
      const length = pending.readUInt32LE(4)
      if (pending.length < 8 + length) break
      const json = JSON.parse(pending.subarray(8, 8 + length).toString('utf8'))
      pending = pending.subarray(8 + length)
      if (opcode === 0) {
        seen.handshake++
        socket.write(frame(1, JSON.stringify({ cmd: 'DISPATCH', evt: 'READY' })))
      } else if (opcode === 1 && json.cmd === 'SET_ACTIVITY') {
        if (Object.keys(json.args.activity).length === 0) seen.clear++
        else seen.activity++
      }
    }
  })
})
await new Promise((resolve) => server.listen(PIPE, resolve))

const mod = await import('../dist/main.mjs')
const commands = new Map()
const orca = {
  commands: { register: (id, h) => commands.set(id, h) },
  events: { on: () => {} },
  host: {
    call: async (method) =>
      method === 'workspace.readContext'
        ? { displayName: 'smoke-repo', branch: 'main' }
        : undefined
  },
  log: (m) => console.log('[worker]', m)
}

// Activate with the compiled bundle's real client, redirected to the smoke pipe.
mod.default(orca, {
  loadConfig: () => ({ clientId: '123456789012345678' }),
  createClient: (clientId) => new mod.DiscordPresence({ clientId, pipePath: () => PIPE })
})

await commands.get('start-presence')()

// Give the real pipe I/O a moment, then assert and tear down.
await new Promise((resolve) => setTimeout(resolve, 200))

await mod.deactivate()
server.close()

if (seen.handshake !== 1 || seen.activity !== 1 || seen.clear !== 1) {
  console.error('SMOKE FAIL', JSON.stringify(seen))
  process.exit(1)
}
console.log('SMOKE OK', JSON.stringify(seen))
