import type { EngineInterface } from 'claude-code'

import { send, settle } from './kitty'
import type { Kitty } from './kitty'

// /win-kitty: mc-rice's dashboard (claude_mods/mc-rice/dashboard.py) from
// Claude, a shell in the grid in Steve's place or the name tags drawn as
// lines or as words alone. It sets the user variable mcrice_grid on Claude's
// own window, which the dashboard's watcher answers, with `@` and a word of
// this session's after what it asks; the watcher writes what came of it to
// dashboard.json under that word, as it does for the hotbar's message.

export const MOST_SHELLS = 9

export const HELP =
  'The grid takes up to 9 shells in Steve\'s place, from Steve or the probe, which come back once it is empty. ' +
  'ctrl+shift+enter, the hotbar\'s last slot or /win-kitty add opens one; ctrl+alt+shift+arrows move the shell ' +
  'you are in to the next cell, ctrl+alt+arrows go between them, and exit closes one. ' +
  '/win-kitty lines off draws the name tags as words alone, lines on as lines again.'

export const USAGE = '/win-kitty takes add, add 1-9, lines on, lines off or help; alone it asks which.'

// The menu /win-kitty alone shows, and what each asks the dashboard for.
export const MENU: Record<string, string> = {
  'Add a shell': 'add',
  'How the grid works': 'help',
  'Name tags as lines': 'lines on',
  'Name tags as words': 'lines off',
}

// What the dashboard is asked for, `help` for the help, or nothing when the words aren't /win-kitty's.
export function requestOf(args: string): string | undefined {
  const words = args.trim().toLowerCase().split(/\s+/).filter(w => w.length > 0)
  const [what, more, ...rest] = words
  if (rest.length > 0) return undefined
  if (what === 'help' || what === 'move') return more === undefined ? 'help' : undefined
  if (what === 'add') {
    if (more === undefined) return 'add'
    const count = Number(more)
    return Number.isInteger(count) && count >= 1 && count <= MOST_SHELLS ? `add ${count}` : undefined
  }
  if (what === 'lines' && (more === 'on' || more === 'off')) return `lines ${more}`
  return undefined
}

// What the dashboard said under `word`, from dashboard.json as it is now.
export function saidOf(text: string, word: string): string | undefined {
  try {
    const said = (JSON.parse(text) as { said?: { id?: unknown; text?: unknown } }).said
    return said?.id === word && typeof said.text === 'string' ? said.text : undefined
  } catch {
    return undefined
  }
}

export const NO_ANSWER =
  'The dashboard didn\'t answer. It runs in kitty\'s first window with mc-rice\'s dashboard.py as kitty.conf\'s ' +
  'watcher, and claude-rc.conf must let the mods set-user-vars.'

// How often, and how many times, to look for an answer the dashboard was too busy to give at once.
const LOOK_MS = 250
const LOOKS = 8

let asked = 0

// Asks the dashboard for `request` and answers with what it said.
export async function ask($: EngineInterface, kitty: Kitty, request: string): Promise<string> {
  const local = await $.env.get('LOCALAPPDATA')
  if (!local) return NO_ANSWER
  asked += 1
  const word = `${await $.clock.now()}-${asked}`
  send($, kitty, 'grid', ['set-user-vars', '--match', `id:${kitty.window}`, `mcrice_grid=${request}@${word}`])
  // kitty answers the variable as it sets it, so the answer is there once the request is done,
  // unless the dashboard was laying the tab out just then.
  await settle()
  for (let look = 0; look <= LOOKS; look++) {
    const said = saidOf(await $.fs.read(`${local}\\mc-rice\\dashboard.json`).catch(() => ''), word)
    if (said !== undefined) return said
    if (look < LOOKS) await new Promise<void>(done => $.clock.after(LOOK_MS, done))
  }
  return NO_ANSWER
}
