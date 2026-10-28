import { atom, read, update } from 'claude-code'
import type { EngineInterface, ImageSource, Register, Timer } from 'claude-code'

import type { Effort, Scene, Tasks, View, WorldName } from '../types'
import { describe } from './caption'
import type { Told } from './caption'
import { CRAFT } from './craft'
import { ENDING_TICKS, LEAVE_SECONDS, TICK_MS, progressStage, sceneFor, toFrame } from './frame'
import type { Frame, FrameState } from './frame'
import { SVG_LIMIT, cellsOf, toCells, toRgba, toSvg } from './pixels'
import { USUAL_VIEW, drawScene, fitBlocks, fitHD, turned, zoomed } from './scene'
import { cue, cueLeaving } from './sound'
import type { Steering } from './steer'
import { WORLDS } from './worlds'

const PANE = 'probe'

const effort = atom({ plugin: 'pixel-probe', key: 'effort' } as const, null)
const isWorking = atom({ plugin: 'pixel-probe', key: 'isWorking' } as const, false)
const tick = atom({ plugin: 'pixel-probe', key: 'tick' } as const, 0)
const work = atom({ plugin: 'pixel-probe', key: 'work' } as const, 0)
const tasks = atom({ plugin: 'pixel-probe', key: 'tasks' } as const, null)
const target = atom({ plugin: 'pixel-probe', key: 'target' } as const, { phase: 'whole', since: -1000, scene: 'orbit', born: -1000 })
const mode = atom({ plugin: 'pixel-probe', key: 'mode' } as const, null)
const pinned = atom({ plugin: 'pixel-probe', key: 'pinned' } as const, null)
const world = atom({ plugin: 'pixel-probe', key: 'world' } as const, null)
const craft = atom({ plugin: 'pixel-probe', key: 'craft' } as const, null)
const hd = atom({ plugin: 'pixel-probe', key: 'hd' } as const, false)
const hdDenied = atom({ plugin: 'pixel-probe', key: 'hdDenied' } as const, null)
const labels = atom({ plugin: 'pixel-probe', key: 'labels' } as const, false)
const view = atom({ plugin: 'pixel-probe', key: 'view' } as const, USUAL_VIEW)
const helpers = atom({ plugin: 'pixel-probe', key: 'helpers' } as const, {})

// How long an agent's craft takes to fly off, and how often the agents are
// checked against the session's own list, in ticks.
const LEAVE_TICKS = Math.ceil((LEAVE_SECONDS * 1000) / TICK_MS)
const RECONCILE_TICKS = 50
// Between turns the world turns on, slowly: a tick this often, not ten a second.
const DRIFT_MS = 1000

// The HD picture's height in pixels, its width as the pane's box has it,
// scaled by the terminal to fill it: fine enough for the craft's panels and
// the agents' names, and light enough to resend ten times a second. Each of
// the scene's pixels is drawn CHUNK by CHUNK of them, so it still reads as
// pixel art, only finer than the blocks.
const HD_PIXELS = 384
const CHUNK = 2
// The waits before each probe of the HD picture: one not yet mounted gets the
// next chance, and one refused every time never will be.
const HD_PROBE_MS = [300, 700, 2000]

const LEVELS: readonly unknown[] = ['low', 'medium', 'high', 'xhigh', 'max']
const SCENES: readonly unknown[] = ['orbit', 'survey', 'asteroid']

const toLevel = (value: unknown): Effort | undefined =>
  LEVELS.includes(value) ? (value as Effort) : undefined

const toScene = (value: unknown): Scene | undefined =>
  SCENES.includes(value) ? (value as Scene) : undefined

const toWorld = (value: unknown): WorldName | undefined =>
  typeof value === 'string' && Object.hasOwn(WORLDS, value) ? (value as WorldName) : undefined

// The craft a name (any case) is, if any craft goes by it.
const craftOf = (name: string | null) => {
  const found = name === null ? -1 : CRAFT.findIndex(one => one.name.toLowerCase() === name.toLowerCase())
  return found < 0 ? undefined : found
}

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Probe', rows: 36, columns: 66 })

const isPaneShown = async ($: EngineInterface) =>
  (await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown && pane.isPlaced)

// The animation clock ticks ten times a second while Claude works, an
// ending plays or an agent's craft flies; between, once a second, the world
// turning slowly while the pane shows. Background agents outlive the turn.
let ticker: Timer | undefined
let pace = 0
let isTurnRunning = false
let animateUntil = 0

function tickEvery($: EngineInterface, ms: number) {
  if (ticker !== undefined && pace === ms) return

  ticker?.cancel()
  pace = ms
  ticker = $.clock.every(ms, () => void advance($))
}

const startTicking = ($: EngineInterface) => tickEvery($, TICK_MS)

async function advance($: EngineInterface) {
  if (pace === DRIFT_MS && !(await isPaneShown($))) return

  const now = await update($, tick, n => n + 1)
  const crew = await update($, helpers, all => {
    const played = Object.entries(all).filter(([, helper]) => helper.left !== undefined && now - helper.left >= LEAVE_TICKS)
    return played.length === 0 ? all : Object.fromEntries(Object.entries(all).filter(([id]) => !played.some(([gone]) => gone === id)))
  })
  const count = Object.keys(crew).length
  if (count > 0 && now % RECONCILE_TICKS === 0) void reconcile($)
  if (isTurnRunning || now < animateUntil || count > 0) return

  // The target as it is now: a turn may have brought a fresh one meanwhile.
  await update($, target, current => (current.phase === 'ending' ? { ...current, phase: 'gone' as const, since: now } : current))
  tickEvery($, DRIFT_MS)
}

// What the picture is drawn from, read in one go: the frame's state, and
// what the caption tells besides. `isLive` where the picture moves; a still
// picture is drawn without the tick.
async function sceneState($: EngineInterface, isLive: boolean): Promise<{ state: FrameState; told: Told }> {
  const level = await read($, effort)
  const working = await read($, isWorking)
  const state: FrameState = {
    effort: level,
    working,
    work: await read($, work),
    tasks: await read($, tasks),
    target: await read($, target),
    helpers: await read($, helpers),
    world: await read($, world),
    craft: craftOf(await read($, craft)) ?? 0,
    isLabeled: await read($, labels),
    view: await read($, view),
    tick: isLive ? await read($, tick) : undefined,
  }

  return { state, told: { level, seen: await read($, mode), working } }
}

// The agents this session spawned, by agent id: what kind each is, the craft
// it flies and whether it is on screen, kept while their turns come and go.
// Kept here rather than in $.state, so agents spawned together each pick a
// craft knowing the others' picks. The engine's own loops (compaction,
// memory) are never spawned, so never here, and never shown.
const agents = new Map<string, { type: string; craft: number; name: string; isHere: boolean }>()

// The craft Claude flies, kept beside `craft` for the casting below, which can't wait on state.
let claudeFlies = 0

// A craft for agent `id`: one no one on screen flies, Claude included, picked
// by the id so the same agent flies the same craft; any, once all are taken.
function castFor(id: string): { craft: number; name: string } {
  const taken = new Set([claudeFlies, ...[...agents].filter(([other, agent]) => other !== id && agent.isHere).map(([, agent]) => agent.craft)])
  const free = CRAFT.map((_, i) => i).filter(i => !taken.has(i))
  const pool = free.length > 0 ? free : CRAFT.map((_, i) => i).filter(i => i !== claudeFlies)
  const luck = [...id].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7)
  const craftIndex = pool[luck % pool.length] ?? 1

  return { craft: craftIndex, name: CRAFT[craftIndex]?.name ?? 'Probe' }
}

// An agent at work: its craft flies in, or, a teammate back for another turn,
// again, in the same craft unless Claude or another took it meanwhile.
async function arrive($: EngineInterface, id: string) {
  const agent = agents.get(id)
  if (!agent) return

  const isTaken = agent.craft === claudeFlies || [...agents].some(([other, one]) => other !== id && one.isHere && one.craft === agent.craft)
  if (!agent.isHere && isTaken) Object.assign(agent, castFor(id))
  agent.isHere = true
  const now = await read($, tick)
  await update($, helpers, all => {
    const here = all[id]
    if (here && here.left === undefined) return all

    const { name, craft: flies, type } = agent
    return { ...all, [id]: { name, craft: flies, type, since: now } }
  })
  startTicking($)
}

// An agent done: its craft fires its engine and flies off, fading.
async function depart($: EngineInterface, id: string) {
  const agent = agents.get(id)
  if (agent) agent.isHere = false
  const now = await read($, tick)
  let isLeaving = false
  await update($, helpers, all => {
    const here = all[id]
    if (!here || here.left !== undefined) return all

    isLeaving = true
    return { ...all, [id]: { ...here, left: now } }
  })
  if (!isLeaving) return

  startTicking($)
  await cueLeaving($)
}

// An agent whose end went unheard (killed, failed) is let go when the
// session's own list says it is over. Workflow agents are not on that list.
async function reconcile($: EngineInterface) {
  const listed = await $.agent.list().catch(() => [])
  const over = new Set(['completed', 'failed', 'killed'])
  for (const info of listed) {
    if (over.has(info.status)) await depart($, info.id)
  }
}

// A fresh target: the orbit's chart begins, the survey's map, an asteroid drifts in.
async function freshTarget($: EngineInterface, scene: Scene) {
  const now = await read($, tick)
  await update($, target, () => ({ phase: 'whole' as const, since: now, scene, born: now }))
  await cue($, scene, 'arrive')
}

const stageNow = async ($: EngineInterface) => progressStage(await read($, work), await read($, tasks))

// Each stage Claude gets past `before` sounds: a tick, a chirp, the laser.
async function noteStage($: EngineInterface, before: number): Promise<number> {
  const now = await stageNow($)
  const current = await read($, target)
  if (now > before && current.phase === 'whole') await cue($, current.scene, 'stage')

  return now
}

// Claude stopped: the orbit closes, the map is made, the asteroid shatters.
async function finishTarget($: EngineInterface) {
  const current = await read($, target)
  if (current.phase !== 'whole') return

  const now = await read($, tick)
  await update($, target, live => (live.phase === 'whole' ? { ...live, phase: 'ending' as const, since: now } : live))
  animateUntil = now + ENDING_TICKS[current.scene]
  startTicking($)
  await cue($, current.scene, 'end')
}

// A standing target of another scene is swapped for a fresh one; one already
// ending plays out, and the next turn brings the new scene.
async function showScene($: EngineInterface, scene: Scene) {
  const current = await read($, target)
  if (current.phase !== 'whole' || current.scene === scene) return

  await freshTarget($, scene)
}

// The classic hooks report the permission mode; the scene follows it.
async function noteMode($: EngineInterface, seen: string | undefined) {
  if (seen === undefined) return

  if ((await read($, mode)) !== seen) await update($, mode, () => seen)
  await showScene($, (await read($, pinned)) ?? sceneFor(seen))
}

async function pin($: EngineInterface, scene: Scene | null) {
  await update($, pinned, () => scene)
  await $.store.set('scene', scene)
  await showScene($, scene ?? sceneFor(await read($, mode)))
}

// Whether the terminal shows the HD picture is known only once it is mounted:
// a blit to it is refused where the terminal draws its alt text instead. Then
// the probe goes back to blocks for this session, saying why.
let isProbed = false

function probeHD($: EngineInterface, source: ImageSource, attempt = 0) {
  if (attempt === 0 && isProbed) return

  isProbed = true
  $.clock.after(HD_PROBE_MS[attempt] ?? 0, () => {
    void $.ui.blit({ requestId: PANE, key: 'scene', source }).then(
      async ({ deny }) => {
        if (deny === undefined) return
        if (attempt + 1 < HD_PROBE_MS.length) probeHD($, source, attempt + 1)
        else await update($, hdDenied, () => deny)
      },
      () => undefined,
    )
  })
}

// /probe's words, and what each says once done.
const ON_OFF = (asked: string, word: string) => asked === word || asked === `${word} on` || asked === `${word} off`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'probe',
      description:
        'Show the probe beside the chat: /probe on|off, hd|blocks picks how it is drawn, orbit|survey|asteroid|follow the scene, ' +
        'moon|mars|earth|saturn|jupiter|neptune|pluto the world (effort: the effort picks it), juno|voyager|cassini|... the craft Claude flies, ' +
        'labels on|off names over the craft, sound on|off',
    })
    await update($, isWorking, () => false)
    // A reload stops the clock, so an ending in flight finishes at once.
    await update($, target, current => (current.phase === 'ending' ? { ...current, phase: 'gone' as const } : current))

    // Until the first request says otherwise, trust the saved setting.
    if ((await read($, effort)) === null) {
      const saved = toLevel(await $.settings.read({ key: 'effortLevel' }))
      if (saved !== undefined) await update($, effort, () => saved)
    }

    const kept = toScene(await $.store.get('scene'))
    if (kept !== undefined) {
      await update($, pinned, () => kept)
      await showScene($, kept)
    }
    const visits = toWorld(await $.store.get('world'))
    if (visits !== undefined) await update($, world, () => visits)
    if ((await $.store.get('hd')) === true) await update($, hd, () => true)
    if ((await $.store.get('labels')) === true) await update($, labels, () => true)
    const flown = await $.store.get('craft')
    const flies = craftOf(typeof flown === 'string' ? flown : null)
    claudeFlies = flies ?? 0
    await update($, craft, () => (flies === undefined ? null : (CRAFT[flies]?.name ?? null)))
    // A new session starts with no agents at work.
    agents.clear()
    await update($, helpers, () => ({}))

    // The probe stays off across sessions once /probe off says so.
    if ((await $.store.get('hidden')) !== true) void openPane($)
    tickEvery($, DRIFT_MS)

    return next(e)
  })

  // An agent started (a subagent, a teammate, a workflow's): its craft joins
  // the probe. It has started once `next` answers, so nothing here may fail
  // after: that would start it again.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    try {
      if (started.deny === undefined && started.agentId !== undefined) {
        // Cast with no wait before it is kept, so the next spawn sees this one's craft taken.
        agents.set(started.agentId, { type: e.subagentType, ...castFor(started.agentId), isHere: true })
        await arrive($, started.agentId)
      }
    } catch {
      // The probe misses this one; the agent runs all the same.
    }

    return started
  })

  on('command.run', { command: 'probe' }, async ($, e) => {
    const asked = e.args.trim().toLowerCase().replace(/\s+/g, ' ')
    const scene = toScene(asked)
    const visits = toWorld(asked)

    if (scene !== undefined || asked === 'follow') {
      await pin($, scene ?? null)
      return { text: scene === undefined ? 'The scene follows the permission mode again.' : `The probe will ${scene === 'asteroid' ? 'mine asteroids' : scene} whatever the mode.` }
    }
    // A world kept whatever the effort, from now and in new sessions; `effort` lets the effort pick again.
    if (visits !== undefined || asked === 'effort') {
      await update($, world, () => visits ?? null)
      await $.store.set('world', visits ?? null)
      return {
        text: visits === undefined
          ? 'The effort level picks the world again.'
          : `The probe visits ${WORLDS[visits].title} whatever the effort: /probe effort lets the effort pick again.`,
      }
    }
    // Claude flies another craft, by name, from now and in new sessions. An agent flying the same one is recast.
    const flies = craftOf(asked)
    if (flies !== undefined) {
      claudeFlies = flies
      const name = CRAFT[flies]?.name ?? null
      await update($, craft, () => (flies === 0 ? null : name))
      await $.store.set('craft', flies === 0 ? null : name)
      await recast($)
      return { text: flies === 0 ? 'Claude flies Juno again.' : `Claude flies ${name} now: /probe juno brings Juno back.` }
    }
    // Names over the craft, off until asked for; `labels` alone flips them.
    if (ON_OFF(asked, 'labels')) {
      const shown = asked === 'labels' ? !(await read($, labels)) : asked === 'labels on'
      await update($, labels, () => shown)
      await $.store.set('labels', shown)
      return {
        text: shown
          ? 'Names show over the craft where the picture is fine enough: /probe labels off hides them.'
          : 'Names are hidden: /probe labels on shows them.',
      }
    }
    // Sound is off until asked for; `sound` alone flips it.
    if (ON_OFF(asked, 'sound')) {
      const isOn = asked === 'sound' ? (await $.store.get('sound')) !== true : asked === 'sound on'
      await $.store.set('sound', isOn)
      return { text: isOn ? "The probe's sounds are on: /probe sound off mutes them." : "The probe's sounds are off: /probe sound on brings them back." }
    }
    if (asked === 'off') {
      await $.store.set('hidden', true)
      await $.ui.close({ id: PANE })
      return { text: 'The probe is off, and stays off in new sessions: /probe on brings it back.' }
    }
    // Asked again, HD probes the terminal afresh.
    if (asked === 'hd' || asked === 'blocks') {
      await update($, hd, () => asked === 'hd')
      await update($, hdDenied, () => null)
      await $.store.set('hd', asked === 'hd')
      isProbed = false
    }
    if (asked !== '' && asked !== 'on' && asked !== 'hd' && asked !== 'blocks') {
      return { text: `/probe doesn't know "${asked}": try on, off, hd, blocks, orbit, survey, asteroid, follow, a world, a craft, labels or sound.` }
    }

    await $.store.set('hidden', false)
    const opened = await openPane($)
    if (ticker === undefined) tickEvery($, DRIFT_MS)
    if (!opened.isPlaced) return { text: `The probe is waiting: ${opened.reason}` }

    return {
      text:
        asked === 'hd'
          ? 'The probe draws in real pixels where this terminal can show them: /probe blocks goes back.'
          : asked === 'blocks'
            ? 'The probe draws in blocks: /probe hd tries real pixels.'
            : 'The probe is beside the chat.',
    }
  })

  // The wheel over the picture zooms about the pointer, a few ticks at most
  // at a time, and scrolls nothing: the pane has nothing to scroll. Over the
  // caption under it, or with no ticks to tell, it does nothing.
  on('ui.scroll', { requestId: PANE }, async ($, e) => {
    const { pointer } = e
    const isOver =
      pointer !== undefined && picture.columns > 0 && pointer.row >= 0 && pointer.row < picture.rows && pointer.column >= 0 && pointer.column < picture.columns
    if ((pointer !== undefined && !isOver) || !Number.isFinite(e.by) || e.by === 0) return {}

    const at: readonly [number, number] = isOver
      ? [(pointer.column + 0.5) / picture.columns - 0.5, 0.5 - (pointer.row + 0.5) / picture.rows]
      : [0, 0]
    const ticks = Math.sign(e.by) * Math.min(3, Math.abs(e.by))
    await update($, view, now => zoomed(now, ticks, at))
    return {}
  })

  // A drag over the picture spins and tips the world from where it was when
  // the drag began, its zoom as the wheel has it meanwhile; a right click puts
  // it back as it was. Read and written in one step, so a post handled late
  // can't undo a later one, and a finished or reset drag's stragglers are let go.
  on('ui.message', async ($, e) => {
    const said = e.requestId === PANE && e.element === STEER ? steeringOf(e.data) : undefined
    if (said === undefined) return {}

    if ('reset' in said) {
      if (steering) finished = steering.n
      steering = undefined
      await update($, view, () => USUAL_VIEW)
      return {}
    }
    const { n, across, down, isDone } = said.drag
    if (n === finished) return {}

    await update($, view, now => {
      if (steering?.n !== n) steering = { n, from: now }
      const { spin, tip } = turned(steering.from, across, down)
      return { ...now, spin, tip }
    })
    if (isDone) {
      finished = n
      steering = undefined
    }
    return {}
  })

  // `/effort max` swaps the world right away instead of on the next request.
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const ran = await next(e)
    const asked = toLevel(e.args.trim().toLowerCase())
    if (asked !== undefined) await update($, effort, () => asked)

    return ran
  }).catch(($, e, next) => next(e))

  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteMode($, e.permission_mode)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PostToolUse', async ($, e, next) => {
    const answer = await next(e)
    await noteMode($, e.permission_mode)
    return answer
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      isTurnRunning = true

      // Last turn's target ended: a fresh one arrives, of the scene in force.
      // One left standing by an interrupted turn stays, progress and all.
      if ((await read($, target)).phase !== 'whole') {
        await update($, work, () => 0)
        await update($, tasks, () => null)
        await freshTarget($, (await read($, pinned)) ?? sceneFor(await read($, mode)))
      }
      await update($, isWorking, () => true)
      startTicking($)
    } else {
      // A teammate back for another turn.
      await arrive($, e.agentId)
    }

    return next(e)
  })

  // Each request is work done, its effort the world's; a subagent's counts too.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const sent: Effort = e.effort === undefined ? 'none' : typeof e.effort === 'number' ? 'custom' : e.effort
      if ((await read($, effort)) !== sent) await update($, effort, () => sent)
    }
    if (isTurnRunning) {
      const before = await stageNow($)
      await update($, work, n => n + 1)
      await noteStage($, before)
    }

    return yield* next(e)
  })

  on('tool.call', async ($, e, next) => {
    const before = await stageNow($)
    const worked = isTurnRunning ? await update($, work, n => n + 1) : await read($, work)
    const reached = await noteStage($, before)
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran

    const result: unknown = ran.result
    const change = taskChange(e.tool, e, result)
    if (change !== undefined) {
      await update($, tasks, current => ({ ids: change(current?.ids ?? {}), base: worked }))
      await noteStage($, reached)
    }

    return ran
  }).catch(($, e, next) => next(e))

  // Claude is done once the Stop hooks have run and none sent it back to work.
  on('classic.Stop', async ($, e, next) => {
    await noteMode($, e.permission_mode)
    const verdict = await next(e)
    if (e.agent_id === undefined && verdict.block === undefined) await finishTarget($)

    return verdict
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      // A finished turn whose stop we did not hear ends its target here.
      if (e.reason === 'answer') await finishTarget($)
      isTurnRunning = false
      await update($, isWorking, () => false)
    } else {
      await depart($, e.agentId)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // The terminal animates; other surfaces draw a still picture.
    const isLive = e.surface === 'terminal'
    const { state, told } = await sceneState($, isLive)
    const frame = toFrame(state)
    const denied = await read($, hdDenied)
    const { name, color, alt, caption } = describe(frame, { ...told, denied: isLive ? denied : null })

    if (e.surface === 'terminal') {
      const { Box, Client, Image, Raster, Text } = $.ui.resolve(e)
      // The pointer over the picture turns the view (steer.ts), laid over it.
      const steered = (columns: number, rows: number) => {
        picture = { columns, rows }
        return (
          <Box position="absolute" top={0} left={0}>
            <Client key={STEER} module="./steer.ts" width={columns} height={rows} />
          </Box>
        )
      }
      const label = (
        <Text weight="bold" color={color}>
          {name}
        </Text>
      )

      if ((await read($, hd)) && denied === null) {
        const box = fitHD(e.props.bodyColumns, e.props.scroll.bodyRows, HD_PIXELS)
        const [width, height] = [Math.ceil(box.width / CHUNK), Math.ceil(box.height / CHUNK)]
        const source = { rgba: toRgba(drawScene(frame, width, height), CHUNK), width: width * CHUNK, height: height * CHUNK }
        probeHD($, source)

        return (
          <Box flexDirection="column">
            <Box>
              <Image key="scene" source={source} columns={box.columns} rows={box.rows} alt={alt} />
              {steered(box.columns, box.rows)}
            </Box>
            {label}
            <Text dimColor>{caption}</Text>
          </Box>
        )
      }

      const { width, height } = fitBlocks(e.props.bodyColumns, e.props.scroll.bodyRows)
      const pixels = drawScene(frame, width, height)
      const cells = cellsOf(pixels)

      return (
        <Box flexDirection="column">
          <Box>
            <Raster key="scene" columns={cells.columns} rows={cells.rows} cells={toCells(pixels)} />
            {steered(cells.columns, cells.rows)}
          </Box>
          {label}
          <Text dimColor>{caption}</Text>
        </Box>
      )
    }

    const { Box, Svg, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Svg source={svgOf(frame, 128)} alt={alt} width={192} height={192} />
        <Text weight="bold" color={color}>
          {name}
        </Text>
        <Text dimColor>{caption}</Text>
      </Box>
    )
  })
}

// Every agent on screen flying the craft Claude now flies takes another.
async function recast($: EngineInterface) {
  const moved = new Set<string>()
  for (const [id, agent] of agents) {
    if (!agent.isHere || agent.craft !== claudeFlies) continue
    Object.assign(agent, castFor(id))
    moved.add(id)
  }
  if (moved.size === 0) return

  await update($, helpers, all =>
    Object.fromEntries(
      Object.entries(all).map(([id, helper]) => {
        const agent = agents.get(id)
        return [id, agent && moved.has(id) ? { ...helper, name: agent.name, craft: agent.craft } : helper]
      }),
    ),
  )
}

// The overlay turning the view (steer.ts), the cells of the picture it lies
// on as last drawn, which the wheel's pointer is read against, and the drag
// under way: its number and the view as it was when it began.
const STEER = 'steer'
let picture = { columns: 0, rows: 0 }
let steering: { n: number; from: View } | undefined
// The last drag finished or reset: a post of it handled after that changes nothing.
let finished: number | undefined

// What the overlay posted, if it is what it posts.
function steeringOf(data: unknown): Steering | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  if ('reset' in data && data.reset === true) return { reset: true }
  if (!('drag' in data) || typeof data.drag !== 'object' || data.drag === null) return undefined

  const { n, across, down, isDone } = data.drag as Record<string, unknown>
  return typeof n === 'number' && typeof across === 'number' && typeof down === 'number' && typeof isDone === 'boolean'
    ? { drag: { n, across, down, isDone } }
    : undefined
}

// The picture as SVG for the surfaces that draw it, its colors rounded so
// the nebula makes long runs, drawn smaller until it fits what an Svg may hold.
function svgOf(frame: Frame, size: number): string {
  let svg = toSvg(drawScene(frame, size), 12)
  for (let smaller = size; svg.length > SVG_LIMIT && smaller > 32; ) {
    smaller = Math.floor((smaller * 3) / 4)
    svg = toSvg(drawScene(frame, smaller - (smaller % 2)), 16)
  }

  return svg
}

type TaskIds = Tasks['ids']

// How a task-list tool call changes the tasks this target counts, if it does.
function taskChange(tool: string, input: unknown, result: unknown): ((ids: TaskIds) => TaskIds) | undefined {
  if (tool === 'TodoWrite' && hasTodos(input)) {
    // The todo list is rewritten whole each time; tasks from TaskCreate stay.
    return ids => ({
      ...Object.fromEntries(Object.entries(ids).filter(([id]) => !id.startsWith('todo:'))),
      ...Object.fromEntries(
        input.todos.map((todo, i) => [`todo:${i}`, todo.status === 'completed' ? 'done' : 'open'] as const),
      ),
    })
  }
  if (tool === 'TaskCreate' && isCreated(result)) {
    return ids => ({ ...ids, [result.task.id]: 'open' })
  }
  if (tool === 'TaskUpdate' && isUpdate(input) && input.status !== undefined) {
    const { taskId, status } = input

    return ids => {
      const rest = Object.fromEntries(Object.entries(ids).filter(([id]) => id !== taskId))
      return status === 'deleted' ? rest : { ...rest, [taskId]: status === 'completed' ? 'done' : 'open' }
    }
  }

  return undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const hasTodos = (input: unknown): input is { todos: { status: string }[] } =>
  isRecord(input) && Array.isArray(input.todos) && input.todos.every(todo => isRecord(todo) && typeof todo.status === 'string')

const isCreated = (result: unknown): result is { task: { id: string } } =>
  isRecord(result) && isRecord(result.task) && typeof result.task.id === 'string'

const isUpdate = (input: unknown): input is { taskId: string; status?: string } =>
  isRecord(input) && typeof input.taskId === 'string' && (input.status === undefined || typeof input.status === 'string')
