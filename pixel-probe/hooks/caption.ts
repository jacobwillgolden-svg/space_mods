import type { Effort } from '../types'
import { missionWords } from './apollo'
import type { Frame } from './frame'

// What the caption tells besides the frame: the effort as Claude last sent
// it, the permission mode last seen, and whether Claude works.
export type Told = { level: Effort | null; seen: string | null; working: boolean }

// The words the dashboard's panel puts under the picture: the world's name
// and its color, and the caption.
export type Words = { name: string; color: string; caption: string }

export function describe(frame: Frame, told: Told): Words {
  const { level, seen, working } = told
  const flying = frame.crew.filter(hand => hand.left === undefined)
  // Apollo 11 says only what the mission is doing: the quotes run long.
  if (frame.mission) {
    const caption = [missionWords(frame.mission), ...(flying.length === 0 ? [] : [crewOf(flying.map(hand => hand.name))])].join(' · ')
    return { name: 'Apollo 11', color: '#e8eaf0', caption }
  }
  const { title } = frame.world
  const name = title.charAt(0).toUpperCase() + title.slice(1)
  const caption = [
    level === null
      ? 'effort: shows on the next turn'
      : level === 'none'
        ? 'this model has no effort setting'
        : `effort: ${level}`,
    ...(seen === null ? [] : [`${seen} mode`]),
    statusOf(frame, working),
    ...(flying.length === 0 ? [] : [crewOf(flying.map(hand => hand.name))]),
  ].join(' · ')

  return { name, color: frame.world.color, caption }
}

// The agents' craft, named, cut short past forty characters.
function crewOf(names: readonly string[]): string {
  const count = `${names.length} agent${names.length === 1 ? '' : 's'}`
  const listed = names.join(', ')

  return `${count}: ${listed.length > 40 ? `${listed.slice(0, 39)}…` : listed}`
}

// What the probe is up to, in the scene's own words.
function statusOf(frame: Frame, working: boolean): string {
  const isDone = frame.target.kind !== 'whole'
  const percent = `${frame.stage * 10}%`
  const rock = frame.rock.name

  switch (frame.scene) {
    case 'orbit':
      return isDone ? 'orbit complete' : working ? `orbiting... ${percent} charted` : 'idle'
    case 'survey':
      return isDone ? 'survey complete' : working ? `surveying... ${percent} mapped` : 'idle'
    case 'asteroid':
      return isDone ? `${rock} shattered` : working ? `mining... ${rock} ${percent} cracked` : 'idle'
    case 'apollo':
      return frame.mission ? missionWords(frame.mission) : 'idle'
  }
}
