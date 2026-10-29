import type { Scene } from '../types'
import { fbm2, hash3 } from './noise'
import { brighten, mix } from './pixels'
import type { Canvas } from './pixels'

// The sky behind each scene, a dim nebula over the dark after one of the
// repo's panoramas (panoramas/), and the color the scene draws its own
// light in: the charted orbit, the survey's beam, the mining laser, Apollo's
// way to the Moon. Apollo's sky has no nebula, only black and the stars.
export type Sky = { panorama: string; dark: number; clouds: readonly number[]; accent: number; seed: number }

export const SKIES: Record<Scene, Sky> = {
  orbit: { panorama: 'violet', dark: 0x04051a, clouds: [0x1f4fb0, 0x2a9ad8, 0x6a3ab8, 0xa46ad8], accent: 0x7fd4ff, seed: 101 },
  survey: { panorama: 'orion', dark: 0x090509, clouds: [0xb04a72, 0xc8744c, 0x2a6e72, 0xd8b896], accent: 0x8ff0d8, seed: 211 },
  asteroid: { panorama: 'ember', dark: 0x080303, clouds: [0x9a1c16, 0xd8402e, 0xb89a78, 0x5a0e0e], accent: 0xff5a4a, seed: 307 },
  apollo: { panorama: 'black', dark: 0x000000, clouds: [], accent: 0x9fd8ff, seed: 409 },
}

// A sky as made for one size: its colors, and the stars bright enough to twinkle.
type Painted = { colors: Uint32Array; twinkles: readonly { at: number; color: number; phase: number }[] }

const painted = new Map<string, Painted>()

// The sky for a picture `width` by `height`, made once and then copied.
export function drawSky(c: Canvas, sky: Sky, time: number) {
  const made = paint(sky, c.width, c.height)
  c.color.set(made.colors)
  for (const { at, color, phase } of made.twinkles) {
    const shine = 0.5 + 0.5 * Math.sin(time * 1.7 + phase)
    c.color[at] = mix(c.color[at] ?? 0, color, shine)
  }
}

function paint(sky: Sky, width: number, height: number): Painted {
  const key = `${sky.panorama}:${width}x${height}`
  const known = painted.get(key)
  if (known) return known
  if (painted.size > 12) painted.clear()

  const colors = new Uint32Array(width * height)
  const twinkles: { at: number; color: number; phase: number }[] = []
  const unit = Math.min(width, height)
  // Fewer stars a pixel the bigger the picture, so each picture holds about as many.
  const starry = Math.min(0.008, 200 / (width * height))

  // The nebula is soft, so a big picture works it out every few pixels and blends between.
  const step = Math.max(1, Math.round(unit / 96))
  const across = Math.ceil(width / step) + 1
  const down = Math.ceil(height / step) + 1
  const nebula = new Uint32Array(across * down).fill(sky.dark)
  for (let gy = 0; gy < down && sky.clouds.length > 1; gy++) {
    for (let gx = 0; gx < across; gx++) {
      const [u, v] = [((gx * step) / unit) * 2.2, ((gy * step) / unit) * 2.2]
      // Wisps where the noise folds over on itself, as the panoramas' filaments do.
      const fold = 1 - Math.abs(2 * fbm2(u, v, sky.seed, 4) - 1)
      const body = fbm2(u * 0.6 + 4, v * 0.6 + 4, sky.seed + 1, 3)
      const thick = Math.max(0, fold ** 4 * 0.6 + (body - 0.45) * 0.9)
      const hue = fbm2(u * 0.8, v * 0.8, sky.seed + 2, 3) * (sky.clouds.length - 1)
      const i = Math.min(sky.clouds.length - 2, Math.floor(hue))
      const cloud = mix(sky.clouds[i] ?? 0, sky.clouds[i + 1] ?? 0, hue - i)
      nebula[gy * across + gx] = mix(sky.dark, cloud, Math.min(0.42, thick * 0.55))
    }
  }

  for (let y = 0; y < height; y++) {
    const [gy, fy] = [Math.floor(y / step), (y % step) / step]
    for (let x = 0; x < width; x++) {
      const [gx, fx] = [Math.floor(x / step), (x % step) / step]
      const at = (dx: number, dy: number) => nebula[(gy + dy) * across + gx + dx] ?? 0
      let color = step === 1 ? at(0, 0) : mix(mix(at(0, 0), at(1, 0), fx), mix(at(0, 1), at(1, 1), fx), fy)

      const roll = hash3(x, y, 0, sky.seed)
      if (roll < starry) {
        const bright = 0.35 + 0.65 * (roll / starry) ** 2
        const tint = [0xffffff, 0xcfe0ff, 0xfff0d0, 0xffd8b0][Math.floor(hash3(x, y, 1, sky.seed) * 4)] ?? 0xffffff
        color = brighten(color, tint, bright)
        if (bright > 0.8) twinkles.push({ at: y * width + x, color: tint, phase: hash3(x, y, 2, sky.seed) * 6.3 })
      }
      colors[y * width + x] = color
    }
  }

  // The brightest stars of a big picture shine out in a cross.
  if (unit >= 160) {
    const canvas: Canvas = { width, height, color: colors, depth: new Float32Array(0) }
    for (const { at, color } of twinkles) {
      const [x, y] = [at % width, Math.floor(at / width)]
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) cross(canvas, x + dx, y + dy, color)
    }
  }

  const made = { colors, twinkles }
  painted.set(key, made)
  return made
}

function cross(c: Canvas, x: number, y: number, color: number) {
  if (x < 0 || y < 0 || x >= c.width || y >= c.height) return
  const i = y * c.width + x
  c.color[i] = brighten(c.color[i] ?? 0, color, 0.35)
}
