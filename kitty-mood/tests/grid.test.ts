import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { HELP, NO_ANSWER, USAGE, requestOf, saidOf } from '../hooks/grid'

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

const KITTY_ENV = {
  KITTY_LISTEN_ON: 'tcp:127.0.0.1:50000',
  KITTY_WINDOW_ID: '3',
  KITTY_INSTALLATION_DIR: 'C:\\Program Files\\kitty',
  USERPROFILE: 'C:\\Users\\me',
  LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
}

const DASHBOARD = 'C:\\Users\\me\\AppData\\Local\\mc-rice\\dashboard.json'

// The engine as in mood.test.ts, with a dashboard behind kitty: each
// set-user-vars of mcrice_grid is answered in dashboard.json under its word,
// with what `answer` makes of what was asked (nothing, to not answer).
function engine(on: On, answer: (request: string) => string | undefined, env: Record<string, string> = KITTY_ENV) {
  const kitten: string[][] = []
  let said = '{}'
  const clock = mock.clock(on, { now: 1_000_000 })

  mock.env(on, env)
  mock.store(on, {})
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('process.run', (_, e) => {
    if (e.argv[1] === '@') {
      const words = e.argv.slice(6)
      kitten.push(words)
      const asked = words[0] === 'set-user-vars' ? /^mcrice_grid=(.*)@(.*)$/.exec(words.at(-1) ?? '') : null
      const text = asked ? answer(asked[1]) : undefined
      if (asked && text !== undefined) said = JSON.stringify({ on: true, said: { id: asked[2], text, at: 1 } })
    }
    const stdout = e.argv[0] === 'reg' ? 'AppsUseLightTheme    REG_DWORD    0x0' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', (_, e) => (e.path === DASHBOARD ? { value: said } : { deny: 'not in a test' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.run', () => ({ text: '' }))

  return { kitten, clock }
}

const start = ($: Engine) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
const asks = (kitten: string[][]) => kitten.filter(r => r[0] === 'set-user-vars')

test('/win-kitty add asks the dashboard on Claude\'s own window and says what it said', async ($, on) => {
  const { kitten } = engine(on, request => (request === 'add' ? 'a shell in the grid, 1 of 9' : undefined))
  await start($)

  const { text } = await $.command.run({ command: 'win-kitty', args: 'add', ...TYPED })
  expect(text).toBe('a shell in the grid, 1 of 9')
  expect(asks(kitten)).toHaveLength(1)
  expect(asks(kitten)[0].slice(0, 3)).toEqual(['set-user-vars', '--match', 'id:3'])
  expect(asks(kitten)[0][3]).toMatch(/^mcrice_grid=add@\d+-\d+$/)
})

test('/win-kitty passes on why the dashboard won\'t, and a count and the tag lines', async ($, on) => {
  const { kitten } = engine(on, request => (request.startsWith('add') ? 'the grid is full: 9 shells' : `asked ${request}`))
  await start($)

  expect((await $.command.run({ command: 'win-kitty', args: 'add', ...TYPED })).text).toBe('the grid is full: 9 shells')
  expect((await $.command.run({ command: 'win-kitty', args: 'lines off', ...TYPED })).text).toBe('asked lines off')
  await $.command.run({ command: 'win-kitty', args: 'ADD 3', ...TYPED })
  expect(asks(kitten).map(r => r[3].split('@')[0])).toEqual(['mcrice_grid=add', 'mcrice_grid=lines off', 'mcrice_grid=add 3'])
  // Each asks under a word of its own, so an answer is never taken for another's.
  expect(new Set(asks(kitten).map(r => r[3].split('@')[1])).size).toBe(3)
})

test('/win-kitty help, and words it doesn\'t take, ask kitty nothing', async ($, on) => {
  const { kitten } = engine(on, () => 'unexpected')
  await start($)

  expect((await $.command.run({ command: 'win-kitty', args: 'help', ...TYPED })).text).toBe(HELP)
  for (const args of ['add 10', 'add 0', 'add two', 'lines', 'lines maybe', 'remove', 'add 1 2']) {
    expect((await $.command.run({ command: 'win-kitty', args, ...TYPED })).text).toBe(USAGE)
  }
  expect(asks(kitten)).toHaveLength(0)
})

test('/win-kitty says so when no dashboard answers', async ($, on) => {
  const { clock } = engine(on, () => undefined)
  await start($)

  const answer = $.command.run({ command: 'win-kitty', args: 'add', ...TYPED })
  for (let i = 0; i < 12; i++) await clock.advance(250)
  expect((await answer).text).toBe(NO_ANSWER)
})

test('/win-kitty outside kitty says why', async ($, on) => {
  const { kitten } = engine(on, () => 'unexpected', { USERPROFILE: 'C:\\Users\\me' })
  await start($)

  expect((await $.command.run({ command: 'win-kitty', args: 'add', ...TYPED })).text).toContain('not in a kitty')
  expect(kitten).toHaveLength(0)
})

test('what /win-kitty asks, and what it reads back', () => {
  expect(requestOf('add')).toBe('add')
  expect(requestOf('  add   9 ')).toBe('add 9')
  expect(requestOf('move')).toBe('help')
  expect(requestOf('lines on')).toBe('lines on')
  expect(requestOf('')).toBe(undefined)
  expect(saidOf('{"said": {"id": "w1", "text": "hi"}}', 'w1')).toBe('hi')
  expect(saidOf('{"said": {"id": "w0", "text": "hi"}}', 'w1')).toBe(undefined)
  expect(saidOf('{not json', 'w1')).toBe(undefined)
  expect(saidOf('{}', 'w1')).toBe(undefined)
})
