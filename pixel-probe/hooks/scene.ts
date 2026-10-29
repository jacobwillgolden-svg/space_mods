import type { View } from '../types'
import { drawApollo } from './apollo'
import { CRAFT, drawCraft } from './craft'
import type { Pose } from './craft'
import { drawText, textWidth } from './font'
import { ARRIVE_SECONDS, LEAVE_SECONDS } from './frame'
import type { Frame, Hand } from './frame'
import { hash3 } from './noise'
import { blend, canvas, dither, glow, mix, put, shade } from './pixels'
import type { Canvas } from './pixels'
import { drawRock } from './rock'
import { SKIES, drawSky } from './sky'
import { chartOf, moonChartOf, turningAt } from './worlds'
import type { Chart, Moon, World } from './worlds'

// A small scene of spheres seen from far off, so straight on: the world in
// the middle, its moons and rings, the probe and the agents' craft, drawn a
// pixel at a time with a dithered terminator as pixel art shades a ball.
// Positions are in the world's radii from its middle, x right, y up, z
// toward the eye; depths on the canvas are in pixels.

type Vec = readonly [number, number, number]

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const times = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k]
const normalize = (a: Vec): Vec => times(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1))
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const easeOut = (t: number) => 1 - (1 - clamp(t, 0, 1)) ** 2

// The sun, from the front left and a little above, as the eye sees it.
const LIGHT: Vec = normalize([-0.62, 0.38, 0.68])
// How much of a world's night side still shows, and what a shadow leaves.
const AMBIENT = 0.04
const SHADOW = 0.08

// How far a world's pole tips toward the eye as no one has turned it.
const TIP = 0.2
// The world's radius as a share of the picture's shorter side, at its usual size.
const WORLD = 0.27
// The probe's size, from its middle to a wing's tip, the same way.
const PROBE = 0.1

// The probe's orbit in the usual modes: how many world radii out, how far it
// opens toward the eye and leans, seconds a lap, and where its charted path begins.
const ORBIT = 1.6
const ORBIT_OPEN = 0.38
const ORBIT_LEAN = 0.22
const ORBIT_SECONDS = 12
const CHART_FROM = Math.PI / 2
// Where the probe keeps station to survey, and how long the beam takes across and back.
const STATION: Vec = [1.3, 1.05, 0.9]
const SWEEP_SECONDS = 3.2

// The world's pole tipped toward the eye, then its axis leaned in the picture.
type Turn = { ct: number; st: number; cr: number; sr: number }

const turnOf = (tip: number, roll: number): Turn => ({ ct: Math.cos(tip), st: Math.sin(tip), cr: Math.cos(roll), sr: Math.sin(roll) })

const toEye = ({ ct, st, cr, sr }: Turn, [x, y, z]: Vec): Vec => {
  const [y1, z1] = [y * ct - z * st, y * st + z * ct]
  return [x * cr - y1 * sr, x * sr + y1 * cr, z1]
}

const fromEye = ({ ct, st, cr, sr }: Turn, [x, y, z]: Vec): Vec => {
  const [x1, y1] = [x * cr + y * sr, -x * sr + y * cr]
  return [x1, y1 * ct + z * st, -y1 * st + z * ct]
}

// A ball that casts a shadow: its middle and radius, in world radii.
type Ball = { at: Vec; r: number }

// What reaches point `p` of the sunlight: none past a ball between it and
// the sun, less through the rings.
function sunlight(p: Vec, balls: readonly Ball[], rings?: { normal: Vec; world: World }): number {
  for (const ball of balls) {
    const w = sub(ball.at, p)
    const along = dot(w, LIGHT)
    if (along > 0 && dot(w, w) - along * along < ball.r * ball.r) return SHADOW
  }
  if (rings === undefined) return 1

  const facing = dot(rings.normal, LIGHT)
  if (Math.abs(facing) < 1e-6) return 1
  const t = -dot(rings.normal, p) / facing
  if (t <= 0) return 1
  const band = bandAt(rings.world, Math.hypot(...add(p, times(LIGHT, t))))
  return band === undefined ? 1 : 1 - band.alpha * 0.7
}

const bandAt = (world: World, radius: number) => world.rings.find(band => radius >= band.from && radius < band.to)

// A world's face looked up by latitude and longitude, nearest texel: the
// chart's own pixels show, as pixel art's do.
function look(chart: Chart, lat: number, lon: number, layer: 'colors' | 'clouds' = 'colors'): number {
  const u = (((lon + Math.PI) / (2 * Math.PI)) % 1 + 1) % 1
  const x = Math.min(chart.width - 1, Math.floor(u * chart.width))
  const y = clamp(Math.floor(((Math.PI / 2 - lat) / Math.PI) * chart.height), 0, chart.height - 1)
  return (layer === 'clouds' ? chart.clouds?.[y * chart.width + x] : chart.colors[y * chart.width + x]) ?? 0
}

// How many texels round a chart is for a ball `radius` pixels across: about
// a texel a pixel at the middle, a power of two, and no finer than `most`,
// past which zooming in shows the chart's own blocks.
const chartWidth = (radius: number, most: number) => clamp(2 ** Math.ceil(Math.log2(Math.max(1, 2 * Math.PI * radius))), 32, most)

// How the survey marks the world: its map's grid over the part made, up to
// screen column `until`, the beam's line at `beam`, in the scene's color.
type Survey = { until: number; beam?: number; grid: number; accent: number }

function drawWorld(c: Canvas, world: World, at: { x: number; y: number; r: number }, turn: Turn, spin: number, time: number, moons: readonly Ball[], levels: number, survey?: Survey) {
  const { x: cx, y: cy, r: R } = at
  const chart = chartOf(world, chartWidth(R, 256))
  const rings = world.rings.length > 0 ? { normal: toEye(turn, [0, 1, 0]), world } : undefined
  // Storms that turn are drawn live, finer than the face's texels.
  const turning = world.storms.filter(storm => storm.turns !== undefined)
  // The grid's lines every thirty degrees, about a pixel wide.
  const step = Math.PI / 6
  const line = 0.6 / Math.max(4, R)

  for (let py = Math.max(0, Math.floor(cy - R)); py <= Math.min(c.height - 1, Math.ceil(cy + R)); py++) {
    for (let px = Math.max(0, Math.floor(cx - R)); px <= Math.min(c.width - 1, Math.ceil(cx + R)); px++) {
      const dx = (px + 0.5 - cx) / R
      const dy = -(py + 0.5 - cy) / R
      const r2 = dx * dx + dy * dy
      if (r2 > 1) continue

      const nz = Math.sqrt(1 - r2)
      const normal: Vec = [dx, dy, nz]
      const [bx, by, bz] = fromEye(turn, normal)
      const lat = Math.asin(clamp(by, -1, 1))
      const lon = Math.atan2(bx, bz) - spin
      let color = look(chart, lat, lon)
      for (const storm of turning) color = turningAt(storm, lat, lon, time, color)
      if (chart.clouds) color = mix(color, 0xf4f6fa, look(chart, lat, lon - spin * 0.25, 'clouds'))
      if (world.atmosphere) color = mix(color, world.atmosphere.color, (1 - nz) ** 2 * world.atmosphere.strength)

      let lit = Math.max(0, dot(normal, LIGHT))
      if (lit > 0) lit *= sunlight(normal, moons, rings)
      const stepped = Math.min(1, Math.floor(lit * levels + dither(px, py)) / levels)
      color = shade(color, AMBIENT + (1 - AMBIENT) * stepped)

      if (survey && px < survey.until) {
        const offLat = Math.abs(lat - Math.round(lat / step) * step)
        const offLon = Math.abs(lon - Math.round(lon / step) * step) * Math.cos(lat)
        color = mix(color, survey.accent, offLat < line || offLon < line ? survey.grid : survey.grid * 0.15)
      }
      if (survey?.beam !== undefined && Math.abs(px + 0.5 - survey.beam) < Math.max(0.6, R * 0.015)) color = mix(color, survey.accent, 0.7)

      put(c, px, py, color, nz * R)
    }
  }
}

// The thin glow of a world's air at its edge, brightest toward the sun.
function drawAir(c: Canvas, world: World, at: { x: number; y: number; r: number }) {
  if (!world.atmosphere) return

  const { x: cx, y: cy, r: R } = at
  const thick = Math.max(1.2, R * 0.07)
  for (let py = Math.floor(cy - R - thick); py <= Math.ceil(cy + R + thick); py++) {
    for (let px = Math.floor(cx - R - thick); px <= Math.ceil(cx + R + thick); px++) {
      const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy)
      if (d <= R || d > R + thick) continue
      const sunward = ((px + 0.5 - cx) * LIGHT[0] - (py + 0.5 - cy) * LIGHT[1]) / d
      const strength = world.atmosphere.strength * (1 - (d - R) / thick) * clamp(sunward + 0.45, 0, 1)
      blend(c, px, py, world.atmosphere.color, strength, 0)
    }
  }
}

// The rings, seen through: dark where the world's shadow falls across them.
function drawRings(c: Canvas, world: World, at: { x: number; y: number; r: number }, turn: Turn) {
  const outer = Math.max(0, ...world.rings.map(band => band.to))
  if (outer === 0) return

  const { x: cx, y: cy, r: R } = at
  const normal = toEye(turn, [0, 1, 0])
  if (Math.abs(normal[2]) < 0.02) return

  const planet: Ball[] = [{ at: [0, 0, 0], r: 1 }]
  for (let py = Math.floor(cy - outer * R); py <= Math.ceil(cy + outer * R); py++) {
    for (let px = Math.floor(cx - outer * R); px <= Math.ceil(cx + outer * R); px++) {
      const dx = (px + 0.5 - cx) / R
      const dy = -(py + 0.5 - cy) / R
      const dz = -(normal[0] * dx + normal[1] * dy) / normal[2]
      const radius = Math.hypot(dx, dy, dz)
      const band = bandAt(world, radius)
      if (band === undefined) continue

      const ringlets = 0.8 + 0.2 * Math.sin(radius * 90)
      const lit = sunlight([dx, dy, dz], planet) < 1 ? 0.18 : 0.95
      blend(c, px, py, shade(band.color, lit), band.alpha * ringlets, dz * R)
    }
  }
}

// A moon, lit and shadowed, the same face always toward its world.
function drawMoon(c: Canvas, moon: Moon, ball: Ball, angle: number, at: { x: number; y: number; r: number }, turn: Turn, balls: readonly Ball[], levels: number) {
  const { x: cx, y: cy, r: R } = at
  const [sx, sy] = [cx + ball.at[0] * R, cy - ball.at[1] * R]
  const others = balls.filter(other => other !== ball)
  const radius = ball.r * R
  if (radius < 0.9) {
    put(c, Math.floor(sx), Math.floor(sy), shade(moon.color, 0.35 + 0.65 * (sunlight(ball.at, others) < 1 ? 0 : 1)), ball.at[2] * R)
    return
  }

  const chart = moonChartOf(moon, chartWidth(radius, 64))
  for (let py = Math.floor(sy - radius); py <= Math.ceil(sy + radius); py++) {
    for (let px = Math.floor(sx - radius); px <= Math.ceil(sx + radius); px++) {
      const dx = (px + 0.5 - sx) / radius
      const dy = -(py + 0.5 - sy) / radius
      const r2 = dx * dx + dy * dy
      if (r2 > 1) continue

      const nz = Math.sqrt(1 - r2)
      const normal: Vec = [dx, dy, nz]
      const [bx, by, bz] = fromEye(turn, normal)
      let lit = Math.max(0, dot(normal, LIGHT))
      if (lit > 0) lit *= sunlight(add(ball.at, times(normal, ball.r)), others)
      const stepped = Math.min(1, Math.floor(lit * levels + dither(px, py)) / levels)
      const color = look(chart, Math.asin(clamp(by, -1, 1)), Math.atan2(bx, bz) - angle)
      put(c, px, py, shade(color, AMBIENT + (1 - AMBIENT) * stepped), (ball.at[2] + nz * ball.r) * R)
    }
  }
}

// A point on a circle `a` world radii round, `angle` along it, the circle
// opened `open` radians toward the eye (its near side low) and leaned `lean`
// in the picture.
function orbitAt(a: number, angle: number, open: number, lean: number): Vec {
  const [x0, y0, z] = [a * Math.cos(angle), -a * Math.sin(angle) * Math.sin(open), a * Math.sin(angle) * Math.cos(open)]
  return [x0 * Math.cos(lean) - y0 * Math.sin(lean), x0 * Math.sin(lean) + y0 * Math.cos(lean), z]
}

// The usual view, as no one has turned or zoomed it.
export const USUAL_VIEW: View = { spin: 0, tip: 0, zoom: 1, pan: [0, 0] }

// How far the person may tip the world, down or up, from the usual, and how
// far or near they may zoom; a drag across the whole picture spins the world
// this far round, one down it tips this far, each tick of the wheel zooms
// this many times.
const TIP_LEAST = -0.5
const TIP_MOST = 0.9
const ZOOM_LEAST = 0.6
const ZOOM_MOST = 4
const SPIN_ACROSS = 3
const TIP_DOWN = 1.2
const WHEEL = 1.15

// `from` turned by a drag `across` and `down` its picture, in fractions of
// it, as if the world were grabbed: a drag right brings its near side right,
// one down shows it more from above.
export function turned(from: View, across: number, down: number): View {
  return { ...from, spin: from.spin + across * SPIN_ACROSS, tip: clamp(from.tip + down * TIP_DOWN, TIP_LEAST, TIP_MOST) }
}

// `from` zoomed `ticks` of the wheel, nearer for negative ones as the wheel
// rolled up, about the point `at` in the picture, its fractions off the
// middle rightward and upward, so what is under the pointer stays there;
// never looking past the edges of the usual view.
export function zoomed(from: View, ticks: number, at: readonly [number, number] = [0, 0]): View {
  const zoom = clamp(from.zoom * WHEEL ** -ticks, ZOOM_LEAST, ZOOM_MOST)
  const room = Math.max(0, (1 - 1 / zoom) / 2)
  const pan = (i: 0 | 1) => clamp((from.pan[i] ?? 0) + (at[i] ?? 0) * (1 / from.zoom - 1 / zoom), -room, room)

  return { ...from, zoom, pan: [pan(0), pan(1)] }
}

// The frame `width` by `height` pixels, over its sky, or over one flat
// `backdrop` color, as the wallpaper tool (tools/wallpaper.py) asks for.
export function drawScene(frame: Frame, width: number, height = width, backdrop?: number): Canvas {
  const c = canvas(width, height)
  const sky = SKIES[frame.scene]
  if (backdrop === undefined) drawSky(c, sky, frame.time)
  else c.color.fill(backdrop)

  const view = frame.view ?? USUAL_VIEW
  const { zoom } = view
  const unit = Math.min(width, height)
  // Finer shading, and names, where the picture has the pixels for them.
  const levels = unit >= 200 ? 7 : 4
  // Apollo 11 is a film of its own, framed shot by shot; the person's view
  // turns the eye on the Moon once the flag is up.
  if (frame.mission) {
    drawApollo(c, frame.mission, frame.time, levels, frame.view)
    return c
  }
  const place = (x: number, y: number): [number, number] => [
    width / 2 + (x - width / 2 - view.pan[0] * width) * zoom,
    height / 2 + (y - height / 2 + view.pan[1] * height) * zoom,
  ]

  const { world, scene, target } = frame
  const isMining = scene === 'asteroid'
  const [wx, wy] = place(isMining ? width * 0.3 : width / 2, isMining ? height * 0.66 : height / 2)
  const R = WORLD * unit * world.size * (isMining ? 0.62 : 1) * zoom
  const at = { x: wx, y: wy, r: R }
  const turn = turnOf(TIP + world.tip + view.tip, world.roll)
  const spin = (2 * Math.PI * frame.time) / world.day + view.spin
  const screen = (p: Vec): [number, number] => [wx + p[0] * R, wy - p[1] * R]

  const moons = world.moons.map(moon => {
    const angle = moon.phase + (2 * Math.PI * frame.time) / moon.period + view.spin
    const ball: Ball = { at: toEye(turn, [moon.orbit * Math.sin(angle), 0, moon.orbit * Math.cos(angle)]), r: moon.size }
    return { moon, angle, ball }
  })
  const balls = moons.map(m => m.ball)
  const planet: Ball = { at: [0, 0, 0], r: 1 }
  const shineAt = (p: Vec) => (sunlight(p, [planet]) < 1 ? 0.35 : 1)

  const size = Math.max(3, PROBE * unit * zoom)
  const arrival = target.kind === 'whole' ? target.arrival : 1
  const isWhole = target.kind === 'whole'
  const ending = target.kind === 'ending' ? target.t : undefined

  // The probe: round its orbit, at its station, or beside the asteroid.
  const open = clamp(ORBIT_OPEN + view.tip * 0.8, 0.05, 1.3)
  const probeAngle = CHART_FROM + (2 * Math.PI * frame.time) / ORBIT_SECONDS
  const bob = 0.05 * Math.sin(frame.time * 1.6)
  const [rx, ry] = place(width * 0.68, height * 0.4)
  const rockRadius = 0.17 * unit * frame.rock.size * zoom
  const rockX = isWhole ? rx + (width + rockRadius * 2 - rx) * (1 - easeOut(arrival)) : rx
  const probe: { p: Vec; x: number; y: number; z: number } = (() => {
    if (scene === 'orbit') {
      const p = orbitAt(ORBIT, probeAngle, open, ORBIT_LEAN)
      return { p, x: screen(p)[0], y: screen(p)[1], z: p[2] * R }
    }
    if (scene === 'survey') {
      const p: Vec = [STATION[0], STATION[1] + bob, STATION[2]]
      return { p, x: screen(p)[0], y: screen(p)[1], z: p[2] * R }
    }
    const [x, y] = [rx - 0.33 * unit * zoom, ry - 0.16 * unit * zoom + bob * size]
    return { p: [(x - wx) / R, (wy - y) / R, 3], x, y, z: 3 * R }
  })()
  const forward = scene === 'orbit' ? sub(orbitAt(ORBIT, probeAngle + 0.05, open, ORBIT_LEAN), probe.p) : ([1, 0, 0] as Vec)
  const claude: Pose = {
    x: probe.x,
    y: probe.y,
    z: probe.z,
    size,
    spin: frame.time * 1.5,
    shine: shineAt(probe.p),
    ...(frame.working ? { thrust: { dx: -forward[0], dy: forward[1], power: scene === 'orbit' ? 1 : 0.4 } } : {}),
  }

  drawWorld(c, world, at, turn, spin, frame.time, balls, levels, surveyOf(frame, at, sky.accent))
  for (const { moon, angle, ball } of moons) drawMoon(c, moon, ball, angle, at, turn, [planet, ...balls], levels)

  const rock = { x: rockX, y: ry, z: 2 * R, radius: rockRadius, turn: frame.clock * 0.3, light: LIGHT }
  if (isMining && target.kind !== 'gone') {
    drawRock(c, frame.rock, rock, ending === undefined ? { stage: frame.stage } : { t: ending, stage: 9 }, levels)
  }

  const crew = frame.crew.map((hand, i) => crewPose(frame, hand, i, { world: at, rock, size: size * 0.72, width, height, open, screen, shineAt }))
  for (const [i, pose] of crew.entries()) drawCraft(c, CRAFT[frame.crew[i]?.craft ?? 1] ?? CRAFT[1]!, pose, frame.time)
  drawCraft(c, CRAFT[frame.craft] ?? CRAFT[0]!, claude, frame.time)

  drawAir(c, world, at)
  drawRings(c, world, at, turn)

  if (scene === 'orbit' && target.kind !== 'gone') {
    drawChart(c, frame, { open, R, screen, accent: sky.accent, alpha: arrival, size })
    if (ending !== undefined) signal(c, claude, ending, sky.accent)
  }
  if (scene === 'survey' && isWhole && frame.working) beam(c, claude, at, frame.clock, sky.accent, arrival)
  if (scene === 'survey' && ending !== undefined) ping(c, at, ending, sky.accent)
  if (isMining && isWhole && arrival >= 1) {
    if (frame.working) laser(c, claude, rock, frame.time, sky.accent, 1)
    for (const [i, pose] of crew.entries()) {
      const hand = frame.crew[i]
      if (hand && hand.left === undefined && hand.age >= ARRIVE_SECONDS) laser(c, pose, rock, frame.time + i, sky.accent, 0.5)
    }
  }

  if (frame.isLabeled && unit >= 128) {
    const scale = unit >= 320 ? 2 : 1
    const tag = (name: string, pose: Pose) =>
      drawText(c, name, Math.round(pose.x - textWidth(name, scale) / 2), Math.round(pose.y - pose.size * 0.8 - 7 * scale), 0xe8e8f0, scale)
    for (const [i, pose] of crew.entries()) if ((pose.fade ?? 1) > 0.5) tag(frame.crew[i]?.name ?? '', pose)
    tag(CRAFT[frame.craft]?.name ?? '', claude)
  }

  return c
}

// The survey's marks on the world as this frame has them: the map's grid
// over as much of the disc as is surveyed, and the beam's line while Claude
// works; once done, the whole map flashing and fading.
function surveyOf(frame: Frame, at: { x: number; r: number }, accent: number): Survey | undefined {
  if (frame.scene !== 'survey' || frame.target.kind === 'gone') return undefined

  if (frame.target.kind === 'ending') {
    return { until: Infinity, grid: 0.25 + 0.5 * Math.max(0, 1 - frame.target.t / 1.4), accent }
  }
  const sweep = at.x + at.r * 0.98 * Math.sin((2 * Math.PI * frame.clock) / SWEEP_SECONDS)
  return {
    until: at.x - at.r + 2 * at.r * (frame.stage / 10),
    grid: 0.45 * frame.target.arrival,
    accent,
    ...(frame.working && frame.target.arrival >= 1 ? { beam: sweep } : {}),
  }
}

// The orbit charted so far, a dotted path: bright as far as Claude has got,
// faint beyond; whole and pulsing once Claude stops. Hidden behind the world.
function drawChart(c: Canvas, frame: Frame, how: { open: number; R: number; screen: (p: Vec) => [number, number]; accent: number; alpha: number; size: number }) {
  const { open, R, screen, accent, alpha } = how
  const charted = frame.target.kind === 'whole' ? frame.stage / 10 : 1
  const pulse = frame.target.kind === 'ending' ? 0.6 + 0.4 * Math.cos(frame.target.t * 8) : 1
  const dots = Math.max(24, Math.round((2 * Math.PI * ORBIT * R) / 3))

  for (let k = 0; k < dots; k++) {
    const p = orbitAt(ORBIT, CHART_FROM + (2 * Math.PI * k) / dots, open, ORBIT_LEAN)
    const [x, y] = screen(p)
    const isCharted = k / dots < charted
    blend(c, Math.floor(x), Math.floor(y), accent, (isCharted ? 0.9 * pulse : 0.22) * alpha, p[2] * R)
  }
}

// Rings of signal going out from the probe as the orbit closes: news sent home.
function signal(c: Canvas, from: Pose, t: number, accent: number) {
  for (let k = 0; k < 3; k++) {
    const s = t - k * 0.3
    if (s <= 0 || s >= 1.2) continue
    circle(c, from.x, from.y, from.size * (1 + s * 5), accent, (1 - s / 1.2) * 0.8)
  }
}

// The survey's ping as the map is done, a ring going out from the world.
function ping(c: Canvas, at: { x: number; y: number; r: number }, t: number, accent: number) {
  if (t >= 1.4) return
  circle(c, at.x, at.y, at.r * (1.05 + t * 1.2), accent, (1 - t / 1.4) * 0.7)
}

function circle(c: Canvas, x: number, y: number, radius: number, color: number, strength: number) {
  const steps = Math.max(24, Math.ceil(2 * Math.PI * radius))
  for (let k = 0; k < steps; k++) {
    const angle = (2 * Math.PI * k) / steps
    glow(c, Math.floor(x + Math.cos(angle) * radius), Math.floor(y + Math.sin(angle) * radius), color, strength)
  }
}

// The survey's beam, a fan of light from the probe to a line across the
// world that sweeps back and forth.
function beam(c: Canvas, from: Pose, at: { x: number; y: number; r: number }, clock: number, accent: number, alpha: number) {
  const sweep = at.x + at.r * 0.98 * Math.sin((2 * Math.PI * clock) / SWEEP_SECONDS)
  const half = Math.sqrt(Math.max(0, at.r * at.r - (sweep - at.x) ** 2))
  const corners: readonly (readonly [number, number])[] = [[from.x, from.y], [sweep, at.y - half], [sweep, at.y + half]]
  const [a, b, d] = corners as [readonly [number, number], readonly [number, number], readonly [number, number]]
  const area = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0])
  if (Math.abs(area) < 1) return

  for (let py = Math.floor(Math.min(a[1], b[1], d[1])); py <= Math.ceil(Math.max(a[1], b[1], d[1])); py++) {
    for (let px = Math.floor(Math.min(a[0], b[0], d[0])); px <= Math.ceil(Math.max(a[0], b[0], d[0])); px++) {
      const [x, y] = [px + 0.5, py + 0.5]
      const wa = ((b[0] - x) * (d[1] - y) - (b[1] - y) * (d[0] - x)) / area
      const wb = ((d[0] - x) * (a[1] - y) - (d[1] - y) * (a[0] - x)) / area
      if (wa < 0 || wb < 0 || wa + wb > 1) continue
      glow(c, px, py, accent, 0.14 * alpha)
    }
  }
}

// A laser from a craft to the rock's near side, flickering, sparks where it lands.
function laser(c: Canvas, from: Pose, rock: { x: number; y: number; radius: number }, time: number, accent: number, strength: number) {
  const [dx, dy] = [from.x - rock.x, from.y - rock.y]
  const far = Math.hypot(dx, dy) || 1
  const [hitX, hitY] = [rock.x + (dx / far) * rock.radius * 0.8, rock.y + (dy / far) * rock.radius * 0.8]
  const flicker = (0.7 + 0.3 * Math.sin(time * 25)) * strength
  const steps = Math.ceil(Math.hypot(hitX - from.x, hitY - from.y) * 2)
  for (let s = 0; s <= steps; s++) {
    const t = s / Math.max(1, steps)
    glow(c, Math.floor(from.x + (hitX - from.x) * t), Math.floor(from.y + (hitY - from.y) * t), accent, flicker)
  }

  const flash = Math.floor(time * 10)
  for (let k = 0; k < 6; k++) {
    const angle = Math.atan2(dy, dx) + (hash3(flash, k, 0, 1) - 0.5) * 2.4
    const r = rock.radius * (0.1 + 0.4 * hash3(flash, k, 1, 1))
    glow(c, Math.floor(hitX + Math.cos(angle) * r), Math.floor(hitY + Math.sin(angle) * r), 0xfff0a0, strength)
  }
}

// Where agent `hand`, the `i`th to arrive, flies: an orbit of its own round
// the world, or round the asteroid while the probe mines; flying in when it
// arrives, and off, fading, once its agent finishes.
function crewPose(
  frame: Frame,
  hand: Hand,
  i: number,
  how: {
    world: { x: number; y: number; r: number }
    rock: { x: number; y: number; z: number; radius: number }
    size: number
    width: number
    height: number
    open: number
    screen: (p: Vec) => [number, number]
    shineAt: (p: Vec) => number
  },
): Pose {
  const { world, rock, size, width, height } = how
  const luck = hash3(hand.id.length, [...hand.id].reduce((sum, ch) => sum * 31 + ch.charCodeAt(0), 7) | 0, 0, 5)
  const angle = luck * 2 * Math.PI + (2 * Math.PI * frame.time) / (14 + 4 * (i % 3))

  let x: number
  let y: number
  let z: number
  let shine = 1
  if (frame.scene === 'asteroid' && frame.target.kind !== 'gone') {
    const a = rock.radius * (2.1 + 0.35 * (i % 3))
    x = rock.x + Math.cos(angle) * a
    y = rock.y - Math.sin(angle) * a * 0.55
    z = rock.z + Math.sin(angle) * rock.radius
  } else {
    const p = orbitAt(1.95 + 0.35 * (i % 4), angle, clamp(how.open - 0.1 + 0.15 * (i % 3), 0.05, 1.3), -0.55 + 0.4 * (i % 4))
    ;[x, y] = how.screen(p)
    z = p[2] * world.r
    shine = how.shineAt(p)
  }

  // Flying in from beyond one side of the picture.
  if (hand.age < ARRIVE_SECONDS) {
    const t = easeOut(hand.age / ARRIVE_SECONDS)
    const [fromX, fromY] = [luck < 0.5 ? -size * 3 : width + size * 3, height * (0.2 + 0.6 * luck)]
    x = fromX + (x - fromX) * t
    y = fromY + (y - fromY) * t
  }
  // Off and away from the middle, faster and fainter as it goes.
  if (hand.left !== undefined) {
    const [ax, ay] = [x - world.x, y - world.y]
    const far = Math.hypot(ax, ay) || 1
    const gone = hand.left ** 2 * Math.min(width, height) * 0.35
    x += (ax / far) * gone
    y += (ay / far) * gone
    return { x, y, z, size, spin: frame.time * 2 + luck * 6, shine, fade: Math.max(0, 1 - hand.left / LEAVE_SECONDS), thrust: { dx: -ax, dy: -ay, power: 1 } }
  }

  return { x, y, z, size, spin: frame.time * 2 + luck * 6, shine }
}
