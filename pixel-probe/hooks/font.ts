import { put } from './pixels'
import type { Canvas } from './pixels'

// A three-by-five pixel font, capitals and digits, for the names over the
// agents' craft: five rows of three, `#` lit.
const GLYPHS: Record<string, readonly string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '##.', '.##'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  '-': ['...', '...', '###', '...', '...'],
  '.': ['...', '...', '...', '...', '.#.'],
}

// How many pixels wide `text` is drawn at `scale`.
export const textWidth = (text: string, scale: number) => Math.max(0, text.length * 4 - 1) * scale

// Draws `text` with its top left at (x, y), over everything, each pixel
// `scale` wide, on a dark shadow so it reads over a bright world. What the
// font has no glyph for is left a space.
export function drawText(c: Canvas, text: string, x: number, y: number, color: number, scale: number) {
  const upper = text.toUpperCase()
  for (const [ink, offset] of [[0x000000, scale], [color, 0]] as const) {
    for (let i = 0; i < upper.length; i++) {
      const glyph = GLYPHS[upper[i] ?? ' '] ?? []
      glyph.forEach((row, r) => {
        for (let k = 0; k < 3; k++) {
          if (row[k] !== '#') continue
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) put(c, x + offset + (i * 4 + k) * scale + sx, y + offset + r * scale + sy, ink, Infinity)
          }
        }
      })
    }
  }
}
