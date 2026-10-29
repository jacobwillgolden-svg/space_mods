import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnStepInput } from 'claude-code'

import { moveOf } from '../hooks/apollo'
import { describe } from '../hooks/caption'
import type { Told, Words } from '../hooks/caption'
import { CRAFT } from '../hooks/craft'
import { moonChart } from '../hooks/earth'
import { ENDING_TICKS, LEAVE_SECONDS, TICK_MS, progressStage, toFrame } from '../hooks/frame'
import type { FrameState } from '../hooks/frame'
import { ROCKS } from '../hooks/rock'
import { USUAL_VIEW, drawScene, turned, zoomed } from '../hooks/scene'
import { WORLDS } from '../hooks/worlds'
import type { Effort, Scene, Tasks, WorldName } from '../types'

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

// mc-rice's dashboard round the shell this session runs in (mirror.ts):
// kitty's process and window, where the two meet, and the panel's own file,
// fresh while `panel.shows` says what it shows, gone while it is undefined.
// The kit hands paths on resolved against its own folder, so they are known
// by how they end.
const KITTY_ENV = { KITTY_PID: '7', KITTY_WINDOW_ID: '1', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }
const meets = (path: string, end: string) => path.replaceAll('/', '\\').endsWith(`\\mc-rice\\probe\\7-1${end}`)

// What this session tells the panel: the scene, or that the session is over.
type Published = { v: number; at?: number; ended?: boolean; state?: FrameState; told?: Told }

// Nothing sits beneath the plugin: each hook here stands for the engine, the
// Stop hooks answering `stop` and TaskCreate making task `a`, and for the
// dashboard's panel round the shell, drawing the probe unless `given.panel`
// says otherwise. It keeps the clock, the store in `stored` and what this
// session tells the panel in `written`, oldest first, counts the panes opened
// and the clips played, and notes the panes closed. `given` is what the store
// holds and which panes are up before the session starts, as a pane an
// earlier version left up across a reload is, and the environment the
// session runs in, in kitty unless it says otherwise.
function engine(
  on: On,
  settings: Record<string, unknown>,
  stop: { block?: string } = {},
  given: { stored?: Record<string, unknown>; panes?: readonly string[]; env?: Record<string, string>; panel?: { shows: string | undefined } } = {},
) {
  const clock = mock.clock(on, { now: 1_000_000 })
  const panel = given.panel ?? { shows: 'probe' }
  const seen = {
    clock,
    opened: 0,
    closed: [] as string[],
    played: 0,
    stored: new Map(Object.entries(given.stored ?? {})),
    written: [] as Published[],
  }
  const up = new Set<string>(given.panes)

  mock.env(on, given.env ?? KITTY_ENV)
  on('store.get', (_, e) => ({ value: seen.stored.get(e.key) }))
  on('store.set', (_, e) => {
    seen.stored.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => {
    seen.opened++
    up.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    seen.closed.push(e.id)
    up.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [...up].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('fs.stat', (_, e) =>
    meets(e.path, '.panel') && panel.shows !== undefined
      ? { value: { kind: 'file', size: panel.shows.length, mtimeMs: clock.now() - 1000, isLink: false } }
      : { deny: 'no such file' },
  )
  on('fs.read', (_, e) => (meets(e.path, '.panel') && panel.shows !== undefined ? { value: panel.shows } : { deny: 'no such file' }))
  on('fs.write', (_, e) => {
    if (meets(e.path, '.json')) seen.written.push(JSON.parse(e.text) as Published)
    return { value: undefined }
  })
  on('audio.play', () => {
    seen.played++
    return { value: undefined }
  })
  on('process.run', () => {
    seen.played++
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('agent.list', () => ({ value: [] }))
  on('settings.read', () => ({ value: settings }))
  let spawned = 0
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `agent-${++spawned}` }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('command.run', () => ({ text: '' }))
  on('classic.Stop', () => stop)
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.PostToolUse', () => ({}))
  on('tool.call', (_, e) => ({ result: e.tool === 'TaskCreate' ? { task: { id: 'a', subject: 'one' } } : {} }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })

  return seen
}

type Seen = ReturnType<typeof engine>

async function start($: Engine) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

async function step($: Engine, effort: TurnStepInput['effort']) {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'opus', effort, messageCount: 1 })
  for await (const _ of stream) {
    // drain
  }
}

const prompt = ($: Engine, mode: string) => $.classic.UserPromptSubmit({ prompt: 'go', permission_mode: mode })

const stop = ($: Engine, mode: string) => $.classic.Stop({ stop_hook_active: false, permission_mode: mode })

const complete = ($: Engine, turnId: string) =>
  $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId, reason: 'answer' })

const work = async ($: Engine, times: number) => {
  for (let i = 0; i < times; i++) await $.tool.call({ tool: 'Bash', command: 'ls' })
}

const probe = async ($: Engine, args: string) => (await $.command.run({ command: 'probe', args, ...TYPED })) as { text: string }

// An agent spawned as the Agent tool spawns one, from the main loop.
const spawn = ($: Engine, description: string, subagentType: string) =>
  $.agent.spawn({
    tool_use_id: `call-${description}`,
    prompt: description,
    description,
    subagentType,
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  })

// The scene as this session last told the dashboard's panel, once what is
// under way has run.
async function lastTold(seen: Seen): Promise<{ state: FrameState; told: Told }> {
  await seen.clock.settle()
  const last = seen.written.filter(one => one.state !== undefined).at(-1)
  if (last?.state === undefined || last.told === undefined) throw new Error('the panel was told nothing')

  return { state: last.state, told: last.told }
}

// The words the panel puts under the picture, as mc-rice's
// tools/probe-frames.ts says them: the world's name, and the caption.
async function said(seen: Seen): Promise<Words> {
  const { state, told } = await lastTold(seen)
  return describe(toFrame(state), told)
}

async function shown(seen: Seen, text: RegExp) {
  const { name, caption } = await said(seen)
  expect(text.test(name) ? name : caption).toMatch(text)
}

async function hidden(seen: Seen, text: RegExp) {
  const { name, caption } = await said(seen)
  expect(`${name} · ${caption}`).not.toMatch(text)
}

// The craft Claude flies, as the panel draws it.
const flown = async (seen: Seen) => CRAFT[(await lastTold(seen)).state.craft]?.name

test('the world follows the effort level', async ($, on) => {
  const seen = engine(on, { effortLevel: 'medium' })
  await start($)
  await shown(seen, /^Mars$/)

  await $.command.run({ command: 'effort', args: 'max', ...TYPED })
  await shown(seen, /^Jupiter$/)

  const worlds = [['xhigh', 'Saturn'], ['low', 'The Moon'], ['high', 'Earth'], [4096, 'Neptune'], [undefined, 'Pluto']] as const
  for (const [level, name] of worlds) {
    await step($, level)
    await shown(seen, new RegExp(`^${name}$`))
  }
})

test('with no saved level the probe waits for the first request', async ($, on) => {
  const seen = engine(on, {})
  await start($)
  await shown(seen, /^Pluto$/)
  await shown(seen, /shows on the next turn/)
})

test('in the usual modes the orbit is charted as Claude works and complete when Claude stops', async ($, on) => {
  const seen = engine(on, { effortLevel: 'max' })
  await start($)

  await prompt($, 'default')
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await shown(seen, /default mode · orbiting\.\.\. 0% charted/)

  await work($, 8)
  await shown(seen, /orbiting\.\.\. 60% charted/)

  await stop($, 'default')
  await shown(seen, /orbit complete/)

  await complete($, 't1')
  await seen.clock.advance(ENDING_TICKS.orbit * TICK_MS + 200)
  await shown(seen, /orbit complete/)

  // The next turn charts a fresh orbit.
  await $.turn.start({ text: 'again', turnId: 't2' })
  await shown(seen, /orbiting\.\.\. 0% charted/)
})

test('in plan mode the probe surveys, the map made when Claude stops', async ($, on) => {
  const seen = engine(on, { effortLevel: 'high' })
  await start($)

  await prompt($, 'plan')
  await $.turn.start({ text: 'plan it', turnId: 't1' })
  await shown(seen, /plan mode · surveying\.\.\. 0% mapped/)
  await shown(seen, /^Earth$/)
  expect(await flown(seen)).toBe('Juno')

  await work($, 8)
  await shown(seen, /surveying\.\.\. 60% mapped/)

  await stop($, 'plan')
  await complete($, 't1')
  await seen.clock.advance(ENDING_TICKS.survey * TICK_MS + 200)
  await shown(seen, /survey complete/)
})

test('in auto mode the probe mines an asteroid that shatters when Claude stops', async ($, on) => {
  const seen = engine(on, { effortLevel: 'xhigh' })
  await start($)

  await prompt($, 'auto')
  await $.turn.start({ text: 'go', turnId: 't1' })
  await shown(seen, /auto mode · mining\.\.\. comet 0% cracked/)
  await shown(seen, /^Saturn$/)
  expect(await flown(seen)).toBe('Juno')

  await work($, 8)
  await shown(seen, /comet 60% cracked/)

  await stop($, 'auto')
  await shown(seen, /comet shattered/)
  await complete($, 't1')
  await seen.clock.advance(ENDING_TICKS.asteroid * TICK_MS + 200)
  await shown(seen, /comet shattered/)
})

test('a turn that saved the mod reloads it as the asteroid shatters, and the shatter plays out', async ($, on) => {
  const seen = engine(on, { effortLevel: 'xhigh' })
  await start($)

  await prompt($, 'auto')
  await $.turn.start({ text: 'go', turnId: 't1' })
  await work($, 8)
  await stop($, 'auto')
  await complete($, 't1')
  await seen.clock.advance(3 * TICK_MS)

  // The reload runs session.start again, a few ticks into the ending.
  await start($)
  await seen.clock.advance(3 * TICK_MS)
  const { state } = await lastTold(seen)
  expect(toFrame(state).target.kind).toBe('ending')

  await seen.clock.advance(ENDING_TICKS.asteroid * TICK_MS)
  expect((await lastTold(seen)).state.target.phase).toBe('gone')
  await shown(seen, /comet shattered/)
})

test('the harder Claude thinks, the tougher the asteroid', async ($, on) => {
  const seen = engine(on, { effortLevel: 'low' })
  await start($)

  await prompt($, 'auto')
  await $.turn.start({ text: 'go', turnId: 't1' })
  const rocks: readonly (readonly [TurnStepInput['effort'], string])[] = [
    ['low', 'stony asteroid'], ['medium', 'iron asteroid'], ['high', 'carbon asteroid'], ['xhigh', 'comet'], ['max', 'metal asteroid'],
  ]
  for (const [level, rock] of rocks) {
    await step($, level)
    await shown(seen, new RegExp(`mining\\.\\.\\. ${rock} \\d+% cracked`))
  }
})

test('/probe apollo flies Apollo 11 each turn: off the pad, out as far as the turn gets, into lunar orbit as Claude stops', async ($, on) => {
  const seen = engine(on, { effortLevel: 'high' })
  await start($)
  expect((await probe($, 'apollo')).text).toBe(
    'The probe will fly Apollo 11 to the Moon whatever the mode: each turn launches, a commit lands Eagle, a push puts Neil on the Moon.',
  )

  await prompt($, 'default')
  await $.turn.start({ text: 'go', turnId: 't1' })
  await shown(seen, /^Apollo 11$/)
  await shown(seen, /ignition/)
  await seen.clock.advance(2000)
  await shown(seen, /liftoff/)

  // Docked by 25.5 seconds in, then out toward the Moon as the turn gets on.
  await work($, 8)
  await seen.clock.advance(30_000)
  await shown(seen, /translunar coast · \d+,000 km$/)
  const out = (await lastTold(seen)).state.flown ?? 0
  expect(out).toBeGreaterThan(0.5)
  await work($, 8)
  await seen.clock.advance(3000)
  expect((await lastTold(seen)).state.flown ?? 0).toBeGreaterThan(out)

  await stop($, 'default')
  await complete($, 't1')
  await seen.clock.advance(ENDING_TICKS.apollo * TICK_MS + 200)
  await shown(seen, /lunar orbit · a commit lands Eagle/)

  // Nothing committed: the next turn goes on in lunar orbit, readying Eagle as it gets on.
  await $.turn.start({ text: 'again', turnId: 't2' })
  await shown(seen, /lunar orbit · burn to round it out/)
  await work($, 16)
  await seen.clock.advance(200)
  await shown(seen, /lunar orbit · Eagle ready · a commit lands it/)

  // A commit there lands Eagle at once.
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "Ready"' })
  await seen.clock.advance(11_000)
  await shown(seen, /the Eagle has landed/)
})

test('a commit lands Eagle at Tranquility Base, the next turn goes on from the Moon, and a push puts Neil on it to plant the flag', async ($, on) => {
  const seen = engine(on, { effortLevel: 'high' })
  await start($)
  await probe($, 'apollo')
  await $.turn.start({ text: 'commit it', turnId: 't1' })
  await seen.clock.advance(26_000)
  await $.tool.call({ tool: 'Bash', command: 'git add -A && git commit -m "Fix the shatter"' })
  await seen.clock.advance(500)
  await shown(seen, /translunar coast · \d+,000 km · go for landing/)

  await stop($, 'default')
  await complete($, 't1')
  await seen.clock.advance(20_000)
  await shown(seen, /the Eagle has landed · a push for the moonwalk/)

  // The next turn goes on from the Moon, where a push puts Neil on it.
  await $.turn.start({ text: 'push it', turnId: 't2' })
  await shown(seen, /Tranquility Base · EVA prep \d+%/)
  await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
  await seen.clock.advance(6500)
  await shown(seen, /one small step for man, one giant leap for mankind/)
  await seen.clock.advance(7000)
  await shown(seen, /the flag at Tranquility Base/)

  // The flag up, the mission done: the next turn launches another.
  await stop($, 'default')
  await complete($, 't2')
  await seen.clock.advance(1000)
  await shown(seen, /the flag at Tranquility Base/)
  await $.turn.start({ text: 'next', turnId: 't3' })
  await shown(seen, /ignition/)
})

test('a push alone lands Eagle and puts Neil on the Moon in the same turn, and a turn on the Moon without one stays there', async ($, on) => {
  const seen = engine(on, { effortLevel: 'high' })
  await start($)
  await probe($, 'apollo')
  await $.turn.start({ text: 'ship it', turnId: 't1' })
  await seen.clock.advance(26_000)
  await $.tool.call({ tool: 'Bash', command: 'git log --grep commit' })
  await seen.clock.advance(200)
  await shown(seen, /translunar coast · \d+,000 km$/)
  await $.tool.call({ tool: 'PowerShell', command: 'git push' })
  await seen.clock.advance(200)
  await shown(seen, /go for EVA/)

  await stop($, 'default')
  await complete($, 't1')
  await seen.clock.advance(32_000)
  await shown(seen, /the flag at Tranquility Base/)

  // The flag up, the next turn launches a new mission; a commit alone lands it,
  // and a turn on the Moon with neither stays there.
  await $.turn.start({ text: 'again', turnId: 't2' })
  await shown(seen, /ignition/)
  await $.tool.call({ tool: 'Bash', command: 'git commit -am wip' })
  await stop($, 'default')
  await complete($, 't2')
  await seen.clock.advance(20_000)
  await $.turn.start({ text: 'a question', turnId: 't3' })
  await shown(seen, /Tranquility Base · EVA prep/)
  await stop($, 'default')
  await complete($, 't3')
  await $.turn.start({ text: 'another', turnId: 't4' })
  await shown(seen, /Tranquility Base · EVA prep/)
})

test('a commit or pull request lands Eagle; a push or merge puts Neil on the Moon; nothing else does', () => {
  expect(moveOf('git commit -m "x"')).toBe('land')
  expect(moveOf('git add -A && git commit -q -F - <<EOF')).toBe('land')
  expect(moveOf('git -C pixel-probe commit -am x')).toBe('land')
  expect(moveOf('gh pr create --fill')).toBe('land')
  expect(moveOf('git push origin main')).toBe('step')
  expect(moveOf('cd repo; git merge feature')).toBe('step')
  expect(moveOf('gh pr merge 12 --squash')).toBe('step')
  expect(moveOf('git log --grep commit')).toBeUndefined()
  expect(moveOf('git commit-tree abc')).toBeUndefined()
  expect(moveOf('echo push')).toBeUndefined()
})

// Apollo 11 `tick` tenths of a second into a mission launched at 0, as `target` has it.
const flying = (tick: number | undefined, target: Partial<FrameState['target']> = {}, flown = 0.5): FrameState => ({
  effort: 'high',
  working: true,
  work: 6,
  tasks: null,
  target: { phase: 'whole', since: 0, scene: 'apollo', born: 0, ...target },
  helpers: {},
  world: null,
  craft: 0,
  tick,
  flown,
})

const flightOf = (tick: number, target: Partial<FrameState['target']> = {}) => toFrame(flying(tick, target))

test('Apollo 11 draws at every part of its flight, the same each time', { timeoutMs: 60_000 }, () => {
  const ended = { phase: 'ending' as const, since: 600, ended: 600 }
  const frames = [
    ...[5, 30, 60, 100, 140].map(tick => flightOf(tick)),
    ...[160, 200, 240].map(tick => flightOf(tick)),
    flightOf(400),
    ...[620, 660, 700].map(tick => flightOf(tick, ended)),
    ...[690, 760, 800].map(tick => flightOf(tick, { ...ended, landed: 300 })),
    ...[790, 850, 920, 980].map(tick => flightOf(tick, { ...ended, landed: 300, stepped: 300 })),
    flightOf(1100, { since: 1000, turn: 1000, landed: 300 }),
    ...[1050, 1100].map(tick => flightOf(tick, { since: 1000, turn: 1000, arrived: 900 })),
    flightOf(1100, { since: 1000, turn: 1000, arrived: 900, landed: 1060 }),
  ]
  for (const frame of frames) {
    const first = drawScene(frame, 66, 64)
    expect(first.color.length).toBe(66 * 64)
    expect(drawScene(frame, 66, 64).color).toEqual(first.color)
  }
  // A still picture, as the dashboard draws Apollo waiting: on the pad.
  const still = toFrame(flying(undefined))
  expect(describe(still, { level: 'high', seen: null, working: false }).caption).toBe('ignition · all engines running')
})

test('once the flag is up a drag or the wheel pulls the eye back until Earth hangs small and blue above the landing site', () => {
  const moonwalk = (tick: number) => flying(tick, { phase: 'ending', since: 600, ended: 600, landed: 300, stepped: 300 })
  const drawn = (state: FrameState, view?: FrameState['view']) => drawScene(toFrame({ ...state, ...(view ? { view } : {}) }), 160, 120).color
  // Earth's sea blue, greener than the flag's, in the upper half of the picture.
  const blue = (colors: Uint32Array) =>
    [...colors.subarray(0, 160 * 60)].filter(color => {
      const [r, g, b] = [(color >> 16) & 255, (color >> 8) & 255, color & 255]
      return b > r + 40 && g > r + 15 && b > 90
    }).length
  const dragged = { ...USUAL_VIEW, tip: 0.9 }
  const rolledOut = { ...USUAL_VIEW, zoom: 0.6 }

  // The flag up: the usual view is the picture as it was; pulled back, Earth is there.
  const flagUp = moonwalk(980)
  expect(drawn(flagUp, USUAL_VIEW)).toEqual(drawn(flagUp))
  expect(blue(drawn(flagUp))).toBe(0)
  expect(blue(drawn(flagUp, dragged))).toBeGreaterThan(0)
  expect(drawn(flagUp, rolledOut)).toEqual(drawn(flagUp, dragged))

  // Before the flag the drag leaves the picture alone.
  const onTheLadder = moonwalk(830)
  expect(drawn(onTheLadder, dragged)).toEqual(drawn(onTheLadder))
})

test("the Moon's craters are pressed in as slopes for the sun to catch, fewer on its seas than its highlands", () => {
  const face = moonChart(256)
  const bumps = face.bumps ?? new Float32Array(0)
  // How rough a patch of the face is, by latitude and longitude in degrees.
  const roughness = (south: number, north: number, west: number, east: number) => {
    let [sum, count] = [0, 0]
    for (let y = 0; y < face.height; y++) {
      const lat = 90 - ((y + 0.5) / face.height) * 180
      if (lat < south || lat > north) continue
      for (let x = 0; x < face.width; x++) {
        const lon = ((x + 0.5) / face.width) * 360 - 180
        if (lon < west || lon > east) continue
        sum += Math.hypot(bumps[2 * (y * face.width + x)] ?? 0, bumps[2 * (y * face.width + x) + 1] ?? 0)
        count++
      }
    }
    return sum / count
  }
  // The southern highlands against the Sea of Tranquility.
  expect(roughness(-35, -15, -5, 15)).toBeGreaterThan(roughness(2, 14, 24, 38) * 1.5)
})

test('a mode change mid-turn swaps the scene at once', async ($, on) => {
  const seen = engine(on, { effortLevel: 'high' })
  await start($)

  await prompt($, 'plan')
  await $.turn.start({ text: 'plan it', turnId: 't1' })
  await shown(seen, /surveying/)

  await $.classic.PostToolUse({ tool_name: 'ExitPlanMode', tool_input: {}, tool_response: {}, tool_use_id: 'x', permission_mode: 'acceptEdits' })
  await shown(seen, /acceptEdits mode · orbiting\.\.\. 0% charted/)
})

test('a Stop hook that sends Claude back to work keeps the orbit going', async ($, on) => {
  const seen = engine(on, { effortLevel: 'high' }, { block: 'not done yet' })
  await start($)

  await prompt($, 'default')
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await stop($, 'default')
  await shown(seen, /orbiting\.\.\./)
})

test('an interrupted turn leaves the target standing, progress and all', async ($, on) => {
  const seen = engine(on, { effortLevel: 'high' })
  await start($)

  await prompt($, 'plan')
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await work($, 8)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' })
  await shown(seen, /idle/)

  await $.turn.start({ text: 'go on', turnId: 't2' })
  await shown(seen, /60% mapped/)
})

test('progress grows with work and stops short of done', () => {
  expect(progressStage(0, null)).toBe(0)
  expect(progressStage(1, null)).toBe(1)
  expect(progressStage(8, null)).toBe(6)
  expect(progressStage(10_000, null)).toBe(9)
})

test('with a task list, progress follows the tasks done', () => {
  const list = (done: number, open: number): Tasks => ({
    ids: Object.fromEntries([
      ...Array.from({ length: done }, (_, i) => [`d${i}`, 'done'] as const),
      ...Array.from({ length: open }, (_, i) => [`o${i}`, 'open'] as const),
    ]),
    base: 10,
  })

  expect(progressStage(10, list(0, 4))).toBe(0)
  expect(progressStage(10, list(2, 2))).toBe(5)
  expect(progressStage(10, list(4, 0))).toBe(9)
})

test('task tools feed the progress', async ($, on) => {
  const seen = engine(on, { effortLevel: 'high' })
  await start($)

  await prompt($, 'plan')
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'one', description: 'first' })
  await $.tool.call({ tool: 'TodoWrite', todos: [
    { content: 'two', status: 'completed', activeForm: 'Doing two' },
    { content: 'three', status: 'completed', activeForm: 'Doing three' },
    { content: 'four', status: 'pending', activeForm: 'Doing four' },
  ] })
  // Two of four done, the work since creeping a little: 50%.
  await shown(seen, /50% mapped/)

  await $.tool.call({ tool: 'TaskUpdate', taskId: 'a', status: 'completed' })
  await shown(seen, /70% mapped/)
})

test('/probe keeps a scene, a world and a craft, across sessions, and lets each go again', async ($, on) => {
  const seen = engine(on, { effortLevel: 'low' })
  await start($)

  expect((await probe($, 'asteroid')).text).toBe('The probe will mine asteroids whatever the mode.')
  await prompt($, 'default')
  await $.turn.start({ text: 'go', turnId: 't1' })
  await shown(seen, /mining\.\.\. stony asteroid/)

  expect((await probe($, 'jupiter')).text).toMatch(/visits Jupiter whatever the effort/)
  await shown(seen, /^Jupiter$/)
  expect((await probe($, 'New  Horizons')).text).toMatch(/Claude flies New Horizons now/)
  expect(await flown(seen)).toBe('New Horizons')
  await shown(seen, /mining\.\.\. stony asteroid/)
  expect(Object.fromEntries(seen.stored)).toMatchObject({ scene: 'asteroid', world: 'jupiter', craft: 'New Horizons' })

  expect((await probe($, 'follow')).text).toBe('The scene follows the permission mode again.')
  await shown(seen, /orbiting\.\.\./)
  expect((await probe($, 'effort')).text).toBe('The effort level picks the world again.')
  await shown(seen, /^The Moon$/)
  expect((await probe($, 'juno')).text).toBe('Claude flies Juno again.')
  expect(await flown(seen)).toBe('Juno')
  expect(Object.fromEntries(seen.stored)).toMatchObject({ scene: null, world: null, craft: null })
})

test('what /probe kept is there when the next session starts', async ($, on) => {
  const seen = engine(on, { effortLevel: 'low' }, {}, { stored: { scene: 'survey', world: 'saturn', craft: 'Cassini' } })
  await start($)

  await shown(seen, /^Saturn$/)
  expect(await flown(seen)).toBe('Cassini')
  expect((await lastTold(seen)).state.target.scene).toBe('survey')
})

test('/probe off and on keep whether the dashboard draws the probe, in new sessions too, and no pane ever opens', async ($, on) => {
  const panel: { shows: string | undefined } = { shows: 'probe' }
  const seen = engine(on, { effortLevel: 'high' }, {}, { panel })
  await start($)
  // The dashboard draws the probe only once /probe on has asked for it.
  expect(seen.stored.has('hidden')).toBe(false)

  expect((await probe($, 'off')).text).toBe('The probe is off the dashboard, and stays off in new sessions: /probe on brings it back.')
  expect(seen.stored.get('hidden')).toBe(true)
  panel.shows = 'off'
  await start($)
  expect(seen.stored.get('hidden')).toBe(true)

  expect((await probe($, 'on')).text).toBe("The probe is on the dashboard, in Steve's place.")
  expect(seen.stored.get('hidden')).toBe(false)
  expect((await probe($, '')).text).toBe("The probe is on the dashboard, in Steve's place.")
  // Drawing it is the dashboard's alone: there is no picture here to draw finer.
  expect((await probe($, 'hd')).text).toMatch(/doesn't know "hd"/)
  expect((await probe($, 'warp drive')).text).toMatch(/doesn't know "warp drive"/)
  expect(seen.opened).toBe(0)
  expect(seen.closed).toEqual([])
})

test('a pane an earlier version left up beside the chat is closed as the session starts, and none opens', async ($, on) => {
  const seen = engine(on, { effortLevel: 'high' }, {}, { panes: ['probe', 'notes'] })
  await start($)
  expect(seen.closed).toEqual(['probe'])

  // A reload with it gone closes nothing more.
  await start($)
  expect(seen.closed).toEqual(['probe'])
  expect(seen.opened).toBe(0)
})

test('agents fly in as craft of their own, never the one Claude flies, and fly off when done', async ($, on) => {
  const seen = engine(on, { effortLevel: 'high' })
  await start($)
  await probe($, 'voyager')

  const ids = []
  for (const task of ['a', 'b', 'c']) ids.push((await spawn($, task, 'Explore')).agentId)
  await seen.clock.advance(500)

  const { caption } = await said(seen)
  expect(caption).toMatch(/3 agents: /)
  const names = caption.replace(/.*3 agents: /, '').split(', ')
  expect(names).toHaveLength(3)
  expect(new Set(names).size).toBe(3)
  expect(names).not.toContain('Voyager')
  for (const name of names) expect(CRAFT.some(craft => craft.name === name)).toBe(true)

  for (const agentId of ids) await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'a', reason: 'answer', agentId })
  await hidden(seen, /agents?: /)
  await seen.clock.advance(LEAVE_SECONDS * 1000 + 500)
  await hidden(seen, /agents?: /)
  // Flown off, they are drawn no more.
  expect((await lastTold(seen)).state.helpers).toEqual({})
})

test('sound stays off until asked for, and plays only while the dashboard draws the probe', async ($, on) => {
  const panel: { shows: string | undefined } = { shows: 'probe' }
  const seen = engine(on, { effortLevel: 'high' }, {}, { panel })
  await start($)

  const turn = async (turnId: string) => {
    await prompt($, 'default')
    await $.turn.start({ text: 'hi', turnId })
    await work($, 8)
    await stop($, 'default')
    await complete($, turnId)
    await seen.clock.advance(ENDING_TICKS.orbit * TICK_MS + 200)
  }
  await turn('t1')
  expect(seen.played).toBe(0)

  expect((await probe($, 'sound on')).text).toMatch(/sounds are on/)
  await turn('t2')
  expect(seen.played).toBeGreaterThan(0)

  // Steve in the dashboard's place, or no dashboard at all: nothing to hear.
  let before = seen.played
  panel.shows = 'steve'
  await seen.clock.advance(2100)
  await turn('t3')
  expect(seen.played).toBe(before)
  panel.shows = undefined
  await seen.clock.advance(2100)
  await turn('t4')
  expect(seen.played).toBe(before)

  // Drawn there again, heard again, until `sound` alone mutes it.
  panel.shows = 'probe'
  await seen.clock.advance(2100)
  await turn('t5')
  expect(seen.played).toBeGreaterThan(before)

  before = seen.played
  await probe($, 'sound')
  await turn('t6')
  expect(seen.played).toBe(before)
})

test('the view tips only so far and zooms only so near or far, keeping what is under the pointer there', () => {
  const tipped = turned(USUAL_VIEW, 0, 10)
  expect(tipped.tip).toBeLessThanOrEqual(0.9)
  expect(turned(USUAL_VIEW, 0, -10).tip).toBeGreaterThanOrEqual(-0.5)
  expect(turned(USUAL_VIEW, 0.5, 0).spin).toBe(1.5)

  expect(zoomed(USUAL_VIEW, -100).zoom).toBe(4)
  expect(zoomed(USUAL_VIEW, 100).zoom).toBe(0.6)
  // Zoomed in twice about a point, then out again about it: back where it began.
  const near = zoomed(zoomed(USUAL_VIEW, -1, [0.3, 0.2]), -1, [0.3, 0.2])
  const back = zoomed(zoomed(near, 1, [0.3, 0.2]), 1, [0.3, 0.2])
  const isNear = (value: number | undefined, to: number) => Math.abs((value ?? Infinity) - to) < 1e-9
  expect(isNear(back.zoom, 1) && isNear(back.pan[0], 0) && isNear(back.pan[1], 0)).toBe(true)
})

// A frame of `scene` at `world`, a few seconds in, Claude at work.
const frameOf = (scene: Scene, world: WorldName, effort: Effort = 'high', more: Partial<FrameState> = {}) =>
  toFrame({
    effort,
    working: true,
    work: 6,
    tasks: null,
    target: { phase: 'whole', since: 0, scene, born: 0 },
    helpers: {},
    world,
    craft: 0,
    tick: 70,
    ...more,
  })

// Each world's face and each sky is made the first time it is drawn at a size, a moment's work each.
test('every world draws in every scene, the same each time', { timeoutMs: 30_000 }, () => {
  for (const world of Object.keys(WORLDS) as WorldName[]) {
    for (const scene of ['orbit', 'survey', 'asteroid', 'apollo'] as const) {
      const first = drawScene(frameOf(scene, world), 66, 64)
      expect(first.color.length).toBe(66 * 64)
      expect(drawScene(frameOf(scene, world), 66, 64).color).toEqual(first.color)
    }
  }
})

test('the world sits lit in the middle of its orbit, dark on its far side', () => {
  const lit = (color: number) => ((color >> 16) & 255) + ((color >> 8) & 255) + (color & 255)
  const c = drawScene(frameOf('orbit', 'jupiter', 'max', { view: { spin: 0, tip: 0, zoom: 1, pan: [0, 0] } }), 100, 100)
  const at = (x: number, y: number) => c.color[y * 100 + x] ?? 0
  // Toward the sun, upper left of the middle, and away from it, at the lower right limb.
  expect(lit(at(42, 45))).toBeGreaterThan(lit(at(72, 66)) + 120)
  // The world is nearer the eye than the sky behind it.
  expect(c.depth[50 * 100 + 50]).toBeGreaterThan(0)
  expect(c.depth[2 * 100 + 2]).toBe(-Infinity)
})

test('a still picture shows everything in place, each agent at work and none leaving', () => {
  const state: FrameState = {
    effort: 'max', working: false, work: 0, tasks: null, world: null, craft: 0, tick: undefined,
    target: { phase: 'whole', since: 0, scene: 'orbit', born: 0 },
    helpers: { a: { name: 'Voyager', craft: 1, type: 'Explore', since: 0 }, b: { name: 'Dawn', craft: 4, type: 'Plan', since: 0, left: 0 } },
  }
  const frame = toFrame(state)
  expect(frame.target).toEqual({ kind: 'whole', arrival: 1 })
  expect(frame.crew.map(hand => hand.name)).toEqual(['Voyager'])
  expect(frame.world).toBe(WORLDS.jupiter)
  expect(frame.rock).toBe(ROCKS.max)
})

test("with the dashboard's panel drawing the probe it hears every change, a tick at a time", async ($, on) => {
  const seen = engine(on, { effortLevel: 'high' })
  await start($)
  await seen.clock.settle()
  expect(seen.written.length).toBeGreaterThan(0)

  await prompt($, 'plan')
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await seen.clock.advance(200)
  expect(seen.written.at(-1)?.state?.target.scene).toBe('survey')
  expect(seen.written.at(-1)?.told?.seen).toBe('plan')
  // The camera is the panel's own, as its mouse turns it.
  expect(seen.written.at(-1)?.state?.view).toBeUndefined()

  const before = seen.written.length
  await seen.clock.advance(1000)
  const ticks = seen.written.slice(before).map(one => one.state?.tick)
  expect(ticks.length).toBeGreaterThanOrEqual(9)
  expect(ticks.length).toBeLessThanOrEqual(11)
  expect(new Set(ticks).size).toBe(ticks.length)

  await stop($, 'plan')
  await seen.clock.settle()
  expect(seen.written.at(-1)?.state?.target.phase).toBe('ending')

  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } })
  expect(seen.written.at(-1)).toEqual({ v: 1, ended: true })
})

test("with Steve or Jarvis in the dashboard's place the probe is untold, and /probe on says what frees the place", async ($, on) => {
  const panel: { shows: string | undefined } = { shows: 'steve' }
  const seen = engine(on, { effortLevel: 'high' }, {}, { panel })
  await start($)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await seen.clock.advance(1000)
  expect(seen.written).toEqual([])

  expect((await probe($, 'on')).text).toBe("Steve has the dashboard's panel: /steve off, and the probe takes over.")
  panel.shows = 'jarvis'
  expect((await probe($, 'on')).text).toBe("Jarvis has the dashboard's panel: /jarvis off and /steve off, and the probe takes over.")
  expect(seen.written).toEqual([])

  // /jarvis off and /steve off: the panel draws the probe, and hears from this session.
  panel.shows = 'probe'
  await seen.clock.advance(2100)
  expect(seen.written.at(-1)?.state).toBeDefined()
  expect((await probe($, 'on')).text).toBe("The probe is on the dashboard, in Steve's place.")
  expect(seen.opened).toBe(0)
})

test("as the dashboard's panel goes the probe is untold, and told again as it comes back", async ($, on) => {
  const panel: { shows: string | undefined } = { shows: 'probe' }
  const seen = engine(on, { effortLevel: 'high' }, {}, { panel })
  await start($)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await seen.clock.advance(300)
  expect(seen.written.length).toBeGreaterThan(0)

  panel.shows = undefined
  await seen.clock.advance(2100)
  const before = seen.written.length
  await seen.clock.advance(1000)
  expect(seen.written.length).toBe(before)

  panel.shows = 'probe'
  await seen.clock.advance(2100)
  expect(seen.written.length).toBeGreaterThan(before)
  expect(seen.opened).toBe(0)
})

test("with the dashboard's panel down nothing is told, and /probe on says the probe shows only there", async ($, on) => {
  const seen = engine(on, { effortLevel: 'high' }, {}, { panel: { shows: undefined } })
  await start($)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await seen.clock.advance(1000)
  expect(seen.written).toEqual([])
  expect((await probe($, 'on')).text).toBe("The probe is on: it shows only on mc-rice's dashboard, and none is round this shell.")
  expect(seen.opened).toBe(0)
})

test('outside kitty there is no dashboard to tell, and /probe on says so', async ($, on) => {
  const seen = engine(on, { effortLevel: 'high' }, {}, { env: {} })
  await start($)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await seen.clock.advance(1000)
  expect(seen.written).toEqual([])
  expect((await probe($, 'on')).text).toBe("The probe is on: it shows only on mc-rice's dashboard, and none is round this shell.")
  expect(seen.opened).toBe(0)
})

test("after /clear Claude goes on, and so does the dashboard's panel; after an exit it hears no more", async ($, on) => {
  const seen = engine(on, { effortLevel: 'high' })
  await start($)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await seen.clock.advance(300)

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  await seen.clock.advance(300)
  expect(seen.written.some(one => one.ended)).toBe(false)
  expect(seen.written.at(-1)?.state).toBeDefined()

  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's2', resume: { id: 's2' } })
  await seen.clock.advance(1000)
  expect(seen.written.at(-1)).toEqual({ v: 1, ended: true })
})

test("after /resume Claude goes on with the resumed session, and so does the dashboard's panel", async ($, on) => {
  const seen = engine(on, { effortLevel: 'high' })
  await start($)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await seen.clock.advance(300)

  // The fresh session gives way to the resumed one, in the same process.
  await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })
  await seen.clock.advance(300)
  expect(seen.written.some(one => one.ended)).toBe(false)

  await $.turn.start({ text: 'back again', turnId: 't2' })
  await seen.clock.advance(300)
  expect(seen.written.at(-1)?.state).toBeDefined()
})

test('a turn after the session was said to end tells the panel again', async ($, on) => {
  const seen = engine(on, { effortLevel: 'high' })
  await start($)
  await seen.clock.advance(300)
  await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
  await seen.clock.advance(300)
  expect(seen.written.at(-1)).toEqual({ v: 1, ended: true })

  await $.turn.start({ text: 'still here', turnId: 't1' })
  await seen.clock.advance(300)
  expect(seen.written.at(-1)?.state).toBeDefined()
})
