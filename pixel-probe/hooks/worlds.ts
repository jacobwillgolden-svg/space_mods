import type { Effort, WorldName } from '../types'
import { fbm3, noise3, random, smooth } from './noise'
import { mix, shade } from './pixels'

// The worlds the probe visits, drawn from noise on the sphere: no picture of
// any of them is used, only their colors and the shapes of their weather.

// How a world's face is made: a gas giant's bands, a rocky world's ground and
// craters, an ocean world's seas, land and clouds, a dwarf's ices.
export type Surface = 'gas' | 'rock' | 'ocean' | 'dwarf'

// A storm on a gas giant, an oval of `across` by `tall` radians, its color
// fading to `rim` at the edge; `lat` and `lon` in radians. One that `turns`
// (Jupiter's Great Red Spot), seconds a turn, is drawn live as it turns
// rather than laid in the world's face.
export type Storm = { lat: number; lon: number; across: number; tall: number; color: number; rim: number; turns?: number }

// One band of a ring system, from and to so many of the world's radii.
export type Ring = { from: number; to: number; color: number; alpha: number }

// A moon: its color, its radius as a share of the world's, how many world
// radii out it goes round, seconds a lap (negative goes the other way), where
// it starts, and what its face is.
export type Moon = {
  name: string
  color: number
  size: number
  orbit: number
  period: number
  phase: number
  surface: 'rock' | 'ice' | 'sulfur' | 'haze'
}

export type World = {
  name: WorldName
  // As the name line says it, and its color there.
  title: string
  color: string
  surface: Surface
  // A gas giant's bands from north to south; else its ground: base, light, dark.
  colors: readonly number[]
  storms: readonly Storm[]
  // Its radius as a share of the usual, how far its axis leans in the picture,
  // how much further its orbits open toward the eye, and seconds a day.
  size: number
  roll: number
  tip: number
  day: number
  // Latitude, in radians, poleward of which it is capped with ice.
  caps?: number
  atmosphere?: { color: number; strength: number }
  rings: readonly Ring[]
  moons: readonly Moon[]
  seed: number
}

const deg = (d: number) => (d * Math.PI) / 180

export const WORLDS: Record<WorldName, World> = {
  moon: {
    name: 'moon',
    title: 'the Moon',
    color: '#c8c8c8',
    surface: 'rock',
    colors: [0xa9a6a0, 0xc9c6bf, 0x5f5e5b],
    storms: [],
    size: 0.72,
    roll: -0.03,
    tip: 0,
    day: 120,
    rings: [],
    moons: [],
    seed: 11,
  },
  mars: {
    name: 'mars',
    title: 'Mars',
    color: '#d0603a',
    surface: 'rock',
    colors: [0xb4532c, 0xcf7a4c, 0x6e3420],
    storms: [],
    size: 0.78,
    roll: -0.3,
    tip: 0,
    day: 42,
    caps: deg(74),
    atmosphere: { color: 0xe6a07a, strength: 0.25 },
    rings: [],
    moons: [
      { name: 'Phobos', color: 0x6b5d52, size: 0.09, orbit: 1.7, period: 7, phase: 0.4, surface: 'rock' },
      { name: 'Deimos', color: 0x8c7d6c, size: 0.07, orbit: 2.5, period: 15, phase: 3.1, surface: 'rock' },
    ],
    seed: 23,
  },
  earth: {
    name: 'earth',
    title: 'Earth',
    color: '#5fa8e8',
    surface: 'ocean',
    colors: [0x1b3f8f, 0x2f6fbf, 0x3f7f3a],
    storms: [],
    size: 0.84,
    roll: -0.41,
    tip: 0,
    day: 40,
    caps: deg(70),
    atmosphere: { color: 0x7fb4ff, strength: 0.6 },
    rings: [],
    moons: [{ name: 'Moon', color: 0xb5b2ab, size: 0.27, orbit: 3.1, period: 34, phase: 2.2, surface: 'rock' }],
    seed: 37,
  },
  saturn: {
    name: 'saturn',
    title: 'Saturn',
    color: '#e3d3a6',
    surface: 'gas',
    colors: [0x8f9a8c, 0xb9b08a, 0xd6c596, 0xe3d3a6, 0xcdb784, 0xe8daaf, 0xdcc794, 0xe4d2a2, 0xc9b17e, 0xd8c596, 0xbcae88, 0x9a9a84],
    storms: [],
    size: 0.7,
    roll: -0.42,
    tip: 0.3,
    day: 26,
    atmosphere: { color: 0xf0dfae, strength: 0.25 },
    rings: [
      { from: 1.24, to: 1.52, color: 0x8a7c66, alpha: 0.35 },
      { from: 1.52, to: 1.95, color: 0xe4d6b6, alpha: 0.9 },
      { from: 2.03, to: 2.2, color: 0xc4b596, alpha: 0.7 },
      { from: 2.22, to: 2.27, color: 0xb8aa8c, alpha: 0.55 },
    ],
    moons: [
      { name: 'Enceladus', color: 0xf2f2ee, size: 0.06, orbit: 2.6, period: 11, phase: 1.2, surface: 'ice' },
      { name: 'Titan', color: 0xd8963c, size: 0.12, orbit: 3.3, period: 26, phase: 4.0, surface: 'haze' },
    ],
    seed: 41,
  },
  jupiter: {
    name: 'jupiter',
    title: 'Jupiter',
    color: '#d9a066',
    surface: 'gas',
    colors: [
      0x7d8790, 0xa49a8a, 0xcbbca3, 0xa3825f, 0xe8decc, 0x9a6845, 0xc49a6c, 0xf0e8d8, 0xe2d2b8,
      0xa86e48, 0x8f5d3e, 0xe6d8c2, 0xb49a7a, 0xd2c3aa, 0x9aa0a4, 0x7d8790,
    ],
    storms: [
      // The Great Red Spot, 16,000 km by 11,000 at 22° south, turning counterclockwise.
      { lat: deg(-22), lon: 1.1, across: 0.24, tall: 0.165, color: 0xc0583a, rim: 0xe9c9a2, turns: 40 },
      { lat: deg(-33), lon: -0.6, across: 0.09, tall: 0.05, color: 0xf4f0e8, rim: 0xcbb69a },
      { lat: deg(-36), lon: 2.6, across: 0.07, tall: 0.04, color: 0xf4f0e8, rim: 0xcbb69a },
      { lat: deg(18), lon: -2.0, across: 0.08, tall: 0.04, color: 0x6e4a36, rim: 0xb08a68 },
    ],
    size: 1,
    roll: -0.05,
    tip: 0,
    day: 24,
    atmosphere: { color: 0xe8d8c0, strength: 0.2 },
    rings: [],
    moons: [
      { name: 'Io', color: 0xdcc65a, size: 0.085, orbit: 1.75, period: 9, phase: 0.3, surface: 'sulfur' },
      { name: 'Europa', color: 0xddd3c2, size: 0.075, orbit: 2.25, period: 14, phase: 2.4, surface: 'ice' },
      { name: 'Ganymede', color: 0x9a8f80, size: 0.11, orbit: 2.85, period: 22, phase: 4.4, surface: 'rock' },
      { name: 'Callisto', color: 0x625950, size: 0.1, orbit: 3.5, period: 36, phase: 5.6, surface: 'rock' },
    ],
    seed: 53,
  },
  neptune: {
    name: 'neptune',
    title: 'Neptune',
    color: '#5b7cf0',
    surface: 'gas',
    colors: [0x2b45a6, 0x3352c4, 0x3a5fd2, 0x3f66da, 0x3658c8, 0x3c63d6, 0x2f4db8, 0x3a5fd2, 0x2b45a6],
    storms: [
      { lat: deg(-22), lon: 0.6, across: 0.22, tall: 0.1, color: 0x17246a, rim: 0x3352c4 },
      { lat: deg(-14), lon: 0.95, across: 0.1, tall: 0.03, color: 0xe8f0ff, rim: 0x6f8fe8 },
    ],
    size: 0.84,
    roll: -0.4,
    tip: 0,
    day: 30,
    atmosphere: { color: 0x8fb8ff, strength: 0.55 },
    rings: [],
    moons: [{ name: 'Triton', color: 0xd9c9c0, size: 0.18, orbit: 2.7, period: -20, phase: 1.0, surface: 'ice' }],
    seed: 67,
  },
  pluto: {
    name: 'pluto',
    title: 'Pluto',
    color: '#e0c4a0',
    surface: 'dwarf',
    colors: [0xc49f78, 0xe6d4bc, 0x6a3626],
    storms: [],
    size: 0.62,
    roll: 0.2,
    tip: 0,
    day: 90,
    atmosphere: { color: 0x9fb0d8, strength: 0.15 },
    rings: [],
    moons: [{ name: 'Charon', color: 0x9b958e, size: 0.5, orbit: 2.5, period: 24, phase: 3.6, surface: 'rock' }],
    seed: 79,
  },
}

// The world each effort level visits: the harder Claude thinks, the bigger
// the world, up to Jupiter at max.
const BY_EFFORT: Record<Effort, WorldName> = {
  low: 'moon',
  medium: 'mars',
  high: 'earth',
  xhigh: 'saturn',
  max: 'jupiter',
  custom: 'neptune',
  none: 'pluto',
}

export const worldFor = (effort: Effort | null): WorldName => BY_EFFORT[effort ?? 'none']

// A world's face laid flat, longitude across from -π and latitude down from
// the north pole, its clouds' cover where it has any, and where its ground
// slopes (east, then north, a pair a texel) for the light to catch: made once
// for each size it is drawn at, then only looked up.
export type Chart = { width: number; height: number; colors: Uint32Array; clouds?: Float32Array; bumps?: Float32Array }

const charts = new Map<string, Chart>()

export function chartOf(world: World, width: number): Chart {
  const key = `${world.name}:${width}`
  const known = charts.get(key)
  if (known) return known

  const made = lay(width, (p, lat, lon) => worldTexel(world, p, lat, lon), world.surface === 'ocean' ? p => cloudsAt(world, p) : undefined)
  charts.set(key, made)
  return made
}

export function moonChartOf(moon: Moon, width: number): Chart {
  const key = `moon:${moon.name}:${width}`
  const known = charts.get(key)
  if (known) return known

  const made = lay(width, (p, lat, lon) => moonTexel(moon, p, lat, lon))
  charts.set(key, made)
  return made
}

type Point = readonly [number, number, number]

function lay(width: number, texel: (p: Point, lat: number, lon: number) => number, cover?: (p: Point) => number): Chart {
  const height = Math.max(2, width >> 1)
  const colors = new Uint32Array(width * height)
  const clouds = cover ? new Float32Array(width * height) : undefined

  for (let y = 0; y < height; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / height) * Math.PI
    for (let x = 0; x < width; x++) {
      const lon = ((x + 0.5) / width) * 2 * Math.PI - Math.PI
      const p: Point = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)]
      colors[y * width + x] = texel(p, lat, lon)
      if (clouds && cover) clouds[y * width + x] = cover(p)
    }
  }

  return { width, height, colors, ...(clouds ? { clouds } : {}) }
}

// The angle from `lon` to `to`, the short way round.
const apart = (lon: number, to: number) => {
  const d = (lon - to) % (2 * Math.PI)
  return d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d
}

function worldTexel(world: World, p: Point, lat: number, lon: number): number {
  switch (world.surface) {
    case 'gas':
      return gasAt(world, p, lat, lon)
    case 'ocean':
      return oceanAt(world, p, lat)
    case 'rock':
      return rockAt(world.colors, world.seed, p, lat, world.caps)
    case 'dwarf':
      return dwarfAt(world, p, lat, lon)
  }
}

// Bands that waver where they meet, streaked along the latitudes, with storms.
function gasAt(world: World, [x, y, z]: Point, lat: number, lon: number): number {
  const { colors, seed } = world
  const swirl = fbm3(x * 2.5, y * 9, z * 2.5, seed, 3) - 0.5
  const eddy = fbm3(x * 7, y * 22, z * 7, seed + 1, 2) - 0.5
  const wavered = lat + 0.09 * swirl + 0.03 * eddy
  const along = ((1 - Math.sin(wavered)) / 2) * (colors.length - 1)
  const i = Math.max(0, Math.min(colors.length - 2, Math.floor(along)))
  let color = mix(colors[i] ?? 0, colors[i + 1] ?? 0, smooth(0.25, 0.75, along - i))
  color = shade(color, 0.93 + 0.14 * noise3(x * 12, y * 30, z * 12, seed + 2))

  for (const storm of world.storms) {
    if (storm.turns !== undefined) continue
    const across = (apart(lon, storm.lon) * Math.cos(lat)) / storm.across
    const tall = (lat - storm.lat) / storm.tall
    const d = Math.hypot(across, tall) + 0.15 * eddy
    if (d < 1) color = mix(storm.color, storm.rim, smooth(0.45, 1, d))
    else if (d < 1.35) color = mix(storm.rim, color, smooth(1, 1.35, d))
  }

  return color
}

// A storm that turns, over `color` at (lat, lon) `time` seconds in: the
// Great Red Spot, an anticyclone, so turning counterclockwise in the south,
// its clouds wound in two arms round a calmer, deeper red heart; a pale
// collar round it, the Red Spot Hollow; and the turbulent wake it trails
// to the west, white eddies torn through the brown belt to its north.
export function turningAt(storm: Storm, lat: number, lon: number, time: number, color: number): number {
  const across = (apart(lon, storm.lon) * Math.cos(lat)) / storm.across
  const tall = (lat - storm.lat) / storm.tall
  if (across > 1.6 || across < -3.6 || tall > 2.2 || tall < -1.6) return color

  const d = Math.hypot(across, tall)
  const turned = Math.atan2(tall, across) - (2 * Math.PI * time) / (storm.turns ?? Infinity)
  if (d < 1) {
    // The arms wind tighter toward the heart, and fade into it.
    const arm = 0.5 + 0.5 * Math.sin(2 * turned + 7.5 * d)
    const wound = smooth(0.15, 0.55, d) * (1 - smooth(0.85, 1, d))
    let spot = mix(shade(storm.color, 0.82), storm.color, smooth(0.1, 0.6, d))
    spot = mix(spot, mix(shade(storm.color, 0.72), mix(storm.color, storm.rim, 0.55), arm), wound * 0.85)
    return mix(spot, storm.rim, smooth(0.78, 1, d) * 0.75)
  }
  if (d < 1.45) {
    // The collar's own streaks run round it with the wind.
    const streak = 0.5 + 0.5 * Math.sin(3 * turned + 11 * d)
    const collar = mix(storm.rim, 0xf6efe2, streak * 0.5)
    return mix(collar, color, smooth(1.1, 1.45, d))
  }
  // The wake: west of the spot and up into the belt, fading the further it trails.
  if (across > -0.6 || tall < -0.5) return color
  const trail = smooth(-3.6, -1.2, across) * smooth(-0.5, 0.2, tall) * (1 - smooth(1.2, 2.2, tall))
  const [x, y, z] = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)]
  // Streaked along the latitudes, as the winds shear them.
  const eddy = fbm3(x * 9 + time * 0.01, y * 46, z * 9, 977, 3)
  return mix(color, eddy > 0.57 ? 0xf2e8d6 : eddy < 0.4 ? 0x86563a : color, trail * 0.7)
}

// Seas shading to shallows at the coasts, land green, dry or cold by
// latitude, and ice at the poles. The clouds are a layer of their own.
function oceanAt(world: World, [x, y, z]: Point, lat: number): number {
  const [deep = 0, shallow = 0, green = 0] = world.colors
  const { seed } = world
  const land = fbm3(x * 1.8, y * 1.8, z * 1.8, seed, 4)
  const wet = fbm3(x * 4, y * 4, z * 4, seed + 3, 2)
  const north = Math.abs(lat)
  const ice = (world.caps ?? Math.PI) + 0.12 * (wet - 0.5)
  if (north > ice) return 0xeef3f8

  if (land < 0.53) return mix(deep, shallow, smooth(0.44, 0.53, land))
  const dry = north > 0.2 && north < 0.6 && wet < 0.5
  const ground = north > 1 ? 0x8a7f5a : dry ? 0xc9a86a : wet > 0.6 ? 0x2e5f2e : green
  return land > 0.64 ? mix(ground, 0x7a6a56, smooth(0.64, 0.7, land)) : shade(ground, 0.9 + 0.2 * wet)
}

function cloudsAt(world: World, [x, y, z]: Point): number {
  const cover = fbm3(x * 3, y * 6, z * 3, world.seed + 9, 3)
  return 0.9 * smooth(0.52, 0.68, cover)
}

// The craters of a rocky body: centers on the sphere and their radii in
// radians, many small and a few large, the same every time for its seed.
type Crater = { at: Point; cosRim: number; cosFloor: number; cosSpray: number }

const craterSets = new Map<number, Crater[]>()

function cratersOf(seed: number): Crater[] {
  const known = craterSets.get(seed)
  if (known) return known

  const next = random(seed * 7 + 1)
  const made = Array.from({ length: 70 }, (): Crater => {
    const lat = Math.asin(2 * next() - 1)
    const lon = next() * 2 * Math.PI
    const radius = 0.03 + 0.2 * next() ** 3
    return {
      at: [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)],
      cosRim: Math.cos(radius),
      cosFloor: Math.cos(radius * 0.78),
      cosSpray: Math.cos(radius * 1.25),
    }
  })
  craterSets.set(seed, made)
  return made
}

// Light highlands, dark lowlands, craters with bright rims, ice at the poles.
function rockAt([base = 0, light = 0, dark = 0]: readonly number[], seed: number, p: Point, lat: number, caps?: number): number {
  const [x, y, z] = p
  const ground = fbm3(x * 2.2, y * 2.2, z * 2.2, seed, 4)
  let color = mix(light, base, smooth(0.36, 0.5, ground))
  color = mix(color, dark, smooth(0.55, 0.7, ground))

  for (const crater of cratersOf(seed)) {
    const cos = x * crater.at[0] + y * crater.at[1] + z * crater.at[2]
    if (cos < crater.cosSpray) continue
    color = cos > crater.cosFloor ? shade(color, 0.82) : cos > crater.cosRim ? shade(color, 1.18) : shade(color, 1.05)
  }
  color = shade(color, 0.92 + 0.16 * noise3(x * 40, y * 40, z * 40, seed + 5))

  if (caps !== undefined && Math.abs(lat) > caps + 0.1 * (ground - 0.5)) return mix(color, 0xf2f0ec, 0.85)
  return color
}

// Tan ices, a dark red belt along the equator, and a pale heart.
function dwarfAt(world: World, p: Point, lat: number, lon: number): number {
  const [base = 0, light = 0, dark = 0] = world.colors
  const [x, y, z] = p
  const ground = fbm3(x * 2.6, y * 2.6, z * 2.6, world.seed, 4)
  let color = mix(base, light, smooth(0.5, 0.65, ground))

  const belt = smooth(0.3, 0.08, Math.abs(lat + 0.1 + 0.15 * (ground - 0.5))) * smooth(1.1, 0.4, Math.abs(apart(lon, -0.9)))
  color = mix(color, dark, Math.min(1, belt * (0.6 + ground)))

  const hx = (apart(lon, 0.9) * Math.cos(lat)) / 0.5
  const hy = (lat - 0.32) / 0.5 + 0.2
  const heart = (hx * hx + hy * hy - 1) ** 3 - hx * hx * hy ** 3
  if (heart < 0) color = mix(color, 0xf3ebe0, 0.85)

  return shade(color, 0.93 + 0.14 * noise3(x * 30, y * 30, z * 30, world.seed + 5))
}

function moonTexel(moon: Moon, p: Point, lat: number, lon: number): number {
  const [x, y, z] = p
  const seed = moon.name.length * 101 + moon.color
  switch (moon.surface) {
    case 'rock':
      return rockAt([moon.color, shade(moon.color, 1.2), shade(moon.color, 0.6)], seed, p, lat)
    case 'ice': {
      const ridge = Math.abs(noise3(x * 6, y * 6, z * 6, seed) - 0.5)
      return ridge < 0.03 ? mix(moon.color, 0x8a5a3a, 0.55) : shade(moon.color, 0.95 + 0.1 * noise3(x * 20, y * 20, z * 20, seed + 1))
    }
    case 'sulfur': {
      const spots = fbm3(x * 5, y * 5, z * 5, seed, 3)
      return spots > 0.62 ? 0x5a3018 : spots > 0.56 ? 0xc8702a : spots < 0.32 ? 0xf2ead0 : moon.color
    }
    case 'haze':
      return shade(moon.color, 0.92 + 0.12 * Math.cos(lat * 3) + 0.02 * Math.sin(lon))
  }
}
