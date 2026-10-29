import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Effort, Scene, Target, Tasks, WorldName } from '../types'
import { moveOf } from './apollo'
import type { Told } from './caption'
import { CRAFT } from './craft'
import { LEAVE_SECONDS, TICK_MS, beatsOf, endingTicksOf, isCoasting, progressOf, progressStage, sceneFor } from './frame'
import type { FrameState } from './frame'
import { findMirror, panelShows, publish } from './mirror'
import type { Mirror, Showing } from './mirror'
import { cue, cueLeaving, showOnDashboard } from './sound'
import { WORLDS } from './worlds'

// The pane earlier versions drew the probe in beside the chat.
const OLD_PANE = 'probe'

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
const labels = atom({ plugin: 'pixel-probe', key: 'labels' } as const, false)
const helpers = atom({ plugin: 'pixel-probe', key: 'helpers' } as const, {})
const flown = atom({ plugin: 'pixel-probe', key: 'flown' } as const, 0)

// How long an agent's craft takes to fly off, and how often the agents are
// checked against the session's own list, in ticks.
const LEAVE_TICKS = Math.ceil((LEAVE_SECONDS * 1000) / TICK_MS)
const RECONCILE_TICKS = 50
// Between turns the world turns on, slowly: a tick this often, not ten a second.
const DRIFT_MS = 1000

const LEVELS: readonly unknown[] = ['low', 'medium', 'high', 'xhigh', 'max']
const SCENES: readonly unknown[] = ['orbit', 'survey', 'asteroid', 'apollo']
// How much of the way left Apollo 11 closes each tick, easing after the turn's progress.
const FLY = 0.08

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

// The animation clock ticks ten times a second while Claude works, an
// ending plays or an agent's craft flies; between, once a second, the world
// turning slowly while the dashboard draws it. Background agents outlive the turn.
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
  if (pace === DRIFT_MS && shown !== 'probe') return

  const now = await update($, tick, n => n + 1)
  // Apollo 11, docked, flies on toward the Moon as the turn gets on.
  const flying = await read($, target)
  if (isCoasting(flying, now)) {
    const goal = progressOf(await read($, work), await read($, tasks))
    await update($, flown, way => (Math.abs(goal - way) < 0.001 ? way : way + (goal - way) * FLY))
  }
  const crew = await update($, helpers, all => {
    const played = Object.entries(all).filter(([, helper]) => helper.left !== undefined && now - helper.left >= LEAVE_TICKS)
    return played.length === 0 ? all : Object.fromEntries(Object.entries(all).filter(([id]) => !played.some(([gone]) => gone === id)))
  })
  // Writes made from a timer pass the mod's own hooks by, state.set's too, so
  // the dashboard's panel is told of each tick here.
  schedulePublish($)
  const count = Object.keys(crew).length
  if (count > 0 && now % RECONCILE_TICKS === 0) void reconcile($)
  if (isTurnRunning || now < animateUntil || count > 0) return

  // The target as it is now: a turn may have brought a fresh one meanwhile.
  await update($, target, current => (current.phase === 'ending' ? { ...current, phase: 'gone' as const, since: now } : current))
  schedulePublish($)
  tickEvery($, DRIFT_MS)
}

// What the dashboard's picture is drawn from, read in one go: the frame's
// state, and what the caption tells besides. The camera is the panel's own,
// as its mouse turns it.
async function sceneState($: EngineInterface): Promise<{ state: FrameState; told: Told }> {
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
    tick: await read($, tick),
    flown: await read($, flown),
  }

  return { state, told: { level, seen: await read($, mode), working } }
}

// The dashboard's panel round the shell this session runs in (mirror.ts),
// the only place the probe is drawn: where the two meet, what it shows while
// it is up, and whether this session told it anything, to tell it as well
// when the session ends.
let mirror: Mirror | undefined
let shown: Showing | undefined
let isPublishing = false
let hasPublished = false
// The session ended, other than by a /clear: what the clock still does as the
// process goes, an ending playing out, is not the panel's to see.
let isOver = false
// How often the panel is looked for.
const PANEL_CHECK_MS = 2000

// Each change to what the probe is doing reaches the panel while it draws
// the probe, at most once a tick: every write of the mod's state asks for it
// (the state.set hook), and those asking before it is made share it.
function schedulePublish($: EngineInterface) {
  if (mirror === undefined || shown !== 'probe' || isPublishing || isOver) return

  isPublishing = true
  $.clock.after(0, () => void publishScene($))
}

async function publishScene($: EngineInterface) {
  isPublishing = false
  const meeting = mirror
  if (meeting === undefined || shown !== 'probe' || isOver) return

  const { state, told } = await sceneState($)
  hasPublished = true
  await publish($, meeting, { v: 1, at: await $.clock.now(), state, told })
}

// The panel comes and goes, and what it shows changes: while it draws the
// probe it hears each change, and the probe is heard.
async function watchPanel($: EngineInterface) {
  if (mirror === undefined) return

  const now = await panelShows($, mirror)
  if (now === shown) return
  shown = now
  showOnDashboard(now === 'probe')
  if (now === 'probe') schedulePublish($)
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

// Claude stopped: the orbit closes, the map is made, the asteroid shatters,
// Apollo 11 makes lunar orbit.
async function finishTarget($: EngineInterface) {
  const current = await read($, target)
  if (current.phase !== 'whole') return

  const now = await read($, tick)
  const ending = await update($, target, live => (live.phase === 'whole' ? { ...live, phase: 'ending' as const, since: now, ended: now } : live))
  animateUntil = now + endingTicksOf(ending)
  startTicking($)
  await cue($, current.scene, 'end')
}

// Apollo 11 only goes forward: a turn that ended in lunar orbit goes on
// there, one that ended on the Moon goes on from it, until the flag is up;
// the turn after that launches a new mission.
const goesOn = (last: Target) => last.scene === 'apollo' && last.stepped === undefined

// A commit or a push came: Eagle lands once it can, Neil steps down once it has.
async function goFor($: EngineInterface, move: 'land' | 'step') {
  if ((await read($, target)).scene !== 'apollo') return

  const now = await read($, tick)
  const marked = await update($, target, live =>
    live.scene !== 'apollo'
      ? live
      : { ...live, landed: live.landed ?? now, ...(move === 'step' ? { stepped: live.stepped ?? now } : {}) },
  )
  // After Claude has stopped (a background agent's commit), the rest plays out from here.
  const { over } = beatsOf(marked)
  if (over > now) {
    animateUntil = Math.max(animateUntil, over)
    if (marked.phase === 'gone') await update($, target, live => (live.phase === 'gone' ? { ...live, phase: 'ending' as const, since: live.ended ?? live.since } : live))
    startTicking($)
  }
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

// /probe's words, and what each says once done.
const ON_OFF = (asked: string, word: string) => asked === word || asked === `${word} on` || asked === `${word} off`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    isOver = false
    mirror = await findMirror($).catch(() => undefined)
    await $.command.register({
      name: 'probe',
      description:
        "The probe on mc-rice's dashboard, in Steve's place once /steve off: /probe on|off, orbit|survey|asteroid|apollo|follow the scene, " +
        'moon|mars|earth|saturn|jupiter|neptune|pluto the world (effort: the effort picks it), juno|voyager|cassini|... the craft Claude flies, ' +
        'labels on|off names over the craft, sound on|off',
    })
    await update($, isWorking, () => false)
    // A reload, as a turn that saved the mod ends, drops the clock but keeps
    // $.state: an ending in flight, the asteroid mid-shatter, plays on from
    // where it was; one already played out is gone.
    const now = await read($, tick)
    const left = await read($, target)
    const isEnding = left.phase === 'ending' && now < left.since + endingTicksOf(left)
    if (isEnding) animateUntil = left.since + endingTicksOf(left)
    else await update($, target, current => (current.phase === 'ending' ? { ...current, phase: 'gone' as const } : current))

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
    if ((await $.store.get('labels')) === true) await update($, labels, () => true)
    const named = await $.store.get('craft')
    const flies = craftOf(typeof named === 'string' ? named : null)
    claudeFlies = flies ?? 0
    await update($, craft, () => (flies === undefined ? null : (CRAFT[flies]?.name ?? null)))
    // A new session starts with no agents at work.
    agents.clear()
    await update($, helpers, () => ({}))

    // The dashboard's panel, up round this shell, draws the probe while it
    // says so, once /probe on has it on: the store says that, where the
    // panel reads it.
    shown = mirror === undefined ? undefined : await panelShows($, mirror)
    showOnDashboard(shown === 'probe')
    if (mirror !== undefined) $.clock.every(PANEL_CHECK_MS, () => void watchPanel($))
    // A pane an earlier version left up, as a reload keeps it, goes.
    if ((await $.ui.panes()).some(pane => pane.id === OLD_PANE)) await $.ui.close({ id: OLD_PANE })
    if (isEnding) startTicking($)
    else tickEvery($, DRIFT_MS)
    schedulePublish($)

    return next(e)
  })

  // The dashboard's panel, told about this session, hears that it is over.
  // After a /clear or a /resume Claude goes on, under a session that starts
  // nothing, and the panel follows it.
  on('session.end', async ($, e, next) => {
    if (e.reason !== 'clear' && e.reason !== 'resume') {
      isOver = true
      if (mirror !== undefined && hasPublished) await publish($, mirror, { v: 1, ended: true })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Every change to what the probe is doing reaches the dashboard's panel while it draws it.
  on('state.set', { plugin: 'pixel-probe' }, async ($, e, next) => {
    const written = await next(e)
    schedulePublish($)
    return written
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
      const does = scene === 'asteroid' ? 'mine asteroids' : scene === 'apollo' ? 'fly Apollo 11 to the Moon' : scene
      const how = scene === 'apollo' ? ': each turn launches, a commit lands Eagle, a push puts Neil on the Moon.' : '.'
      return { text: scene === undefined ? 'The scene follows the permission mode again.' : `The probe will ${does} whatever the mode${how}` }
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
      return { text: 'The probe is off the dashboard, and stays off in new sessions: /probe on brings it back.' }
    }
    if (asked !== '' && asked !== 'on') {
      return { text: `/probe doesn't know "${asked}": try on, off, orbit, survey, asteroid, apollo, follow, a world, a craft, labels or sound.` }
    }

    // On, from now and in new sessions: the dashboard draws the probe in
    // Steve's place, once whatever holds the place ahead of it lets it go.
    await $.store.set('hidden', false)
    if (ticker === undefined) tickEvery($, DRIFT_MS)
    await watchPanel($)
    if (shown === undefined) return { text: "The probe is on: it shows only on mc-rice's dashboard, and none is round this shell." }
    if (shown === 'probe' || shown === 'off') return { text: "The probe is on the dashboard, in Steve's place." }

    // Jarvis has the place ahead of Steve, who may be on behind him.
    const holder = `${shown.charAt(0).toUpperCase()}${shown.slice(1)}`
    const frees = shown === 'jarvis' ? '/jarvis off and /steve off' : `/${shown} off`
    return { text: `${holder} has the dashboard's panel: ${frees}, and the probe takes over.` }
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
      // A session taking turns is not over, whatever said it was.
      isOver = false

      // Last turn's target ended: a fresh one arrives, of the scene in force,
      // unless Apollo 11 goes on from lunar orbit or the Moon. One left
      // standing by an interrupted turn stays, progress and all.
      const last = await read($, target)
      if (last.phase !== 'whole') {
        await update($, work, () => 0)
        await update($, tasks, () => null)
        await update($, flown, () => 0)
        const scene = (await read($, pinned)) ?? sceneFor(await read($, mode))
        const now = await read($, tick)
        if (scene === 'apollo' && goesOn(last)) {
          await update($, target, () => ({ ...last, phase: 'whole' as const, since: now, turn: now, ended: undefined, arrived: last.arrived ?? last.ended }))
        } else {
          await freshTarget($, scene)
        }
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

    const move = (e.tool === 'Bash' || e.tool === 'PowerShell') && typeof e.command === 'string' ? moveOf(e.command) : undefined
    if (move !== undefined) await goFor($, move)

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
