import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { askFor, fitsGit, fromGit, gitOf, gitWords, guessesOf, ovalsOf } from '../hooks/guess'
import { apply, arranged, completions, emptyOffers, historyOf, isTyped, modelOf, nextWords, offersFor, sentencesOf } from '../hooks/words'

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const
const USAGE = { input_tokens: 40, output_tokens: 12, cache_read_input_tokens: 90000, cache_creation_input_tokens: 0 }

// kitty's process and the window Claude runs in, and the files the strip and this session meet in. The kit
// hands paths on resolved against its own folder, so they are known by how they end.
const KITTY_ENV = { KITTY_PID: '7', KITTY_WINDOW_ID: '1', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', USERPROFILE: 'C:\\Users\\me' }
const slashed = (path: string) => path.replaceAll('/', '\\')
const ends = (path: string, end: string) => slashed(path).endsWith(`\\mc-rice\\predict\\7-1${end}`)

const DIRTY_FEATURE = [
  '# branch.oid 1234',
  '# branch.head feature',
  '# branch.upstream origin/feature',
  '# branch.ab +2 -0',
  '1 .M N... 100644 100644 100644 aaa bbb hooks/register.ts',
  '1 M. N... 100644 100644 100644 aaa bbb hooks/guess.ts',
  '? notes.md',
].join('\n')
const CLEAN_MAIN = ['# branch.oid 1234', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +0 -0'].join('\n')

// What the person has sent before, as Claude Code's history.jsonl keeps it, oldest first.
const SENT = [
  ...Array<string>(6).fill('commit and push'),
  ...Array<string>(3).fill('pull updates from git'),
  'push it',
  'push it',
  'make the dashboard faster',
  'the dashboard is slow',
  'can you improve the ovals',
  'improve the ovals again',
  'improve it more',
  'comitt and push',
  'commit this',
  'commit the ovals',
  '/predict on',
  '!git status',
  '[Image #1]',
]
const HISTORY = SENT.map((display, i) => JSON.stringify({ display, pastedContents: {}, timestamp: i, project: 'C:\\work\\repo' })).join('\n')

type Feed = { v: number; at: number; seq: number; state: string; ovals: string[] }

// Nothing sits beneath the plugin: each hook here stands for the engine. `strip` is whether the dashboard's
// strip is up beside the shell, `room` what it says an oval holds, `git` what `git status` prints (null: no
// repository), `reply` the fork's and `late` how long it takes, `history` what was sent before.
function engine(
  on: On,
  given: { strip?: boolean; room?: number; git?: string | null; reply?: string | null; late?: number; kitty?: boolean; stored?: Record<string, unknown>; history?: string } = {},
) {
  const clock = mock.clock(on, { now: 1_000_000 })
  const stored = new Map<string, unknown>(Object.entries(given.stored ?? {}))
  on('store.get', (_, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_, e) => {
    stored.set(e.key, e.value)
    return { value: undefined }
  })
  mock.env(on, given.kitty === false ? { LOCALAPPDATA: KITTY_ENV.LOCALAPPDATA } : KITTY_ENV)
  const seen = {
    told: [] as Feed[],
    forks: [] as string[],
    submitted: [] as { text: string; asUser: boolean }[],
    filled: [] as { text: string; cursor?: number }[],
    runs: [] as string[][],
  }
  let click: { text: string; mtimeMs: number } | undefined
  // The prompt box, as the engine holds it.
  let box = { text: '', cursor: 0 }

  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('fs.stat', (_, e) => {
    if (ends(e.path, '.panel') && given.strip !== false) return { value: { kind: 'file', size: 0, mtimeMs: clock.now() - 1000, isLink: false } }
    if (ends(e.path, '.click.json') && click !== undefined) return { value: { kind: 'file', size: click.text.length, mtimeMs: click.mtimeMs, isLink: false } }
    return { deny: 'no such file' }
  })
  on('fs.read', (_, e) => {
    if (ends(e.path, '.click.json') && click !== undefined) return { value: click.text }
    if (ends(e.path, '.panel') && given.strip !== false) return { value: given.room === undefined ? '' : JSON.stringify({ room: given.room }) }
    if (slashed(e.path) === 'C:\\Users\\me\\.claude\\history.jsonl' && given.history !== undefined) return { value: given.history }
    return { deny: 'no such file' }
  })
  on('fs.write', (_, e) => {
    if (ends(e.path, '.json')) seen.told.push(JSON.parse(e.text) as Feed)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    seen.runs.push([...e.argv])
    const git = given.git === undefined ? DIRTY_FEATURE : given.git
    return { value: git === null ? { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } : { exitCode: 0, stdout: git, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('model.fork', async (_, e) => {
    seen.forks.push(e.prompt)
    if (given.late !== undefined) await clock.sleep(given.late)
    const reply = given.reply === undefined ? '["yes, do it", "run the tests", "merge with main"]' : given.reply
    return { value: reply === null ? { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded' as const, usage: USAGE } : { isAnswered: true, text: reply, usage: USAGE } }
  })
  on('prompt.submit', (_, e) => {
    seen.submitted.push({ text: e.text, asUser: e.origin?.kind === 'plugin' && e.origin.asUser === true })
    return { text: e.text }
  })
  on('prompt.fill', (_, e) => {
    seen.filled.push({ text: e.text, cursor: e.cursor })
    box = { text: e.text, cursor: e.cursor ?? e.text.length }
    return { isFilled: true }
  })
  on('prompt.edit', (_, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    box = { text, cursor: e.start + e.inputText.length }
    return box
  })
  on('prompt.change', (_, e) => ({ text: e.text }))
  on('prompt.suggest', () => ({ isShown: true }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('command.run', () => ({ text: '' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  // An oval picked on the strip, as of the clock now, from the ovals it was last told.
  const pick = (text: string, button: 'left' | 'right', id = `${clock.now()}`, seq = seen.told.at(-1)?.seq) => {
    click = { text: JSON.stringify({ v: 1, id, at: clock.now(), seq, text, button }), mtimeMs: clock.now() }
  }
  const last = () => seen.told.at(-1)
  const boxNow = () => box
  return { seen, clock, pick, last, stored, boxNow }
}

const start = async ($: Engine, clock: { advance: (ms: number) => Promise<void> }) => {
  await $.session.start({ cwd: 'C:\\work\\repo', surface: 'terminal', isInteractive: true })
  await clock.advance(1)
}

// Keys typed at the end of the box, as one edit, and the time for the ovals to follow them.
async function type($: Engine, clock: { advance: (ms: number) => Promise<void> }, box: () => { text: string; cursor: number }, keys: string) {
  const { text } = box()
  await $.prompt.edit({ origin: { kind: 'composer' }, text, cursor: text.length, start: text.length, end: text.length, inputText: keys })
  await clock.advance(50)
}

async function turn($: Engine, id: string, answer: string, reason: 'answer' | 'aborted' = 'answer') {
  await $.turn.start({ text: 'go on', turnId: id })
  await $.turn.complete({ answer, durationMs: 1, isAborted: reason === 'aborted', turnId: id, reason })
}

// --- git and the fork -------------------------------------------------

test("git's porcelain is read for the branch, its upstream and what's uncommitted", () => {
  expect(gitOf(DIRTY_FEATURE)).toEqual({ branch: 'feature', upstream: 'origin/feature', ahead: 2, behind: 0, staged: 1, changed: 1, untracked: 1, conflicted: 0 })
  expect(gitWords(gitOf(CLEAN_MAIN))).toBe('on branch main, nothing to commit, up to date with origin/main.')
  expect(gitWords(null)).toContain('not a git repository')
})

test('git alone guesses commit, push and a merge into main, and nothing for a clean main', () => {
  expect(fromGit(gitOf(DIRTY_FEATURE))).toEqual(['commit', 'commit and push', 'merge with main'])
  expect(fromGit(gitOf(CLEAN_MAIN))).toEqual([])
  expect(fromGit(gitOf(CLEAN_MAIN.replace('+0 -0', '+3 -0')))).toEqual(['push'])
  expect(fromGit(null)).toEqual([])
})

test("git rules out a habit with nothing to do: no commit in a clean tree, no push with nothing to push", () => {
  expect(fitsGit('commit and push', gitOf(CLEAN_MAIN))).toBe(false)
  expect(fitsGit('push it', gitOf(CLEAN_MAIN))).toBe(false)
  expect(fitsGit('push it', gitOf(CLEAN_MAIN.replace('+0 -0', '+1 -0')))).toBe(true)
  expect(fitsGit('pull updates from git', gitOf(CLEAN_MAIN))).toBe(true)
  expect(fitsGit('commit and push', gitOf(DIRTY_FEATURE))).toBe(true)
})

test("the fork's reply is read as a JSON array, fenced or not, or else line by line", () => {
  expect(guessesOf('```json\n["Commit and push.", "run the tests", "merge with main"]\n```')).toEqual(['Commit and push', 'run the tests', 'merge with main'])
  expect(guessesOf('1. yes, do it\n2. "no"\n- show me the diff\n4. one more')).toEqual(['yes, do it', 'no', 'show me the diff'])
  expect(guessesOf('["same", "Same", "", "other"]')).toEqual(['same', 'other'])
  expect(guessesOf(JSON.stringify([42, 'x'.repeat(80)]))).toEqual([])
})

test("the ovals are the fork's guesses first, then git's for those it left empty", () => {
  expect(ovalsOf(['yes'], gitOf(DIRTY_FEATURE))).toEqual(['yes', 'commit', 'commit and push'])
  expect(ovalsOf(['commit', 'a', 'b', 'c'], null)).toEqual(['commit', 'a', 'b'])
})

test("the fork is told git's state, the answer's end, what fits an oval and how the person words things", () => {
  const asked = askFor('Done. Want me to push it?', gitOf(DIRTY_FEATURE), 18, ['commit and push', 'push it'])
  expect(asked).toContain('on branch feature, 1 file staged, 1 file changed and not staged, 1 file untracked, 2 commits ahead of origin/feature.')
  expect(asked).toContain('Want me to push it?')
  expect(asked).toContain('answer straight away')
  expect(asked).toContain('at most 18 characters')
  expect(asked).toContain('"commit and push", "push it"')
  expect(askFor('Done.', null, 300)).toContain('at most 40 characters')
})

// --- the words ----------------------------------------------------------

const MODEL = modelOf(historyOf(HISTORY, 'C:\\work\\repo'))

test("only what was typed is learnt: no commands, shell lines, pictures or a terminal's own codes", () => {
  expect(isTyped('/predict on')).toBe(false)
  expect(isTyped('!git status')).toBe(false)
  expect(isTyped('\u001b[38;2;140;189;254m\u{10EEEE}\u0305\u0305')).toBe(false)
  expect(isTyped('[0m[38;2;140;189;254m')).toBe(false)
  expect(isTyped('commit and push')).toBe(true)
  expect(sentencesOf('Done. see C:\\Users [Image #1] and predict.py, ok?')).toEqual([['Done'], ['see', 'Users', 'and', 'predict.py', 'ok']])
})

test('later prompts count for more, and more again in the same project', () => {
  const sent = historyOf([{ display: 'a' }, { display: 'b', project: 'C:\\Work\\Repo' }, { display: 'c' }].map(row => JSON.stringify(row)).join('\n'), 'c:\\work\\repo')
  expect(sent.map(prompt => prompt.weight)).toEqual([1, 3, 3])
})

test('after a space, the word that came next before', () => {
  expect(nextWords(MODEL, ['commit', 'and'])[0]).toBe('push')
  expect(nextWords(MODEL, ['the'])).toContain('dashboard')
  expect(nextWords(MODEL, ['the'])).not.toContain('the')
})

test('a word being typed is finished, a slip offered as the word it was a slip for', () => {
  expect(completions(MODEL, [], 'pu')).toEqual(expect.arrayContaining(['push', 'pull']))
  expect(completions(MODEL, ['and'], 'pu')[0]).toBe('push')
  // comitt was typed once, commit a dozen times: comitt is a slip, and never offered.
  expect(completions(MODEL, [], 'comi')).toContain('commit')
  expect(completions(MODEL, [], 'comi')).not.toContain('comitt')
  // A word that begins none: what it may be a slip for.
  expect(completions(MODEL, [], 'imrove')[0]).toBe('improve')
})

test('a prompt the box begins is finished whole, and a word put in has a space after it', () => {
  const box = { text: 'commit a', cursor: 8 }
  const [whole, word] = offersFor(MODEL, box, ['commit and push'])
  expect(whole?.text).toBe('and push')
  expect(apply(box, whole!)).toEqual({ text: 'commit and push', cursor: 15 })
  expect(word?.text).toBe('and')
  expect(apply(box, word!)).toEqual({ text: 'commit and ', cursor: 11 })
  // In the middle of the box: the word at the caret replaced, the rest kept, no second space.
  const middle = { text: 'make the dash faster', cursor: 13 }
  const dashboard = offersFor(MODEL, middle, []).find(offer => offer.text === 'dashboard')!
  expect(apply(middle, dashboard)).toEqual({ text: 'make the dashboard faster', cursor: 19 })
})

test("nothing is offered for a slash command, a shell line or a note: Claude Code's own are there", () => {
  expect(offersFor(MODEL, { text: '/pre', cursor: 4 }, ['commit and push'])).toEqual([])
  expect(offersFor(MODEL, { text: '!gi', cursor: 3 }, [])).toEqual([])
})

test('an empty box offers whole prompts, and the likeliest goes in the middle oval', () => {
  const offers = emptyOffers({ text: '', cursor: 0 }, ['commit and push', 'push it', 'go', 'done'])
  expect(offers.map(offer => offer.text)).toEqual(['commit and push', 'push it', 'go'])
  expect(arranged(offers.map(offer => offer.text))).toEqual(['push it', 'commit and push', 'go'])
  expect(arranged(['only'])).toEqual([null, 'only', null])
})

// --- the session ----------------------------------------------------------

test("as the session starts, the ovals offer git's guesses, in the order the person sends them, with no turn yet", async ($, on) => {
  const { clock, last } = engine(on, { history: HISTORY })
  await start($, clock)
  // commit and push, sent six times, the likeliest: in the middle.
  expect(last()).toMatchObject({ v: 1, state: 'ready', ovals: ['commit', 'commit and push', 'merge with main'] })
})

test("a turn shows busy, then git's guesses at once, then the fork's when they come", async ($, on) => {
  const { seen, clock, last } = engine(on, { late: 3000 })
  await start($, clock)
  await $.turn.start({ text: 'fix it', turnId: 't1' })
  await clock.advance(1)
  expect(last()).toMatchObject({ state: 'busy', ovals: [] })
  await $.turn.complete({ answer: 'Fixed. Want me to commit?', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(1)
  expect(seen.runs.at(-1)).toEqual(['git', 'status', '--porcelain=v2', '--branch'])
  expect(seen.forks).toHaveLength(1)
  expect(seen.forks[0]).toContain('Want me to commit?')
  expect(last()).toMatchObject({ state: 'ready', ovals: ['commit and push', 'commit', 'merge with main'] })
  await clock.advance(3000)
  expect(last()).toMatchObject({ state: 'ready', ovals: ['run the tests', 'yes, do it', 'merge with main'] })
})

test('the fork is told how much an oval holds, as the strip says, and the prompts sent most', async ($, on) => {
  const { seen, clock } = engine(on, { room: 17, history: HISTORY })
  await start($, clock)
  await turn($, 't1', 'Done.')
  await clock.advance(1)
  expect(seen.forks[0]).toContain('at most 17 characters')
  expect(seen.forks[0]).toContain('"commit and push", "pull updates from git"')
})

test("Claude Code's own guess at the next prompt is one of the ovals", async ($, on) => {
  const { clock, last } = engine(on, { reply: null, git: CLEAN_MAIN })
  await start($, clock)
  await turn($, 't1', 'Done.')
  await clock.advance(1)
  await $.prompt.suggest({ text: 'run the app', origin: { kind: 'suggestion' } })
  await clock.advance(1)
  expect(last()).toMatchObject({ state: 'ready', ovals: ['', 'run the app', ''] })
})

test('as you type the ovals follow the word at the caret: a click on a word puts it in the box', async ($, on) => {
  const { seen, clock, pick, last, boxNow } = engine(on, { history: HISTORY, git: CLEAN_MAIN })
  await start($, clock)
  await type($, clock, boxNow, 'commit a')
  // The likeliest, the rest of commit and push, in the middle.
  expect(last()).toMatchObject({ state: 'ready', ovals: ['and', 'and push', 'again'] })
  pick('and', 'left')
  await clock.advance(150)
  expect(seen.filled).toEqual([{ text: 'commit and ', cursor: 11 }])
  expect(seen.submitted).toHaveLength(0)
  // The same click is acted on once.
  await clock.advance(250)
  expect(seen.filled).toHaveLength(1)

  // The box as the fill left it: the ovals follow on.
  await $.prompt.change({ text: 'commit and ', cursor: 11, origin: { kind: 'plugin', name: 'predict' } })
  await clock.advance(50)
  expect(last()).toMatchObject({ state: 'ready' })
  expect(last()!.ovals).toContain('push')
})

test('one click on a whole prompt sends it, the rest of one the box begins as well, and empties the box', async ($, on) => {
  const { seen, clock, pick, boxNow } = engine(on, { history: HISTORY, git: CLEAN_MAIN })
  await start($, clock)
  await type($, clock, boxNow, 'pull ')
  pick('updates from git', 'left')
  await clock.advance(150)
  expect(seen.submitted).toEqual([{ text: 'pull updates from git', asUser: true }])
  expect(seen.filled).toEqual([{ text: '', cursor: undefined }])
})

test('a right click does the other: a whole prompt goes in the box, a word is sent with the box', async ($, on) => {
  const { seen, clock, pick, last, boxNow } = engine(on, { history: HISTORY, git: CLEAN_MAIN })
  await start($, clock)
  await type($, clock, boxNow, 'commit a')
  pick('and push', 'right')
  await clock.advance(150)
  expect(seen.filled).toEqual([{ text: 'commit and push', cursor: 15 }])
  expect(seen.submitted).toHaveLength(0)

  await $.prompt.change({ text: 'commit and push', cursor: 15, origin: { kind: 'plugin', name: 'predict' } })
  await type($, clock, boxNow, ' to ')
  const word = last()!.ovals.find(oval => oval !== '')!
  pick(word, 'right')
  await clock.advance(150)
  expect(seen.submitted).toEqual([{ text: `commit and push to ${word}`, asUser: true }])
})

test('a pick is let go unless it is an oval still shown, for the box as it still is', async ($, on) => {
  const { seen, clock, pick, last, boxNow } = engine(on, { history: HISTORY, git: CLEAN_MAIN })
  await start($, clock)
  await type($, clock, boxNow, 'pu')
  // The strip's own picture, as a name clash once had it leave.
  pick('\u001b[38;2;140;189;254m\u{10EEEE}\u0305\u0305\u001b[39m', 'left', 'rows')
  await clock.advance(150)
  expect(seen.filled).toHaveLength(0)
  // An oval still shown, picked for a box typed in since and before the ovals followed it: the strip is
  // looked at for picks every 100 ms from the session's start, the ovals follow 30 ms after a key.
  await clock.advance(100 - ((clock.now() - 1_000_000) % 100) - 20)
  await $.prompt.edit({ origin: { kind: 'composer' }, text: 'pu', cursor: 2, start: 2, end: 2, inputText: 's' })
  pick(last()!.ovals.find(word => word === 'push')!, 'left', 'moved')
  await clock.advance(25)
  expect(seen.filled).toHaveLength(0)
  // The same oval picked once the ovals follow the box is put in.
  await clock.advance(100)
  pick(last()!.ovals.find(word => word === 'push')!, 'left', 'now')
  await clock.advance(150)
  expect(seen.filled).toHaveLength(1)
})

test("an oval picked from ovals since changed is let go, though the same words are still offered", async ($, on) => {
  const { seen, clock, pick, last } = engine(on, { late: 3000 })
  await start($, clock)
  await turn($, 't1', 'Done.')
  await clock.advance(1)
  const gits = last()!
  expect(gits.ovals).toContain('merge with main')
  await clock.advance(3000)
  expect(last()!.ovals).toContain('merge with main')
  pick('merge with main', 'left', 'stale', gits.seq)
  await clock.advance(150)
  expect(seen.submitted).toHaveLength(0)
  pick('merge with main', 'left', 'fresh')
  await clock.advance(150)
  expect(seen.submitted).toEqual([{ text: 'merge with main', asUser: true }])
})

test('what you send is learnt as you send it: the ovals guess in your words', async ($, on) => {
  const { clock, last, boxNow } = engine(on, { git: CLEAN_MAIN })
  await start($, clock)
  for (const turnId of ['t1', 't2']) {
    await $.prompt.submit({ text: 'deploy the probe', origin: { kind: 'composer' } })
    await turn($, turnId, 'Deployed.')
  }
  await clock.advance(1)
  await type($, clock, boxNow, 'dep')
  expect(last()?.ovals).toContain('deploy')
})

test('a turn begun before the guesses came makes them stale: the strip is never told them', async ($, on) => {
  const { seen, clock, last } = engine(on)
  await start($, clock)
  await turn($, 't1', 'One.')
  await $.turn.start({ text: 'and then', turnId: 't2' })
  await clock.advance(1)
  expect(seen.forks).toHaveLength(0)
  expect(last()?.state).toBe('busy')
})

test("a turn cut short forks nothing, and git's guesses stand", async ($, on) => {
  const { seen, clock, last } = engine(on)
  await start($, clock)
  await turn($, 't1', 'Half', 'aborted')
  await clock.advance(1)
  expect(seen.forks).toHaveLength(0)
  expect(last()).toMatchObject({ state: 'ready', ovals: ['commit and push', 'commit', 'merge with main'] })
})

test("with the fork failing, git's guesses stand in", async ($, on) => {
  const { clock, last } = engine(on, { reply: null })
  await start($, clock)
  await turn($, 't1', 'Done.')
  await clock.advance(1)
  expect(last()).toMatchObject({ state: 'ready', ovals: ['commit and push', 'commit', 'merge with main'] })
})

test('nothing is forked with no strip up to show it', async ($, on) => {
  const down = engine(on, { strip: false })
  await start($, down.clock)
  await turn($, 't1', 'Done.')
  await down.clock.advance(1)
  expect(down.seen.forks).toHaveLength(0)
})

test('/predict off stops the guessing and /predict on starts it again', async ($, on) => {
  const { seen, clock, last, stored } = engine(on)
  await start($, clock)
  const off = await $.command.run({ command: 'predict', args: 'off', ...TYPED })
  await clock.advance(1)
  expect(off.text).toContain('off')
  expect(stored.get('hidden')).toBe(true)
  expect(last()?.state).toBe('off')
  await turn($, 't1', 'Done.')
  await clock.advance(1)
  expect(seen.forks).toHaveLength(0)
  expect(last()?.state).toBe('off')

  const back = await $.command.run({ command: 'predict', args: 'on', ...TYPED })
  expect(back.text).toContain('three ovals')
  expect(stored.get('hidden')).toBe(false)
  await turn($, 't2', 'Done.')
  await clock.advance(1)
  expect(seen.forks).toHaveLength(1)
})

test('outside kitty nothing is written, and /predict says where the ovals show', async ($, on) => {
  const { seen, clock } = engine(on, { kitty: false })
  await start($, clock)
  await turn($, 't1', 'Done.')
  await clock.advance(1)
  expect(seen.told).toHaveLength(0)
  expect(seen.forks).toHaveLength(0)
  const said = await $.command.run({ command: 'predict', args: '', ...TYPED })
  expect(said.text).toContain("mc-rice's dashboard")
})

test('a pick left from before the session started is not acted on', async ($, on) => {
  const { seen, clock, pick } = engine(on)
  pick('commit', 'left', 'old', 1)
  await clock.advance(1)
  await start($, clock)
  await clock.advance(500)
  expect(seen.submitted).toHaveLength(0)
})

test('as the session ends the strip is told so, and a /clear starts it afresh', async ($, on) => {
  const { clock, last } = engine(on, { reply: null })
  await start($, clock)
  await turn($, 't1', 'Done.')
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  await clock.advance(1)
  expect(last()).toMatchObject({ state: 'ready', ovals: ['commit and push', 'commit', 'merge with main'] })
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's2', resume: { id: 's1' } })
  expect(last()?.state).toBe('ended')
})

test('a subagent ending its turn guesses nothing', async ($, on) => {
  const { seen, clock } = engine(on)
  await start($, clock)
  await $.turn.start({ text: 'look', turnId: 'a1', agentId: 'agent-1' })
  await $.turn.complete({ answer: 'Found it.', durationMs: 1, isAborted: false, turnId: 'a1', reason: 'answer', agentId: 'agent-1' })
  await clock.advance(1)
  expect(seen.forks).toHaveLength(0)
})
