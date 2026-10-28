import type { Effort, Helper, Scene, Target, Tasks, View, WorldName } from '../types'
import { CRAFT } from './craft'
import { ROCKS } from './rock'
import type { Rock } from './rock'
import { WORLDS, worldFor } from './worlds'
import type { World } from './worlds'

// One animation frame per tick while the probe works or something moves.
export const TICK_MS = 100

// How long a new target takes to arrive: the probe comes round onto its
// orbit or into place to survey, the asteroid drifts in.
export const ARRIVE_TICKS: Record<Scene, number> = { orbit: 10, survey: 8, asteroid: 14 }

// How long each ending plays: the orbit closes and the probe signals home,
// the survey's map flashes complete, the asteroid shatters.
export const ENDING_TICKS: Record<Scene, number> = { orbit: 16, survey: 14, asteroid: 22 }

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
  // Undefined where the surface draws a still picture.
  tick: number | undefined
  isLabeled?: boolean
  view?: View
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
      : s.target.phase === 'ending' && ticks < ENDING_TICKS[scene]
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
  }
}

// Claude can't know how long a turn will take, so progress counts work done
// (requests and tool calls) and slows as it goes: only the stop finishes it.
// With a task list, it follows tasks done and creeps toward the next one.
export function progressStage(work: number, tasks: Tasks | null): number {
  const states = tasks ? Object.values(tasks.ids) : []
  let progress = 1 - Math.exp(-work / 8)

  if (tasks && states.length > 0) {
    const done = states.filter(state => state === 'done').length
    const creep = 0.9 * (1 - Math.exp(-Math.max(0, work - tasks.base) / 6))
    progress = (done + creep) / states.length
  }

  return Math.max(0, Math.min(9, Math.floor(10 * progress)))
}
