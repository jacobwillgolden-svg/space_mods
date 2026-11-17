import type { EngineInterface, Register, Timer } from 'claude-code'

import { HELP, MENU, USAGE, ask, requestOf } from './grid'
import { findKitty, send, settle } from './kitty'
import type { Kitty } from './kitty'
import {
  DARK, LIGHT, TOPIC_PROMPT, activityOf, colorsFor, dynamicOpacityOf, parseTheme, percentOf, restoredColors, tabFor, titleOf,
  topicFromPrompt, topicFromReply,
} from './mood'
import type { Base, Flash, TitleView } from './mood'

// The title and the tab move on once a second while Claude works.
const BEAT_MS = 1000
// How long a turn's ending flashes the window.
const FLASH_MS = 900

type Settings = { mood: boolean; title: boolean }

let kitty: Kitty | undefined
let settings: Settings = { mood: true, title: true }
let base: Base = DARK
// kitty.conf's background opacity, when programs may change it.
let conf: number | undefined
// What /opacity chose, in place of kitty.conf's, until the session ends. The
// mod changes the window's opacity for nothing else.
let chosen: number | undefined
let mode = 'default'

// The session's topic, Claude Code's own title once it has one.
let topic: string | undefined
let isTopicClaudes = false
let isNaming = false

// The turn under way: when it began and what Claude last did.
let turn: { since: number; activity: string } | undefined
let ended: TitleView['ended']
const agents = new Set<string>()
let beat = 0
let ticker: Timer | undefined

// Which Windows theme kitty follows, and so which Claude palette it shows.
// kitty's own colours can't be asked for: get-colors never answers on Windows.
async function readBase($: EngineInterface, found: Kitty): Promise<Base> {
  const asked = await $.process
    .run(['reg', 'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'AppsUseLightTheme'], { timeoutMs: 3000 })
    .catch(() => undefined)
  const isLight = /0x1\b/.test(asked?.stdout ?? '')
  const fallback = isLight ? LIGHT : DARK
  const theme = await $.fs.read(`${found.configDir}\\${isLight ? 'light' : 'dark'}-theme.auto.conf`).catch(() => '')

  return { ...fallback, ...parseTheme(theme) }
}

async function readConf($: EngineInterface, found: Kitty): Promise<number | undefined> {
  return dynamicOpacityOf(await $.fs.read(`${found.configDir}\\kitty.conf`).catch(() => ''))
}

// Opacity belongs to the whole OS window, every tab in it. It is always sent,
// even the same as last time: a config reload or ctrl+shift+a may have moved it.
function setOpacity($: EngineInterface, opacity: number) {
  if (kitty !== undefined) send($, kitty, 'opacity', ['set-background-opacity', '--match', `id:${kitty.window}`, String(opacity)], true)
}

function viewNow(now: number): TitleView {
  return {
    mode,
    topic,
    working: turn && { ms: now - turn.since, activity: turn.activity, agents: agents.size, beat },
    ended: turn ? undefined : ended,
  }
}

// Sends the window as it should look now, a flash over the mood if one is due.
async function paint($: EngineInterface, flash?: Flash) {
  if (kitty === undefined) return
  const window = ['--match', `id:${kitty.window}`]

  if (settings.mood) {
    send($, kitty, 'colors', ['set-colors', ...window, ...colorsFor(mode, base, flash)])
    send($, kitty, 'tab', ['set-tab-color', '--match', `window_id:${kitty.window}`, ...tabFor(mode, base, beat, turn !== undefined)])
  }
  if (settings.title) send($, kitty, 'title', ['set-window-title', ...window, titleOf(viewNow(await $.clock.now()))])
}

// Puts back what Claude changed: kitty's colours, and the title Claude Code sets itself.
function restore($: EngineInterface, what: Partial<Settings>) {
  if (kitty === undefined) return
  const window = ['--match', `id:${kitty.window}`]

  if (what.mood) {
    send($, kitty, 'colors', ['set-colors', ...window, ...restoredColors(base)])
    send($, kitty, 'tab', ['set-tab-color', '--match', `window_id:${kitty.window}`, 'active_bg=NONE', 'active_fg=NONE'])
  }
  // No title hands the window back the last one its program set.
  if (what.title) send($, kitty, 'title', ['set-window-title', ...window])
}

function startBeating($: EngineInterface) {
  ticker ??= $.clock.every(BEAT_MS, () => {
    beat += 1
    void paint($)
  })
}

function stopBeating() {
  ticker?.cancel()
  ticker = undefined
}

async function noteMode($: EngineInterface, seen: string | undefined) {
  if (seen === undefined || seen === mode) return

  mode = seen
  await paint($)
}

// The small model names the session from its first prompt; until it answers,
// or if it can't, the prompt's opening words do.
async function nameTopic($: EngineInterface, prompt: string) {
  if (isNaming) return
  isNaming = true
  topic = topicFromPrompt(prompt)

  const reply = await $.model.complete({ model: 'haiku', prompt: TOPIC_PROMPT(prompt), maxTokens: 24 }).catch(() => undefined)
  const named = reply?.isAnswered ? topicFromReply(reply.text) : undefined
  if (named !== undefined && !isTopicClaudes) {
    topic = named
    await paint($)
  }
}

function forget() {
  topic = undefined
  isTopicClaudes = false
  isNaming = false
  turn = undefined
  ended = undefined
  agents.clear()
  chosen = undefined
}

const isSettings = (value: unknown): value is Settings =>
  typeof value === 'object' && value !== null && 'mood' in value && 'title' in value

const describe = (now: Settings) =>
  `Mood ${now.mood ? 'on' : 'off'}, title ${now.title ? 'on' : 'off'}. ` +
  '/kitty mood on|off tints the window by mode, /kitty title on|off writes the title bar, ' +
  '/opacity 1-100 sets how see-through it is until Claude exits.'

const NOT_IN_KITTY =
  'This session is not in a kitty with remote control on (KITTY_LISTEN_ON is not set). ' +
  'Open a new kitty window after adding claude-rc.conf to kitty.conf, then start Claude there.'

const OPACITY_USAGE = '/opacity takes a whole percentage from 1 to 100, like /opacity 75, or reset to go back to kitty.conf.'

const percent = (opacity: number) => `${Math.round(opacity * 100)}%`

// What /opacity answers.
function describeOpacity(): string {
  const fromConf = `kitty.conf's ${percent(conf ?? 1)}`
  return `Opacity is ${chosen === undefined ? fromConf : `${percent(chosen)} until Claude exits (${fromConf})`}. ` +
    '/opacity 1-100 sets it, /opacity reset goes back to kitty.conf.'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'kitty',
      description: 'win-kitty reacting to Claude: /kitty mood on|off (window tint by mode), /kitty title on|off (title bar)',
    })
    await $.command.register({
      name: 'win-kitty',
      description: "mc-rice's dashboard: /win-kitty add [1-9] opens a shell in the grid in Steve's place, /win-kitty lines on|off draws the name tags as lines or words, /win-kitty help",
      argumentHint: '[add [1-9]|lines on|off|help]',
      // It sends one kitten request and reads one file back, so it needn't wait for a turn to end.
      immediate: true,
    })
    await $.command.register({
      name: 'opacity',
      description: "win-kitty window opacity until Claude exits: /opacity 1-100, /opacity reset for kitty.conf's",
      argumentHint: '[1-100|reset]',
      // It only sends one kitten request, so it needn't wait for a turn to end.
      immediate: true,
    })
    forget()
    stopBeating()
    kitty = await findKitty($).catch(() => undefined)
    if (kitty !== undefined) {
      const kept = await $.store.get('settings')
      if (isSettings(kept)) settings = { mood: kept.mood === true, title: kept.title === true }
      base = await readBase($, kitty)
      conf = await readConf($, kitty)
      await paint($)
    }

    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (e.session_title) {
      topic = e.session_title
      isTopicClaudes = true
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (kitty !== undefined) {
      if (e.session_title) {
        topic = e.session_title
        isTopicClaudes = true
      } else if (topic === undefined && e.source !== 'system' && !e.prompt.trimStart().startsWith('/')) {
        void nameTopic($, e.prompt)
      }
      await noteMode($, e.permission_mode)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PostToolUse', async ($, e, next) => {
    const answer = await next(e)
    await noteMode($, e.permission_mode)
    return answer
  }).catch(($, e, next) => next(e))

  on('classic.Stop', async ($, e, next) => {
    await noteMode($, e.permission_mode)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) {
      agents.add(e.agentId)
    } else if (kitty !== undefined) {
      // The Windows theme, or kitty.conf, may have changed since the last turn.
      base = await readBase($, kitty)
      conf = await readConf($, kitty)
      turn ={ since: await $.clock.now(), activity: 'thinking' }
      beat = 0
      startBeating($)
      await paint($)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined && turn !== undefined) {
      turn.activity = activityOf(e.tool, e as unknown as Record<string, unknown>)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      agents.delete(e.agentId)
    } else if (turn !== undefined) {
      const flash: Flash = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'failed'
      ended = { flash, ms: (await $.clock.now()) - turn.since }
      turn = undefined
      stopBeating()
      await paint($, flash)
      $.clock.after(FLASH_MS, () => void paint($))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'kitty' }, async ($, e) => {
    if (kitty === undefined) return { text: NOT_IN_KITTY }

    const [what, state] = e.args.trim().toLowerCase().split(/\s+/)
    if ((what === 'mood' || what === 'title') && (state === 'on' || state === 'off' || state === undefined)) {
      const isOn = state === undefined ? !settings[what] : state === 'on'
      settings = { ...settings, [what]: isOn }
      await $.store.set('settings', settings)
      if (isOn) await paint($)
      else restore($, { [what]: true })
    }
    return { text: describe(settings) }
  })

  on('command.run', { command: 'opacity' }, async ($, e) => {
    if (kitty === undefined) return { text: NOT_IN_KITTY }

    // kitty.conf may have been changed since the turn began.
    conf = await readConf($, kitty)
    if (conf === undefined) {
      return {
        text: 'kitty only lets programs change its opacity with dynamic_background_opacity yes in kitty.conf, ' +
          'and only in a kitty started after it was set.',
      }
    }

    const arg = e.args.trim().toLowerCase()
    if (arg === 'reset' || arg === 'default') {
      // Sent even when nothing was chosen, to mend a window something else left changed.
      chosen = undefined
      setOpacity($, conf)
    } else if (arg !== '') {
      const at = percentOf(arg)
      if (at === undefined) return { text: OPACITY_USAGE }
      chosen = at
      setOpacity($, at)
    }
    return { text: describeOpacity() }
  })

  on('command.run', { command: 'win-kitty' }, async ($, e) => {
    if (kitty === undefined) return { text: NOT_IN_KITTY }

    let request = requestOf(e.args)
    if (e.args.trim() === '') {
      const chosen = await $.ui.ask('What should the dashboard do?', Object.keys(MENU)).catch(() => undefined)
      if (chosen === undefined) return { text: USAGE }
      // Free text under "Other" is taken as /win-kitty's words.
      request = MENU[chosen] ?? requestOf(chosen)
    }
    if (request === undefined) return { text: USAGE }
    if (request === 'help') return { text: HELP }
    return { text: await ask($, kitty, request) }
  })

  on('session.end', async ($, e, next) => {
    stopBeating()
    restore($, settings)
    if (chosen !== undefined && conf !== undefined) setOpacity($, conf)
    await settle()
    forget()
    return next(e)
  }).catch(($, e, next) => next(e))
}
