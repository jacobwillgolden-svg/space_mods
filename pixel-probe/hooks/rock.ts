import type { Effort } from '../types'
import { fbm3, noise3, random, smooth } from './noise'
import { blend, dither, glow, mix, put, shade } from './pixels'
import type { Canvas } from './pixels'

// The asteroid the probe mines in auto mode, harder the more Claude thinks:
// its name, its colors, its size as a share of the usual, a glint where its
// metal catches the sun, and a tail where it is a comet.
export type Rock = { name: string; color: number; dark: number; size: number; glint?: number; tail?: number; seed: number }

export const ROCKS: Record<Effort, Rock> = {
  none: { name: 'pebble', color: 0x8a8580, dark: 0x4a4644, size: 0.5, seed: 3 },
  low: { name: 'stony asteroid', color: 0x8f8476, dark: 0x4f463e, size: 0.72, seed: 5 },
  medium: { name: 'iron asteroid', color: 0x8e6e58, dark: 0x4a3426, size: 0.8, glint: 0xd8c0a0, seed: 7 },
  high: { name: 'carbon asteroid', color: 0x5a5450, dark: 0x262322, size: 0.9, seed: 9 },
  xhigh: { name: 'comet', color: 0xc6d2da, dark: 0x6a7884, size: 0.85, tail: 0x9fd8ff, seed: 13 },
  max: { name: 'metal asteroid', color: 0xc9a85a, dark: 0x6e5428, size: 1, glint: 0xfff0b0, seed: 17 },
  custom: { name: 'crystal asteroid', color: 0x9a80d8, dark: 0x4a3480, size: 0.85, glint: 0xe8dcff, seed: 19 },
}

// Where the rock is and how it is lit: its middle on screen and nearness to
// the eye, its radius in pixels, how far it has turned, and the sun's way.
export type Place = { x: number; y: number; z: number; radius: number; turn: number; light: readonly [number, number, number] }

// How the asteroid stands: whole with `stage` tenths cracked, or `t` seconds
// into shattering.
export type Breaking = { stage: number } | { t: number; stage: number }

// How many pieces it breaks into, how long those fly whole, and how long
// until they have crumbled away.
const PIECES = 7
const WHOLE_SECONDS = 0.6
const SCATTER_SECONDS = 2

export function drawRock(c: Canvas, rock: Rock, at: Place, breaking: Breaking, levels: number) {
  const { x, y, z, radius, turn, light } = at
  const t = 't' in breaking ? breaking.t : undefined
  if (rock.tail !== undefined && t === undefined) tail(c, rock.tail, at)

  const face = faceOf(rock, radius)
  const reach = radius * 1.35
  const pieces = random(rock.seed * 31 + 7)
  const flung = Array.from({ length: PIECES }, (_, k) => {
    const angle = ((k + 0.5) / PIECES) * 2 * Math.PI + (pieces() - 0.5) * 0.6
    const speed = radius * (1.4 + 1.6 * pieces())
    return [Math.cos(angle) * speed, -Math.sin(angle) * speed] as const
  })
  const [cos, sin] = [Math.cos(-turn), Math.sin(-turn)]

  for (let py = Math.floor(y - reach); py <= Math.ceil(y + reach); py++) {
    for (let px = Math.floor(x - reach); px <= Math.ceil(x + reach); px++) {
      const dx = px + 0.5 - x
      const dy = -(py + 0.5 - y)
      const angle = Math.atan2(dy, dx)
      const edge = radius * outlineAt(face, angle - turn)
      const d = Math.hypot(dx, dy)
      if (d > edge) continue

      // Turned back to the rock's own frame, where its face is laid.
      const texel = face.texelAt((dx * cos - dy * sin) / radius, (dx * sin + dy * cos) / radius)
      const nz = Math.sqrt(Math.max(0, 1 - (d / edge) ** 2))
      const lit = Math.max(0, (dx / edge) * light[0] + (dy / edge) * light[1] + nz * light[2])
      const stepped = Math.min(1, Math.floor(lit * levels + dither(px, py)) / levels)
      const ground = face.ground[texel] ?? 0.5
      let color = mix(rock.color, rock.dark, smooth(0.48, 0.68, ground))
      if (face.pits[texel] === 1) color = shade(color, 0.7)
      color = shade(color, 0.08 + 0.92 * stepped)
      if (rock.glint !== undefined && lit > 0.93 && ground < 0.5) color = rock.glint
      const opens = face.cracks[texel] ?? 0
      if (opens > 0 && breaking.stage >= opens) color = breaking.stage >= 6 ? 0xff8a3a : 0x140f0c

      if (t === undefined) {
        put(c, px, py, color, z + nz * radius)
        continue
      }
      // Shattering: each piece flies its own way, crumbling through the dither as it goes.
      const piece = Math.floor((((angle - turn) / (2 * Math.PI)) % 1 + 1) % 1 * PIECES) % PIECES
      const [vx, vy] = flung[piece] ?? [0, 0]
      const [sx, sy] = [Math.floor(px + vx * t), Math.floor(py + vy * t)]
      if (dither(sx, sy) < (t - WHOLE_SECONDS) / (SCATTER_SECONDS - WHOLE_SECONDS)) continue
      put(c, sx, sy, color, z + nz * radius)
    }
  }

  if (t !== undefined) burst(c, rock, at, t)
}

// A rock's face in its own frame, its radius 1, laid out once for each size
// it is drawn at, about a texel a pixel: its outline by angle, and over a
// grid across it, the ground's shade, its pits, and the stage at which each
// spot cracks (0 never), so drawing it is only looking up.
type Face = {
  outline: Float32Array
  ground: Float32Array
  pits: Uint8Array
  cracks: Uint8Array
  texelAt: (x: number, y: number) => number
}

// How many angles the outline is laid out at, and how far out the grid reaches.
const OUTLINE = 256
const GRID_REACH = 1.4

const faces = new Map<string, Face>()

const outlineAt = (face: Face, angle: number) =>
  face.outline[((Math.round((angle / (2 * Math.PI)) * OUTLINE) % OUTLINE) + OUTLINE) % OUTLINE] ?? 1

function faceOf(rock: Rock, radius: number): Face {
  const pixels = Math.max(4, Math.round(radius))
  const key = `${rock.seed}:${pixels}`
  const known = faces.get(key)
  if (known) return known
  if (faces.size > 24) faces.clear()

  const outline = Float32Array.from({ length: OUTLINE }, (_, i) => {
    const angle = (i / OUTLINE) * 2 * Math.PI
    return 1 + 0.5 * (noise3(Math.cos(angle) * 1.7 + 9, Math.sin(angle) * 1.7 + 9, 0.5, rock.seed) - 0.5)
  })
  const size = Math.ceil(2 * GRID_REACH * pixels)
  const ground = new Float32Array(size * size)
  const pits = new Uint8Array(size * size)
  const cracks = new Uint8Array(size * size)
  const walks = cracksOf(rock.seed)
  const width = 0.7 / pixels

  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      const lx = ((gx + 0.5) / size) * 2 * GRID_REACH - GRID_REACH
      const ly = GRID_REACH - ((gy + 0.5) / size) * 2 * GRID_REACH
      const i = gy * size + gx
      const nz = Math.sqrt(Math.max(0, 1 - lx * lx - ly * ly))
      ground[i] = fbm3(lx * 2.5, ly * 2.5, nz * 2.5, rock.seed, 3)
      pits[i] = noise3(lx * 5 + 3, ly * 5 + 3, nz * 5, rock.seed + 1) > 0.72 ? 1 : 0
      cracks[i] = crackStage(walks, lx, ly, width)
    }
  }

  const texelAt = (x: number, y: number) => {
    const gx = Math.min(size - 1, Math.max(0, Math.floor(((x + GRID_REACH) / (2 * GRID_REACH)) * size)))
    const gy = Math.min(size - 1, Math.max(0, Math.floor(((GRID_REACH - y) / (2 * GRID_REACH)) * size)))
    return gy * size + gx
  }
  const made = { outline, ground, pits, cracks, texelAt }
  faces.set(key, made)
  return made
}

// The cracks the work opens, as walks from near the middle out to the edge,
// in the rock's own frame, its radius 1: the same for every rock of a kind.
type Crack = readonly (readonly [number, number])[]

const crackSets = new Map<number, Crack[]>()

function cracksOf(seed: number): Crack[] {
  const known = crackSets.get(seed)
  if (known) return known

  const next = random(seed * 13 + 5)
  const made = Array.from({ length: 4 }, (_, k): Crack => {
    let angle = (k / 4) * 2 * Math.PI + next()
    let [x, y] = [(next() - 0.5) * 0.3, (next() - 0.5) * 0.3]
    const walk: [number, number][] = [[x, y]]
    for (let s = 0; s < 8; s++) {
      angle += (next() - 0.5) * 1.1
      x += Math.cos(angle) * 0.13
      y += Math.sin(angle) * 0.13
      walk.push([x, y])
    }
    return walk
  })
  crackSets.set(seed, made)
  return made
}

// The stage at which (x, y), in the rock's own frame, opens as a crack, the
// cracks growing a segment at a time to their ends at stage 9; 0 if never.
function crackStage(cracks: readonly Crack[], x: number, y: number, width: number): number {
  let first = 0
  for (const crack of cracks) {
    for (let s = 0; s + 1 < crack.length; s++) {
      const [ax = 0, ay = 0] = crack[s] ?? []
      const [bx = 0, by = 0] = crack[s + 1] ?? []
      const [ex, ey] = [bx - ax, by - ay]
      const along = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)))
      if (Math.hypot(x - ax - ex * along, y - ay - ey * along) >= width) continue

      const opens = Math.floor((9 * s) / (crack.length - 1)) + 1
      first = first === 0 ? opens : Math.min(first, opens)
    }
  }

  return first
}

// A comet's tail, streaming away from the sun, behind the comet.
function tail(c: Canvas, color: number, at: Place) {
  const { x, y, z, radius, light } = at
  const norm = Math.hypot(light[0], light[1]) || 1
  const [ax, ay] = [-light[0] / norm, light[1] / norm]
  const length = radius * 4
  for (let s = 0; s < length; s += 0.5) {
    const spread = radius * (0.5 + (s / length) * 1.2)
    for (let w = -spread; w <= spread; w += 0.6) {
      const strength = (1 - s / length) * (1 - Math.abs(w) / spread) * 0.45
      blend(c, Math.floor(x + ax * s - ay * w), Math.floor(y + ay * s + ax * w), color, strength, z - radius)
    }
  }
  for (let py = Math.floor(y - radius * 1.6); py <= y + radius * 1.6; py++) {
    for (let px = Math.floor(x - radius * 1.6); px <= x + radius * 1.6; px++) {
      const d = Math.hypot(px + 0.5 - x, py + 0.5 - y) / (radius * 1.6)
      if (d < 1) glow(c, px, py, color, (1 - d) * 0.25, z - radius)
    }
  }
}

// The flash as it breaks, and dust flying out and fading.
function burst(c: Canvas, rock: Rock, at: Place, t: number) {
  const { x, y, radius } = at
  if (t < 0.3) {
    const flash = radius * (1 + t * 5)
    for (let py = Math.floor(y - flash); py <= y + flash; py++) {
      for (let px = Math.floor(x - flash); px <= x + flash; px++) {
        const d = Math.hypot(px + 0.5 - x, py + 0.5 - y) / flash
        if (d < 1) glow(c, px, py, 0xffffff, (1 - d) * (1 - t / 0.3))
      }
    }
  }
  const dust = random(rock.seed * 97 + 3)
  for (let k = 0; k < 28; k++) {
    const angle = dust() * 2 * Math.PI
    const r = radius * (0.3 + t * (1.5 + 3 * dust()))
    const fade = Math.max(0, 1 - t / SCATTER_SECONDS)
    glow(c, Math.floor(x + Math.cos(angle) * r), Math.floor(y - Math.sin(angle) * r), rock.glint ?? 0xffd8a0, fade)
  }
}
