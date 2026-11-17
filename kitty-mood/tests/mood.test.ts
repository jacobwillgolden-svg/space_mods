import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { DARK, activityOf, clip, colorsFor, dynamicOpacityOf, mix, parseTheme, percentOf, titleOf } from '../hooks/mood'

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

const KITTY_ENV = {
  KITTY_LISTEN_ON: 'tcp:127.0.0.1:50000',
  KITTY_WINDOW_ID: '3',
  KITTY_INSTALLATION_DIR: 'C:\\Program Files\\kitty',
  USERPROFILE: 'C:\\Users\\me',
}

// Nothing sits beneath the plugin: each hook here stands for the engine. It
// records each kitten request as the words after `@ --to .. --password-file ..`,
// answers the theme registry key as dark, reads kitty.conf as `conf` (and no
// other file), and names every session "tuning kitty".
function engine(on: On, env: Record<string, string> = KITTY_ENV, stored: Record<string, unknown> = {}, conf?: string) {
  const kitten: string[][] = []
  const clock = mock.clock(on, { now: 1_000_000 })

  mock.env(on, env)
  mock.store(on, stored)
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('process.run', (_, e) => {
    if (e.argv[1] === '@') kitten.push(e.argv.slice(6))
    const stdout = e.argv[0] === 'reg' ? 'AppsUseLightTheme    REG_DWORD    0x0' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', (_, e) => (conf !== undefined && e.path.endsWith('\\kitty.conf') ? { value: conf } : { deny: 'not in a test' }))
  on('model.complete', () => ({ value: { isAnswered: true, text: 'tuning kitty', usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('command.run', () => ({ text: '' }))
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.Stop', () => ({}))
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  return { kitten, clock }
}

const start = ($: Engine) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
const titles = (kitten: string[][]) => kitten.filter(r => r[0] === 'set-window-title').map(r => r.slice(3).join(' '))
const colors = (kitten: string[][]) => kitten.filter(r => r[0] === 'set-colors').map(r => r.slice(3))
const opacities = (kitten: string[][]) => kitten.filter(r => r[0] === 'set-background-opacity').map(r => r.slice(3).join(' '))

// A see-through kitty the mods may change.
const GLASS_CONF = 'background_opacity 0.86\r\n# background_blur 1\r\ndynamic_background_opacity yes\r\n'

const END = { reason: 'prompt_input_exit', sessionId: 's', resume: { kind: 'none' } } as never
const ANSWERED = { answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const

test('outside kitty nothing is sent', async ($, on) => {
  const { kitten } = engine(on, { USERPROFILE: 'C:\\Users\\me' })
  await start($)
  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'plan' })

  expect(kitten.length).toBe(0)
})

test('plan mode tints the window blue and its title names the topic', async ($, on) => {
  const { kitten } = engine(on)
  await start($)
  await $.classic.UserPromptSubmit({ prompt: 'make the terminal prettier', permission_mode: 'plan' })

  const last = colors(kitten).at(-1)
  expect(last).toEqual(colorsFor('plan', DARK))
  expect(last?.[1]).toBe('cursor=#6a9bcc')
  expect(titles(kitten).at(-1)).toBe('⛏ plan · tuning kitty')
  // Every request is aimed at Claude's own window.
  expect(kitten.every(r => r[1] === '--match' && (r[2] === 'id:3' || r[2] === 'window_id:3'))).toBe(true)
})

test('a working turn ticks its title, then flashes green and says how long it took', async ($, on) => {
  const { kitten, clock } = engine(on)
  await start($)
  await $.classic.UserPromptSubmit({ prompt: 'fix it', permission_mode: 'default' })
  await $.turn.start({ text: 'fix it', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\src\\app\\main.ts', old_string: 'a', new_string: 'b' })
  await clock.advance(3000)

  expect(titles(kitten).at(-1)).toMatch(/^✳ tuning kitty · . editing main\.ts · 0:03$/)

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(colors(kitten).at(-1)?.[0]).toBe(`background=${mix(DARK.background, '#8fb573', 0.2)}`)
  expect(titles(kitten).at(-1)).toBe('✳ tuning kitty · ✓ done in 0:03')

  await clock.advance(1000)
  expect(colors(kitten).at(-1)).toEqual(colorsFor('default', DARK))
})

test('/kitty mood off puts kitty back and stays off', async ($, on) => {
  const { kitten } = engine(on)
  await start($)
  await $.command.run({ command: 'kitty', args: 'mood off', ...TYPED })

  expect(colors(kitten).at(-1)).toEqual(['background=#1c1b1a', 'cursor=#d97757', 'active_border_color=#d97757'])
  const sent = kitten.length
  await $.classic.UserPromptSubmit({ prompt: 'go', permission_mode: 'auto' })
  expect(colors(kitten).length).toBe(colors(kitten.slice(0, sent)).length)
})

test('no mode and no turn moves the opacity: it is kitty.conf\'s until /opacity says otherwise', async ($, on) => {
  const { kitten, clock } = engine(on, KITTY_ENV, {}, GLASS_CONF)
  await start($)
  for (const permission_mode of ['plan', 'auto', 'bypassPermissions'] as const) {
    await $.classic.UserPromptSubmit({ prompt: 'go', permission_mode })
  }
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete(ANSWERED)
  await clock.advance(1000)
  await $.session.end(END)

  expect(opacities(kitten)).toHaveLength(0)
})

test('options and percentages', () => {
  expect(dynamicOpacityOf(GLASS_CONF)).toBe(0.86)
  expect(dynamicOpacityOf('background_opacity 0.86\n# dynamic_background_opacity yes')).toBe(undefined)
  expect(dynamicOpacityOf('background_opacity 1\ndynamic_background_opacity yes')).toBe(1)
  expect(percentOf('75%')).toBe(0.75)
  expect(percentOf('100')).toBe(1)
  expect(percentOf('0')).toBe(undefined)
  expect(percentOf('7.5')).toBe(undefined)
})

test('/opacity is exactly what the window shows until Claude exits, whatever the mode', async ($, on) => {
  const { kitten, clock } = engine(on, KITTY_ENV, {}, GLASS_CONF)
  await start($)
  const { text } = await $.command.run({ command: 'opacity', args: '100', ...TYPED })
  expect(text).toBe("Opacity is 100% until Claude exits (kitty.conf's 86%). /opacity 1-100 sets it, /opacity reset goes back to kitty.conf.")

  // A turn re-reads kitty.conf but leaves the chosen opacity alone, in auto mode and at the turn's end.
  await $.classic.UserPromptSubmit({ prompt: 'go', permission_mode: 'auto' })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete(ANSWERED)
  await clock.advance(1000)
  expect(opacities(kitten)).toEqual(['1'])
  expect(kitten.filter(r => r[0] === 'set-background-opacity').every(r => r[1] === '--match' && r[2] === 'id:3')).toBe(true)

  await $.command.run({ command: 'opacity', args: '40%', ...TYPED })
  expect(opacities(kitten).at(-1)).toBe('0.4')
  await $.command.run({ command: 'opacity', args: 'reset', ...TYPED })
  expect(opacities(kitten).at(-1)).toBe('0.86')
  await $.command.run({ command: 'opacity', args: '75', ...TYPED })
  await $.session.end(END)
  expect(opacities(kitten).slice(-2)).toEqual(['0.75', '0.86'])
})

test('/opacity takes 1 to 100, and a new session starts from kitty.conf again', async ($, on) => {
  const { kitten } = engine(on, KITTY_ENV, {}, GLASS_CONF)
  await start($)
  const sent = opacities(kitten).length
  for (const args of ['0', '150', 'abc', '0.5']) {
    expect((await $.command.run({ command: 'opacity', args, ...TYPED })).text).toContain('from 1 to 100')
  }
  expect(opacities(kitten)).toHaveLength(sent)

  await $.command.run({ command: 'opacity', args: '50', ...TYPED })
  expect(opacities(kitten).at(-1)).toBe('0.5')
  // The same again is sent again: kitty may have moved it since (a config reload, ctrl+shift+a).
  await $.command.run({ command: 'opacity', args: '50', ...TYPED })
  expect(opacities(kitten).slice(-2)).toEqual(['0.5', '0.5'])
  await $.session.end(END)
  expect(opacities(kitten).at(-1)).toBe('0.86')
  await start($)
  expect((await $.command.run({ command: 'opacity', args: '', ...TYPED })).text).toContain("Opacity is kitty.conf's 86%")
})

test('/opacity clears a solid kitty, and needs dynamic_background_opacity', async ($, on) => {
  const { kitten } = engine(on, KITTY_ENV, {}, 'background_opacity 1\r\ndynamic_background_opacity yes\r\n')
  await start($)
  expect(opacities(kitten)).toHaveLength(0)
  await $.command.run({ command: 'opacity', args: '60', ...TYPED })
  expect(opacities(kitten).at(-1)).toBe('0.6')
  await $.command.run({ command: 'opacity', args: 'reset', ...TYPED })
  expect(opacities(kitten).at(-1)).toBe('1')
  // Back as kitty.conf has it, so the session's end has nothing to put back.
  await $.session.end(END)
  expect(opacities(kitten)).toHaveLength(2)
})

test('/opacity says why it can do nothing', async ($, on) => {
  const { kitten } = engine(on, KITTY_ENV, {}, 'background_opacity 0.86')
  await start($)
  expect((await $.command.run({ command: 'opacity', args: '60', ...TYPED })).text).toContain('dynamic_background_opacity yes')
  expect(opacities(kitten)).toHaveLength(0)
})

test('the session ending hands the title back to Claude Code', async ($, on) => {
  const { kitten } = engine(on)
  await start($)
  await $.session.end(END)

  expect(kitten.at(-1)).toEqual(['set-window-title', '--match', 'id:3'])
})

test('activities, clipping and themes', () => {
  expect(activityOf('Bash', { command: 'cd app && npm test' })).toBe('running npm')
  expect(activityOf('PowerShell', { command: '& "C:\\Program Files\\kitty\\bin\\kitten.exe" @ ls' })).toBe('running kitten')
  expect(activityOf('mcp__claude_ai_Google_Drive__search_files', {})).toBe('using Google Drive')
  expect(clip('one two three four five', 12)).toBe('one two…')
  expect(parseTheme('background  #FAF9F5\ncursor #c96442\n# cursor #000000')).toEqual({ background: '#faf9f5', cursor: '#c96442' })
  expect(titleOf({ mode: 'auto', working: { ms: 75_000, activity: 'searching', agents: 2, beat: 1 } })).toBe('⚔ auto · ◓ searching · 2 agents · 1:15')
})
