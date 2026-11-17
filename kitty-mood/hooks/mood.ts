// What the window looks like for each permission mode and moment, and what
// its title says. Pure: register.ts sends it to kitty.

// The window's own colours, from the Claude theme kitty is showing.
export type Base = { background: string; cursor: string; border: string }

// The same as dark-theme.auto.conf and light-theme.auto.conf ship, for when
// those files can't be read.
export const DARK: Base = { background: '#1c1b1a', cursor: '#d97757', border: '#d97757' }
export const LIGHT: Base = { background: '#faf9f5', cursor: '#c96442', border: '#c96442' }

// Each mode's colour: Claude orange as usual, plan blue, auto red for a fight.
const HUES: Record<string, string> = {
  plan: '#6a9bcc',
  auto: '#e0574a',
  acceptEdits: '#a78bda',
  bypassPermissions: '#ff4f8b',
  dontAsk: '#d9a25c',
}

// What heads the title in each mode; the usual mode needs no word.
const MODES: Record<string, { glyph: string; word?: string }> = {
  default: { glyph: '✳' },
  plan: { glyph: '⛏', word: 'plan' },
  auto: { glyph: '⚔', word: 'auto' },
  acceptEdits: { glyph: '✎', word: 'edits' },
  bypassPermissions: { glyph: '⚡', word: 'bypass' },
  dontAsk: { glyph: '✳', word: "don't ask" },
}

// How a turn ended, as a flash of the whole window.
export type Flash = 'done' | 'stopped' | 'failed'
const FLASHES: Record<Flash, string> = { done: '#8fb573', stopped: '#d9a25c', failed: '#e06c60' }

// How far the background leans towards the mode's colour, and a flash's.
const TINT = 0.07
const FLASH_TINT = 0.2

export const hueOf = (mode: string, base: Base) => HUES[mode] ?? base.cursor

const channels = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16))

// `a` moved `t` of the way to `b`, both #rrggbb.
export function mix(a: string, b: string, t: number): string {
  const [from, to] = [channels(a), channels(b)]
  return `#${from.map((c, i) => Math.round(c + ((to[i] ?? c) - c) * t).toString(16).padStart(2, '0')).join('')}`
}

// The `set-colors` arguments for a mode, or for a flash over it.
export function colorsFor(mode: string, base: Base, flash?: Flash): string[] {
  const hue = hueOf(mode, base)
  const background = flash ? mix(base.background, FLASHES[flash], FLASH_TINT) : mix(base.background, hue, TINT)

  return [`background=${background}`, `cursor=${hue}`, `active_border_color=${hue}`]
}

// kitty.conf's background_opacity, if it lets programs change that
// (dynamic_background_opacity). kitty refuses set-background-opacity otherwise.
export function dynamicOpacityOf(conf: string): number | undefined {
  let opacity = 1
  let isDynamic = false
  for (const line of conf.split(/\r?\n/)) {
    const [key, value = ''] = line.trim().split(/\s+/)
    if (key === 'background_opacity') opacity = Number(value)
    else if (key === 'dynamic_background_opacity') isDynamic = /^(?:yes|y|true)$/i.test(value)
  }
  return isDynamic && opacity > 0 && opacity <= 1 ? opacity : undefined
}

// `/opacity`'s argument, 1 to 100 with or without a %, as an opacity.
export function percentOf(arg: string): number | undefined {
  const [, digits] = /^(\d{1,3})%?$/.exec(arg) ?? []
  const percent = Number(digits)
  return digits !== undefined && percent >= 1 && percent <= 100 ? percent / 100 : undefined
}

// The colours kitty showed before Claude touched them.
export const restoredColors = (base: Base) => [
  `background=${base.background}`,
  `cursor=${base.cursor}`,
  `active_border_color=${base.border}`,
]

// The tab, in the mode's colour; while Claude works it breathes, every other beat paler.
export function tabFor(mode: string, base: Base, beat: number, isWorking: boolean): string[] {
  const hue = hueOf(mode, base)
  const bg = isWorking && beat % 2 === 1 ? mix(hue, base.background, 0.45) : hue

  return [`active_bg=${bg}`, `active_fg=${base.background}`]
}

// Reads `background`, `cursor` and `active_border_color` out of a kitty theme.
export function parseTheme(text: string): Partial<Base> {
  const found: Partial<Base> = {}
  for (const line of text.split(/\r?\n/)) {
    const [key, value] = line.trim().split(/\s+/)
    if (!value || !/^#[0-9a-f]{6}$/i.test(value)) continue
    if (key === 'background') found.background = value.toLowerCase()
    else if (key === 'cursor') found.cursor = value.toLowerCase()
    else if (key === 'active_border_color') found.border = value.toLowerCase()
  }
  return found
}

// `text` in at most `most` characters, cut at a word where one is near.
export function clip(text: string, most: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= most) return flat

  const cut = flat.slice(0, most - 1)
  const space = cut.lastIndexOf(' ')
  return `${space >= most / 2 ? cut.slice(0, space) : cut}…`
}

// 75 s as 1:15.
export function clockOf(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

// The last part of a path, either slash.
const fileOf = (path: unknown) => (typeof path === 'string' ? (path.split(/[\\/]/).pop() ?? path) : undefined)

// What the program a shell command runs is called: `npm test` is npm.
function programOf(command: unknown): string | undefined {
  if (typeof command !== 'string') return undefined
  const rest = command.trim().replace(/^(?:cd\s+\S+\s*(?:&&|;)\s*)+/, '')
  const [, quoted, bare] = /^&?\s*(?:["']([^"']+)["']|(\S+))/.exec(rest) ?? []
  const name = fileOf(quoted ?? bare)?.replace(/\.exe$/i, '')
  return name || undefined
}

// What Claude is up to, in a few words, from the tool it just called.
export function activityOf(tool: string, input: Record<string, unknown>): string {
  const file = fileOf(input.file_path ?? input.notebook_path)
  switch (tool) {
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return file ? `editing ${file}` : 'editing'
    case 'Read':
      return file ? `reading ${file}` : 'reading'
    case 'Bash':
    case 'PowerShell': {
      const program = programOf(input.command)
      return program ? `running ${program}` : 'running a command'
    }
    case 'Grep':
    case 'Glob':
      return 'searching'
    case 'WebFetch':
    case 'WebSearch':
      return 'on the web'
    case 'Agent':
    case 'Workflow':
      return 'briefing agents'
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return 'planning'
    case 'AskUserQuestion':
      return 'asking you'
    case 'Skill':
      return 'reading a skill'
  }
  const server = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(tool)?.[1]
  return server ? `using ${server.replace(/^claude_ai_/, '').replaceAll('_', ' ')}` : tool.toLowerCase()
}

// Everything the title bar says.
export type TitleView = {
  mode: string
  topic?: string
  // While a turn runs: how long, doing what, with how many agents.
  working?: { ms: number; activity: string; agents: number; beat: number }
  // After one: how it ended and how long it took.
  ended?: { flash: Flash; ms: number }
}

const SPINNER = ['◐', '◓', '◑', '◒']
const ENDINGS: Record<Flash, string> = { done: '✓ done in', stopped: '◼ stopped after', failed: '✗ failed after' }

export function titleOf({ mode, topic, working, ended }: TitleView): string {
  const { glyph, word } = MODES[mode] ?? { glyph: '✳', word: mode }
  const parts = [word ? `${glyph} ${word}` : glyph]
  if (topic) parts.push(clip(topic, 40))

  if (working) {
    parts.push(`${SPINNER[working.beat % SPINNER.length]} ${clip(working.activity, 30)}`)
    if (working.agents > 0) parts.push(working.agents === 1 ? '1 agent' : `${working.agents} agents`)
    parts.push(clockOf(working.ms))
  } else if (ended) {
    parts.push(`${ENDINGS[ended.flash]} ${clockOf(ended.ms)}`)
  }

  // The glyph and the first part share a space, not a dot.
  const [head, ...rest] = parts
  return word || rest.length === 0 ? parts.join(' · ') : `${head} ${rest.join(' · ')}`
}

// A first prompt as a topic, for when the model can't name one: its opening words.
export const topicFromPrompt = (prompt: string) => clip(prompt.replace(/[`*_#>]/g, ''), 32).toLowerCase()

// What the small model is asked to name the session with.
export const TOPIC_PROMPT = (prompt: string) =>
  'Name this coding session for a terminal title bar in 2 to 5 lowercase words, ' +
  'like "refactoring auth" or "fixing the flaky test". Reply with the words alone: ' +
  `no quotes, no full stop.\n\n<request>\n${prompt.slice(0, 2000)}\n</request>`

// The model's reply as a topic, or nothing when it isn't one.
export function topicFromReply(reply: string): string | undefined {
  const words = reply.trim().split('\n')[0]?.replace(/^["'`]+|["'`.]+$/g, '').trim().toLowerCase() ?? ''
  return words.length > 0 && words.length <= 48 ? words : undefined
}
