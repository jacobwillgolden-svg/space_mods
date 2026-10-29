// `custom` is a numeric thinking budget; `none` a model that takes no effort.
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'custom' | 'none'

// What the probe does: orbits its world (the usual modes), surveys it (plan
// mode) or mines an asteroid (auto mode); or, with /probe apollo, flies
// Apollo 11 to the Moon.
export type Scene = 'orbit' | 'survey' | 'asteroid' | 'apollo'

// The worlds the probe visits, one for each effort level.
export type WorldName = 'moon' | 'mars' | 'earth' | 'saturn' | 'jupiter' | 'neptune' | 'pluto'

// The tasks touched while this target stands, from Claude's task list or todos;
// `base` is the work count when one last changed.
export type Tasks = { ids: Record<string, 'open' | 'done'>; base: number }

// What the probe works on this turn, which ends when Claude stops: the orbit,
// the survey, the asteroid or the mission. `since` is the tick its phase
// began, `born` the tick it appeared, which seeds it, and `ended` the tick
// Claude stopped. Apollo 11 can outlast a turn: `turn` is the tick its latest
// turn began, `landed` and `stepped` the ticks the commit (or PR) that lands
// Eagle and the push (or merge) that puts Neil on the Moon came, and `acted`
// the tick the last of them came.
export type Target = {
  phase: 'whole' | 'ending' | 'gone'
  since: number
  scene: Scene
  born: number
  ended?: number
  turn?: number
  landed?: number
  stepped?: number
  acted?: number
}

// A Claude agent at work beside the probe, flying a craft of its own: what
// kind of agent, and the ticks it arrived and its agent finished.
export type Helper = { name: string; craft: number; type: string; since: number; left?: number }

// How the person has turned and zoomed the view, by dragging and scrolling
// over the dashboard's picture: radians the world is spun round its axis and
// its orbits tipped toward the eye, how many times nearer, and where it looks
// off the middle, in fractions of the usual view.
export type View = { spin: number; tip: number; zoom: number; pan: readonly [number, number] }

declare module 'claude-code' {
  interface PluginState {
    'pixel-probe': {
      effort: Effort | null
      isWorking: boolean
      tick: number
      work: number
      tasks: Tasks | null
      target: Target
      // How far Apollo 11 has flown toward the Moon this turn, 0 to 1,
      // easing after the turn's progress.
      flown: number
      // The permission mode last seen, as the classic hooks report it.
      mode: string | null
      // A scene chosen with /probe, kept whatever the mode.
      pinned: Scene | null
      // A world chosen with /probe, kept whatever the effort.
      world: WorldName | null
      // The craft Claude flies (/probe voyager), by name; Juno when null.
      craft: string | null
      // Names over the agents' craft (/probe labels on); off until asked.
      labels: boolean
      // The agents flying beside the probe, by agent id.
      helpers: Record<string, Helper>
    }
  }
}
