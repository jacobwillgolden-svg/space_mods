import type { View as TurnedView } from '../types'
import { earthChart, moonChart } from './earth'
import { fbm2, hash3, random, smooth } from './noise'
import { blend, canvas, dither, glow, mix, put, shade } from './pixels'
import type { Canvas } from './pixels'
import type { Chart } from './worlds'

// Apollo 11, every turn, in pixels. The Saturn V leaves Kennedy's pad 39A
// and makes Earth orbit; the third stage burns again for the Moon; Columbia
// turns round, docks with Eagle and draws it out. The coast out goes as far
// as the turn has got, and when Claude stops, round behind the Moon into
// orbit. A commit lands Eagle at Tranquility Base; a push puts Neil on the
// ladder and the Moon, Buzz after him, and the flag up. Earth and the Moon
// are the real ones (earth.ts), lit as they were: the launch at 13:32 UTC on
// 16 July 1969, the landing with the sun 10.8° up in the east.

// The mission as a frame has it.
export type Mission = {
  // Seconds since this mission's engines lit; the clamps let go at LIFTOFF.
  launch: number
  // The share of the way to the Moon flown this turn, 0 to 1.
  flown: number
  // Seconds since the arrival at the Moon began (Claude stopped), since
  // Eagle's landing began and since the moonwalk began, where each has a
  // time; negative while one waits on another.
  arrive?: number
  land?: number
  step?: number
  // Whether the turn began with Eagle already down, from a commit last turn.
  onTheMoon: boolean
  // The turn's progress, 0 to 1: on the Moon, the moonwalk's preparations.
  prep: number
  // Whether a commit (or PR) has come, and a push (or merge).
  isGoForLanding: boolean
  isGoForEva: boolean
}

// Every turn's flight, in seconds from the engines lighting: the clamps let
// go at LIFTOFF; the first stage drops at S_IC_OFF, the escape tower at
// TOWER_OFF, the second stage at S_II_OFF; the third shuts down in Earth
// orbit at ORBIT_IN and burns again for the Moon from TLI to TLI_OFF; then
// Columbia turns round, docks with Eagle and draws it out, all by DOCKED.
export const LIFTOFF = 1
const S_IC_OFF = 4.2
const TOWER_OFF = 4.7
const S_II_OFF = 7
const ORBIT_IN = 8
const TLI = 13
const TLI_OFF = 15.5
export const DOCKED = 25.5

// Once Claude stops: the rest of the way out, then behind the Moon, out of
// touch, and into orbit by IN_ORBIT.
export const ARRIVE = 3
export const IN_ORBIT = 7.5

// A commit: Eagle undocks and crosses the Moon's face, the picture cuts to
// the ground at CUT, and Eagle is down at TOUCHDOWN and still by LAND.
const CUT = 5
const TOUCHDOWN = 9
export const LAND = 10.5

// A push: the hatch, the porch and the ladder; Neil's step at STEP; Buzz
// down after him; and the flag, planted by EVA.
const STEP = 6
export const EVA = 12.5

// What a shell command that ran without error does for the mission: a
// commit or a pull request lands Eagle, a push or a merge puts Neil on the
// Moon (and lands Eagle first, if it has not).
const LANDS = /(^|[\s;&|(])(git(\s+-[cC]\s+\S+)*\s+commit(?![\w-])|gh\s+pr\s+create(?![\w-]))/
const STEPS = /(^|[\s;&|(])(git(\s+-[cC]\s+\S+)*\s+(push|merge)(?![\w-])|gh\s+pr\s+merge(?![\w-]))/

export function moveOf(command: string): 'land' | 'step' | undefined {
  if (STEPS.test(command)) return 'step'
  return LANDS.test(command) ? 'land' : undefined
}

type Vec = readonly [number, number, number]

const rad = (degrees: number) => (degrees * Math.PI) / 180
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
// Eased from 0 to 1 as `t` goes from 0 to 1, slow at both ends.
const ease = (t: number) => {
  const k = clamp(t, 0, 1)
  return k * k * (3 - 2 * k)
}
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit3 = (a: Vec): Vec => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / n, a[1] / n, a[2] / n]
}
const plus = (a: Vec, b: Vec, k = 1): Vec => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
const times = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k]

// The way from a sphere's middle to (lat, lon) on it: x toward 90° east, y
// north, z toward 0°.
const toward = (lat: number, lon: number): Vec => [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)]

// The sun at the launch, 13:32 UTC on 16 July 1969: overhead at 21.3° north, 23° west.
const SUN_AT_LAUNCH = toward(rad(21.3), rad(-23))
// The sun on the Moon as Eagle landed, 10.8° up in the east at Tranquility
// Base: overhead at about 1.5° north, 102.7° east.
const SUN_ON_THE_MOON = toward(rad(1.5), rad(102.7))
// Launch Complex 39A, 28.61° north, 80.60° west; Tranquility Base, 0.674° north, 23.473° east.
const PAD = [rad(28.61), rad(-80.6)] as const
const TRANQUILITY = toward(rad(0.674), rad(23.473))

// A body turned to the eye with (lat, lon) facing it, north up, or turned
// `roll` round counterclockwise: `toBody` takes a way seen from the eye (x
// right, y up, z toward the eye) into the body's own frame, `fromBody` takes it back.
type Facing = { toBody: (v: Vec) => Vec; fromBody: (v: Vec) => Vec }

function facing(lat: number, lon: number, roll = 0): Facing {
  const [cl, sl, co, so] = [Math.cos(lat), Math.sin(lat), Math.cos(lon), Math.sin(lon)]
  const [cr, sr] = [Math.cos(roll), Math.sin(roll)]
  return {
    toBody: ([x0, y0, z]) => {
      const [x, y] = [x0 * cr + y0 * sr, -x0 * sr + y0 * cr]
      const [y1, z1] = [y * cl + z * sl, -y * sl + z * cl]
      return [x * co + z1 * so, y1, -x * so + z1 * co]
    },
    fromBody: ([x, y, z]) => {
      const [x1, z1] = [x * co - z * so, x * so + z * co]
      const [y2, z2] = [y * cl - z1 * sl, y * sl + z1 * cl]
      return [x1 * cr - y2 * sr, x1 * sr + y2 * cr, z2]
    },
  }
}

// The texel of a face at a latitude and longitude, the nearest, as scene.ts finds it.
function texelOf(chart: Chart, lat: number, lon: number): number {
  const u = (((lon + Math.PI) / (2 * Math.PI)) % 1 + 1) % 1
  const x = Math.min(chart.width - 1, Math.floor(u * chart.width))
  const y = clamp(Math.floor(((Math.PI / 2 - lat) / Math.PI) * chart.height), 0, chart.height - 1)
  return y * chart.width + x
}

const look = (chart: Chart, lat: number, lon: number, isCloud = false): number =>
  (isCloud ? chart.clouds?.[texelOf(chart, lat, lon)] : chart.colors[texelOf(chart, lat, lon)]) ?? 0

// How many texels round a face drawn `radius` pixels across: about one a
// pixel at the middle, a power of two, no more than 512.
const chartWidth = (radius: number) => clamp(2 ** Math.ceil(Math.log2(Math.max(1, 2 * Math.PI * radius))), 64, 512)

type Disc = { x: number; y: number; r: number; z: number }

// A sphere at `at`, its face turned to the eye by `turn`, lit from `light`
// in steps through the dither; `night` of its color left on its dark side
// (earthshine on the Moon), an atmosphere's tint toward its edge, and
// `gamma` below 1 for the Moon's bright dust, which stays bright as the sun gets low.
function drawBall(c: Canvas, chart: Chart, at: Disc, turn: Facing, light: Vec, levels: number, night: number, air?: number, gamma = 1) {
  const { x: cx, y: cy, r: R, z } = at
  const sun = turn.toBody(light)
  const { bumps } = chart
  for (let py = Math.max(0, Math.floor(cy - R)); py <= Math.min(c.height - 1, Math.ceil(cy + R)); py++) {
    for (let px = Math.max(0, Math.floor(cx - R)); px <= Math.min(c.width - 1, Math.ceil(cx + R)); px++) {
      const dx = (px + 0.5 - cx) / R
      const dy = -(py + 0.5 - cy) / R
      const r2 = dx * dx + dy * dy
      if (r2 > 1) continue

      const nz = Math.sqrt(1 - r2)
      const normal: Vec = [dx, dy, nz]
      const [bx, by, bz] = turn.toBody(normal)
      const lat = Math.asin(clamp(by, -1, 1))
      const lon = Math.atan2(bx, bz)
      let color = look(chart, lat, lon)
      if (chart.clouds) color = mix(color, 0xf4f6fa, look(chart, lat, lon, true))
      if (air !== undefined) color = mix(color, 0x7fb4ff, (1 - nz) ** 2 * air)
      let facingSun = dot(normal, light)
      if (bumps) {
        // The ground tipped by its slopes, east and north, before the sun is let fall on it.
        const i = texelOf(chart, lat, lon)
        const [east, north] = [bumps[2 * i] ?? 0, bumps[2 * i + 1] ?? 0]
        const [sl, cl, so, co] = [Math.sin(lat), Math.cos(lat), Math.sin(lon), Math.cos(lon)]
        const tipped: Vec = [bx - east * co + north * sl * so, by - north * cl, bz + east * so + north * sl * co]
        facingSun = dot(tipped, sun) / Math.hypot(tipped[0], tipped[1], tipped[2])
      }
      const lit = Math.max(0, facingSun) ** gamma
      const stepped = Math.min(1, Math.floor(lit * levels + dither(px, py)) / levels)
      put(c, px, py, shade(color, night + (1 - night) * stepped), z + nz * R)
    }
  }
}

// The thin blue of Earth's air at its edge, brightest toward the sun.
function drawAir(c: Canvas, at: Disc, light: Vec) {
  const { x: cx, y: cy, r: R } = at
  const thick = Math.max(1.2, R * 0.06)
  for (let py = Math.max(0, Math.floor(cy - R - thick)); py <= Math.min(c.height - 1, Math.ceil(cy + R + thick)); py++) {
    for (let px = Math.max(0, Math.floor(cx - R - thick)); px <= Math.min(c.width - 1, Math.ceil(cx + R + thick)); px++) {
      const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy)
      if (d <= R || d > R + thick) continue
      const sunward = ((px + 0.5 - cx) * light[0] - (py + 0.5 - cy) * light[1]) / d
      blend(c, px, py, 0x8fc0ff, 0.6 * (1 - (d - R) / thick) * clamp(sunward + 0.4, 0, 1), at.z)
    }
  }
}

// How a sprite's sides catch the sun: how much its left side (across its
// axis) and its face to the eye are turned toward the light.
type Lit = { side: number; front: number }

const litAt = (angle: number, light: Vec): Lit => ({ side: -Math.sin(angle) * light[0] + Math.cos(angle) * light[1], front: light[2] })

// A round body's shine at `s` of the way across it, -1 right to 1 left of its axis.
const roll = (lit: Lit, s: number) => 0.3 + 0.7 * Math.max(0, s * lit.side + Math.sqrt(Math.max(0, 1 - s * s)) * lit.front)

// A shape in its own meters: u along its axis, v across it (to the left of
// the axis positive), its color there, or undefined off it.
type Shape = (u: number, v: number) => number | undefined

// Where a sprite is drawn: (x, y) on screen is its u = 0, v = 0; `scale`
// pixels a meter; its axis pointing `angle` (0 right, counterclockwise); `z` its nearness.
type Place = { x: number; y: number; z: number; scale: number; angle: number }

// Draws `shape` over its box [u0, u1] by [v0, v1], dithered away to `fade`.
function sprite(c: Canvas, at: Place, box: readonly [number, number, number, number], shape: Shape, fade = 1) {
  if (fade <= 0) return
  const [u0, u1, v0, v1] = box
  const [cos, sin] = [Math.cos(at.angle), Math.sin(at.angle)]
  const corners = [
    [u0, v0],
    [u0, v1],
    [u1, v0],
    [u1, v1],
  ].map(([u = 0, v = 0]) => [at.x + (u * cos - v * sin) * at.scale, at.y - (u * sin + v * cos) * at.scale] as const)
  const xs = corners.map(([x]) => x)
  const ys = corners.map(([, y]) => y)
  for (let py = Math.max(0, Math.floor(Math.min(...ys))); py <= Math.min(c.height - 1, Math.ceil(Math.max(...ys))); py++) {
    for (let px = Math.max(0, Math.floor(Math.min(...xs))); px <= Math.min(c.width - 1, Math.ceil(Math.max(...xs))); px++) {
      const dx = px + 0.5 - at.x
      const dy = -(py + 0.5 - at.y)
      const u = (dx * cos + dy * sin) / at.scale
      const v = (-dx * sin + dy * cos) / at.scale
      if (u < u0 || u > u1 || v < v0 || v > v1) continue
      const color = shape(u, v)
      if (color === undefined || (fade < 1 && dither(px, py) > fade)) continue
      put(c, px, py, color, at.z)
    }
  }
}

const WHITE = 0xecebe6
const BLACK = 0x242424
const ENGINE = 0x4c4a48
const SILVER = 0xd4d7dc
const GOLD = 0xc9962e

// The Saturn V's radius `u` meters up from the mouths of its first-stage
// engines, to the escape tower's tip at 110.6.
function saturnRadius(u: number): number {
  if (u < 66) return 5.05
  if (u < 69) return 5.05 - ((u - 66) / 3) * 1.75
  if (u < 87) return 3.3
  if (u < 95.5) return 3.3 - ((u - 87) / 8.5) * 1.35
  if (u < 99.5) return 1.95
  if (u < 103) return 1.95 - ((u - 99.5) / 3.5) * 1.6
  if (u < 107.5) return 0.32
  return 0.42 * Math.min(1, (110.6 - u) / 1.6)
}

// The engines below a stage starting at `from`: the first stage's five F-1s
// (three seen), the second's five J-2s, the third's one J-2.
function engines(lit: Lit, from: number, u: number, v: number): number | undefined {
  const [tall, mouth, throat, centers] =
    from === 5 ? [5, 1.75, 0.8, [-3.3, 0, 3.3]] : from === 46 ? [3.4, 1, 0.45, [-2.4, 0, 2.4]] : from === 69 ? [2.8, 1.2, 0.5, [0]] : [0, 0, 0, []]
  const k = (from - u) / tall
  if (k < 0 || k > 1) return undefined
  const half = throat + (mouth - throat) * k ** 0.8
  for (const center of centers) {
    if (Math.abs(v - center) < half) return shade(ENGINE, 0.5 + 0.6 * roll(lit, (v - center) / half) + (k > 0.85 ? 0.2 : 0))
  }
  return undefined
}

// The stack from `from` meters up to `to`: from 5 the whole rocket, from 42
// the second stage still in its interstage, from 46 without it, from 69 the
// third stage alone; to 110.6 with the escape tower, to 103 without it (and
// with it the cover that hid the command module).
function saturn(lit: Lit, from: number, to: number): Shape {
  return (u, v) => {
    if (u > to) return undefined
    if (u < from) return engines(lit, from, u, v)
    const r = saturnRadius(u)
    const a = Math.abs(v)
    if (a > r) {
      // The first stage's fins, flaring out at its foot.
      if (from === 5 && u < 11 && a < 5.05 + 2.6 * ((11 - u) / 6)) return shade(BLACK, 0.8 + 0.4 * roll(lit, Math.sign(v)))
      return undefined
    }
    const s = v / r
    const stripe = Math.floor((s + 1) * 2) % 2
    let color = WHITE
    // The roll pattern, black and white, for the cameras to see it turn.
    if (u < 17 || (u > 69 && u < 73)) color = stripe === 0 ? BLACK : WHITE
    else if (u > 27.5 && u < 31) color = stripe === 1 ? BLACK : WHITE
    else if (u > 64.5 && u < 66) color = BLACK
    else if (u >= 86 && u < 87) color = 0xb8bab6
    else if (u >= 99.5 && u < 103) color = to > 103 ? WHITE : SILVER
    else if (u >= 95.5 && u < 99.5) color = SILVER
    else if (u >= 103 && u < 107.5) color = Math.floor(u * 2) % 2 === 0 ? 0x8a3424 : 0x5a2418
    else if (u >= 107.5) color = u > 109.4 ? 0x9a3a2a : 0xe6e2da
    return shade(color, roll(lit, s))
  }
}

// Columbia, the command and service module: u from the mouth of its engine
// bell to the tip of its docking probe, 11.7 m.
function csm(lit: Lit): Shape {
  return (u, v) => {
    const a = Math.abs(v)
    if (u < 2.8) {
      const half = 0.5 + 0.75 * (1 - u / 2.8) ** 0.9
      return a > half ? undefined : shade(u < 1.1 ? 0x8a8a8e : 0x3a3a3e, roll(lit, v / half) + 0.15)
    }
    if (u < 7.7) {
      // The thruster quads stand out from the service module near its top.
      if (a > 1.96) return u > 6.2 && u < 7 && a < 2.35 ? shade(0x6a6a6e, 0.9) : undefined
      const panel = u > 3.1 && u < 4.5 ? 0xf2f2f0 : Math.floor(u * 1.4) % 2 === 0 ? 0xd0d3d8 : 0xc4c8ce
      return shade(panel, roll(lit, v / 1.96))
    }
    if (u < 11) {
      const r = 1.96 - ((u - 7.7) / 3.3) * 1.66
      if (a > r) return undefined
      const isWindow = u > 8.9 && u < 9.4 && a > r * 0.25 && a < r * 0.6
      return isWindow ? 0x1c2a3a : shade(0xdfe2e6, roll(lit, v / r) * 1.05)
    }
    return u < 11.7 && a < 0.14 ? shade(0x9a9a9a, 0.9) : undefined
  }
}

// The distance from (u, v) to the segment from (au, av) to (bu, bv).
function offSegment(u: number, v: number, au: number, av: number, bu: number, bv: number): number {
  const [eu, ev] = [bu - au, bv - av]
  const t = clamp(((u - au) * eu + (v - av) * ev) / (eu * eu + ev * ev || 1), 0, 1)
  return Math.hypot(u - au - eu * t, v - av - ev * t)
}

// Gold foil, crinkled, catching the light cell by cell.
const foil = (base: number, light: number, u: number, v: number) => shade(base, light * (0.82 + 0.36 * hash3(Math.floor(u * 5), Math.floor(v * 5), 0, 7)))

// Eagle, the lunar module, seen side on: u from the mouth of its descent
// engine to the top of its docking tunnel, 6.4 m; its legs folded as it
// flew from the Earth, or out, as for the landing.
function lm(lit: Lit, isLegsOut: boolean): Shape {
  return (u, v) => {
    const a = Math.abs(v)
    if (isLegsOut) {
      if (offSegment(u, a, 2.2, 2.1, -0.9, 4.2) < 0.17 || offSegment(u, a, 1, 2.1, -0.8, 3.9) < 0.12) return foil(GOLD, 0.8, u, v)
      if (u < -0.7 && u > -1.05 && Math.abs(a - 4.2) < 0.5) return shade(0xb8b4ac, 0.9)
    } else if (a > 2.1 && a < 2.5 && u > 0.2 && u < 2.7) {
      return foil(GOLD, 0.7, u, v)
    }
    if (u < 0) return undefined
    if (u < 0.7) return a < 0.45 + 0.3 * (1 - u / 0.7) ? shade(0x3c3a38, roll(lit, v / 0.75) + 0.1) : undefined
    if (u < 2.5) return a < 2.1 ? foil(u > 2.3 ? BLACK : GOLD, roll(lit, v / 2.1), u, v) : undefined
    if (u < 5.7) {
      const half = u < 4.3 ? 2 : 2 - (u - 4.3) * 0.35
      if (a < half) return shade(v > 0.6 && u > 3.6 && u < 4.8 ? 0x2a2a2c : 0x9c9a96, roll(lit, v / half))
      return u > 4.55 && u < 5 && a < 2.45 ? shade(0x8a8a86, 0.85) : undefined
    }
    return u < 6.4 && a < 0.5 ? shade(0xa8a8a4, roll(lit, v / 0.5)) : undefined
  }
}

// Columbia and Eagle docked nose to nose, 17.4 m: Columbia's engine at u = 0.
function docked(lit: Lit): Shape {
  const [command, lunar] = [csm(lit), lm({ side: -lit.side, front: lit.front }, false)]
  return (u, v) => (u < 11 ? command(u, v) : lunar(17.4 - u, -v))
}

// An engine's flame from (x, y), out the way `angle` points, `length` and
// `width` pixels: white at its root through `outer`, flickering.
function flame(c: Canvas, x: number, y: number, angle: number, length: number, width: number, outer: number, time: number, z: number, strength = 1) {
  const [ux, uy] = [Math.cos(angle), -Math.sin(angle)]
  const flicker = 0.85 + 0.15 * Math.sin(time * 41)
  const reach = length * flicker
  for (let s = 0; s <= reach; s += 0.5) {
    const t = s / Math.max(1, reach)
    const half = Math.max(0.5, width * (0.5 + 0.7 * t) * 0.5)
    for (let w = -half; w <= half; w += 0.6) {
      const color = t < 0.2 && Math.abs(w) < half * 0.6 ? 0xfff8e0 : outer
      glow(c, Math.floor(x + ux * s - uy * w), Math.floor(y + uy * s + ux * w), color, (1 - t) * strength * (1 - (Math.abs(w) / half) * 0.5), z)
    }
  }
}

// A soft puff of smoke or steam: `radius` pixels, `alpha` at its heart.
function puff(c: Canvas, x: number, y: number, radius: number, color: number, alpha: number, z: number) {
  for (let py = Math.floor(y - radius); py <= Math.ceil(y + radius); py++) {
    for (let px = Math.floor(x - radius); px <= Math.ceil(x + radius); px++) {
      const d = Math.hypot(px + 0.5 - x, py + 0.5 - y) / Math.max(0.5, radius)
      if (d < 1) blend(c, px, py, color, alpha * (1 - d * d), z)
    }
  }
}

// Where in the mission a frame is: which picture, and how far into it.
type Shot =
  | { kind: 'earth'; t: number }
  | { kind: 'dock'; t: number }
  | { kind: 'coast'; at: number }
  | { kind: 'moon'; t: number }
  | { kind: 'descent'; t: number }
  | { kind: 'surface'; land: number; step?: number }

function shotOf(m: Mission): Shot {
  const { arrive, land } = m
  const step = m.step !== undefined && m.step >= 0 ? m.step : undefined
  if (m.onTheMoon) return { kind: 'surface', land: Infinity, step }
  if (land !== undefined && land >= CUT) return { kind: 'surface', land, step }
  if (land !== undefined && land >= 0) return { kind: 'descent', t: land }
  if (arrive !== undefined) {
    if (arrive < ARRIVE) return { kind: 'coast', at: m.flown + (1 - m.flown) * ease(arrive / ARRIVE) }
    return { kind: 'moon', t: arrive - ARRIVE }
  }
  if (m.launch < TLI_OFF) return { kind: 'earth', t: m.launch }
  if (m.launch < DOCKED) return { kind: 'dock', t: m.launch - TLI_OFF }
  return { kind: 'coast', at: m.flown }
}

// The mission's picture, over the sky scene.ts has drawn; `view`, the
// person's drag and wheel on the dashboard, pulls the eye back from the
// flag once it is up, and on up to orbit to see Earth rise.
export function drawApollo(c: Canvas, m: Mission, time: number, levels: number, view?: TurnedView) {
  const shot = shotOf(m)
  switch (shot.kind) {
    case 'earth':
      return earthShot(c, shot.t, time, levels)
    case 'dock':
      return dockShot(c, shot.t, time, levels)
    case 'coast':
      return coastShot(c, shot.at, time, levels)
    case 'moon':
      return moonShot(c, shot.t, time, levels)
    case 'descent':
      return descentShot(c, shot.t, time, levels)
    case 'surface':
      return surfaceShot(c, shot.land, shot.step, m.onTheMoon, time, levels, shot.step !== undefined && shot.step >= EVA ? pulledBack(view) : 0)
  }
}

// What the caption says the mission is doing.
export function missionWords(m: Mission): string {
  const shot = shotOf(m)
  switch (shot.kind) {
    case 'earth': {
      const { t } = shot
      if (t < LIFTOFF) return 'ignition · all engines running'
      if (t < S_IC_OFF) return 'liftoff · Launch Complex 39A'
      if (t < TOWER_OFF) return 'staging · second stage lit'
      if (t < S_II_OFF) return 'escape tower jettisoned'
      if (t < ORBIT_IN) return 'staging · third stage lit'
      if (t < TLI) return 'Earth parking orbit · 191 km'
      return 'translunar injection · third stage burn'
    }
    case 'dock': {
      const { t } = shot
      if (t < 0.6) return 'Columbia ready to separate'
      if (t < 2.2) return 'separation · adapter panels away'
      if (t < 3.8) return 'transposition · Columbia turns round'
      if (t < 6) return 'docking'
      if (t < 8.5) return 'docked · Eagle drawn out'
      return 'third stage away to solar orbit'
    }
    case 'coast': {
      if (m.arrive !== undefined) return 'translunar coast · arriving'
      const km = Math.round(6.6 + 377 * shot.at)
      const go = m.isGoForEva ? ' · go for EVA' : m.isGoForLanding ? ' · go for landing' : ''
      return `translunar coast · ${km},000 km${go}`
    }
    case 'moon': {
      const { t } = shot
      if (t < 1.2) return 'approaching the Moon'
      if (t < IN_ORBIT - ARRIVE) return 'loss of signal · lunar orbit insertion'
      return m.isGoForLanding ? 'lunar orbit · go for landing' : 'lunar orbit · a commit lands Eagle'
    }
    case 'descent': {
      const { t } = shot
      if (t < 0.8) return 'Columbia and Eagle, undocking'
      if (t < 2.5) return 'the Eagle has wings'
      return 'powered descent · 1202 alarm'
    }
    case 'surface': {
      const { land, step } = shot
      if (step !== undefined) {
        if (step < 1) return 'hatch open'
        if (step < 2.5) return 'Neil on the porch'
        if (step < 5) return 'Neil on the ladder'
        if (step < STEP) return 'on the footpad'
        if (step < STEP + 3.5) return "that's one small step for man, one giant leap for mankind"
        if (step < 10) return 'Buzz on the ladder'
        if (step < EVA) return 'planting the flag'
        return 'the flag at Tranquility Base · 20 July 1969'
      }
      if (m.onTheMoon) return `Tranquility Base · EVA prep ${Math.round(100 * m.prep)}% · a push for the hatch`
      if (land < 7) return 'powered descent · 1202 alarm'
      if (land < TOUCHDOWN - 0.4) return 'picking up some dust'
      if (land < TOUCHDOWN + 0.4) return 'contact light'
      // The landing's last words stay up once it is over, the clock slowing then.
      if (land < LAND - 0.5 || m.isGoForEva) return 'Tranquility Base here, the Eagle has landed'
      return 'the Eagle has landed · a push for the moonwalk'
    }
  }
}

// The launch, the climb to orbit and the burn for the Moon, seen from far
// above the Atlantic: Earth turned so the pad stands at its top, the
// camera pulling back as the rocket climbs.
function earthShot(c: Canvas, t: number, time: number, levels: number) {
  const { width: W, height: H } = c
  const unit = Math.min(W, H)
  const near = 1 - ease((t - LIFTOFF) / (ORBIT_IN - LIFTOFF + 1))
  const k = 0.3 * unit * (1 + 1.6 * near)
  const turn = facing(PAD[0] - rad(70), PAD[1])
  const light = turn.fromBody(SUN_AT_LAUNCH)
  const pad = turn.fromBody(toward(PAD[0], PAD[1]))
  const east: Vec = [1, 0, 0]
  const cx = W * 0.42
  const cy = (1 - near) * H * 0.58 + near * (H * 0.66 + pad[1] * k)
  const screen = (p: Vec) => [cx + p[0] * k, cy - p[1] * k] as const
  const earth = { x: cx, y: cy, r: k, z: 0 }

  drawBall(c, earthChart(chartWidth(k)), earth, turn, light, levels, 0.05, 0.45)
  drawAir(c, earth, light)

  // The stack's place t seconds in, in Earth radii from its middle: up off
  // the pad, over to the east and into orbit; a revolution and a half; then
  // out on the burn for the Moon.
  const rate = (3 * Math.PI) / (TLI - ORBIT_IN)
  const round = (angle: number, r: number) => times(plus(times(pad, Math.cos(angle)), east, Math.sin(angle)), r)
  const path = (at: number): Vec => {
    if (at <= LIFTOFF) return times(pad, 1.002)
    if (at < ORBIT_IN) {
      const s = ((at - LIFTOFF) / (ORBIT_IN - LIFTOFF)) ** 1.5
      return round(0.7 * s * s, 1 + 0.17 * (1 - (1 - s) ** 2))
    }
    const angle = 0.7 + rate * (Math.min(at, TLI) - ORBIT_IN)
    if (at < TLI) return round(angle, 1.17)
    const q = (at - TLI) / (TLI_OFF - TLI)
    return round(angle + rate * (TLI_OFF - TLI) * (q - 0.3 * q * q), 1.17 + 2.6 * q * q)
  }
  const wayAt = (at: number) => {
    const [ax, ay] = screen(path(at - 0.05))
    const [bx, by] = screen(path(at + 0.05))
    return at <= LIFTOFF ? Math.atan2(pad[1], pad[0]) : Math.atan2(-(by - ay), bx - ax)
  }

  // The orbit, dotted, once the rocket is up.
  if (t > ORBIT_IN - 1) {
    for (let k2 = 0; k2 < 90; k2++) {
      const p = round((k2 / 90) * 2 * Math.PI, 1.17)
      const [x, y] = screen(p)
      blend(c, Math.floor(x), Math.floor(y), 0x9fd8ff, 0.5 * clamp(t - ORBIT_IN + 1, 0, 1) * (1 - ease((t - TLI) / 2)), p[2] * k)
    }
  }

  // The rocket drawn bigger than it is, and never too small to see once it is up.
  const perMeter = Math.max((0.32 * k) / 110.6, (0.1 * unit) / 40)
  const [px, py] = screen(pad)
  // The launch tower beside the rocket, red, its arms swinging away at
  // liftoff; left behind, and lost from view as the camera pulls back.
  const towerFade = 1 - clamp((t - LIFTOFF - 0.5) / 2, 0, 1)
  const towerTop = [px, py - 120 * perMeter] as const
  const side = -perMeter * 8
  for (let s = 0; s <= 1 && towerFade > 0; s += 0.02) {
    const x = px + side + (towerTop[0] - px) * s
    const y = py + (towerTop[1] - py) * s
    if (dither(Math.floor(x), Math.floor(y)) > towerFade) continue
    put(c, Math.floor(x), Math.floor(y), Math.floor(s * 40) % 2 === 0 ? 0xb83a22 : 0x7a2414, pad[2] * k + 2)
    if (perMeter > 0.5) put(c, Math.floor(x) - 1, Math.floor(y), 0x7a2414, pad[2] * k + 2)
  }
  if (t < LIFTOFF) {
    for (const s of [0.45, 0.62, 0.8]) {
      const [x, y] = [px + (towerTop[0] - px) * s, py + (towerTop[1] - py) * s]
      for (let w = side; w < 0; w += 0.5) put(c, Math.floor(x + w), Math.floor(y), 0x8a8a86, pad[2] * k + 2)
    }
  }

  // Smoke and steam rolling out from the flame trench along the ground.
  if (t > 0.3 && t < 5.5) {
    const age = t - 0.3
    for (let i = 0; i < 10; i++) {
      const way = i % 2 === 0 ? 1 : -1
      const out = (0.2 + (0.8 * (i >> 1)) / 4) * Math.min(1, age / 2) * perMeter * 70
      puff(c, px + way * out, py + perMeter * 4, perMeter * (6 + 9 * Math.min(1, age / 2)), 0xe8e4dc, 0.55 * (1 - age / 5.5), pad[2] * k + 3)
    }
  }

  // The trail of exhaust the climb leaves, low down, drifting and thinning.
  if (t > LIFTOFF && t < S_II_OFF) {
    for (let at = LIFTOFF; at < Math.min(t, S_IC_OFF); at += 0.06) {
      const [x, y] = screen(path(at))
      const age = t - at
      puff(c, x, y, perMeter * (3 + 4 * age), 0xd8d2c8, 0.35 * Math.max(0, 1 - age / 3), path(at)[2] * k + 1)
    }
  }

  // The stack as it stands: the stages still on it, the dropped ones falling away.
  const stack = (at: number): readonly [number, number] => (at < S_IC_OFF ? [5, 110.6] : at < TOWER_OFF ? [42, 110.6] : at < S_II_OFF ? [46, 103] : [69, 103])
  const draw = (at: number, from: number, to: number, drift: readonly [number, number], spin: number, fade: number) => {
    const angle = wayAt(at) + spin
    const [tx, ty] = screen(path(at))
    const lit = litAt(angle, light)
    const x = tx - Math.cos(angle) * from * perMeter + drift[0]
    const y = ty + Math.sin(angle) * from * perMeter + drift[1]
    sprite(c, { x, y, z: path(at)[2] * k + 4, scale: perMeter, angle }, [Math.max(0, from - 5), to, -8, 8], saturn(lit, from, to), fade)
    return { x: tx + drift[0], y: ty + drift[1], angle }
  }
  const [from, to] = stack(t)
  const now = draw(t, from, to, [0, 0], 0, 1)

  // Each dropped piece: what it was, when, and it falls behind, tumbling.
  const drops = [
    [S_IC_OFF, 5, 42],
    [TOWER_OFF, 103, 110.6],
    [TOWER_OFF, 42, 46],
    [S_II_OFF, 46, 69],
  ] as const
  for (const [when, pieceFrom, pieceTo] of drops) {
    const age = t - when
    if (age < 0 || age > 2.4) continue
    const angle = wayAt(when)
    const back = -(age * age) * 0.18 * k
    const sideways = pieceFrom === 103 ? age * 0.08 * k : 0
    draw(when, pieceFrom, pieceTo, [Math.cos(angle) * back - Math.sin(angle) * sideways, -Math.sin(angle) * back - Math.cos(angle) * sideways], age * (pieceFrom === 103 ? 2.5 : 0.8), 1 - age / 2.4)
  }

  // The engines: the first stage's F-1s orange and long, the J-2s' flames pale and thin.
  const burning = t > 0.3 && t < S_IC_OFF ? 'F-1' : (t > S_IC_OFF + 0.2 && t < ORBIT_IN) || (t > TLI && t < TLI_OFF) ? 'J-2' : undefined
  if (burning !== undefined) {
    const length = burning === 'F-1' ? perMeter * (t < LIFTOFF ? 40 : 75 + 35 * Math.min(1, t - LIFTOFF)) : perMeter * 30
    const width = burning === 'F-1' ? perMeter * 12 : perMeter * 6
    flame(c, now.x, now.y, now.angle + Math.PI, length, width, burning === 'F-1' ? 0xff9a3a : 0x9fc8ff, time, path(t)[2] * k + 5, burning === 'F-1' ? 1 : 0.6)
  }
}

// Columbia separating from the third stage, turning round, docking with
// Eagle and drawing it out, Earth big below.
function dockShot(c: Canvas, d: number, time: number, levels: number) {
  const { width: W, height: H } = c
  const unit = Math.min(W, H)
  const light = unit3([0.45, 0.55, 0.7])
  const earth = { x: W * 0.14, y: H * 1.16, r: 0.8 * unit, z: -10_000 }
  const turn = facing(rad(22), rad(-70) + time * 0.01)
  drawBall(c, earthChart(chartWidth(earth.r)), earth, turn, unit3([0.3, 0.6, 0.75]), levels, 0.05, 0.45)
  drawAir(c, earth, unit3([0.3, 0.6, 0.75]))

  const s = Math.min((0.62 * W) / 40, (0.75 * unit) / 12)
  // Screen place of u meters along the stack, as it stood on the rocket.
  const x0 = W * 0.1 - 66 * s
  const y0 = H * 0.4

  // The third stage, drifting off at the end, venting.
  const away = Math.max(0, d - 8.5)
  const tumble = away * 0.05
  const [mx, my] = [x0 + 77 * s - away * away * 2 * s, y0 + away * 1.2 * s]
  const third: Place = { x: mx - Math.cos(tumble) * 77 * s, y: my + Math.sin(tumble) * 77 * s, z: 0, scale: s, angle: tumble }
  sprite(c, third, [64, 87, -3.6, 3.6], saturn(litAt(third.angle, light), 69, 87))
  if (away > 0.3) puff(c, mx + 9 * s, my - 3.4 * s, s * (1 + away), 0xf4f4f0, 0.35 * Math.max(0, 1 - (away - 0.3)), 1)

  // The adapter's panels: closed round Eagle, then opened out and thrown away.
  const opened = 0.8 * ease((d - 0.6) / 0.8)
  const thrown = Math.max(0, d - 1.4)
  for (const way of [1, -1]) {
    const hinge: Place = {
      x: x0 + 87 * s - thrown * 3 * s,
      y: y0 - way * (3.3 + thrown * 2.5) * s,
      z: 2,
      scale: s,
      angle: way * (-0.157 + opened + thrown * 0.9),
    }
    sprite(c, hinge, [0, 8.6, -0.2, 0.2], (u, v) => shade(0xd8d8d4, 0.55 + 0.45 * roll(litAt(hinge.angle, light), v / 0.2)), 1 - thrown / 2.6)
  }

  // Eagle in the adapter, then drawn out by Columbia.
  const drawnOut = 12 * ease((d - 6.5) / 2)
  const eagle: Place = { x: x0 + (87.6 + drawnOut) * s, y: y0, z: 1, scale: s, angle: 0 }
  sprite(c, eagle, [0, 6.4, -2.6, 2.6], lm(litAt(0, light), false))

  // Columbia: out, round, back in nose first, then away with Eagle.
  const turned = Math.PI * ease((d - 2.2) / 1.6)
  const middle = d < 2.2 ? 98.55 + 14 * ease((d - 0.6) / 1.6) : d < 3.8 ? 112.55 : d < 6 ? 112.55 - 12.5 * ease((d - 3.8) / 2.2) : 100.05 + drawnOut
  const columbia: Place = { x: x0 + middle * s, y: y0, z: 3, scale: s, angle: turned }
  const shape = csm(litAt(turned, light))
  sprite(c, columbia, [-5.85, 5.85, -2.5, 2.5], (u, v) => shape(u + 5.85, v))

  // Puffs from Columbia's thrusters at each move.
  for (const at of [0.6, 2.2, 3.8, 5.9, 6.5]) {
    const age = d - at
    if (age < 0 || age > 0.35) continue
    for (const way of [1, -1]) {
      const [qx, qy] = [Math.cos(turned) * 1.4 - Math.sin(turned) * way * 2.3, Math.sin(turned) * 1.4 + Math.cos(turned) * way * 2.3]
      glow(c, Math.floor(columbia.x + qx * s), Math.floor(columbia.y - qy * s), 0xffffff, 0.9 * (1 - age / 0.35), 4)
    }
  }
}

// The coast out, Earth behind and the Moon ahead, the way dotted: bright
// as far as Apollo has got, faint beyond, with the free return's loop home.
function coastShot(c: Canvas, at: number, time: number, levels: number) {
  const { width: W, height: H } = c
  const unit = Math.min(W, H)
  const light = unit3([0.34, -0.4, 0.85])
  const earth = { x: W * 0.2, y: H * 0.66, r: 0.15 * unit, z: 0 }
  const moon = { x: W * 0.8, y: H * 0.32, r: 0.065 * unit, z: 0 }
  drawBall(c, earthChart(chartWidth(earth.r)), earth, facing(rad(25), rad(-75) + time * 0.05), light, levels, 0.05, 0.5)
  drawAir(c, earth, light)
  drawBall(c, moonChart(chartWidth(moon.r)), moon, facing(rad(25), rad(90)), light, levels, 0.06, undefined, 0.6)

  const curve = (points: readonly (readonly [number, number])[], t: number): readonly [number, number] => {
    const [a = [0, 0], b = [0, 0], d = [0, 0], e = [0, 0]] = points
    const u = 1 - t
    return [
      u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * d[0] + t * t * t * e[0],
      u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * d[1] + t * t * t * e[1],
    ]
  }
  const out = [
    [earth.x + 1.2 * earth.r, earth.y - 0.3 * earth.r],
    [earth.x + 3.6 * earth.r, earth.y - 2.2 * earth.r],
    [moon.x - 5 * moon.r, moon.y + 1.4 * moon.r],
    [moon.x + 0.2 * moon.r, moon.y - 1.3 * moon.r],
  ] as const
  const home = [
    [moon.x + 0.9 * moon.r, moon.y + 1.1 * moon.r],
    [moon.x - 2.5 * moon.r, moon.y + 6 * moon.r],
    [earth.x + 4.5 * earth.r, earth.y + 1 * earth.r],
    [earth.x + 1.1 * earth.r, earth.y + 0.7 * earth.r],
  ] as const
  const dots = Math.max(40, Math.round(unit * 0.35))
  for (let i = 0; i <= dots; i++) {
    const t = i / dots
    const [x, y] = curve(out, t)
    blend(c, Math.floor(x), Math.floor(y), 0x9fd8ff, t <= at ? 0.85 : 0.22, t > 0.97 ? -moon.r * 3 : 10)
    const [hx, hy] = curve(home, t)
    if (i % 2 === 0) blend(c, Math.floor(hx), Math.floor(hy), 0x9fd8ff, 0.1, 10)
  }

  const [x, y] = curve(out, at)
  const [ax, ay] = curve(out, Math.max(0, at - 0.01))
  const [bx, by] = curve(out, Math.min(1, at + 0.01))
  const angle = Math.atan2(-(by - ay), bx - ax)
  const length = Math.max(10, 0.085 * unit)
  const scale = length / 17.4
  sprite(c, { x: x - Math.cos(angle) * length * 0.5, y: y + Math.sin(angle) * length * 0.5, z: at > 0.97 ? -moon.r * 3 : 20, scale, angle }, [0, 17.4, -2.6, 2.6], docked(litAt(angle, light)))
}

// Lunar orbit, `t` seconds after leaving the coast: the approach, behind the
// Moon out of touch for the burn, round into orbit, and on round it, east to
// west over the near side as Apollo's orbits went.
const ORBIT_SECONDS = 16

function moonShot(c: Canvas, t: number, time: number, levels: number) {
  const { width: W, height: H } = c
  const unit = Math.min(W, H)
  const turn = facing(rad(12), rad(35))
  const light = turn.fromBody(SUN_ON_THE_MOON)
  const moon = { x: W * 0.5, y: H * 0.54, r: 0.36 * unit, z: 0 }
  drawBall(c, moonChart(chartWidth(moon.r)), moon, turn, light, levels, 0.07, undefined, 0.6)

  const orbit = (angle: number): Vec => turn.fromBody([Math.cos(angle) * 1.12, 0, Math.sin(angle) * 1.12])
  const earthward = turn.fromBody([0, 0, 1])
  const p: Vec = (() => {
    if (t < 1.8) {
      // In from Earth's side, curving onto the orbit's far side.
      const k = ease(t / 1.8)
      const start = plus(times(earthward, 3.2), [-0.4, -0.3, 0])
      const end = orbit(Math.PI)
      const bend = plus(end, unit3(plus(orbit(Math.PI - 0.3), times(end, -1))), -1.4)
      const u = 1 - k
      return plus(plus(times(start, u * u), times(bend, 2 * u * k)), times(end, k * k))
    }
    if (t < 3.6) return orbit(Math.PI + ((t - 1.8) / 1.8) * Math.PI)
    return orbit(2 * Math.PI + ((t - 3.6) / ORBIT_SECONDS) * 2 * Math.PI)
  })()
  const ahead: Vec = (() => {
    const later = t < 1.8 ? orbit(Math.PI) : orbit(Math.PI + ((t + 0.1 - 1.8) / 1.8) * Math.PI)
    return t >= 3.6 ? orbit(2 * Math.PI + ((t + 0.1 - 3.6) / ORBIT_SECONDS) * 2 * Math.PI) : later
  })()
  const [x, y] = [moon.x + p[0] * moon.r, moon.y - p[1] * moon.r]
  const angle = Math.atan2(ahead[1] - p[1], ahead[0] - p[0])
  const length = Math.max(10, 0.075 * unit)
  sprite(c, { x: x - Math.cos(angle) * length * 0.5, y: y + Math.sin(angle) * length * 0.5, z: p[2] * moon.r, scale: length / 17.4, angle }, [0, 17.4, -2.6, 2.6], docked(litAt(angle, light)))
}

// The landing seen from orbit: Columbia and Eagle over the Sea of
// Tranquility, apart, and Eagle down toward Tranquility Base, its engine lit.
function descentShot(c: Canvas, t: number, time: number, levels: number) {
  const { width: W, height: H } = c
  const unit = Math.min(W, H)
  const turn = facing(rad(-38), rad(30))
  const light = turn.fromBody(SUN_ON_THE_MOON)
  const moon = { x: W * 0.5, y: H * 1.05, r: 0.8 * unit, z: 0 }
  drawBall(c, moonChart(chartWidth(moon.r)), moon, turn, light, levels, 0.07, undefined, 0.6)

  const screen = (p: Vec) => [moon.x + p[0] * moon.r, moon.y - p[1] * moon.r] as const
  const base = turn.fromBody(TRANQUILITY)
  // Columbia flies on west, high; Eagle drops away beneath it.
  const flight = (angle: number, high: number): Vec => turn.fromBody([Math.cos(angle) * high, 0.02, Math.sin(angle) * high])
  const start = Math.atan2(TRANQUILITY[2], TRANQUILITY[0]) - 0.32
  const columbia = flight(start + t * 0.035, 1.1)
  const apart = ease((t - 0.8) / 1.7)
  const down = ease((t - 2.5) / (CUT - 2.5))
  const eagle = plus(times(plus(flight(start + t * 0.035 - 0.004, 1.1 - 0.025 * apart), [0, -0.012 * apart, 0]), 1 - down), base, down)
  const length = Math.max(10, 0.1 * unit)
  const scale = length / 17.4

  const [cx, cy] = screen(columbia)
  const [ex, ey] = screen(eagle)
  if (t < 0.8) {
    sprite(c, { x: cx - length * 0.5, y: cy, z: columbia[2] * moon.r + 5, scale, angle: 0 }, [0, 17.4, -2.6, 2.6], docked(litAt(Math.PI, light)))
    return
  }
  const shape = csm(litAt(Math.PI, light))
  sprite(c, { x: cx, y: cy, z: columbia[2] * moon.r + 5, scale, angle: Math.PI }, [0, 11.7, -2.4, 2.4], shape)
  const shrink = 1 - 0.5 * down
  sprite(c, { x: ex, y: ey, z: eagle[2] * moon.r + 6, scale: scale * shrink, angle: Math.PI / 2 }, [-1.2, 6.4, -4.8, 4.8], lm(litAt(Math.PI / 2, light), true))
  if (t > 2.5) flame(c, ex, ey + 0.4 * scale, -Math.PI / 2, 5 * scale * shrink, 1.6 * scale * shrink, 0xffc890, time, eagle[2] * moon.r + 7, 0.7)
}

// On the Moon, looking north across the Sea of Tranquility from a man's
// height: the sun low in the east (right), every shadow stretched long to
// the west (left). Eagle comes in from the east and lands; on a push Neil
// comes out, down the ladder and off the footpad, Buzz after him, and
// they plant the flag.
const EYE = 1.5
// Where Eagle stands and the flag goes, in meters east and north of the eye.
const LM_X = 6
const LM_D = 20
const FLAG_X = -3.2
const FLAG_D = 15.5
// Shadows are this many times longer than what casts them, the sun 10.8° up.
const LONG = 1 / Math.tan(rad(10.8))

// The eye on the Moon: where it is (east, up, north meters), `f` pixels a
// radian, its middle at (cx, cy) on screen, and its right, up and forward
// ways, from its heading round from north toward east and its pitch up from
// level. The figures stand flat to the eye, turned with its heading.
type View = { W: number; H: number; f: number; cx: number; cy: number; eye: Vec; right: Vec; up: Vec; forward: Vec; along: Vec }

// How far a drag or the wheel has pulled the eye back from the flag, 0 to 1:
// any drag, either way, or the wheel rolled out; back to the landing site
// seen from a distance, then up to orbit to see Earth rise (RISING, RISEN).
// A right-click on the dashboard brings it back in.
const pulledBack = (view: TurnedView | undefined) =>
  view === undefined ? 0 : clamp(Math.max(Math.abs(view.tip) / 0.9, Math.abs(view.spin) / 1.5, (1 - view.zoom) / 0.4), 0, 1)

// Pulled all the way back: 34 meters east of the landing site and 5 up,
// looking west and up, so Eagle, the flag and the two of them sit on the
// horizon and Earth hangs high above them, 66.5° up, as it did.
const WIDE = { eye: [35.5, 5, 14.5] as Vec, heading: rad(-85), pitch: rad(29), f: 0.54 }

const viewOf = (c: Canvas, isClose: boolean, back = 0): View => {
  const unit = Math.min(c.width, c.height)
  const near = isClose ? 1.9 * unit : 0.95 * unit
  const k = ease(back)
  // Close in, the flag a little left of the middle.
  const cx = isClose ? 0.4 * c.width - (FLAG_X * near) / FLAG_D : 0.5 * c.width
  const [h, p] = [WIDE.heading * k, WIDE.pitch * k]
  const start: Vec = [0, EYE, 0]
  return {
    W: c.width,
    H: c.height,
    f: near * ((WIDE.f * unit) / near) ** k,
    cx: cx + (0.5 * c.width - cx) * k,
    cy: Math.round((0.43 + 0.07 * k) * c.height),
    eye: plus(start, plus(WIDE.eye, start, -1), k),
    right: [Math.cos(h), 0, -Math.sin(h)],
    up: [-Math.sin(h) * Math.sin(p), Math.cos(p), -Math.cos(h) * Math.sin(p)],
    forward: [Math.sin(h) * Math.cos(p), Math.sin(p), Math.cos(h) * Math.cos(p)],
    along: [Math.sin(h), 0, Math.cos(h)],
  }
}

// The moonwalk cuts in close as the flag goes in.
const CLOSE = 9

// How far back the drag goes before the picture starts to dissolve into the
// view from orbit, and how far until it is all that is left.
const RISING = 0.55
const RISEN = 0.85

// The view from orbit, as Apollo 11 photographed it there (AS11-44-6551):
// 110 km up, looking along the ground to the horizon through a long lens,
// Earth just risen over it, lit from above and half dark, the sun high over
// the ground below. The ground is the Moon as a ball, each pixel's line of
// sight followed down to it, and on it craters at three sizes, each drawn
// only where it is big enough to see, so the far ground lies smooth. Made
// once for each size.
const ORBIT_HIGH = 110
const MOON_KM = 1737.4
const earthrises = new Map<string, Uint32Array>()

function earthriseOf(width: number, height: number, levels: number): Uint32Array {
  const key = `${width}x${height}:${levels}`
  const known = earthrises.get(key)
  if (known) return known
  if (earthrises.size > 4) earthrises.clear()

  const c = canvas(width, height)
  const f = 4.4 * width
  const [cx, cy] = [width / 2, Math.round(height * 0.5)]
  const eye = MOON_KM + ORBIT_HIGH
  // Looking at the horizon, down by its dip from 110 km up.
  const dip = Math.acos(MOON_KM / eye)
  const forward: Vec = [0, -Math.sin(dip), Math.cos(dip)]
  const up: Vec = [0, Math.cos(dip), Math.sin(dip)]
  const sun = unit3([-0.5, 0.75, 0.45])
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const sight = unit3(plus(plus(forward, [1, 0, 0], (px + 0.5 - cx) / f), up, -(py + 0.5 - cy) / f))
      // Where the line of sight meets the Moon, if it does before the horizon.
      const toward = eye * sight[1]
      const meets = toward * toward - (eye * eye - MOON_KM * MOON_KM)
      if (meets < 0) continue
      const far = -toward - Math.sqrt(meets)
      if (far <= 0) continue
      const ground: Vec = [sight[0] * far, eye + sight[1] * far, sight[2] * far]
      const normal = times(ground, 1 / MOON_KM)
      const [east, north] = [MOON_KM * Math.atan2(ground[0], ground[1]), MOON_KM * Math.atan2(ground[2], ground[1])]
      // How much ground a pixel spans down the view, seen so slantwise.
      const span = far / f / Math.max(0.03, -dot(sight, normal))
      const [slopeEast, slopeNorth, shine] = cratersAt(east, north, span)
      const across = unit3([normal[1], -normal[0], 0])
      const along = unit3([0, -normal[2], normal[1]])
      const tipped = unit3(plus(plus(normal, across, -slopeEast), along, -slopeNorth))
      const lit = Math.max(0, dot(tipped, sun)) ** 0.6
      const stepped = Math.min(1, Math.floor(lit * levels + dither(px, py)) / levels)
      const dust = mix(0xa29e97, 0x8e8b85, smooth(0.35, 0.65, fbm2(east / 90, north / 90, 1969, 3)))
      put(c, px, py, shade(dust, (0.08 + 0.92 * stepped) * shine), -far)
    }
  }

  // Earth, just over the horizon, a seventh of the picture across.
  const r = 0.0166 * f
  const at = { x: cx, y: cy - 0.0236 * f, r, z: 1 }
  // Lit from above, the sun high over the Moon: a little more than half of it.
  const light = unit3([-0.18, 0.97, 0.12])
  drawBall(c, earthChart(chartWidth(r)), at, facing(rad(-5), rad(-44), rad(-10)), light, levels, 0.02, 0.45)
  drawAir(c, at, light)
  earthrises.set(key, c.color)
  return c.color
}

// The slopes east and north of the ground at (east, north) km from under
// the eye, and how bright it is there: craters on grids of three sizes,
// about half the cells holding one, each skipped where a pixel spans more
// than its width; fresh small ones with bright rims.
function cratersAt(east: number, north: number, span: number): readonly [number, number, number] {
  let [slopeEast, slopeNorth, shine] = [0, 0, 1]
  for (const cell of [48, 14, 4]) {
    if (cell * 0.3 < span * 1.5) continue
    const [i, j] = [Math.floor(east / cell), Math.floor(north / cell)]
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const [ci, cj] = [i + di, j + dj]
        if (hash3(ci, cj, cell, 51) < 0.5) continue
        const r = cell * (0.12 + 0.3 * hash3(ci, cj, cell, 52))
        const [x, y] = [(ci + hash3(ci, cj, cell, 53)) * cell, (cj + hash3(ci, cj, cell, 54)) * cell]
        const [dx, dy] = [east - x, north - y]
        const far = Math.hypot(dx, dy)
        const d = far / r
        if (d > 1.7 || far === 0) continue
        const [steep, floor, peak] = r > 15 ? [0.25, 0.5, 0.14] : r > 4 ? [0.4, 0.3, 0.12] : [0.6, 0, 0]
        const slope =
          d < peak
            ? -steep * 1.6 * Math.sin((Math.PI * d) / peak)
            : d < floor
              ? 0
              : d < 1
                ? (steep * (d - floor)) / (1 - floor)
                : -steep * 0.85 * (1 - (d - 1) / 0.7) ** 2
        slopeEast += (slope * dx) / far
        slopeNorth += (slope * dy) / far
        if (r < 4 && d > 0.85 && d < 1.25 && hash3(ci, cj, cell, 55) > 0.8) shine *= 1.12
      }
    }
  }
  return [slopeEast, slopeNorth, shine]
}

// How far ahead of the eye (east, up, north) meters are.
const ahead = (v: View, x: number, y: number, d: number) => dot([x - v.eye[0], y - v.eye[1], d - v.eye[2]], v.forward)

// Where (east, up, north) meters land on screen, and how near; nowhere
// (NaN) behind the eye.
const project = (v: View, x: number, y: number, d: number) => {
  const q: Vec = [x - v.eye[0], y - v.eye[1], d - v.eye[2]]
  const far = dot(q, v.forward)
  if (far < 0.3) return [NaN, NaN, -Infinity] as const
  return [v.cx + (v.f * dot(q, v.right)) / far, v.cy - (v.f * dot(q, v.up)) / far, -far] as const
}

// Where a point of a figure standing at (x, d) lands: `across` meters along
// its face, which is turned to the eye, `up` meters up and `deep` meters
// back from it.
const standing = (v: View, x: number, d: number, across: number, up: number, deep = 0) =>
  project(v, x + across * v.right[0] + deep * v.along[0], up, d + across * v.right[2] + deep * v.along[2])

// The ground as seen, made once for each place and way the eye looks: each
// pixel's line of sight followed down to the ground, out to the horizon
// where the Moon curves away (2.3 km off from a man's height), and there grey dust, darker patches, and
// craters lit on their western walls and dark on their eastern, the sun
// being in the east. Where on the ground each pixel lands is kept for the
// shadows; NaN where it sees sky.
type Ground = { colors: Uint32Array; east: Float32Array; north: Float32Array }

const grounds = new Map<string, Ground>()
// The Moon's radius in meters: the horizon from `h` meters up is this far off.
const MOON_RADIUS = 1_737_400

function groundOf(c: Canvas, v: View): Ground {
  const key = `${c.width}x${c.height}:${v.f}:${v.cx}:${v.cy}:${v.eye.join()}:${v.forward.join()}`
  const known = grounds.get(key)
  if (known) return known
  if (grounds.size > 6) grounds.clear()

  const next = random(20_07_1969)
  const craters = Array.from({ length: 70 }, () => {
    const d = 6 + 220 * next() ** 2
    return { x: (next() * 2 - 1) * d * 0.9, d, r: 0.3 + (0.6 + 0.04 * d) * next() ** 2 }
  })
  const made = { colors: new Uint32Array(c.width * c.height), east: new Float32Array(c.width * c.height).fill(NaN), north: new Float32Array(c.width * c.height).fill(NaN) }
  const horizon = Math.sqrt(2 * MOON_RADIUS * v.eye[1])
  for (let py = 0; py < c.height; py++) {
    for (let px = 0; px < c.width; px++) {
      const [across, down] = [(px + 0.5 - v.cx) / v.f, (py + 0.5 - v.cy) / v.f]
      const sight = plus(plus(v.forward, v.right, across), v.up, -down)
      if (sight[1] >= 0) continue
      const reach = v.eye[1] / -sight[1]
      if (reach > horizon) continue
      const [x, d] = [v.eye[0] + reach * sight[0], v.eye[2] + reach * sight[2]]
      const i = py * c.width + px
      made.east[i] = x
      made.north[i] = d
      let light = 0.84 + 0.26 * (fbm2(x * 0.25, d * 0.25, 1969, 3) - 0.5) + 0.12 * (hash3(px, py, 0, 11) - 0.5)
      for (const crater of craters) {
        const [dx, dd] = [(x - crater.x) / crater.r, (d - crater.d) / crater.r]
        const r2 = dx * dx + dd * dd
        if (r2 > 1.4) continue
        light *= r2 > 1 ? 1.06 : dx > 0.2 ? 0.55 : dx < -0.3 ? 1.16 : 0.92
      }
      made.colors[i] = shade(0x938e86, light * (0.9 + 0.1 * Math.min(1, reach / 60)))
    }
  }
  grounds.set(key, made)
  return made
}

// A shadow on the ground from something `tall` meters high standing at
// (x, d), `wide` meters across it east to west and `deep` north to south:
// out to the west, LONG times as long, narrowing to a point.
type Shadow = { x: number; d: number; tall: number; wide: number; deep: number }

const isShaded = (s: Shadow, x: number, d: number) => {
  const off = Math.abs(d - s.d)
  return off <= s.deep && x <= s.x + s.wide * 0.5 && x >= s.x - s.tall * LONG * (1 - off / s.deep)
}

// The stars on the sky's sphere, the same every time: a way and a brightness each.
let skyStars: { way: Vec; bright: number }[] | undefined

function starsOf() {
  if (skyStars) return skyStars
  const next = random(1969_07_20)
  skyStars = Array.from({ length: 1400 }, () => {
    const [y, turn] = [next() * 1.02 - 0.02, next() * 2 * Math.PI]
    const across = Math.sqrt(Math.max(0, 1 - y * y))
    return { way: [across * Math.cos(turn), y, across * Math.sin(turn)] as Vec, bright: 0.25 + 0.75 * next() ** 3 }
  })
  return skyStars
}

// Earth from Tranquility Base: 66.5° up, just south of west, 1.9° across;
// lit on its side toward the sun, low in the east, so a little more than
// half lit; the Atlantic toward the Moon, the Americas on its sunlit edge.
const EARTH_WAY = unit3([-0.398, 0.917, -0.0107])
const EARTH_ANGLE = Math.asin(6371 / 384_400)
const SUN_WAY: Vec = [Math.cos(rad(10.8)), Math.sin(rad(10.8)), 0]

function drawEarthAbove(c: Canvas, v: View, levels: number) {
  const far = dot(EARTH_WAY, v.forward)
  if (far < 0.1) return
  const x = v.cx + (v.f * dot(EARTH_WAY, v.right)) / far
  const y = v.cy - (v.f * dot(EARTH_WAY, v.up)) / far
  // Never smaller than a dot that can be found, as the rocket is drawn bigger than it is.
  const r = Math.max(4.5, (v.f * EARTH_ANGLE) / far)
  if (x + 2.5 * r < 0 || x - 2.5 * r > c.width || y + 2.5 * r < 0 || y - 2.5 * r > c.height) return
  // A faint blue glow round it in the black: the pale blue dot.
  for (let py = Math.floor(y - 2.5 * r); py <= Math.ceil(y + 2.5 * r); py++) {
    for (let px = Math.floor(x - 2.5 * r); px <= Math.ceil(x + 2.5 * r); px++) {
      const d = Math.hypot(px + 0.5 - x, py + 0.5 - y) / r
      if (d > 1 && d < 2.5) glow(c, px, py, 0x6f9fe8, 0.4 * ((2.5 - d) / 1.5) ** 2, -1e8)
    }
  }
  // Earth's north where the Moon's north falls on the screen.
  const north: Vec = [0, 0, 1]
  const roll = Math.atan2(dot(north, v.up), dot(north, v.right)) - Math.PI / 2
  const light = unit3([dot(SUN_WAY, v.right), dot(SUN_WAY, v.up), -dot(SUN_WAY, EARTH_WAY)])
  const at = { x, y, r, z: -1e8 }
  drawBall(c, earthChart(chartWidth(r)), at, facing(rad(-5), rad(-44), roll), light, levels, 0.03, 0.45)
  if (r > 3) drawAir(c, at, light)
}

// A filled polygon of screen points at nearness `z`, its color by pixel.
function polygon(c: Canvas, points: readonly (readonly [number, number])[], z: number, color: (px: number, py: number) => number) {
  if (points.some(([x, y]) => Number.isNaN(x) || Number.isNaN(y))) return
  const ys = points.map(([, y]) => y)
  for (let py = Math.max(0, Math.floor(Math.min(...ys))); py <= Math.min(c.height - 1, Math.ceil(Math.max(...ys))); py++) {
    const y = py + 0.5
    const xs: number[] = []
    for (let i = 0; i < points.length; i++) {
      const [ax = 0, ay = 0] = points[i] ?? []
      const [bx = 0, by = 0] = points[(i + 1) % points.length] ?? []
      if (ay > y !== by > y) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax))
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let px = Math.max(0, Math.ceil((xs[k] ?? 0) - 0.5)); px <= Math.min(c.width - 1, Math.floor((xs[k + 1] ?? 0) - 0.5)); px++) put(c, px, py, color(px, py), z)
    }
  }
}

// A line `width` pixels thick from a to b.
function line(c: Canvas, a: readonly [number, number], b: readonly [number, number], width: number, color: number, z: number) {
  if ([a[0], a[1], b[0], b[1]].some(Number.isNaN)) return
  // Only the part on the picture, give or take the line's width: something
  // just before the eye can reach thousands of pixels off it.
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  let [from, to] = [0, 1]
  for (const [p, q] of [[-dx, a[0] + width], [dx, c.width + width - a[0]], [-dy, a[1] + width], [dy, c.height + width - a[1]]] as const) {
    if (p === 0) {
      if (q < 0) return
      continue
    }
    const k = q / p
    if (p < 0) from = Math.max(from, k)
    else to = Math.min(to, k)
    if (from > to) return
  }
  const [sx, sy] = [a[0] + dx * from, a[1] + dy * from]
  const [ex, ey] = [a[0] + dx * to, a[1] + dy * to]
  const steps = Math.ceil(Math.hypot(ex - sx, ey - sy) * 2) + 1
  const half = width / 2
  for (let s = 0; s <= steps; s++) {
    const [x, y] = [sx + ((ex - sx) * s) / steps, sy + ((ey - sy) * s) / steps]
    for (let py = Math.floor(y - half + 0.5); py <= Math.floor(y + half - 0.5 + 0.5); py++) {
      for (let px = Math.floor(x - half + 0.5); px <= Math.floor(x + half - 0.5 + 0.5); px++) put(c, px, py, color, z)
    }
  }
}

// Eagle standing (or coming down) on the Moon, seen from the side: its
// front, with the hatch, porch and ladder, to the west (left), lit from the
// east. `x` and `y` are its middle's place east of the eye and its height;
// `isOpen` whether the hatch is, `isDown` whether its probes have touched.
function drawEagle(c: Canvas, v: View, x: number, y: number, isOpen: boolean, isDown: boolean) {
  const at = (lx: number, ly: number, dd = 0) => standing(v, x, LM_D, lx, y + ly, dd)
  const p = (lx: number, ly: number, dd = 0) => {
    const [px, py] = at(lx, ly, dd)
    return [px, py] as const
  }
  const s = v.f / Math.max(1, ahead(v, x, 3, LM_D))
  const z = -ahead(v, x, 3, LM_D)
  const strut = Math.max(1, 0.16 * s)
  // How the sun from the east falls across a part `from` to `to` meters east to west.
  const lightAt = (px: number, from: number, to: number) => 0.55 + 0.45 * clamp((px - p(from, 0)[0]) / Math.max(1, p(to, 0)[0] - p(from, 0)[0]), 0, 1)

  // The north leg, behind.
  line(c, p(0, 2.2, 2.1), p(0, 0.3, 4.6), strut, shade(GOLD, 0.45), z - 4)
  polygon(c, [p(-0.47, 0.25, 4.6), p(0.47, 0.25, 4.6), p(0.47, 0, 4.6), p(-0.47, 0, 4.6)], z - 4, () => shade(0xb0aca4, 0.5))

  // The west and east legs: primary struts, secondaries, footpads.
  for (const way of [-1, 1]) {
    const dark = way < 0 ? 0.5 : 0.9
    line(c, p(way * 2.15, 2.75), p(way * 4.55, 0.3), strut * 1.3, shade(GOLD, dark), z + 1)
    line(c, p(way * 2.15, 1.45), p(way * 4.45, 0.35), strut, shade(0xb0aca4, dark), z + 1)
    polygon(c, [p(way * 4.08, 0.25), p(way * 5.02, 0.25), p(way * 5.02, 0), p(way * 4.08, 0)], z + 1, () => shade(0xc8c4bc, dark))
    // The contact probes hang beneath, then lie bent on the ground; the forward (ladder) leg has none.
    if (way > 0) line(c, p(4.55, 0), isDown ? p(5.6, -y) : p(4.55, -1.7), 1, 0x8a8a86, z + 1)
  }

  // The descent stage, gold, and its engine beneath.
  polygon(c, [p(-0.55, 1.45), p(0.55, 1.45), p(0.75, 0.95), p(-0.75, 0.95)], z, () => 0x3a3836)
  polygon(c, [p(-2.15, 1.45), p(2.15, 1.45), p(2.15, 3.15), p(-2.15, 3.15)], z, (px, py) => {
    const light = lightAt(px, -2.15, 2.15)
    return py < p(0, 2.98)[1] ? shade(BLACK, light) : foil(GOLD, light, px * 0.7, py * 0.7)
  })

  // The ascent stage: its cabin, black about the windows, grey behind, and the equipment bay aft.
  const cabin = [p(-1.95, 3.15), p(-2.02, 4.15), p(-1.78, 4.5), p(-1.35, 5.3), p(-0.6, 5.5), p(0.45, 5.55), p(0.8, 5.1), p(2.05, 5), p(2.18, 3.9), p(1.6, 3.15)] as const
  polygon(c, cabin, z + 2, px => {
    const light = lightAt(px, -2.02, 2.18)
    const [front] = p(-1.25, 0)
    const [aft] = p(1, 0)
    return shade(px < front ? 0x2c2c2e : px > aft ? 0x6e6c68 : 0xa6a49e, light)
  })
  polygon(c, [p(-1.78, 4.5), p(-1.35, 5.3), p(-1.12, 5.18), p(-1.52, 4.44)], z + 3, (px, py) => (dither(px, py) > 0.8 ? 0x8aa0b8 : 0x16202a))
  if (isOpen) polygon(c, [p(-2.04, 3.32), p(-1.74, 3.32), p(-1.74, 4.08), p(-2.04, 4.08)], z + 3, () => 0x0c0c0e)
  polygon(c, [p(-0.45, 5.5), p(0.35, 5.5), p(0.35, 5.85), p(-0.45, 5.85)], z + 2, px => shade(0x9c9a96, lightAt(px, -0.45, 0.35)))
  // The thruster quads at the corners, the radar dish forward, the steerable antenna aft.
  for (const [qx, qy] of [[-2.3, 4.85], [2.38, 4.85]] as const) {
    polygon(c, [p(qx - 0.18, qy - 0.18), p(qx + 0.18, qy - 0.18), p(qx + 0.18, qy + 0.18), p(qx - 0.18, qy + 0.18)], z + 3, () => shade(0x8c8a86, qx > 0 ? 1 : 0.6))
    line(c, p(qx - 0.42, qy), p(qx + 0.42, qy), 1, 0x5a5a5a, z + 3)
    line(c, p(qx, qy - 0.42), p(qx, qy + 0.42), 1, 0x5a5a5a, z + 3)
  }
  line(c, p(-0.9, 5.5), p(-0.95, 5.85), 1, 0x9a9a9a, z + 2)
  polygon(c, [p(-1.3, 5.85), p(-0.6, 5.85), p(-0.75, 6.15), p(-1.15, 6.15)], z + 2, () => 0xd8d6d0)
  line(c, p(1.3, 5.3), p(1.55, 6), 1, 0x9a9a9a, z + 2)
  polygon(c, [p(1.2, 6), p(1.9, 6), p(1.8, 6.3), p(1.3, 6.3)], z + 2, () => 0xe2e0da)
  line(c, p(0.3, 5.55), p(0.15, 6.6), 1, 0xb0b0b0, z + 2)

  // The porch outside the hatch, and the ladder down the forward leg.
  line(c, p(-2.02, 3.18), p(-2.9, 3.12), Math.max(1, 0.12 * s), 0xc8c4bc, z + 4)
  line(c, p(-2.9, 3.12), p(-2.9, 3.62), 1, 0xb0aca4, z + 4)
  for (let rung = 0; rung < 9; rung++) {
    const k = (rung + 0.5) / 9
    const [rx, ry] = [-2.35 - 2 * k, 2.55 - 1.95 * k]
    line(c, p(rx - 0.22, ry - 0.18), p(rx + 0.22, ry + 0.18), 1, 0xd8d4cc, z + 5)
  }

  // The south leg, nearest the eye, in front of it all.
  line(c, p(0, 1.6, -2.1), p(0, 0.3, -4.55), strut * 1.4, shade(GOLD, 0.75), z + 30)
  line(c, p(-1.3, 1.5, -2.1), p(0, 0.35, -4.55), strut, shade(0xb0aca4, 0.6), z + 30)
  line(c, p(1.3, 1.5, -2.1), p(0, 0.35, -4.55), strut, shade(0xb0aca4, 0.9), z + 30)
  polygon(c, [p(-0.47, 0.25, -4.6), p(0.47, 0.25, -4.6), p(0.47, 0, -4.6), p(-0.47, 0, -4.6)], z + 30, () => 0xc8c4bc)
  if (!isDown) line(c, p(0, 0, -4.6), p(0, -1.7, -4.6), 1, 0x8a8a86, z + 30)
}

// How someone in a suit stands: walking `stride` through its step (0 to 1,
// both feet down at 0 and 0.5), climbing, or with hands on the flagpole, saluting.
type Gait = 'stand' | 'walk' | 'climb' | 'plant' | 'salute'

// An astronaut at (x, y, d), meters east, up and north of the eye, facing
// `way` (1 east, -1 west): white suit, the backpack behind, gold visor.
function drawWalker(c: Canvas, v: View, x: number, y: number, d: number, way: number, gait: Gait, stride: number) {
  const s = v.f / Math.max(1, ahead(v, x, 1, d))
  const z = -ahead(v, x, 1, d) + 0.5
  const p = (lx: number, ly: number) => {
    const [px, py] = standing(v, x, d, lx * way, y + ly)
    return [px, py] as const
  }
  const thick = Math.max(1.2, 0.17 * s)
  const swing = gait === 'walk' ? Math.sin(stride * 2 * Math.PI) : 0
  const climb = gait === 'climb' ? Math.sin(stride * 2 * Math.PI) : 0
  const limb = (from: readonly [number, number], bend: readonly [number, number], to: readonly [number, number], color: number, nearer: number) => {
    line(c, p(from[0], from[1]), p(bend[0], bend[1]), thick, color, z + nearer)
    line(c, p(bend[0], bend[1]), p(to[0], to[1]), thick, color, z + nearer)
  }
  const SUIT = 0xe8e6e0
  const SHADE = 0xa9a7a1
  // Legs: the far one shaded, the near one lit, each a thigh and a shin to the boot.
  for (const [side, color, nearer] of [[-1, SHADE, 0], [1, SUIT, 0.2]] as const) {
    const phase = side * (gait === 'climb' ? climb : swing)
    const knee: readonly [number, number] = gait === 'climb' ? [0.18 + 0.12 * phase, 0.62 + 0.2 * phase] : [0.22 * phase + 0.06, 0.5]
    const foot: readonly [number, number] = gait === 'climb' ? [0.08, 0.12 + 0.3 * Math.max(0, phase)] : [0.42 * phase, 0.1 + 0.12 * Math.max(0, phase)]
    limb([0, 0.92], knee, foot, color, nearer)
    line(c, p(foot[0] - 0.08, foot[1] - 0.05), p(foot[0] + 0.18, foot[1] - 0.05), thick, 0x7a7e86, z + nearer + 0.05)
  }
  // The backpack behind, the oxygen purge unit on top of it.
  polygon(c, [p(-0.44, 0.98), p(-0.12, 0.98), p(-0.12, 1.74), p(-0.44, 1.74)], z - 0.1, px => (px % 2 === 0 ? 0xdcdad4 : 0xd2d0ca))
  polygon(c, [p(-0.4, 1.74), p(-0.16, 1.74), p(-0.16, 1.86), p(-0.4, 1.86)], z - 0.1, () => 0xc4c2bc)
  // The body, then the helmet, its visor gold.
  polygon(c, [p(-0.15, 0.9), p(0.18, 0.9), p(0.21, 1.5), p(-0.14, 1.52)], z + 0.1, () => SUIT)
  const [hx, hy] = p(0.05, 1.68)
  const helmet = Math.max(1.2, 0.2 * s)
  for (let py = Math.floor(hy - helmet); py <= Math.ceil(hy + helmet); py++) {
    for (let px = Math.floor(hx - helmet); px <= Math.ceil(hx + helmet); px++) {
      const [dx, dy] = [(px + 0.5 - hx) / helmet, (py + 0.5 - hy) / helmet]
      if (dx * dx + dy * dy > 1) continue
      const isVisor = dx * way > -0.1 && dy > -0.55 && dy < 0.55
      put(c, px, py, isVisor ? (dx * way > 0.55 && dy < -0.1 ? 0xffe8a0 : 0xc8922c) : SUIT, z + 0.3)
    }
  }
  // Arms: swinging as it walks, up the rails as it climbs, on the pole as it plants it.
  for (const [side, color, nearer] of [[-1, SHADE, -0.05], [1, SUIT, 0.4]] as const) {
    const elbow: readonly [number, number] =
      gait === 'climb' ? [0.24, 1.6 + 0.1 * side * climb] : gait === 'plant' ? [0.3, 1.32 + 0.08 * side] : gait === 'salute' && side > 0 ? [0.3, 1.45] : [0.1 - 0.12 * side * swing, 1.18]
    const hand: readonly [number, number] =
      gait === 'climb' ? [0.32, 1.85 + 0.12 * side * climb] : gait === 'plant' ? [0.5, 1.45 - 0.1 * side] : gait === 'salute' && side > 0 ? [0.12, 1.66] : [0.18 - 0.22 * side * swing, 0.98]
    limb([0.02, 1.42], elbow, hand, color, nearer)
  }
}

// The flag: its pole pushed `planted` of the way in, its crossbar out
// `unfurled` of the way and the flag hanging from it, rippled.
function drawFlag(c: Canvas, v: View, x: number, d: number, planted: number, unfurled: number) {
  const s = v.f / Math.max(1, ahead(v, x, 1, d))
  const z = -ahead(v, x, 1, d) + 0.4
  const high = 0.35 * (1 - planted)
  const top = 2.25 + high
  const at = (across: number, up: number) => {
    const [px, py] = standing(v, x, d, across, up)
    return [px, py] as const
  }
  line(c, at(0, high - 0.1), at(0, top), Math.max(1, 0.05 * s), 0xd8d4cc, z)
  const wide = 1.52 * Math.max(0.08, unfurled)
  line(c, at(0, top), at(wide, top), 1, 0xd8d4cc, z)
  const [left, upper] = at(0, top)
  const [right, lower] = at(wide, top - 0.91)
  for (let py = Math.max(0, Math.floor(upper) + 1); py <= Math.min(c.height - 1, Math.ceil(lower)); py++) {
    for (let px = Math.max(0, Math.ceil(left)); px <= Math.min(c.width - 1, Math.floor(right)); px++) {
      const fx = (px + 0.5 - left) / Math.max(1, right - left)
      const fy = (py + 0.5 - upper) / Math.max(1, lower - upper)
      // The bottom edge ripples where the crossbar never quite reached out.
      if (fy > 0.92 + 0.08 * Math.sin(fx * 9)) continue
      const isCanton = fx < 0.4 && fy < 7 / 13
      const stripe = Math.floor(fy * 13) % 2 === 0 ? 0xb22234 : 0xf0eeea
      const color = isCanton ? ((px + py) % 2 === 0 && fx > 0.04 && fy > 0.04 ? 0xf0eeea : 0x2e2c6e) : stripe
      put(c, px, py, shade(color, 0.82 + 0.18 * Math.sin(fx * 17 + 1)), z + 0.05)
    }
  }
}

// The surface: Eagle coming down `land` seconds into its landing, or
// `isLongDown`, landed in an earlier turn; the moonwalk `step` seconds in,
// if begun; and the eye pulled `back` from the flag, 0 to 1, once it is up.
function surfaceShot(c: Canvas, land: number, step: number | undefined, isLongDown: boolean, time: number, levels: number, back: number) {
  // Pulled right back, only the view from orbit is left.
  if (back >= RISEN) {
    c.color.set(earthriseOf(c.width, c.height, levels))
    return
  }
  const v = viewOf(c, step !== undefined && step >= CLOSE, Math.min(1, back / RISING))
  const ground = groundOf(c, v)
  c.color.fill(0)
  c.depth.fill(-Infinity)
  for (const star of starsOf()) {
    const far = dot(star.way, v.forward)
    if (far < 0.05) continue
    const px = Math.floor(v.cx + (v.f * dot(star.way, v.right)) / far)
    const py = Math.floor(v.cy - (v.f * dot(star.way, v.up)) / far)
    if (px >= 0 && py >= 0 && px < c.width && py < c.height) c.color[py * c.width + px] = shade(0xf4f6ff, star.bright * 0.8)
  }
  drawEarthAbove(c, v, levels)

  // Eagle's way down: in from the east, slowing, then straight down to touch.
  const k = clamp((land - CUT) / (TOUCHDOWN - CUT), 0, 1)
  const lmX = LM_X + 16 * (1 - ease(k * 1.25)) ** 2
  const lmY = 14 * (1 - k) ** 1.6
  const isDown = land >= TOUCHDOWN
  const isFiring = land < TOUCHDOWN + 0.2

  // The ground, its shadows all to the west.
  const walkers = step === undefined ? [] : moonwalk(step)
  const flagAt = step === undefined ? undefined : flagOf(step)
  const shadows: Shadow[] = [
    { x: lmX, d: LM_D, tall: 6.8 + lmY, wide: 4.3, deep: 2.4 },
    ...walkers.map(w => ({ x: w.x, d: w.d, tall: 1.85 + w.y, wide: 0.5, deep: 0.25 })),
    ...(flagAt ? [{ x: FLAG_X, d: FLAG_D, tall: 2.3, wide: 0.3, deep: 0.15 }] : []),
  ]
  for (let i = 0; i < c.color.length; i++) {
    const [x, d] = [ground.east[i] ?? NaN, ground.north[i] ?? NaN]
    if (Number.isNaN(x)) continue
    c.color[i] = shadows.some(s => isShaded(s, x, d)) ? shade(ground.colors[i] ?? 0, 0.45) : (ground.colors[i] ?? 0)
    c.depth[i] = -1e7
  }

  // The dust the engine blows out along the ground as it nears it.
  if (isFiring && lmY < 9) {
    const strength = (1 - lmY / 9) * (land < TOUCHDOWN ? 1 : 1 - (land - TOUCHDOWN) / 0.2)
    for (let streak = 0; streak < 40; streak++) {
      const lane = LM_D + (hash3(streak, 0, 0, 3) - 0.5) * 6
      const reach = 4 + 14 * hash3(streak, 1, 0, 3)
      const way = hash3(streak, 2, 0, 3) < 0.5 ? -1 : 1
      const run = ((time * 22 + reach * 7) % reach) + 1
      const [ax, ay] = project(v, lmX + way * run, 0, lane)
      const [bx] = project(v, lmX + way * (run + 3), 0, lane)
      for (let sx = Math.min(ax, bx); sx <= Math.max(ax, bx); sx++) {
        const fade = 1 - Math.abs(sx - ax) / Math.max(1, Math.abs(bx - ax))
        blend(c, Math.floor(sx), Math.floor(ay), 0xe0dcd4, 0.55 * strength * fade, Infinity)
        blend(c, Math.floor(sx), Math.floor(ay) - 1, 0xe0dcd4, 0.25 * strength * fade, Infinity)
      }
    }
  }

  drawEagle(c, v, lmX, lmY, step !== undefined && step >= 0.6, isDown || isLongDown)
  if (isFiring && !isLongDown) {
    const [fx, fy] = project(v, lmX, lmY + 0.95, LM_D)
    flame(c, fx, fy, -Math.PI / 2, ((2.5 * v.f) / LM_D) * (land < TOUCHDOWN ? 1 : 0.3), (1.2 * v.f) / LM_D, 0xffd8a0, time, 1000, 0.35)
  }

  // The bootprints Neil leaves.
  if (step !== undefined && step >= STEP) {
    for (let print = 0; print < 12; print++) {
      const at = STEP + print * 0.28
      if (step < at) break
      const w = neilAt(at)
      const [bx, by, bz] = project(v, w.x + (print % 2 === 0 ? 0.12 : -0.12), 0, w.d)
      if (Number.isNaN(bx)) continue
      put(c, Math.floor(bx), Math.floor(by), shade(c.color[Math.floor(by) * c.width + Math.floor(bx)] ?? 0x938e86, 0.62), bz + 0.5)
    }
  }
  if (flagAt) drawFlag(c, v, FLAG_X, FLAG_D, flagAt.planted, flagAt.unfurled)
  for (const w of walkers) drawWalker(c, v, w.x, w.y, w.d, w.way, w.gait, w.stride)

  // Pulled further back, the landing site dissolves into the view from orbit.
  if (back > RISING) {
    const rise = earthriseOf(c.width, c.height, levels)
    const k = ease((back - RISING) / (RISEN - RISING))
    for (let i = 0; i < c.color.length; i++) c.color[i] = mix(c.color[i] ?? 0, rise[i] ?? 0, k)
  }
}

type Walker = { x: number; y: number; d: number; way: number; gait: Gait; stride: number }

// Where Neil is `p` seconds into the moonwalk: out of the hatch onto the
// porch, down the ladder facing it, on the footpad, the step, then across
// to the flag, carrying it, and planting it.
function neilAt(p: number): Walker {
  const ladderTop = { x: LM_X - 2.75, y: 3.15 }
  const ladderFoot = { x: LM_X - 4.45, y: 0.25 }
  if (p < 2.5) {
    const k = ease((p - 1) / 1.5)
    return { x: LM_X - 1.9 + (ladderTop.x - (LM_X - 1.9)) * k, y: ladderTop.y, d: LM_D, way: 1, gait: 'climb', stride: 0 }
  }
  if (p < 5) {
    const k = (p - 2.5) / 2.5
    return { x: ladderTop.x + (ladderFoot.x - ladderTop.x) * k, y: ladderTop.y + (ladderFoot.y - ladderTop.y) * k, d: LM_D, way: 1, gait: 'climb', stride: k * 4 }
  }
  if (p < STEP - 0.3) return { x: ladderFoot.x, y: ladderFoot.y, d: LM_D, way: p < 5.5 ? 1 : -1, gait: 'stand', stride: 0 }
  if (p < STEP + 0.3) {
    const k = ease((p - (STEP - 0.3)) / 0.6)
    return { x: ladderFoot.x - 0.6 * k, y: ladderFoot.y * (1 - k), d: LM_D, way: -1, gait: 'walk', stride: k * 0.5 }
  }
  const spot = { x: FLAG_X + 0.62, d: FLAG_D + 0.3 }
  const from = { x: ladderFoot.x - 0.6, d: LM_D }
  if (p < 9) {
    const k = ease((p - (STEP + 0.3)) / (9 - STEP - 0.3))
    return { x: from.x + (spot.x - from.x) * k, y: 0.08 * Math.abs(Math.sin(p * 7)), d: from.d + (spot.d - from.d) * k, way: -1, gait: 'walk', stride: p * 1.6 }
  }
  return { x: spot.x, y: 0, d: spot.d, way: -1, gait: p < 9.4 ? 'stand' : 'plant', stride: 0 }
}

// Buzz, nineteen minutes behind Neil as it was, here a few seconds: out,
// down, across to the flag's other side, and a salute.
function buzzAt(p: number): Walker | undefined {
  if (p < 7) return undefined
  const ladderTop = { x: LM_X - 2.75, y: 3.15 }
  const ladderFoot = { x: LM_X - 4.45, y: 0.25 }
  if (p < 7.8) return { x: LM_X - 1.9 + (ladderTop.x - (LM_X - 1.9)) * ease((p - 7) / 0.8), y: ladderTop.y, d: LM_D, way: 1, gait: 'climb', stride: 0 }
  if (p < 10) {
    const k = (p - 7.8) / 2.2
    return { x: ladderTop.x + (ladderFoot.x - ladderTop.x) * k, y: ladderTop.y + (ladderFoot.y - ladderTop.y) * k, d: LM_D, way: 1, gait: 'climb', stride: k * 4 }
  }
  const spot = { x: FLAG_X + 2.3, d: FLAG_D + 0.9 }
  if (p < 11.8) {
    const k = ease((p - 10) / 1.8)
    return { x: ladderFoot.x + (spot.x - ladderFoot.x) * k, y: 0.08 * Math.abs(Math.sin(p * 7)) * (k < 1 ? 1 : 0), d: LM_D + (spot.d - LM_D) * k, way: -1, gait: 'walk', stride: p * 1.6 }
  }
  return { x: spot.x, y: 0, d: spot.d, way: -1, gait: p < 12.1 ? 'stand' : 'salute', stride: 0 }
}

const moonwalk = (p: number): Walker[] => {
  const buzz = buzzAt(p)
  return [...(buzz ? [buzz] : []), ...(p >= 1 ? [neilAt(p)] : [])]
}

// The flag, once Neil has it out: carried, pushed in, opened out.
function flagOf(p: number): { planted: number; unfurled: number } | undefined {
  if (p < 9.4) return undefined
  return { planted: ease((p - 9.4) / 0.9), unfurled: ease((p - 10.3) / 0.9) }
}
