// What the three ovals under the prompt say: the prompts the person is likeliest to send next, guessed
// as each turn ends from the conversation itself (register.ts forks it), with the repository's state
// beside it. Plain functions, no engine: the prompt the fork answers, how its reply is read, and the
// guesses git alone can make when the fork can't.

// Ovals the dashboard's strip has (mc-rice's panels/predict.py).
export const OVALS = 3

// The most a guess may say: an oval shows less, cut, and a click sends it whole.
export const LONGEST = 60

// How many letters an oval holds when the strip hasn't said (it does, in its .panel file), and the least
// and most the fork is asked to keep to.
export const ROOM = 24
export const ROOM_LEAST = 10
export const ROOM_MOST = 40

// How much of the answer's end the fork is shown again: where a question or an offer is.
export const ANSWER_TAIL = 1500

// The repository the session works in, as `git status --porcelain=v2 --branch` tells it.
export type Git = {
  branch: string | null // null on a detached head
  upstream: string | null
  ahead: number
  behind: number
  staged: number
  changed: number // tracked files changed and not staged
  untracked: number
  conflicted: number
}

// The default branches a branch is merged into.
const TRUNKS = new Set(['main', 'master'])

export function gitOf(stdout: string): Git {
  const git: Git = { branch: null, upstream: null, ahead: 0, behind: 0, staged: 0, changed: 0, untracked: 0, conflicted: 0 }
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim()
      git.branch = head === '(detached)' ? null : head
    } else if (line.startsWith('# branch.upstream ')) {
      git.upstream = line.slice('# branch.upstream '.length).trim() || null
    } else if (line.startsWith('# branch.ab ')) {
      const ab = /\+(\d+) -(\d+)/.exec(line)
      if (ab) {
        git.ahead = Number(ab[1])
        git.behind = Number(ab[2])
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      // "1 XY ...": X the index's change, Y the worktree's, '.' for none.
      const xy = line.slice(2, 4)
      if (xy[0] !== '.') git.staged += 1
      if (xy[1] !== '.') git.changed += 1
    } else if (line.startsWith('u ')) {
      git.conflicted += 1
    } else if (line.startsWith('? ')) {
      git.untracked += 1
    }
  }
  return git
}

const files = (count: number, what: string) => `${count} file${count === 1 ? '' : 's'} ${what}`

// One line of what git says now, for the fork.
export function gitWords(git: Git | null): string {
  if (git === null) return 'not a git repository (or git could not be asked).'
  const parts = [git.branch === null ? 'a detached HEAD' : `on branch ${git.branch}`]
  const dirty = git.staged + git.changed + git.untracked + git.conflicted
  if (git.conflicted > 0) parts.push(files(git.conflicted, 'in conflict'))
  if (git.staged > 0) parts.push(files(git.staged, 'staged'))
  if (git.changed > 0) parts.push(files(git.changed, 'changed and not staged'))
  if (git.untracked > 0) parts.push(files(git.untracked, 'untracked'))
  if (dirty === 0) parts.push('nothing to commit')
  if (git.upstream === null) parts.push(git.branch === null ? 'no upstream' : 'never pushed (no upstream)')
  else if (git.ahead === 0 && git.behind === 0) parts.push(`up to date with ${git.upstream}`)
  else {
    if (git.ahead > 0) parts.push(`${git.ahead} commit${git.ahead === 1 ? '' : 's'} ahead of ${git.upstream}`)
    if (git.behind > 0) parts.push(`${git.behind} behind it`)
  }
  return `${parts.join(', ')}.`
}

// The message the fork answers, after the conversation as the session last sent it. It says it comes
// from the mod, so the model doesn't take it for the person, and asks for haste: a fork thinks as hard
// as the session does, and naming a lower effort would cost a cache write of the whole conversation.
// `room` is how many letters an oval holds; `habits` the prompts the person sends most, for their wording.
export function askFor(answer: string, git: Git | null, room = ROOM, habits: readonly string[] = []): string {
  const tail = answer.trim().slice(-ANSWER_TAIL)
  const most = Math.max(ROOM_LEAST, Math.min(ROOM_MOST, Math.round(room)))
  return [
    '<predict-mod>',
    'This message comes from the predict mod, not from me, and your reply goes to three buttons under my prompt box, ' +
      'not to the chat. You have no tools here and this needs no thought: answer straight away.',
    '',
    'Guess the three prompts I am most likely to send you next, now that your turn is over: what I would type myself, ' +
      `in my own words and style as this conversation shows them, each one to five words and at most ${most} characters ` +
      '(no more fits a button), each a different next step, the likeliest first.',
    '- If you asked me something or offered choices, the answers come first: the choices themselves, or a yes or no as I would say it.',
    '- Uncommitted changes make "commit" and "commit and push" likely; a branch other than main with work on it makes "merge with main" likely.',
    '- Nothing already done, nothing that only thanks you.',
    ...(habits.length > 0 ? [`- Prompts I send often, for my wording: ${habits.map(habit => JSON.stringify(habit)).join(', ')}.`] : []),
    '',
    `Git now: ${gitWords(git)}`,
    tail ? `Your answer just now ended:\n"""\n${tail}\n"""` : 'Your turn ended without an answer in words.',
    '',
    'Reply with a JSON array of three strings and nothing else, such as ["...", "...", "..."].',
    '</predict-mod>',
  ].join('\n')
}

// One guess made fit for an oval: on one line, without the quotes, numbering or full stop a model may
// put round it; '' when nothing is left or it runs past LONGEST.
export function cleaned(guess: string): string {
  const one = guess
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:[-*•]|\d+[.)])\s*/, '')
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
    .replace(/[.。]+$/, '')
    .trim()
  return one.length > LONGEST ? '' : one
}

// The guesses in the fork's reply: its JSON array, or failing that its lines; at most OVALS, no two alike.
export function guessesOf(reply: string): string[] {
  let found: unknown[] | null = null
  const open = reply.indexOf('[')
  const close = reply.lastIndexOf(']')
  if (open !== -1 && close > open) {
    try {
      const parsed: unknown = JSON.parse(reply.slice(open, close + 1))
      if (Array.isArray(parsed)) found = parsed
    } catch {
      found = null
    }
  }
  const raw = found ?? reply.replace(/```[a-z]*|```/gi, '').split(/\r?\n/)
  return distinct(raw.filter((g): g is string => typeof g === 'string').map(cleaned))
}

// What git alone suggests: commit with work uncommitted, push with commits unpushed, a merge into main from
// any other branch with something on it. Nothing in a clean tree on main, or outside a repository.
export function fromGit(git: Git | null): string[] {
  if (git === null) return []
  const guesses: string[] = []
  const dirty = git.staged + git.changed + git.untracked > 0
  const off = git.branch !== null && !TRUNKS.has(git.branch)
  if (git.conflicted > 0) guesses.push('resolve the conflicts')
  if (dirty) guesses.push('commit', 'commit and push')
  else if (git.ahead > 0 || (git.upstream === null && off)) guesses.push('push')
  if (off && (dirty || git.ahead > 0 || git.upstream !== null)) guesses.push('merge with main')
  return distinct(guesses)
}

// The ovals: the fork's guesses, then git's for any it left empty.
export function ovalsOf(guesses: readonly string[], git: Git | null): string[] {
  return distinct([...guesses, ...fromGit(git)])
}

// Whether git leaves a prompt you send often worth offering: no commit with nothing to commit, no push with
// nothing to push.
export function fitsGit(prompt: string, git: Git | null): boolean {
  if (git === null) return true
  const dirty = git.staged + git.changed + git.untracked + git.conflicted > 0
  const said = prompt.toLowerCase()
  if (/\bcommit/.test(said) && !dirty) return false
  if (/\bpush/.test(said) && !dirty && git.ahead === 0 && git.upstream !== null) return false
  return true
}

// The guesses, each once whatever its case, none empty, at most `most` of them.
export function distinct(guesses: readonly string[], most = OVALS): string[] {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const guess of guesses) {
    const key = guess.toLowerCase()
    if (guess === '' || seen.has(key)) continue
    seen.add(key)
    kept.push(guess)
    if (kept.length === most) break
  }
  return kept
}
