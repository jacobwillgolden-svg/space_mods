import { dither, glow, mix, put, shade } from './pixels'
import type { Canvas } from './pixels'

// A spacecraft drawn from a handful of parts, after the look of the missions
// it is named for: wings of solar panels round its body (`reach` of its
// size long, `wide` across), a body, a dish of `dish` of its size, and thin
// booms. Claude flies the first; agents are cast from the rest.
export type Craft = {
  name: string
  wings: number
  reach: number
  wide: number
  panel: number
  body: number
  dish: number
  booms: number
}

export const CRAFT: readonly Craft[] = [
  { name: 'Juno', wings: 3, reach: 1, wide: 0.3, panel: 0x2b3f8c, body: 0xcfc6b2, dish: 0.22, booms: 0 },
  { name: 'Voyager', wings: 0, reach: 0, wide: 0, panel: 0, body: 0x8c8a86, dish: 0.6, booms: 2 },
  { name: 'Cassini', wings: 0, reach: 0, wide: 0, panel: 0, body: 0xd4a53a, dish: 0.5, booms: 1 },
  { name: 'Rosetta', wings: 2, reach: 1.15, wide: 0.26, panel: 0x22408f, body: 0xcf9f3a, dish: 0.3, booms: 0 },
  { name: 'Dawn', wings: 2, reach: 1.25, wide: 0.2, panel: 0x30508f, body: 0xd8d0bc, dish: 0.25, booms: 0 },
  { name: 'New Horizons', wings: 0, reach: 0, wide: 0, panel: 0, body: 0xd8bf7a, dish: 0.45, booms: 1 },
  { name: 'Galileo', wings: 0, reach: 0, wide: 0, panel: 0, body: 0x9a9a9a, dish: 0.6, booms: 3 },
  { name: 'Hayabusa', wings: 2, reach: 0.75, wide: 0.32, panel: 0x26387a, body: 0xd9b25a, dish: 0.3, booms: 0 },
  { name: 'Mariner', wings: 4, reach: 0.7, wide: 0.24, panel: 0x34508a, body: 0xb8b0a0, dish: 0.3, booms: 0 },
  { name: 'Magellan', wings: 2, reach: 0.62, wide: 0.42, panel: 0x2f4a86, body: 0xc8c0b0, dish: 0.5, booms: 0 },
  { name: 'Pioneer', wings: 0, reach: 0, wide: 0, panel: 0, body: 0xb0a890, dish: 0.62, booms: 2 },
  { name: 'Ulysses', wings: 0, reach: 0, wide: 0, panel: 0, body: 0xc9a64a, dish: 0.45, booms: 1 },
]

// Where a craft is drawn and how: its middle on screen and nearness to the
// eye, `size` pixels from its middle to a wing's tip, turned `spin` round,
// lit `shine` (1 in sunlight, less in a shadow), seen `fade` of the way
// (1 whole), and its engine's thrust: the way the flame points, and how hard.
export type Pose = {
  x: number
  y: number
  z: number
  size: number
  spin: number
  shine: number
  fade?: number
  thrust?: { dx: number; dy: number; power: number }
}

// The craft's spin is seen tilted: what lies round it is this much shorter up and down.
const SQUASH = 0.45

export function drawCraft(c: Canvas, craft: Craft, pose: Pose, time: number) {
  const { x, y, z, size, spin, shine } = pose
  const fade = pose.fade ?? 1
  // Pixels drop out through the dither as the craft fades away.
  const paint = (px: number, py: number, color: number) => {
    if (fade < 1 && dither(px, py) > fade) return
    put(c, px, py, shade(color, shine), z)
  }

  if (pose.thrust && pose.thrust.power > 0) flame(c, pose, time)

  const angles = (count: number, offset: number) => Array.from({ length: count }, (_, k) => spin + offset + (k * 2 * Math.PI) / count)
  const wings = angles(craft.wings, 0)
  const booms = angles(craft.booms, Math.PI / Math.max(1, craft.wings + craft.booms))
  const isBehind = (angle: number) => Math.sin(angle) < 0

  for (const angle of wings.filter(isBehind)) wing(craft, x, y, size, angle, 0.7, paint)
  for (const angle of booms.filter(isBehind)) boom(x, y, size, angle, 0.7, paint)
  body(craft, x, y, size, paint)
  for (const angle of booms.filter(a => !isBehind(a))) boom(x, y, size, angle, 1, paint)
  for (const angle of wings.filter(a => !isBehind(a))) wing(craft, x, y, size, angle, 1, paint)
}

type Paint = (x: number, y: number, color: number) => void

// A wing of panels from the body out: framed cells, darker turned away.
function wing(craft: Craft, x: number, y: number, size: number, angle: number, light: number, paint: Paint) {
  const along: readonly [number, number] = [Math.cos(angle), Math.sin(angle) * SQUASH]
  const across: readonly [number, number] = [-Math.sin(angle), Math.cos(angle) * SQUASH]
  const from = size * 0.2
  const to = size * craft.reach
  const half = Math.max(0.5, (size * craft.wide) / 2)
  // Solving for where a pixel lies along and across the wing.
  const det = along[0] * across[1] - along[1] * across[0]
  if (Math.abs(det) < 1e-6) return

  const cell = size >= 14 ? Math.max(3, size * 0.18) : Infinity
  const reach = to + half + 1
  for (let py = Math.floor(y - reach); py <= Math.ceil(y + reach); py++) {
    for (let px = Math.floor(x - reach); px <= Math.ceil(x + reach); px++) {
      const dx = px + 0.5 - x
      const dy = -(py + 0.5 - y)
      const a = (dx * across[1] - dy * across[0]) / det
      const b = (along[0] * dy - along[1] * dx) / det
      if (a < from || a > to || Math.abs(b) > half) continue

      const isFrame = (a - from) % cell < 1 || Math.abs(b) > half - 0.6
      const color = isFrame ? mix(craft.panel, 0xc8c8d0, 0.35) : craft.panel
      paint(px, py, shade(color, light))
    }
  }
}

// A thin boom with an instrument at its tip.
function boom(x: number, y: number, size: number, angle: number, light: number, paint: Paint) {
  const length = size * 1.1
  const tx = Math.cos(angle)
  const ty = -Math.sin(angle) * SQUASH
  const steps = Math.ceil(length * 2)
  for (let s = 0; s <= steps; s++) {
    const r = (s / steps) * length
    paint(Math.floor(x + tx * r), Math.floor(y + ty * r), shade(0xb8b0a0, light))
  }
  paint(Math.floor(x + tx * length), Math.floor(y + ty * length), shade(0xe0c060, light))
}

// The body, lit from the upper left, under its dish.
function body(craft: Craft, x: number, y: number, size: number, paint: Paint) {
  const round = Math.max(0.8, size * 0.2)
  disc(x, y, round, 1, (px, py, dx, dy) => paint(px, py, shade(craft.body, dx + dy < 0 ? 1.1 : 0.8)))

  const dish = size * craft.dish
  if (dish < 1) return
  disc(x, y - round * 0.6, dish, SQUASH * 1.4, (px, py, dx, dy) =>
    paint(px, py, dx * dx + dy * dy < 0.25 ? 0xd8d8d2 : dx + dy > 0.3 ? 0xb4b4ae : 0xf2f2ec),
  )
}

// Fills an ellipse `radius` wide and `tall` times that high, handing each
// pixel its place in it, -1 to 1 each way.
function disc(x: number, y: number, radius: number, tall: number, each: (px: number, py: number, dx: number, dy: number) => void) {
  const high = radius * tall
  for (let py = Math.floor(y - high); py <= Math.ceil(y + high); py++) {
    for (let px = Math.floor(x - radius); px <= Math.ceil(x + radius); px++) {
      const dx = (px + 0.5 - x) / radius
      const dy = (py + 0.5 - y) / Math.max(0.5, high)
      if (dx * dx + dy * dy <= 1) each(px, py, dx, dy)
    }
  }
}

// The engine's flame, blue-white, flickering, out behind the craft.
function flame(c: Canvas, pose: Pose, time: number) {
  const { x, y, z, size, thrust } = pose
  if (!thrust) return

  const length = size * 0.9 * thrust.power * (0.8 + 0.2 * Math.sin(time * 37))
  const norm = Math.hypot(thrust.dx, thrust.dy) || 1
  const [dx, dy] = [thrust.dx / norm, thrust.dy / norm]
  const steps = Math.ceil(length * 2)
  for (let s = 0; s <= steps; s++) {
    const t = s / Math.max(1, steps)
    const r = size * 0.25 + t * length
    const width = Math.max(0.5, size * 0.14 * (1 - t))
    for (let w = -width; w <= width; w += 0.7) {
      glow(c, Math.floor(x + dx * r - dy * w), Math.floor(y + dy * r + dx * w), t < 0.3 ? 0xffffff : 0x7fbfff, (1 - t) * (pose.fade ?? 1) * 0.8, z)
    }
  }
}
