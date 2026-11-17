import type { EngineInterface } from 'claude-code'

// The kitty this session runs in, reached by remote control: where it
// listens, which of its windows is Claude's, and the password that lets it
// restyle that window (and nothing else: see claude-rc.conf).
export type Kitty = { kitten: string; to: string; window: string; passwordFile: string; configDir: string }

// kitty tells every program it starts where it listens and which window it
// is in. Without both, Claude isn't in a kitty with remote control on.
export async function findKitty($: EngineInterface): Promise<Kitty | undefined> {
  const to = await $.env.get('KITTY_LISTEN_ON')
  const window = await $.env.get('KITTY_WINDOW_ID')
  if (!to || !window) return undefined

  const install = await $.env.get('KITTY_INSTALLATION_DIR')
  const configDir = (await $.env.get('KITTY_CONFIG_DIRECTORY')) ?? `${(await $.env.get('USERPROFILE')) ?? ''}\\.config\\kitty`

  return {
    kitten: install ? `${install}\\bin\\kitten.exe` : 'kitten',
    to,
    window,
    passwordFile: `${configDir}\\claude-rc.pw`,
    configDir,
  }
}

// One request at a time of each kind, the newest winning, so a slow kitten
// never leaves stale colours queued up behind it.
// A request the same as the last of its kind is not sent again, unless
// `isForced`: for what kitty may have changed since, behind the mod's back.
const waiting = new Map<string, readonly string[]>()
const draining = new Map<string, Promise<void>>()
const sent = new Map<string, string>()

// A kitty that refuses the password asks the person in the window and holds
// the reply until they answer, so no request is waited on for long.
const KITTEN_MS = 4000

export function send($: EngineInterface, kitty: Kitty, kind: string, args: readonly string[], isForced = false) {
  if (!isForced && !waiting.has(kind) && sent.get(kind) === args.join('\0')) return

  waiting.set(kind, args)
  if (!draining.has(kind)) draining.set(kind, drain($, kitty, kind))
}

async function drain($: EngineInterface, kitty: Kitty, kind: string) {
  for (let args = waiting.get(kind); args !== undefined; args = waiting.get(kind)) {
    waiting.delete(kind)
    sent.set(kind, args.join('\0'))
    await $.process
      .run([kitty.kitten, '@', '--to', kitty.to, '--password-file', kitty.passwordFile, ...args], { timeoutMs: KITTEN_MS })
      .catch(() => undefined)
  }
  draining.delete(kind)
}

// Resolves once every request sent so far has been made.
export async function settle() {
  while (draining.size > 0) await Promise.all(draining.values())
}
