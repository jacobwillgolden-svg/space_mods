import type { EngineInterface, Register } from 'claude-code'

import { askFor, cleaned, distinct, fitsGit, fromGit, gitOf, guessesOf, ROOM } from './guess'
import type { Git } from './guess'
import { apply, arranged, emptyModel, emptyOffers, habits, hear, historyOf, learn, modelOf, offersFor } from './words'
import type { Box, Model, Offer } from './words'

// Predictive text the way a phone's keyboard has it: three ovals under the prompt on mc-rice's dashboard
// (claude_mods/mc-rice, panels/predict.py), in the look of whichever mod holds the dashboard, and nowhere
// else. As you type they follow the word at the caret, finishing it or guessing the next, from the prompts
// you have sent before (words.ts). In an empty box after a turn they are whole prompts: git's at once, then
// a fork of the conversation's (as Claude Code's own one-line suggestion is made, and that suggestion too),
// with the prompts you send often. One click sends a whole prompt; a word goes in the prompt box at the
// caret, as a tap on a phone's puts it; a right click does the other. Alt+1, 2 and 3 pick the left, middle
// and right oval as a click does, with Shift as a right click: kitty hands them to the strip, which leaves
// the pick here as a click's, so nothing here tells them apart.
//
// The strip and this session meet in files named for kitty's process and the window Claude runs in, as
// Steve's mod and the dashboard's place do: the strip keeps <...>.panel fresh while it is up, with how many
// letters an oval holds; this session writes <...>.json, what the ovals say; and the strip leaves
// <...>.click.json when one is picked.
type Strip = { feed: string; panel: string; click: string }

// What the strip is told: `ready` with ovals to pick, `busy` while a turn runs and the box is empty, `idle`
// with nothing to offer, `off` after /predict off, `ended` as the session goes.
type State = 'idle' | 'busy' | 'ready' | 'off' | 'ended'

type Timer = ReturnType<EngineInterface['clock']['every']>

// How long the strip's file counts as fresh once touched: it touches it every two seconds.
const FRESH_MS = 5000
// How often the strip's pick is looked for, and how old one may be and still be acted on.
const CLICK_MS = 100
const CLICK_FRESH_MS = 10_000
const GIT_MS = 5000
// A burst of keys is guessed for once, this long after the first of it.
const TYPING_MS = 30
// How much a prompt sent in this session counts, against the history's newest (3, or 4.5 in its project).
const SENT_NOW = 4
// The prompts sent most often that the fork is shown, for their wording.
const HABITS_SHOWN = 5

let strip: Strip | undefined
// The main loop's turns, counted: the guesses wanted are the last turn's, and any still coming for an
// earlier one are let go.
let turns = 0
let isRunning = false // a main-loop turn is under way
let isEnded = false
let project: string | undefined
let box: Box = { text: '', cursor: 0 }
let model: Model = emptyModel()
let git: Git | null = null
let forked: string[] = [] // the fork's guesses at the last turn's end
let suggested = '' // Claude Code's own one-line guess at the same
// What the strip was last told, and the offers behind its ovals: in the ovals' order, null where one is
// empty, with the box they were made for.
let told = ''
let seq = 0
let offers: (Offer | null)[] = []
let offeredFor: Box = box
let isDue = false
let queue: Promise<unknown> = Promise.resolve()
let clickStamp = -1 // the pick's file as last read
let clickDone = '' // the last pick acted on
let isReadingClick = false
let clickBeat: Timer | undefined

// Outside kitty there is no strip to meet.
async function findStrip($: EngineInterface): Promise<Strip | undefined> {
  const pid = await $.env.get('KITTY_PID')
  const window = await $.env.get('KITTY_WINDOW_ID')
  const local = await $.env.get('LOCALAPPDATA')
  if (!pid || !window || !local || !/^[0-9]+$/.test(pid) || !/^[0-9]+$/.test(window)) return undefined
  const base = `${local}\\mc-rice\\predict\\${pid}-${window}`
  return { feed: `${base}.json`, panel: `${base}.panel`, click: `${base}.click.json` }
}

// Tells the strip what to show. Written only when the ovals or the state change: offers whose words stay
// the same as the box moves on are kept up to date here alone, so a pick reads them against the box as it
// is. A write that fails leaves the strip on the last one; nothing here may get in the session's way.
async function show($: EngineInterface, state: State, list: readonly (Offer | null)[] = [], base: Box = box) {
  if (strip === undefined) return
  offers = state === 'ready' ? [...list] : []
  offeredFor = base
  const ovals = offers.map(offer => offer?.text ?? '')
  const said = JSON.stringify([state, ovals])
  if (said === told) return
  told = said
  seq += 1
  const feed = { v: 1, at: await $.clock.now(), seq, state, ovals }
  await $.fs.write(strip.feed, JSON.stringify(feed)).catch(() => undefined)
}

async function isOn($: EngineInterface): Promise<boolean> {
  return (await $.store.get('hidden').catch(() => undefined)) !== true
}

async function isStripUp($: EngineInterface): Promise<boolean> {
  if (strip === undefined) return false
  const stat = await $.fs.stat(strip.panel).catch(() => undefined)
  return stat !== undefined && (await $.clock.now()) - stat.mtimeMs < FRESH_MS
}

// How many letters an oval holds, as the strip last said.
async function roomNow($: EngineInterface): Promise<number> {
  if (strip === undefined) return ROOM
  try {
    const said = JSON.parse(String(await $.fs.read(strip.panel))) as { room?: unknown }
    return typeof said.room === 'number' && said.room > 0 ? said.room : ROOM
  } catch {
    return ROOM
  }
}

async function gitNow($: EngineInterface): Promise<Git | null> {
  try {
    const ran = await $.process.run(['git', 'status', '--porcelain=v2', '--branch'], { timeoutMs: GIT_MS })
    return ran.exitCode === 0 ? gitOf(ran.stdout) : null
  } catch {
    return null
  }
}

// The whole prompts on offer, likeliest first: the fork's guesses, Claude Code's own, git's, and the ones
// you send often; in an empty box only those git doesn't rule out (no commit with nothing to commit).
function wholes(isEmptyBox: boolean): string[] {
  const often = habits(model, isEmptyBox ? prompt => fitsGit(prompt, git) : undefined)
  // Git's guesses in the order you send them: commit and push before commit, for one who pushes.
  const rank = (guess: string) => {
    const at = often.findIndex(habit => habit.toLowerCase() === guess.toLowerCase())
    return at === -1 ? often.length : at
  }
  const gits = fromGit(git).sort((a, b) => rank(a) - rank(b))
  return distinct([...forked, suggested, ...gits, ...often], Infinity)
}

// What the ovals should say now, told to the strip.
async function refresh($: EngineInterface) {
  if (strip === undefined) return
  if (isEnded) return show($, 'ended')
  if (!(await isOn($))) return show($, 'off')
  const now = box
  if (now.text.trim() === '') {
    if (isRunning) return show($, 'busy', [], now)
    const list = emptyOffers(now, wholes(true))
    return show($, list.length > 0 ? 'ready' : 'idle', arranged(list), now)
  }
  const list = offersFor(model, now, wholes(false))
  return show($, list.length > 0 ? 'ready' : 'idle', arranged(list), now)
}

// The ovals worked out again in `ms`, once however often it's asked for meanwhile, one at a time.
function soon($: EngineInterface, ms = 0) {
  if (isDue) return
  isDue = true
  $.clock.after(ms, () => {
    isDue = false
    queue = queue.then(() => refresh($)).catch(() => undefined)
  })
}

// The box as the engine reports it after an edit or a change.
function typed($: EngineInterface, now: Box) {
  if (strip === undefined || (now.text === box.text && now.cursor === box.cursor)) return
  box = { text: now.text, cursor: now.cursor }
  soon($, TYPING_MS)
}

// What you send, learnt from: what you have sent before (Claude Code's history.jsonl), and git's state.
async function warmUp($: EngineInterface) {
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  const profile = await $.env.get('USERPROFILE')
  const home = config || (profile ? `${profile}\\.claude` : undefined)
  const sent = home === undefined ? undefined : await $.fs.read(`${home}\\history.jsonl`).catch(() => undefined)
  if (typeof sent === 'string') {
    const started = await $.clock.now()
    model = modelOf(historyOf(sent, project))
    $.ui.log(`predict: ${model.seen.size} words from what you've sent, in ${(await $.clock.now()) - started} ms`, { to: 'debug' })
  }
  git = await gitNow($)
  soon($)
}

// Once the main loop's turn `turn` has ended, with `answer` or cut short: git's guesses at once, then for
// an answer the fork's, unless another turn has begun since. The fork runs only while the strip is up to
// show its guesses: a guess nobody sees costs the same.
async function afterTurn($: EngineInterface, turn: number, answer: string | null) {
  if (turn !== turns || strip === undefined) return
  git = await gitNow($)
  if (turn !== turns) return
  soon($)
  if (answer === null || !(await isOn($)) || !(await isStripUp($))) return
  const room = await roomNow($)
  const started = await $.clock.now()
  const reply = await $.model.fork({ prompt: askFor(answer, git, room, habits(model).slice(0, HABITS_SHOWN)) }).catch(error => {
    $.ui.log(`predict: the fork failed: ${String(error)}`, { to: 'debug' })
    return undefined
  })
  if (turn !== turns) return
  if (reply?.isAnswered) {
    forked = guessesOf(reply.text)
    const used = reply.usage
    $.ui.log(
      `predict: ${forked.length} guesses in ${(await $.clock.now()) - started} ms, ${used.cache_read_input_tokens} tokens read ` +
        `from the cache, ${used.input_tokens + used.cache_creation_input_tokens} not, ${used.output_tokens} out`,
      { to: 'debug' },
    )
  } else if (reply !== undefined) {
    $.ui.log(`predict: no guesses: ${reply.reason}`, { to: 'debug' })
  }
  soon($)
}

// The strip leaves {v, id, at, seq, text, button} when an oval is clicked. Only an oval it still shows, for
// the box as it still is, is acted on. A click on a whole prompt sends it, one tap as before: the prompt the
// offer makes of the box, as the person's own (held by the engine until the session is idle, should a turn
// have started), the box emptied. A click on a word puts it in the box, the prompt still going on. A right
// click does the other: a whole prompt into the box to change first, a word sent with the box before it.
async function readClick($: EngineInterface) {
  if (strip === undefined || isReadingClick) return
  isReadingClick = true
  try {
    const stat = await $.fs.stat(strip.click).catch(() => undefined)
    if (stat === undefined || stat.kind !== 'file' || stat.mtimeMs === clickStamp) return
    clickStamp = stat.mtimeMs
    const left = JSON.parse(String(await $.fs.read(strip.click))) as {
      v?: unknown
      id?: unknown
      at?: unknown
      seq?: unknown
      text?: unknown
      button?: unknown
      how?: unknown
    }
    if (left.v !== 1 || typeof left.id !== 'string' || left.id === clickDone) return
    if (typeof left.at !== 'number' || Math.abs((await $.clock.now()) - left.at) > CLICK_FRESH_MS) return
    const text = typeof left.text === 'string' ? left.text.trim() : ''
    if (text === '') return
    clickDone = left.id
    if (typeof left.seq === 'number' && left.seq !== seq) {
      $.ui.log(`predict: "${text.slice(0, 80)}" was picked from ovals since changed, and let go`, { to: 'debug' })
      return
    }
    // Nothing else the strip might leave (once, the rows of its own picture) ever goes in as your prompt.
    const offer = offers.find(o => o !== null && o.text.trim() === text)
    if (offer === undefined) {
      $.ui.log(`predict: a pick that was never offered, ${JSON.stringify(text.slice(0, 80))}, was let go`, { to: 'debug' })
      return
    }
    if (box.text !== offeredFor.text || box.cursor !== offeredFor.cursor) {
      $.ui.log(`predict: "${text}" was picked for a box since typed in, and let go`, { to: 'debug' })
      return
    }
    const made = apply(offeredFor, offer)
    // A strip from before `button` said `how`: send or fill, or insert or send, the second its right click.
    const isRight = left.button === 'right' || (left.button === undefined && (left.how === 'send' || left.how === 'fill'))
    if (offer.whole !== isRight) {
      const words = made.text.trim()
      void $.prompt
        .submit({ text: words, asUser: true })
        .then(entered => {
          if (entered.drop !== undefined) $.ui.log(`predict: "${words}" was dropped: ${entered.drop}`, { to: 'debug' })
        })
        .catch(error => $.ui.log(`predict: "${words}" was not sent: ${String(error)}`, { to: 'debug' }))
      if (box.text !== '') await $.prompt.fill({ text: '' }).catch(() => undefined)
      return
    }
    const filled = await $.prompt.fill({ text: made.text, mode: 'replace', cursor: made.cursor })
    if (!filled.isFilled) void $.ui.toast(`The prompt box is busy: "${offer.text}" didn't go in.`)
  } catch {
    // Being written, or gone: the next look has it.
  } finally {
    isReadingClick = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'predict',
      description: "Predictive text in three ovals under the prompt on mc-rice's dashboard, as you type and after each turn: /predict on|off",
      argumentHint: 'on|off',
      immediate: true,
    })
    strip = await findStrip($).catch(() => undefined)
    project = e.cwd
    turns += 1
    isRunning = false
    isEnded = false
    box = { text: '', cursor: 0 }
    forked = []
    suggested = ''
    told = ''
    // On until /predict off, and said so in the store, for the dashboard to read as it lays out.
    if ((await $.store.get('hidden')) === undefined) await $.store.set('hidden', false)

    clickBeat?.cancel()
    clickBeat = undefined
    if (strip !== undefined) {
      // A pick left from before this session is not this session's to act on.
      clickStamp = (await $.fs.stat(strip.click).catch(() => undefined))?.mtimeMs ?? -1
      clickBeat = $.clock.every(CLICK_MS, () => void readClick($))
      soon($)
      $.clock.after(0, () => void warmUp($).catch(() => undefined))
    }
    return next(e)
  })

  // As the session goes the ovals go with it. After a /clear or a resume Claude goes on in the same
  // process with no session.start: the last conversation's guesses are let go.
  on('session.end', async ($, e, next) => {
    turns += 1
    isRunning = false
    forked = []
    suggested = ''
    if (e.reason === 'clear' || e.reason === 'resume') {
      const turn = turns
      $.clock.after(0, () => void afterTurn($, turn, null))
      soon($)
    } else {
      isEnded = true
      await show($, 'ended')
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      turns += 1
      isRunning = true
      forked = []
      suggested = ''
      soon($)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Guessed from a timer, so the turn ends when it would have: git and the fork take a while.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      isRunning = false
      const turn = turns
      const isAnswered = e.reason === 'answer' && !e.isAborted
      if (isAnswered) hear(model, e.answer)
      $.clock.after(0, () => void afterTurn($, turn, isAnswered ? e.answer : null))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Every key you type in the prompt box: the ovals follow it.
  on('prompt.edit', async ($, e, next) => {
    const after = await next(e)
    typed($, after)
    return after
  }).catch(($, e, next) => next(e))

  // The box changed some other way: a recalled prompt, a clear, an oval picked.
  on('prompt.change', async ($, e, next) => {
    typed($, e)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Claude Code's own guess at your next prompt, one of the ovals' too.
  on('prompt.suggest', async ($, e, next) => {
    if (e.origin.kind === 'suggestion' && !isRunning) {
      const guess = cleaned(e.text)
      if (guess !== '' && guess !== suggested) {
        suggested = guess
        soon($)
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // What you send, learnt as you send it: the ovals guess in your words.
  on('prompt.submit', async ($, e, next) => {
    try {
      if (e.origin.kind === 'composer' && e.isMeta !== true && e.command === undefined) learn(model, e.text, SENT_NOW)
    } catch {
      // A prompt not learnt is a guess a little worse, never a prompt lost.
    }
    return next(e)
  })

  on('command.run', { command: 'predict' }, async ($, e) => {
    const asked = e.args.trim().toLowerCase()
    if (asked === 'off') {
      await $.store.set('hidden', true)
      soon($)
      return { text: 'Predictions are off, in every session: /predict on brings the ovals back.' }
    }
    if (asked !== '' && asked !== 'on') return { text: 'Try /predict on or /predict off.' }
    if (asked === 'on') await $.store.set('hidden', false)
    if (!(await isOn($))) return { text: 'Predictions are off: /predict on brings them back.' }
    soon($)
    return {
      text:
        strip === undefined
          ? "Predictions are on, but they show only under the prompt on mc-rice's dashboard, in kitty."
          : (await isStripUp($))
            ? 'Predictions are on: three ovals under the prompt, following what you type. A click sends a whole prompt or puts a word in; a right click does the other. Alt+1, 2 and 3 pick the left, middle and right oval, Alt+Shift as a right click.'
            : 'Predictions are on. Their strip under the prompt opens with the dashboard round this shell (after a kitty restart, the first time).',
    }
  })
}
