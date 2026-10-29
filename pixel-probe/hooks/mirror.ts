import type { EngineInterface } from 'claude-code'

// mc-rice's dashboard (claude_mods/mc-rice, panels/steve.py) draws the probe
// round the kitty shell Claude runs in, in Steve's place once /steve off has
// him off: the only place the probe is drawn. The two meet in files named for
// kitty's process and the window Claude runs in: the panel keeps one of its
// own fresh while it is up, naming what has the place, and this session
// writes the other, what the probe is doing, each time that changes while it
// is the probe.
export type Mirror = { scene: string; panel: string }

// What has the dashboard's place: 'probe', 'off' with nothing there (the
// probe off), or the name of what holds it ahead of the probe, as 'steve'
// until /steve off.
export type Showing = string

// How long the panel's file counts as fresh once touched: it touches it every two seconds.
const FRESH_MS = 5000

// Outside kitty there is no panel to meet.
export async function findMirror($: EngineInterface): Promise<Mirror | undefined> {
  const pid = await $.env.get('KITTY_PID')
  const window = await $.env.get('KITTY_WINDOW_ID')
  const local = await $.env.get('LOCALAPPDATA')
  if (!pid || !window || !local) return undefined

  const base = `${local}\\mc-rice\\probe\\${pid}-${window}`
  return { scene: `${base}.json`, panel: `${base}.panel` }
}

// What has the panel's place, or undefined with no panel up.
export async function panelShows($: EngineInterface, mirror: Mirror): Promise<Showing | undefined> {
  const stat = await $.fs.stat(mirror.panel).catch(() => undefined)
  if (stat === undefined || (await $.clock.now()) - stat.mtimeMs >= FRESH_MS) return undefined

  const said = (await $.fs.read(mirror.panel).catch(() => '')).trim().toLowerCase()
  return /^[a-z][a-z0-9-]*$/.test(said) ? said : 'off'
}

// A write that fails leaves the panel on the last one; nothing here may stop the probe.
export async function publish($: EngineInterface, mirror: Mirror, scene: unknown) {
  await $.fs.write(mirror.scene, JSON.stringify(scene)).catch(() => undefined)
}
