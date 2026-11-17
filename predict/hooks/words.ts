// What you'll type next, a word at a time, the way a phone's keyboard guesses it: learnt from the prompts
// you have sent before (Claude Code keeps every one, history.jsonl), with the words of Claude's last answers
// for the names and files in them, and whole prompts finished from what the turn's end guessed and what you
// send often. Plain functions, no engine: register.ts feeds them the box as you type.

// The prompt box as the engine reports it: what's typed, and where the caret is (UTF-16 offsets).
export type Box = { text: string; cursor: number }

// One oval: what it says, and what picking it makes of the box it was offered for: `insert` in place of
// `start` to `end`, the caret then at `caret`. `whole` when that is a whole prompt, ready to send: one
// offered in an empty box, or the rest of one the box begins; not a word, with the prompt still going on.
export type Offer = { text: string; start: number; end: number; insert: string; caret: number; whole: boolean }

type Counts = Map<string, number>
type Followers = Map<string, { total: number; next: Counts }>

export type Model = {
  words: Counts // every word, by its lowercase, weighted
  total: number
  seen: Counts // how many times each word was typed, unweighted
  starts: Counts // the words a prompt or a sentence begins with
  startTotal: number
  after1: Followers // what follows each word
  after2: Followers // what follows each pair, "a b"
  forms: Map<string, Counts> // how each word is spelt as typed: README, GitHub, mc-rice
  prompts: Map<string, { text: string; weight: number }> // short prompts, sent whole, by their words in lowercase
  heard: Counts // words of Claude's last answers, fading a turn at a time
  heardTotal: number
  typos: Map<string, string> // a word typed now and then, to the one close to it typed far more often
  tops: { words?: string[]; starts?: string[] } // the likeliest words and starts, kept until a prompt is learnt
}

export type Sent = { text: string; weight: number }

const OVALS = 3
// A word: letters or digits, with apostrophes, dots, dashes, slashes and underscores inside (don't,
// predict.py, mc-rice), never at its ends.
const WORD = /[\p{L}\p{N}](?:[\p{L}\p{N}'’_./-]*[\p{L}\p{N}])?/gu
// The word the caret is in or just after, as far as it goes either way.
const WORD_BEFORE = /[\p{L}\p{N}][\p{L}\p{N}'’_./-]*$/u
const WORD_AFTER = /^[\p{L}\p{N}'’_./-]*/u
// Where one sentence or clause ends and another begins: nothing is guessed across one.
const BREAKS = /[.!?;:]+(?=\s|$)|\n+|\s[-–—]+\s|[()[\]{}"“”]/u
// Not typed: control characters, private-use ones (a terminal's image placeholders) or an escape's colours.
const JUNK = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|\p{Co}|\[\d+(?:;\d+)*m/u
const PLACEHOLDERS = /\[(?:Image|Pasted text)[^\]]*\]/gi
const LINKS = /\bhttps?:\/\/\S+/gi
const LONGEST_WORD = 32
// A prompt sent whole is remembered as one while it is this short.
const SHORT_WORDS = 6
const SHORT_LETTERS = 40
// How much a prompt sent counts against one sent before: the newest three times the oldest, and in the
// same project half as much again.
const NEWEST = 3
const SAME_PROJECT = 1.5
// A prompt sent at least about twice of late is a habit, offered in the empty box and finished as you type.
const HABIT = 2.5
// A typo: a word with its letters doubled in other places than in one DOUBLED_RATIO times as common, and
// seen DOUBLED_LEAST times at least (comitt, commit). With no dictionary, nothing else is safe to call one:
// a word a letter from a commoner one is as often a word (seven, steven; possibly, possible).
const DOUBLED_RATIO = 4
const DOUBLED_LEAST = 3
// A correction keeps this much of a word's likelihood for each letter it is away from what's typed.
const PER_SLIP = 0.15
// A word typed this many times is meant, never corrected.
const MEANT = 3

export function emptyModel(): Model {
  return {
    words: new Map(),
    total: 0,
    seen: new Map(),
    starts: new Map(),
    startTotal: 0,
    after1: new Map(),
    after2: new Map(),
    forms: new Map(),
    prompts: new Map(),
    heard: new Map(),
    heardTotal: 0,
    typos: new Map(),
    tops: {},
  }
}

const keyOf = (word: string) => word.toLowerCase().replaceAll('’', "'")

function bump(counts: Counts, key: string, by: number) {
  counts.set(key, (counts.get(key) ?? 0) + by)
}

function follow(followers: Followers, context: string, key: string, by: number) {
  let after = followers.get(context)
  if (after === undefined) {
    after = { total: 0, next: new Map() }
    followers.set(context, after)
  }
  after.total += by
  bump(after.next, key, by)
}

function spell(model: Model, key: string, form: string, by: number) {
  let forms = model.forms.get(key)
  if (forms === undefined) {
    forms = new Map()
    model.forms.set(key, forms)
  }
  bump(forms, form, by)
}

// Whether a prompt is one the person typed: not a slash command, a shell line or a note to memory, and
// nothing in it a person doesn't type.
export function isTyped(prompt: string): boolean {
  const text = prompt.trim()
  return text !== '' && !/^[/!#]/.test(text) && !JUNK.test(text)
}

const plain = (prompt: string) => prompt.replace(PLACEHOLDERS, ' ').replace(LINKS, ' ')

// A text's words: never one longer than a word gets, nor a lone letter but a and I (C of C:\Users).
const wordsIn = (text: string) => (text.match(WORD) ?? []).filter(word => word.length <= LONGEST_WORD && (word.length > 1 || /[aAiI\p{N}]/u.test(word)))

// A prompt's sentences, each its words as typed.
export function sentencesOf(prompt: string): string[][] {
  return plain(prompt)
    .split(BREAKS)
    .map(wordsIn)
    .filter(words => words.length > 0)
}

// A prompt short enough to be offered whole: its words in lowercase (a question kept apart from the same
// words said), and how it was last typed.
function shortOf(prompt: string): { key: string; text: string } | null {
  const text = plain(prompt).replace(/\s+/g, ' ').trim().replace(/\.+$/, '')
  const words = wordsIn(text)
  if (words.length === 0 || words.length > SHORT_WORDS || text.length > SHORT_LETTERS) return null
  return { key: words.map(keyOf).join(' ') + (text.endsWith('?') ? '?' : ''), text }
}

// One prompt sent, taken in: its words, what follows what, and the prompt itself while it is short.
export function learn(model: Model, prompt: string, weight = 1): void {
  if (!isTyped(prompt)) return
  model.tops = {}
  for (const sentence of sentencesOf(prompt)) {
    const keys = sentence.map(keyOf)
    keys.forEach((key, i) => {
      bump(model.words, key, weight)
      model.total += weight
      bump(model.seen, key, 1)
      spell(model, key, sentence[i]!, weight)
      if (i === 0) {
        bump(model.starts, key, weight)
        model.startTotal += weight
      }
      if (i >= 1) follow(model.after1, keys[i - 1]!, key, weight)
      if (i >= 2) follow(model.after2, `${keys[i - 2]} ${keys[i - 1]}`, key, weight)
    })
  }
  const whole = shortOf(prompt)
  if (whole !== null) {
    const known = model.prompts.get(whole.key)
    model.prompts.set(whole.key, { text: whole.text, weight: (known?.weight ?? 0) + weight })
  }
}

// The prompts in Claude Code's history.jsonl, oldest first, the last `limit` of them, each weighted by how
// lately it was sent and whether it was sent in `project`.
export function historyOf(jsonl: string, project?: string, limit = 5000): Sent[] {
  const rows: { text: string; project: unknown }[] = []
  for (const line of jsonl.split(/\r?\n/)) {
    if (line.trim() === '') continue
    try {
      const row = JSON.parse(line) as { display?: unknown; project?: unknown }
      if (typeof row.display === 'string') rows.push({ text: row.display, project: row.project })
    } catch {
      // A line half written: the rest still count.
    }
  }
  const kept = rows.slice(-limit)
  const here = project?.toLowerCase()
  return kept.map((row, i) => ({
    text: row.text,
    weight:
      (1 + ((NEWEST - 1) * i) / Math.max(1, kept.length - 1)) *
      (here !== undefined && typeof row.project === 'string' && row.project.toLowerCase() === here ? SAME_PROJECT : 1),
  }))
}

export function modelOf(sent: readonly Sent[]): Model {
  const model = emptyModel()
  for (const prompt of sent) learn(model, prompt.text, prompt.weight)
  model.typos = typosOf(model)
  return model
}

// How many edits apart two words are (letters added, dropped, changed or swapped), counting no further than
// `limit` + 1.
export function distance(a: string, b: string, limit = 2): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let before: number[] = []
  let last = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let least = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let d = Math.min(last[j]! + 1, row[j - 1]! + 1, last[j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, before[j - 2]! + 1)
      row.push(d)
      least = Math.min(least, d)
    }
    if (least > limit) return limit + 1
    before = last
    last = row
  }
  return Math.min(last[b.length]!, limit + 1)
}

const allowed = (word: string) => (word.length >= 6 ? 2 : 1)

// A word with its doubled letters single: comitt and commit are both comit.
const shapeOf = (word: string) => word.replace(/(.)\1+/gu, '$1')

// The words that are a slip for one typed far more often, the same letters doubled elsewhere: comitt for
// commit, entiire for entire, pannel for panel.
function typosOf(model: Model): Map<string, string> {
  const shapes = new Map<string, [string, number][]>()
  for (const [word, n] of model.words) {
    if (word.length < 4 || !/^\p{L}+$/u.test(word)) continue
    const shape = shapeOf(word)
    const group = shapes.get(shape)
    if (group === undefined) shapes.set(shape, [[word, n]])
    else group.push([word, n])
  }
  const typos = new Map<string, string>()
  for (const group of shapes.values()) {
    if (group.length < 2) continue
    const [likeliest, most] = group.reduce((a, b) => (b[1] > a[1] ? b : a))
    if (most < DOUBLED_LEAST) continue
    for (const [word, n] of group) if (word !== likeliest && most >= n * DOUBLED_RATIO) typos.set(word, likeliest)
  }
  return typos
}

// After a turn: the words of Claude's answer, for the names and files you may type next, the earlier
// answers' fading by half.
export function hear(model: Model, answer: string): void {
  for (const [key, n] of model.heard) {
    if (n < 0.1) model.heard.delete(key)
    else model.heard.set(key, n / 2)
  }
  for (const word of wordsIn(answer)) {
    if (word.length < 4 || /^\d+$/.test(word)) continue
    const key = keyOf(word)
    bump(model.heard, key, 1)
    // Spelt as Claude spells it only where you never have.
    if (!model.forms.has(key)) spell(model, key, word, 0.01)
  }
  model.heardTotal = [...model.heard.values()].reduce((sum, n) => sum + n, 0)
}

// The prompts sent often of late, likeliest first, those `fits` allows.
export function habits(model: Model, fits: (prompt: string) => boolean = () => true, count = 8): string[] {
  return [...model.prompts.values()]
    .filter(prompt => prompt.weight >= HABIT && fits(prompt.text))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, count)
    .map(prompt => prompt.text)
}

const share = (after: { total: number; next: Counts } | undefined, key: string) => (after ? (after.next.get(key) ?? 0) / after.total : 0)

// How likely `key` is next after `context` (the sentence's last two words, none at its start).
function chance(model: Model, context: readonly string[], key: string): number {
  const said = (model.words.get(key) ?? 0) / Math.max(1, model.total)
  const one = context.length === 0 ? 0.7 * ((model.starts.get(key) ?? 0) / Math.max(1, model.startTotal)) + 0.3 * said : said
  const last = context[context.length - 1]
  const two = last === undefined ? 0 : share(model.after1.get(last), key)
  const three = context.length < 2 ? 0 : share(model.after2.get(`${context[context.length - 2]} ${last}`), key)
  return 0.55 * three + 0.3 * two + 0.15 * one
}

function best(scores: Map<string, number>, count: number): string[] {
  return [...scores]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, count)
    .map(([key]) => key)
}

// The likeliest words, or sentence starts, held on the model: sorting them all is too slow for each key.
function top(model: Model, which: 'words' | 'starts'): string[] {
  return (model.tops[which] ??= best(model[which], 12))
}

// The next word, after a space: what followed these words before, else what you start with.
export function nextWords(model: Model, context: readonly string[], count = OVALS): string[] {
  const last = context[context.length - 1]
  // What followed these words before; the commonest words only where little did.
  const candidates = new Set<string>()
  if (last !== undefined) for (const key of model.after1.get(last)?.next.keys() ?? []) candidates.add(key)
  if (context.length >= 2) for (const key of model.after2.get(`${context[context.length - 2]} ${last}`)?.next.keys() ?? []) candidates.add(key)
  if (candidates.size < 2 * count) for (const key of top(model, context.length === 0 ? 'starts' : 'words')) candidates.add(key)
  // Never the word just typed again (the the), nor a slip for a word.
  if (last !== undefined) candidates.delete(last)
  const scores = new Map<string, number>()
  for (const key of candidates) if (!model.typos.has(key)) scores.set(key, chance(model, context, key))
  return best(scores, count)
}

// The word being typed, finished: the words it begins, likeliest here first, a slip offered as what it was
// a slip for (comitt, commit); when it begins none, the words it may be a slip for. Never the word as typed:
// a space does as much.
export function completions(model: Model, context: readonly string[], typed: string, count = OVALS): string[] {
  const scores = new Map<string, number>()
  const add = (key: string, score: number) => {
    // A word Claude has used is spelt right, whatever you type more often (committed, commited).
    const meant = model.heard.has(key) ? key : (model.typos.get(key) ?? key)
    if (meant !== typed) scores.set(meant, Math.max(scores.get(meant) ?? 0, score))
  }
  for (const key of model.words.keys()) if (key.startsWith(typed)) add(key, chance(model, context, key))
  for (const [key, n] of model.heard) if (key.startsWith(typed)) add(key, chance(model, context, key) + (0.2 * n) / Math.max(1, model.heardTotal))
  // A word you've typed a few times is meant: it isn't corrected.
  if (scores.size === 0 && typed.length >= 4 && (model.seen.get(typed) ?? 0) < MEANT) {
    // Against the whole word and its beginnings about as long as what's typed (imrov is a slip in improve),
    // the first letter as typed: a slip there is rare, and the nearest words go first.
    const lengths = [typed.length - 1, typed.length, typed.length + 1]
    for (const [key, n] of model.words) {
      if (n < 2 || key === typed || key[0] !== typed[0] || model.typos.has(key)) continue
      let near = distance(typed, key, allowed(typed))
      for (const length of lengths) if (length < key.length) near = Math.min(near, distance(typed, key.slice(0, length), allowed(typed)))
      if (near <= allowed(typed)) scores.set(key, n * PER_SLIP ** near)
    }
  }
  // A word typed whole that begins no other and is a slip for none: offered as typed, a tap putting the
  // space after it, so the ovals never go blank mid-word.
  if (scores.size === 0 && (model.words.get(typed) ?? 0) > 0) scores.set(typed, 1)
  return best(scores, count)
}

// How the person spells a word: as they most often have, with a capital where they began it with one.
function spelt(model: Model, key: string, typed: string): string {
  let form = key
  let most = -1
  for (const [spelling, n] of model.forms.get(key) ?? []) {
    if (n > most) {
      form = spelling
      most = n
    }
  }
  return /^\p{Lu}/u.test(typed) && /^\p{Ll}/u.test(form) ? form[0]!.toUpperCase() + form.slice(1) : form
}

// The sentence's last two words before the caret's word, in lowercase; none at a sentence's start.
function contextOf(before: string): string[] {
  const sentences = before.split(BREAKS)
  return wordsIn(sentences[sentences.length - 1] ?? '')
    .map(keyOf)
    .slice(-2)
}

const bare = (word: string) => keyOf(word).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')

// The rest of a whole prompt the box begins: its words from the one being typed on, or null. The first of
// `phrases` that fits.
export function phraseRest(before: string, typed: string, phrases: readonly string[]): string | null {
  const said = before.trim() === '' ? [] : before.trim().split(/\s+/).map(bare)
  const word = bare(typed)
  if (said.length === 0 && word === '') return null
  for (const phrase of phrases) {
    const pieces = phrase.trim().split(/\s+/)
    const keys = pieces.map(bare)
    const at = said.length
    if (keys.length <= at || !said.every((w, i) => w === keys[i]) || !keys[at]!.startsWith(word)) continue
    if (keys.length === at + 1 && keys[at] === word) continue // typed whole already
    return pieces.slice(at).join(' ')
  }
  return null
}

// An offer replacing `start` to `end` of `text` with `words`: a word with a space after it, as a phone's
// keyboard puts one (none added before a space already there, the caret put past it), a prompt's rest as it is.
function edit(text: string, start: number, end: number, words: string, spaced: boolean): Offer {
  const spaceAfter = /^\s/.test(text.slice(end))
  const insert = spaced && !spaceAfter ? `${words} ` : words
  return { text: words, start, end, insert, caret: start + insert.length + (spaced && spaceAfter ? 1 : 0), whole: !spaced }
}

function distinctOffers(offers: readonly Offer[]): Offer[] {
  const seen = new Set<string>()
  return offers.filter(offer => {
    const key = offer.text.toLowerCase()
    if (offer.text === '' || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// The ovals while there's something in the box, likeliest first: the rest of a prompt in `phrases` the box
// begins (the turn's guesses, then your habits), then the word being typed finished, or the next one after
// a space. Nothing for a slash command, a shell line or a note to memory: Claude Code has its own for those.
export function offersFor(model: Model, box: Box, phrases: readonly string[]): Offer[] {
  const text = box.text
  const cursor = Math.max(0, Math.min(box.cursor, text.length))
  if (/^\s*[/!#]/.test(text)) return []
  const before = text.slice(0, cursor)
  const typed = WORD_BEFORE.exec(before)?.[0] ?? ''
  const start = cursor - typed.length
  const end = cursor + (WORD_AFTER.exec(text.slice(cursor))?.[0].length ?? 0)
  const offers: Offer[] = []
  const rest = phraseRest(text.slice(0, start), typed, phrases)
  if (rest !== null) offers.push(edit(text, start, end, rest, false))
  // A word ending in an apostrophe, a dot or a dash is still being typed: only a prompt's rest fits it.
  if (typed === '' || /[\p{L}\p{N}]$/u.test(typed)) {
    const context = contextOf(text.slice(0, start))
    const keys = typed === '' ? nextWords(model, context) : completions(model, context, keyOf(typed))
    for (const key of keys) offers.push(edit(text, start, end, spelt(model, key, typed), true))
  }
  return distinctOffers(offers).slice(0, OVALS)
}

// The ovals for an empty box: whole prompts, put in as the box's text.
export function emptyOffers(box: Box, phrases: readonly string[]): Offer[] {
  return distinctOffers(phrases.map(phrase => ({ text: phrase, start: 0, end: box.text.length, insert: phrase, caret: phrase.length, whole: true }))).slice(0, OVALS)
}

// The box an offer makes of the one it was offered for.
export function apply(box: Box, offer: Offer): Box {
  return { text: box.text.slice(0, offer.start) + offer.insert + box.text.slice(offer.end), cursor: offer.caret }
}

// Offers, likeliest first, as the ovals show them: the likeliest in the middle, as a phone's keyboard has it,
// the next on its left, the third on its right; null where there is none.
export function arranged<T>(ranked: readonly T[]): (T | null)[] {
  return [ranked[1] ?? null, ranked[0] ?? null, ranked[2] ?? null]
}
