import type { Effort, Helper, Scene, Target, Tasks, View, WorldName } from '../types'
import { DOCKED, EVA, IN_ORBIT, LAND } from './apollo'
import type { Mission } from './apollo'
import { CRAFT } from './craft'
import { ROCKS } from './rock'
import type { Rock } from './rock'
import { WORLDS, worldFor } from './worlds'
import type { World } from './worlds'

// One animation frame per tick while the probe works or something moves.
export const TICK_MS = 100

// How long a new target takes to arrive: the probe comes round onto its
// orbit or into place to survey, the asteroid drifts in; Apollo 11 times its
// own launch (apollo.ts).
export const ARRIVE_TICKS: Record<Scene, number> = { orbit: 10, survey: 8, asteroid: 14, apollo: 10 }

// How long each ending plays: the orbit closes and the probe signals home,
// the survey's map flashes complete, the asteroid shatters; Apollo 11 makes
// lunar orbit, and more on a commit or a push (endingTicksOf).
export const ENDING_TICKS: Record<Scene, number> = { orbit: 16, survey: 14, asteroid: 22, apollo: Math.ceil((IN_ORBIT * 1000) / TICK_MS) }

const ticksOf = (seconds: number) => Math.ceil((seconds * 1000) / TICK_MS)

// Whether Apollo 11's turn began with Eagle already on the Moon: a commit
// came in an earlier turn.
export const isOnTheMoon = (target: Target) => target.landed !== undefined && target.landed < (target.turn ?? target.born)

// Whether Apollo 11's turn began in lunar orbit, an earlier turn having ended
// on the way there, and Eagle not yet down.
export const isInLunarOrbit = (target: Target) => target.arrived !== undefined && !isOnTheMoon(target)

// When Apollo 11's last moves begin, in ticks: the arrival at the Moon once
// Claude stops; Eagle's landing once a commit has come and Apollo is in
// lunar orbit (at once, in a turn begun there); the moonwalk once a push has
// come and Eagle is down; and `over`, when all of it is still.
export type Beats = { arrive?: number; land?: number; step?: number; over: number }

export function beatsOf(target: Target): Beats {
  if (isOnTheMoon(target)) {
    const step = target.stepped
    return step === undefined ? { over: target.ended ?? -Infinity } : { step, over: step + ticksOf(EVA) }
  }
  if (isInLunarOrbit(target)) {
    const land = target.landed
    const step = land === undefined || target.stepped === undefined ? undefined : Math.max(land + ticksOf(LAND), target.stepped)
    const over = step !== undefined ? step + ticksOf(EVA) : land !== undefined ? land + ticksOf(LAND) : (target.ended ?? -Infinity)
    return { land, step, over }
  }
  if (target.ended === undefined) return { over: -Infinity }

  const arrive = target.ended
  const land = target.landed === undefined ? undefined : Math.max(arrive + ticksOf(IN_ORBIT), target.landed)
  const step = land === undefined || target.stepped === undefined ? undefined : Math.max(land + ticksOf(LAND), target.stepped)
  const over = step !== undefined ? step + ticksOf(EVA) : land !== undefined ? land + ticksOf(LAND) : arrive + ticksOf(IN_ORBIT)
  return { arrive, land, step, over }
}

// How long a target's ending plays, in ticks from when Claude stopped.
export const endingTicksOf = (target: Target) =>
  target.scene === 'apollo' ? Math.max(0, beatsOf(target).over - (target.ended ?? target.since)) : ENDING_TICKS[target.scene]

// Whether Apollo 11 has docked and is coasting `tick` into the turn: from
// then on it flies toward the Moon as the turn gets on.
export const isCoasting = (target: Target, tick: number) =>
  target.scene === 'apollo' && target.phase === 'whole' && target.arrived === undefined && !isOnTheMoon(target) && ((tick - target.born) * TICK_MS) / 1000 >= DOCKED

// How long an agent's craft takes to fly in, and to fly off once it finishes.
export const ARRIVE_SECONDS = 1.4
export const LEAVE_SECONDS = 2.6

export type TargetView =
  | { kind: 'whole'; arrival: number } // 0 just appeared, 1 in place
  | { kind: 'ending'; t: number } // seconds since Claude stopped
  | { kind: 'gone' }

// An agent's craft, as the frame sees it: who flies it, the seconds since it
// arrived, and since its agent finished, if it has.
export type Hand = { id: string; name: string; craft: number; age: number; left?: number }

export type Frame = {
  scene: Scene
  world: World
  // The asteroid the effort sends, should the probe mine one.
  rock: Rock
  // The craft Claude flies, from CRAFT.
  craft: number
  // Whether Claude is at work this moment: engines lit, the beam on.
  working: boolean
  // Progress through the turn, 0-9: the orbit charted, the map made, the cracks.
  stage: number
  target: TargetView
  // Seconds on the animation clock, for every orbit and spin.
  time: number
  // The target's seed, and the seconds since it appeared.
  seed: number
  clock: number
  // The agents' craft, in the order they arrived.
  crew: readonly Hand[]
  // Names over the agents' craft, shown only once asked for.
  isLabeled?: boolean
  // The view as the person turned and zoomed it; the usual when absent.
  view?: View
  // Apollo 11, where the scene is it.
  mission?: Mission
}

export type FrameState = {
  effort: Effort | null
  working: boolean
  work: number
  tasks: Tasks | null
  target: Target
  helpers: Record<string, Helper>
  // A world kept with /probe, whatever the effort.
  world: WorldName | null
  craft: number
  // Undefined for a still picture, as the dashboard draws the probe waiting.
  tick: number | undefined
  isLabeled?: boolean
  // The dashboard's camera, as its mouse turned it; the usual when absent.
  view?: View
  // How far Apollo 11 has flown toward the Moon this turn; the turn's
  // progress when absent.
  flown?: number
}

const seconds = (ticks: number) => (ticks * TICK_MS) / 1000

// Plan mode surveys, auto mode mines; every other mode orbits.
export const sceneFor = (mode: string | null): Scene =>
  mode === 'plan' ? 'survey' : mode === 'auto' ? 'asteroid' : 'orbit'

// Where a still picture stands: everything in place, a while into its orbits.
const STILL_SECONDS = 7

export function toFrame(s: FrameState): Frame {
  const { scene } = s.target
  const ticks = s.tick === undefined ? Infinity : s.tick - s.target.since
  const target: TargetView =
    s.target.phase === 'whole'
      ? { kind: 'whole', arrival: Math.min(1, ticks / ARRIVE_TICKS[scene]) }
      : s.target.phase === 'ending' && ticks < endingTicksOf(s.target)
        ? { kind: 'ending', t: seconds(ticks) }
        : { kind: 'gone' }
  // A still picture shows each agent in place, and none leaving.
  const sinceTick = (tick: number) => (s.tick === undefined ? Infinity : seconds(s.tick - tick))
  const crew = Object.entries(s.helpers)
    .sort(([, a], [, b]) => a.since - b.since)
    .flatMap(([id, helper]): Hand[] => {
      const left = helper.left === undefined ? undefined : sinceTick(helper.left)
      if (left !== undefined && left >= LEAVE_SECONDS) return []

      return [{ id, name: helper.name, craft: helper.craft, age: sinceTick(helper.since), left }]
    })

  return {
    scene,
    world: WORLDS[s.world ?? worldFor(s.effort)],
    rock: ROCKS[s.effort ?? 'none'],
    craft: Math.max(0, Math.min(CRAFT.length - 1, s.craft)),
    working: s.working && s.tick !== undefined,
    stage: progressStage(s.work, s.tasks),
    target,
    time: s.tick === undefined ? STILL_SECONDS : seconds(s.tick),
    seed: s.target.born,
    clock: s.tick === undefined ? STILL_SECONDS : seconds(s.tick - s.target.born),
    crew,
    isLabeled: s.isLabeled === true,
    view: s.view,
    ...(scene === 'apollo' ? { mission: missionOf(s) } : {}),
  }
}

// Apollo 11 as a frame shows it; a still picture is the rocket on the pad.
function missionOf(s: FrameState): Mission {
  const { target } = s
  const progress = progressOf(s.work, s.tasks)
  const go = { isGoForLanding: target.landed !== undefined, isGoForEva: target.stepped !== undefined }
  if (s.tick === undefined) return { launch: 0, flown: 0, onTheMoon: false, inOrbit: false, inTurn: 0, prep: 0, ...go }

  const now = s.tick
  const since = (tick: number | undefined) => (tick === undefined ? undefined : seconds(now - tick))
  const beats = beatsOf(target)
  return {
    launch: seconds(now - target.born),
    flown: s.flown ?? progress,
    arrive: since(beats.arrive),
    land: since(beats.land),
    step: since(beats.step),
    onTheMoon: isOnTheMoon(target),
    inOrbit: isInLunarOrbit(target),
    inTurn: seconds(now - (target.turn ?? target.born)),
    prep: progress,
    ...go,
  }
}

// Claude can't know how long a turn will take, so progress counts work done
// (requests and tool calls) and slows as it goes: only the stop finishes it.
// With a task list, it follows tasks done and creeps toward the next one.
export function progressOf(work: number, tasks: Tasks | null): number {
  const states = tasks ? Object.values(tasks.ids) : []
  if (!tasks || states.length === 0) return 1 - Math.exp(-work / 8)

  const done = states.filter(state => state === 'done').length
  const creep = 0.9 * (1 - Math.exp(-Math.max(0, work - tasks.base) / 6))
  return Math.min(1, (done + creep) / states.length)
}

// The progress in tenths, 0 to 9.
export const progressStage = (work: number, tasks: Tasks | null): number => Math.max(0, Math.min(9, Math.floor(10 * progressOf(work, tasks))))
