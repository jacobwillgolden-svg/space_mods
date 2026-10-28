import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnStepInput } from 'claude-code'

import { CRAFT } from '../hooks/craft'
import { ENDING_TICKS, LEAVE_SECONDS, TICK_MS, progressStage, toFrame } from '../hooks/frame'
import type { FrameState } from '../hooks/frame'
import { SVG_LIMIT, toSvg } from '../hooks/pixels'
import { ROCKS } from '../hooks/rock'
import { USUAL_VIEW, drawScene, fitBlocks, fitHD, turned, zoomed } from '../hooks/scene'
import type { Steering } from '../hooks/steer'
import { WORLDS } from '../hooks/worlds'
import type { Effort, Scene, Tasks, WorldName } from '../types'

const PANE = {
  plugin: 'pixel-probe',
  component: 'Pane',
  requestId: 'probe',
  props: {
    title: 'Probe',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

// Nothing sits beneath the plugin: each hook here stands for the engine, the
// Stop hooks answering `stop` and TaskCreate making task `a`. It keeps the
// store in `stored`, counts the panes opened and the clips played, and notes
// the panes closed. `given` is what the store holds and which panes are up
// before the session starts, as a pane left up across a reload is.
function engine(
  on: On,
  settings: Record<string, unknown>,
  stop: { block?: string } = {},
  given: { stored?: Record<string, unknown>; panes?: readonly string[] } = {},
) {
  const seen = { opened: 0, closed: [] as string[], played: 0, stored: new Map(Object.entries(given.stored ?? {})) }
  const up = new Set<string>(given.panes)

  mock.env(on, {})
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

async function shown($: Engine, text: RegExp) {
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text }))?.text).toBeDefined()
    await ui.unmount()
  }
}

async function hidden($: Engine, text: RegExp) {
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text })).toBeUndefined()
  await ui.unmount()
}

// What the desktop's still picture says it shows.
async function altText($: Engine): Promise<string> {
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const found = await ui.find({ type: 'Svg' })
  await ui.unmount()
  return (found?.props as { alt: string }).alt
}

test('the world follows the effort level, on every surface', async ($, on) => {
  engine(on, { effortLevel: 'medium' })
  await start($)
  await shown($, /^Mars$/)

  await $.command.run({ command: 'effort', args: 'max', ...TYPED })
  await shown($, /^Jupiter$/)

  const worlds = [['xhigh', 'Saturn'], ['low', 'The Moon'], ['high', 'Earth'], [4096, 'Neptune'], [undefined, 'Pluto']] as const
  for (const [level, name] of worlds) {
    await step($, level)
    await shown($, new RegExp(`^${name}$`))
  }
})

test('with no saved level the probe waits for the first request', async ($, on) => {
  engine(on, {})
  await start($)
  await shown($, /^Pluto$/)
  await shown($, /shows on the next turn/)
})

test('in the usual modes the orbit is charted as Claude works and complete when Claude stops', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { effortLevel: 'max' })
  await start($)

  await prompt($, 'default')
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await shown($, /default mode · orbiting\.\.\. 0% charted/)

  await work($, 8)
  await shown($, /orbiting\.\.\. 60% charted/)

  await stop($, 'default')
  await shown($, /orbit complete/)

  await complete($, 't1')
  await clock.advance(ENDING_TICKS.orbit * TICK_MS + 200)
  await shown($, /orbit complete/)

  // The next turn charts a fresh orbit.
  await $.turn.start({ text: 'again', turnId: 't2' })
  await shown($, /orbiting\.\.\. 0% charted/)
})

test('in plan mode the probe surveys, the map made when Claude stops', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { effortLevel: 'high' })
  await start($)

  await prompt($, 'plan')
  await $.turn.start({ text: 'plan it', turnId: 't1' })
  await shown($, /plan mode · surveying\.\.\. 0% mapped/)
  expect(await altText($)).toBe('Juno surveying Earth')

  await work($, 8)
  await shown($, /surveying\.\.\. 60% mapped/)

  await stop($, 'plan')
  await complete($, 't1')
  await clock.advance(ENDING_TICKS.survey * TICK_MS + 200)
  await shown($, /survey complete/)
})

test('in auto mode the probe mines an asteroid that shatters when Claude stops', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { effortLevel: 'xhigh' })
  await start($)

  await prompt($, 'auto')
  await $.turn.start({ text: 'go', turnId: 't1' })
  await shown($, /auto mode · mining\.\.\. comet 0% cracked/)
  expect(await altText($)).toBe('Juno mining a comet near Saturn')

  await work($, 8)
  await shown($, /comet 60% cracked/)

  await stop($, 'auto')
  await shown($, /comet shattered/)
  await complete($, 't1')
  await clock.advance(ENDING_TICKS.asteroid * TICK_MS + 200)
  await shown($, /comet shattered/)
})

test('the harder Claude thinks, the tougher the asteroid', async ($, on) => {
  mock.clock(on)
  engine(on, { effortLevel: 'low' })
  await start($)

  await prompt($, 'auto')
  await $.turn.start({ text: 'go', turnId: 't1' })
  const rocks: readonly (readonly [TurnStepInput['effort'], string])[] = [
    ['low', 'stony asteroid'], ['medium', 'iron asteroid'], ['high', 'carbon asteroid'], ['xhigh', 'comet'], ['max', 'metal asteroid'],
  ]
  for (const [level, rock] of rocks) {
    await step($, level)
    await shown($, new RegExp(`mining\\.\\.\\. ${rock} \\d+% cracked`))
  }
})

test('a mode change mid-turn swaps the scene at once', async ($, on) => {
  mock.clock(on)
  engine(on, { effortLevel: 'high' })
  await start($)

  await prompt($, 'plan')
  await $.turn.start({ text: 'plan it', turnId: 't1' })
  await shown($, /surveying/)

  await $.classic.PostToolUse({ tool_name: 'ExitPlanMode', tool_input: {}, tool_response: {}, tool_use_id: 'x', permission_mode: 'acceptEdits' })
  await shown($, /acceptEdits mode · orbiting\.\.\. 0% charted/)
})

test('a Stop hook that sends Claude back to work keeps the orbit going', async ($, on) => {
  mock.clock(on)
  engine(on, { effortLevel: 'high' }, { block: 'not done yet' })
  await start($)

  await prompt($, 'default')
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await stop($, 'default')
  await shown($, /orbiting\.\.\./)
})

test('an interrupted turn leaves the target standing, progress and all', async ($, on) => {
  mock.clock(on)
  engine(on, { effortLevel: 'high' })
  await start($)

  await prompt($, 'plan')
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await work($, 8)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' })
  await shown($, /idle/)

  await $.turn.start({ text: 'go on', turnId: 't2' })
  await shown($, /60% mapped/)
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
  mock.clock(on)
  engine(on, { effortLevel: 'high' })
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
  await shown($, /50% mapped/)

  await $.tool.call({ tool: 'TaskUpdate', taskId: 'a', status: 'completed' })
  await shown($, /70% mapped/)
})

test('/probe keeps a scene, a world and a craft, across sessions, and lets each go again', async ($, on) => {
  mock.clock(on)
  const seen = engine(on, { effortLevel: 'low' })
  await start($)

  expect((await probe($, 'asteroid')).text).toBe('The probe will mine asteroids whatever the mode.')
  await prompt($, 'default')
  await $.turn.start({ text: 'go', turnId: 't1' })
  await shown($, /mining\.\.\. stony asteroid/)

  expect((await probe($, 'jupiter')).text).toMatch(/visits Jupiter whatever the effort/)
  await shown($, /^Jupiter$/)
  expect((await probe($, 'New  Horizons')).text).toMatch(/Claude flies New Horizons now/)
  expect(await altText($)).toBe('New Horizons mining a stony asteroid near Jupiter')
  expect(Object.fromEntries(seen.stored)).toMatchObject({ scene: 'asteroid', world: 'jupiter', craft: 'New Horizons' })

  expect((await probe($, 'follow')).text).toBe('The scene follows the permission mode again.')
  await shown($, /orbiting\.\.\./)
  expect((await probe($, 'effort')).text).toBe('The effort level picks the world again.')
  await shown($, /^The Moon$/)
  expect((await probe($, 'juno')).text).toBe('Claude flies Juno again.')
  expect(Object.fromEntries(seen.stored)).toMatchObject({ scene: null, world: null, craft: null })
})

test('what /probe kept is there when the next session starts', async ($, on) => {
  mock.clock(on)
  engine(on, { effortLevel: 'low' }, {}, { stored: { scene: 'survey', world: 'saturn', craft: 'Cassini' } })
  await start($)

  await shown($, /^Saturn$/)
  expect(await altText($)).toBe('Cassini surveying Saturn')
})

test('/probe off closes the pane and keeps it closed in new sessions; /probe on brings it back', async ($, on) => {
  mock.clock(on)
  const seen = engine(on, { effortLevel: 'high' })
  await start($)
  expect(seen.opened).toBe(1)

  expect((await probe($, 'off')).text).toMatch(/stays off in new sessions/)
  expect(seen.closed).toEqual(['probe'])
  await start($)
  expect(seen.opened).toBe(1)

  expect((await probe($, 'on')).text).toBe('The probe is beside the chat.')
  expect(seen.opened).toBe(2)
  expect((await probe($, 'warp drive')).text).toMatch(/doesn't know "warp drive"/)
})

test('agents fly in as craft of their own, never the one Claude flies, and fly off when done', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { effortLevel: 'high' })
  await start($)
  await probe($, 'voyager')

  const ids = []
  for (const task of ['a', 'b', 'c']) ids.push((await spawn($, task, 'Explore')).agentId)
  await clock.advance(500)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const caption = (await ui.find({ type: 'Text', text: /3 agents: / }))?.text ?? ''
  await ui.unmount()
  const names = caption.replace(/.*3 agents: /, '').split(', ')
  expect(names).toHaveLength(3)
  expect(new Set(names).size).toBe(3)
  expect(names).not.toContain('Voyager')
  for (const name of names) expect(CRAFT.some(craft => craft.name === name)).toBe(true)

  for (const agentId of ids) await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'a', reason: 'answer', agentId })
  await hidden($, /agents?: /)
  await clock.advance(LEAVE_SECONDS * 1000 + 500)
  await hidden($, /agents?: /)
})

test('sound stays off until asked for, and plays while the pane shows', async ($, on) => {
  const clock = mock.clock(on)
  const seen = engine(on, { effortLevel: 'high' })
  await start($)

  const turn = async (turnId: string) => {
    await prompt($, 'default')
    await $.turn.start({ text: 'hi', turnId })
    await work($, 8)
    await stop($, 'default')
    await complete($, turnId)
    await clock.advance(ENDING_TICKS.orbit * TICK_MS + 200)
  }
  await turn('t1')
  expect(seen.played).toBe(0)

  expect((await probe($, 'sound on')).text).toMatch(/sounds are on/)
  await turn('t2')
  expect(seen.played).toBeGreaterThan(0)

  const before = seen.played
  await probe($, 'sound')
  await turn('t3')
  expect(seen.played).toBe(before)
})

test('/probe hd draws real pixels where the terminal can, blocks where it cannot', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { effortLevel: 'high' })
  let refusal: string | undefined
  on('ui.blit', () => ({ value: refusal === undefined ? {} : { deny: refusal } }))
  await start($)

  const drawn = async (surface: (typeof SURFACES)[number] = 'terminal', query: { key?: string; type?: string; text?: RegExp } = { key: 'scene' }) => {
    const ui = await $.ui.mount({ ...PANE, surface })
    const found = await ui.find(query)
    await ui.unmount()
    return found
  }

  expect((await drawn())?.type).toBe('Raster')

  await probe($, 'hd')
  expect((await drawn())?.type).toBe('Image')
  await clock.advance(400)
  expect((await drawn())?.type).toBe('Image')

  // Where the terminal draws the alt instead, every probe is refused: blocks, and why.
  refusal = 'no placeholder images'
  await probe($, 'hd')
  expect((await drawn())?.type).toBe('Image')
  await clock.advance(3500)
  expect((await drawn())?.type).toBe('Raster')
  expect(await drawn('terminal', { type: 'Text', text: /HD off here: no placeholder images/ })).toBeDefined()

  await probe($, 'blocks')
  expect((await drawn())?.type).toBe('Raster')
  expect(await drawn('desktop', { type: 'Svg' })).toBeDefined()
})

test('the picture fills the pane: blocks two pixels a row, HD the same box in finer pixels', async ($, on) => {
  mock.clock(on)
  engine(on, { effortLevel: 'high' })
  on('ui.blit', () => ({ value: {} }))
  await start($)

  expect(fitBlocks(66, 36)).toEqual({ width: 66, height: 64 })
  expect(fitHD(100, 60, 384)).toEqual({ columns: 100, rows: 50, width: 384, height: 384 })
  expect(fitHD(160, 40, 384)).toEqual({ columns: 160, rows: 36, width: 768, height: 346 })

  const scene = async (bodyColumns: number, bodyRows: number) => {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns, scroll: { offset: 0, bodyRows } } })
    const found = await ui.find({ key: 'scene' })
    await ui.unmount()
    return found?.props
  }
  expect(await scene(66, 36)).toMatchObject({ columns: 66, rows: 32 })

  await probe($, 'hd')
  expect(await scene(100, 60)).toMatchObject({ columns: 100, rows: 50, source: { width: 384, height: 384 } })
  expect(await scene(160, 40)).toMatchObject({ columns: 160, rows: 36, source: { width: 768, height: 346 } })
})

test('the wheel zooms about the pointer, a drag spins and tips the world, a right click puts it back', async ($, on) => {
  mock.clock(on)
  engine(on, { effortLevel: 'max' })
  await start($)

  const picture = async () => {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const found = await ui.find({ key: 'scene' })
    await ui.unmount()
    return JSON.stringify(found?.props)
  }
  const post = async (data: Steering) => {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.post(data)
    await ui.unmount()
  }
  const usual = await picture()

  const scrolled = await $.ui.scroll({
    component: 'Pane', requestId: 'probe', offset: 0, by: -1, bodyRows: 40, contentRows: 40,
    origin: { kind: 'person' }, pointer: { column: 5, row: 5 },
  })
  expect(scrolled).toEqual({})
  const zoomedIn = await picture()
  expect(zoomedIn).not.toBe(usual)

  await post({ drag: { n: 1, across: 0.25, down: 0.1, isDone: true } })
  const dragged = await picture()
  expect(dragged).not.toBe(zoomedIn)

  // A finished drag's straggler, handled late, changes nothing.
  await post({ drag: { n: 1, across: 0.6, down: 0, isDone: false } })
  expect(await picture()).toBe(dragged)

  const clicking = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clicking.pointer({ type: 'down', x: 4, y: 4, button: 'right' })
  await clicking.unmount()
  expect(await picture()).toBe(usual)
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
test('every world draws in every scene, the same each time, and fits an Svg', { timeoutMs: 30_000 }, () => {
  for (const world of Object.keys(WORLDS) as WorldName[]) {
    for (const scene of ['orbit', 'survey', 'asteroid'] as const) {
      const first = drawScene(frameOf(scene, world), 66, 64)
      expect(first.color.length).toBe(66 * 64)
      expect(drawScene(frameOf(scene, world), 66, 64).color).toEqual(first.color)
      expect(toSvg(drawScene(frameOf(scene, world), 128), 12).length).toBeLessThan(SVG_LIMIT)
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
