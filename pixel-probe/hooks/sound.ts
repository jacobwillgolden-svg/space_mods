import type { EngineInterface } from 'claude-code'

import type { Scene } from '../types'

// The clips tools/sounds.py synthesizes into sounds/: blips, chirps, a
// laser, nothing recorded.
type Clip = 'blip' | 'tick' | 'chime' | 'scan' | 'chirp' | 'ping' | 'rumble' | 'zap' | 'boom' | 'whoosh'

// When a scene makes a sound: its target arrives, Claude gets a stage
// further, Claude stops.
export type Moment = 'arrive' | 'stage' | 'end'

// A moment's clips, each with how many milliseconds after it it plays.
type Cue = readonly (readonly [Clip, number])[]

const SCENES: Record<Scene, Record<Moment, Cue>> = {
  orbit: { arrive: [['blip', 0]], stage: [['tick', 0]], end: [['chime', 0]] },
  survey: { arrive: [['scan', 0]], stage: [['chirp', 0]], end: [['ping', 0]] },
  asteroid: { arrive: [['rumble', 0]], stage: [['zap', 0]], end: [['boom', 0]] },
  // Liftoff, a blip a stage of the way out, and a chime into lunar orbit.
  apollo: { arrive: [['rumble', 0]], stage: [['blip', 0]], end: [['chime', 0]] },
}

// Whether the dashboard's panel round this session's shell draws the probe
// (mirror.ts): the only place it is drawn.
let isOnDashboard = false

export function showOnDashboard(isShown: boolean) {
  isOnDashboard = isShown
}

// Whether the probe keeps quiet: sound is off until /probe sound on, and
// with the dashboard's panel not drawing it for this session there is
// nothing to hear. The panel, not /probe off's saved flag: that one is every
// session's, so an off in one would hush another still showing it.
async function isQuiet($: EngineInterface): Promise<boolean> {
  return !isOnDashboard || (await $.store.get('sound')) !== true
}

// Plays a moment of a scene, unless sound is off.
export async function cue($: EngineInterface, scene: Scene, moment: Moment) {
  if (await isQuiet($)) return

  for (const [clip, delay] of SCENES[scene][moment]) {
    if (delay === 0) play($, clip)
    else $.clock.after(delay, () => play($, clip))
  }
}

// When an agent's craft last flew off, so a crowd finishing at once costs
// one sound: on Windows each sound is a PowerShell of its own.
let leftAt = -Infinity

export async function cueLeaving($: EngineInterface) {
  if (await isQuiet($)) return

  const now = await $.clock.now()
  if (now - leftAt < 1000) return

  leftAt = now
  play($, 'whoosh')
}

// A Windows path starts with its drive.
const isWindows = (path: string) => /^[A-Za-z]:[\\/]/.test(path)

// `$.audio.play` has no player in a Windows terminal, so PowerShell plays the
// clip there. Either way a clip that can't play is just silence.
function play($: EngineInterface, clip: Clip) {
  const root = $.plugin.root
  const played: Promise<unknown> = isWindows(root)
    ? $.process.run(
        [
          'powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
          `(New-Object Media.SoundPlayer '${root.replaceAll("'", "''")}\\sounds\\${clip}.wav').PlaySync()`,
        ],
        { timeoutMs: 10_000 },
      )
    : $.audio.play({ asset: `sounds/${clip}.wav` })

  void played.catch(() => undefined)
}
