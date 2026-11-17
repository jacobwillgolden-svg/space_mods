import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { colorName, followed, keyboardEffect } from '../hooks/aura'

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

// The shape the service writes (checked against real captures of each): the
// keyboard's device and effect first or not, the wallpaper's beside them.
function script(name: string, tag = 'effect', hue = '0.000000', slot = 'ALPHA', wallpaperFirst = false): string {
  const group = (n: number, type: string) => `<group key="${name}${n}"><device><model>x</model><type>${type}</type></device></group>`
  const entry = (n: number, h: string) =>
    `<${tag} key="${name}${n}"><waveList><wave><bindToSlot><slot key="${slot}"/></bindToSlot></wave></waveList>` +
    `<initColor><hue>${h}</hue>\n<saturation>1.000000</saturation><lightness>0.500000</lightness></initColor></${tag}>`
  const [keyboard, wallpaper] = wallpaperFirst ? [1, 0] : [0, 1]
  return `<root><viewport>${group(0, wallpaperFirst ? 'WallPaper' : 'Laptop_4Zone')}${group(1, wallpaperFirst ? 'Laptop_4Zone' : 'WallPaper')}</viewport>` +
    `<effectList>${entry(keyboard, hue)}${entry(wallpaper, '0.333333')}</effectList></root>`
}

const RED = script('StaticSingleEff')

function engine(on: On, stored: Record<string, unknown> = {}, file: string | null = RED) {
  mock.store(on, stored)
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('fs.read', () => (file === null ? { deny: 'not in a test' } : { value: file }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.run', () => ({ text: '' }))
}

test('on says what it follows', async ($, on) => {
  engine(on)
  const { text } = await $.command.run({ command: 'aurasync', args: 'on', ...TYPED })
  expect(text).toBe("Aura sync is on: the jukebox follows static red. /aurasync off goes back to the theme's.")
})

test('off is kept, and bare /aurasync flips it', async ($, on) => {
  engine(on, { on: true })
  expect((await $.command.run({ command: 'aurasync', args: '', ...TYPED })).text).toContain('Aura sync is off')
  expect((await $.command.run({ command: 'aurasync', args: '', ...TYPED })).text).toContain('Aura sync is on')
  expect((await $.command.run({ command: 'aurasync', args: 'off', ...TYPED })).text).toContain('Aura sync is off')
  expect((await $.command.run({ command: 'aurasync', args: 'off', ...TYPED })).text).toContain('Aura sync is off')
})

test('an effect not followed says so', async ($, on) => {
  engine(on, {}, script('BreathSingleEff'))
  const { text } = await $.command.run({ command: 'aurasync', args: 'on', ...TYPED })
  expect(text).toContain("this effect (BreathSingleEff) isn't followed yet")
})

test("a file that can't be read keeps it on and says so", async ($, on) => {
  engine(on, {}, null)
  const { text } = await $.command.run({ command: 'aurasync', args: 'on', ...TYPED })
  expect(text).toContain("can't be read")
  expect((await $.command.run({ command: 'aurasync', args: '', ...TYPED })).text).toContain('Aura sync is off')
})

test('anything else changes nothing', async ($, on) => {
  engine(on)
  expect((await $.command.run({ command: 'aurasync', args: 'rainbow', ...TYPED })).text).toBe('/aurasync takes on or off.')
  expect((await $.command.run({ command: 'aurasync', args: '', ...TYPED })).text).toContain('Aura sync is on')
})

test('music reads as its colour or as a rainbow', () => {
  expect(followed(script('MusicStatic_SingleEff', 'anime', '0.666667'))).toBe('the jukebox follows music in blue')
  expect(followed(script('MusicRainbowSingleEff', 'anime', '0', 'HUE'))).toBe('the jukebox follows music in a rainbow')
})

test('immersion reads as itself, by its audio type', () => {
  const immersion = (written: string) => written.replaceAll('<waveList>', '<animelist><audiotype>204</audiotype></animelist><waveList>')
  expect(followed(immersion(script('MusicStatic_SingleEff', 'anime', '0.666667')))).toBe('the jukebox follows immersion in blue')
  expect(followed(immersion(script('MusicRainbowSingleEff', 'anime', '0', 'HUE')))).toBe('the jukebox follows immersion in a rainbow')
})

test('a gradient reads as one, not as its first colour', () => {
  const gradient = script('StaticSingleEff').replaceAll('<waveList>', '<ViceEffect key="Gradient"><GradientPoint></GradientPoint></ViceEffect><waveList>')
  expect(followed(gradient)).toBe('the jukebox follows a static gradient')
})

test('the color cycle is followed', () => {
  expect(followed(script('ColorCycleSingleEff', 'effect', '0', 'HUE'))).toBe('the jukebox follows the color cycle, about in step')
})

test('the rainbow is followed', () => {
  expect(followed(script('RainbowSingleEff', 'effect', '0', 'HUE'))).toBe('the jukebox follows the rainbow, about in step')
})

test("the keyboard's effect is read, never the wallpaper's", () => {
  expect(keyboardEffect(script('StaticSingleEff', 'effect', '0.000000', 'ALPHA', true))?.name).toBe('StaticSingleEff')
  expect(followed(script('StaticSingleEff', 'effect', '0.666667', 'ALPHA', true))).toBe('the jukebox follows static blue')
  expect(followed('<root></root>')).toBe("this effect isn't followed yet, so the jukebox keeps the theme's colours")
})

test('hues read as words', () => {
  expect(colorName(0, 1)).toBe('red')
  expect(colorName(2 / 3, 1)).toBe('blue')
  expect(colorName(0.99, 1)).toBe('red')
  expect(colorName(0.5, 0)).toBe('white')
})
