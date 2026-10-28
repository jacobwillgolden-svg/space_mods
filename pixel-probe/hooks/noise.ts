// Value noise: a random number at every point of a lattice, eased between,
// and fractal sums of it at finer and finer scales. The same point and seed
// always give the same value, so a world looks the same every frame.

// 0 to 1 for lattice point (x, y, z) under `seed`.
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1440662683) ^ Math.imul(seed | 0, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16

  return (h >>> 0) / 4294967296
}

const ease = (t: number) => t * t * (3 - 2 * t)

export function noise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const u = ease(x - xi)
  const v = ease(y - yi)
  const w = ease(z - zi)
  const at = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed)
  const near = (at(0, 0, 0) * (1 - u) + at(1, 0, 0) * u) * (1 - v) + (at(0, 1, 0) * (1 - u) + at(1, 1, 0) * u) * v
  const far = (at(0, 0, 1) * (1 - u) + at(1, 0, 1) * u) * (1 - v) + (at(0, 1, 1) * (1 - u) + at(1, 1, 1) * u) * v

  return near * (1 - w) + far * w
}

// The same on a flat lattice: half the work, for the sky.
export function noise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const u = ease(x - xi)
  const v = ease(y - yi)
  const top = hash3(xi, yi, 0, seed) * (1 - u) + hash3(xi + 1, yi, 0, seed) * u
  const bottom = hash3(xi, yi + 1, 0, seed) * (1 - u) + hash3(xi + 1, yi + 1, 0, seed) * u

  return top * (1 - v) + bottom * v
}

export function fbm2(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0
  let strength = 0.5
  let total = 0
  for (let i = 0; i < octaves; i++) {
    const k = 1 << i
    sum += strength * noise2(x * k, y * k, seed + i * 7919)
    total += strength
    strength /= 2
  }

  return sum / total
}

// `octaves` layers of noise, each twice as fine and half as strong: 0 to 1, mostly near the middle.
export function fbm3(x: number, y: number, z: number, seed: number, octaves = 4): number {
  let sum = 0
  let strength = 0.5
  let total = 0
  for (let i = 0; i < octaves; i++) {
    const k = 1 << i
    sum += strength * noise3(x * k, y * k, z * k, seed + i * 7919)
    total += strength
    strength /= 2
  }

  return sum / total
}

// Smoothly 0 below `from`, 1 above `to`.
export function smooth(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

// mulberry32: the same seed scatters the same debris every time.
export function random(seed: number): () => number {
  let a = seed

  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
