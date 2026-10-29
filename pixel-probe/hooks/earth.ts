import { fbm3, noise3, random, smooth } from './noise'
import { mix, shade } from './pixels'
import type { Chart } from './worlds'

// The real Earth and Moon, for Apollo 11. Earth's land is Natural Earth's
// 1:110m outlines (public domain), simplified to half a degree and filled in
// here a row at a time; the Moon's seas are where NASA's Lunar
// Reconnaissance Orbiter maps them (public domain), its named craters where
// they lie, and the rest of its craters spread as the Moon's are. Both are
// faces laid flat as worlds.ts lays them: longitude across from -π, latitude
// down from the north pole.

// Each ring of the land's outlines, "lon,lat" pairs in half degrees, the
// biggest first: Eurasia, Africa, the Americas, Antarctica, then islands.
const COASTS: readonly string[] = [
  '214,154 228,152 219,148 246,146 247,147 254,147 263,142 265,144 280,143 278,145 281,146 299,144 306,142 318,142 322,139 336,139 339,137 342,138 341,140 357,139 360,138 360,130 355,129 359,125 347,123 341,120 338,121 327,120 324,116 326,115 324,110 321,109 314,102 311,111 312,114 327,122 329,125 320,121 319,124 313,123 308,120 310,118 284,118 270,109 276,108 280,108 283,104 280,97 276,93 270,87 265,87 255,80 259,74 258,70 253,69 252,73 254,74 249,76 251,79 242,78 244,81 243,82 236,78 235,77 238,75 245,75 238,70 244,63 243,56 237,49 232,46 222,43 221,41 217,43 212,40 219,27 218,23 210,17 210,20 200,27 198,18 206,11 208,3 203,6 200,13 197,16 198,23 194,34 191,31 188,32 189,36 183,46 174,43 173,40 161,32 160,21 155,16 147,32 145,43 141,42 133,51 115,51 113,54 109,53 103,56 100,60 96,60 102,50 103,52 104,48 108,48 113,53 114,48 120,45 115,38 111,34 97,28 87,25 85,34 78,43 77,47 69,56 70,59 68,55 65,60 71,46 74,44 75,37 87,25 85,23 89,21 102,24 102,21 95,8 81,-5 78,-9 78,-13 81,-22 82,-29 79,-33 70,-40 71,-47 65,-51 64,-58 56,-66 52,-68 39,-70 37,-68 36,-63 30,-54 29,-44 24,-36 27,-21 24,-10 18,-2 19,7 17,10 12,9 9,13 -4,9 -18,10 -25,15 -33,24 -35,29 -32,36 -34,44 -29,53 -19,60 -19,65 -12,72 -4,70 3,73 19,75 22,74 21,68 38,61 40,64 43,66 58,62 62,63 68,62 72,69 72,73 55,73 52,79 58,82 67,84 77,82 83,84 73,90 78,95 70,93 73,90 68,89 65,91 67,92 61,93 55,85 58,82 45,81 48,75 46,76 46,73 45,73 39,81 39,83 26,91 25,91 25,88 37,80 34,81 34,78 32,76 31,80 18,89 13,86 6,86 6,84 2,82 0,77 -4,73 -11,72 -13,74 -18,74 -19,86 -3,88 -2,92 -9,97 -3,97 -4,100 3,100 9,106 16,107 18,108 17,114 21,115 22,113 19,111 22,108 39,109 43,110 43,115 48,114 49,117 47,118 58,120 46,120 43,121 43,126 51,130 44,131 43,129 36,125 34,123 38,120 34,117 32,112 26,111 21,119 17,117 11,117 10,124 21,129 30,136 49,142 56,142 63,141 60,140 62,139 81,136 82,134 80,133 66,133 70,132 70,129 74,128 73,130 74,130 79,129 81,130 80,131 84,133 88,132 89,134 87,137 93,137 94,135 91,134 93,133 107,138 109,138 107,136 118,138 120,137 122,138 120,139 121,140 137,136 138,137 134,139 133,142 138,146 145,146 144,143 146,141 145,138 147,137 143,133 145,132 150,136 150,138 147,139 149,141 146,143 150,144 149,146 151,145 151,143 153,142 152,144 155,145 163,144 161,147 174,148 172,149 174,150 202,153 209,155',
  '-117,-128 -124,-130 -124,-132 -131,-136 -124,-141 -122,-147 -141,-153 -154,-153 -147,-156 -156,-157 -156,-158 -116,-166 -100,-163 -86,-164 -57,-161 -59,-159 -71,-159 -71,-156 -35,-150 -31,-149 -33,-148 -31,-146 -21,-143 -15,-143 -14,-142 0,-143 15,-140 22,-142 27,-140 54,-141 68,-137 77,-140 109,-132 123,-136 138,-136 139,-138 136,-141 138,-141 136,-144 140,-145 148,-140 155,-139 166,-134 174,-134 176,-132 179,-134 192,-135 199,-134 206,-131 212,-134 227,-132 240,-135 270,-132 270,-131 275,-134 291,-134 298,-137 309,-137 323,-141 342,-143 339,-147 332,-149 327,-152 329,-156 334,-158 324,-158 320,-162 339,-168 360,-169 360,-180 -360,-180 -360,-169 -358,-168 -340,-168 -316,-171 -286,-170 -307,-167 -306,-164 -314,-162 -301,-163 -293,-161 -311,-158 -316,-156 -317,-154 -303,-155 -292,-153 -292,-151 -290,-150 -228,-147 -225,-149 -201,-151 -200,-150 -205,-148 -207,-145 -193,-147 -180,-147 -178,-145 -150,-148 -135,-145 -137,-139 -135,-135 -126,-129 -116,-127 -114,-127',
  '-181,139 -181,137 -178,139 -175,134 -171,140 -165,139 -163,138 -164,136 -163,135 -167,133 -172,133 -175,130 -186,124 -189,118 -186,118 -185,114 -165,110 -164,107 -160,102 -157,105 -160,109 -153,113 -157,118 -155,120 -156,125 -148,125 -139,122 -139,118 -135,116 -129,121 -123,114 -124,113 -115,109 -111,104 -120,100 -133,100 -142,94 -130,98 -128,97 -130,96 -129,92 -123,92 -121,94 -120,92 -131,87 -132,89 -129,91 -134,90 -141,86 -140,83 -147,82 -144,82 -148,82 -150,78 -151,79 -150,77 -152,74 -153,78 -153,76 -154,76 -151,71 -163,63 -161,50 -163,52 -168,60 -178,61 -178,59 -180,58 -188,59 -193,57 -196,45 -193,39 -189,36 -184,37 -182,39 -181,42 -174,43 -178,32 -167,31 -168,22 -163,18 -159,19 -154,17 -150,22 -144,25 -142,24 -144,23 -143,18 -143,22 -140,24 -136,21 -124,21 -125,20 -114,12 -108,12 -103,8 -100,3 -101,0 -97,0 -97,-2 -96,-1 -90,-3 -89,-5 -80,-6 -71,-10 -69,-15 -70,-18 -77,-26 -79,-36 -82,-44 -95,-50 -98,-57 -108,-69 -112,-70 -117,-68 -114,-74 -118,-77 -125,-78 -125,-82 -130,-82 -130,-84 -127,-85 -130,-87 -131,-90 -135,-91 -135,-93 -131,-94 -132,-96 -138,-101 -136,-105 -142,-106 -142,-108 -150,-105 -151,-97 -148,-94 -151,-93 -149,-88 -146,-89 -145,-85 -149,-86 -146,-79 -147,-74 -143,-65 -140,-40 -143,-35 -152,-29 -160,-14 -162,-12 -163,-9 -160,-5 -162,-4 -162,-2 -154,8 -156,17 -159,18 -162,14 -171,20 -175,27 -182,28 -189,32 -193,31 -207,37 -211,40 -212,46 -228,63 -230,64 -229,60 -219,47 -220,46 -224,49 -225,52 -230,55 -228,57 -235,66 -241,69 -249,81 -248,91 -249,96 -245,94 -246,98 -255,102 -256,105 -268,116 -294,122 -303,118 -301,123 -317,112 -330,109 -315,115 -314,118 -324,117 -324,119 -328,120 -332,123 -329,126 -322,128 -323,129 -322,130 -330,129 -336,131 -329,133 -323,132 -334,137 -313,143 -273,138 -256,141 -252,139 -243,140 -230,138 -228,137 -231,136 -218,135 -216,136 -218,137 -216,137 -212,138 -203,135 -195,137 -192,136 -192,135 -188,138 -193,140 -190,144 -186,143 -183,140 -185,139',
  '287,-28 291,-30 293,-38 298,-41 306,-52 306,-63 300,-75 293,-78 290,-76 287,-78 281,-76 279,-72 276,-71 276,-69 274,-71 276,-66 272,-70 269,-65 263,-63 252,-64 247,-68 240,-68 236,-70 230,-68 231,-63 227,-52 228,-53 227,-49 228,-44 228,-45 233,-41 242,-39 251,-28 254,-28 259,-30 261,-25 265,-24 265,-22 273,-24 271,-30 280,-35 283,-30 284,-22',
  '-54,167 -42,165 -63,164 -24,163 -40,160 -35,160 -39,158 -39,155 -37,154 -43,153 -40,152 -39,150 -41,150 -39,149 -47,147 -45,144 -50,145 -44,141 -51,143 -50,142 -53,140 -45,140 -80,131 -86,125 -87,120 -97,122 -103,127 -108,134 -102,140 -109,139 -109,142 -103,141 -112,143 -109,145 -117,151 -137,152 -143,154 -134,155 -147,156 -131,159 -136,160 -125,164 -101,165 -89,163 -94,165 -87,166',
  '-173,146 -172,145 -165,148 -161,144 -156,145 -148,143 -144,143 -136,140 -134,138 -138,137 -124,134 -128,130 -136,133 -129,127 -130,125 -138,127 -132,124 -150,129 -155,128 -157,129 -156,131 -148,131 -146,135 -158,140 -177,141 -179,142 -177,142 -180,142 -180,144 -177,147 -172,148',
  '-137,166 -124,165 -135,163 -131,163 -142,160 -154,159 -151,157 -160,154 -156,154 -161,152 -179,153 -176,154 -177,156 -170,155 -176,157 -170,159 -174,161 -164,161 -175,161 -183,164',
  '268,-2 271,-7 277,-3 289,-8 295,-12 294,-15 301,-21 296,-20 289,-15 285,-19 275,-17 277,-15 276,-11 267,-7 266,-8 264,-6 267,-4 261,-2 265,-1',
  '236,4 238,2 236,2 232,-8 220,-6 218,-1 219,4 222,4 226,6 233,14 238,11 235,6',
  '-228,146 -220,146 -216,143 -217,146 -213,146 -209,142 -202,139 -205,139 -205,138 -232,138 -235,140 -225,141 -236,141 -232,143 -239,143 -236,145',
  '100,-27 101,-31 99,-31 94,-50 91,-51 88,-50 87,-44 89,-40 89,-32 95,-29 98,-24',
  '212,-12 205,-8 191,11 195,10 208,0 207,-1 212,-6',
  '-6,117 -8,115 -4,115 -6,112 3,105 3,103 -10,100 -7,103 -11,104 -8,105 -9,107 -6,108 -10,110 -10,112 -11,111 -12,114 -10,117',
  '282,74 281,70 272,67 270,69 262,68 264,66 263,63 260,63 259,67 265,71 271,71 273,75 275,74 279,76 281,82 283,83 284,80',
  '-241,143 -246,142 -252,144 -248,147 -250,149 -235,148 -231,147',
  '115,141 103,143 111,150 138,153 117,149 111,145',
  '-29,133 -27,130 -37,127 -46,128 -44,129 -48,130 -44,131 -49,131 -44,133 -41,131',
  '-350,133 -344,134 -340,132 -345,131 -346,129 -357,132 -360,132 -360,130 -360,138',
  '37,159 43,158 32,154 21,159',
  '346,-82 348,-83 346,-88 343,-88 339,-93 333,-92 334,-90',
  '-90,-156 -88,-157 -87,-160 -108,-161 -97,-156',
  '-174,159 -172,159 -182,156 -193,160 -185,163',
  '250,3 247,0 240,0 242,-3 247,-1 243,-4 246,-11 244,-11 245,-9 243,-9 242,-5 241,-11 239,-11 238,-6 240,1',
  '-112,101 -114,100 -107,98 -106,93 -108,94 -108,96 -111,94 -119,95 -115,101 -112,103',
  '-189,154 -178,151 -162,151 -160,150 -185,150 -188,153 -194,154',
  '-216,152 -212,152 -213,150 -227,149 -224,150 -235,150 -231,153 -218,151 -221,153',
  '200,158 190,158 182,161 192,163 200,160',
  '349,-72 354,-76 357,-75 350,-83 350,-80 348,-79 349,-75 345,-69',
  '-137,-142 -138,-144 -142,-145 -150,-143 -144,-142 -143,-139 -141,-138',
  '287,101 289,98 286,99 285,96 287,92 285,93 284,92 283,107 285,109',
  '243,37 244,37 245,34 243,29 248,28 248,25 241,28 242,29 240,30 240,33',
  '288,88 291,89 291,87 280,83 284,91',
  '217,-14 222,-13 231,-17 217,-16 211,-14 212,-12',
  '-136,-108 -130,-109 -138,-111 -149,-106 -142,-108 -139,-105',
  '-201,148 -195,148 -196,146 -193,145 -193,143 -199,143 -205,145 -201,145 -203,147',
  '-14,105 -20,104 -18,106 -19,108 -13,110 -11,109',
  '290,151 289,150 278,149 274,151 278,152',
  '-159,46 -148,41 -156,40 -154,41 -157,43 -164,45 -170,44 -165,46',
  '-170,131 -160,127 -174,127',
  '291,-82 297,-82 296,-86 292,-87 289,-82',
  '-145,40 -137,37 -143,35 -148,36 -149,37 -145,37 -147,39',
  '253,17 251,11 247,16 244,14 247,17 251,18 251,20',
  '-197,153 -195,153 -196,150 -205,151 -205,153',
  '51,161 55,160 46,159 35,161',
  '-186,146 -191,144 -192,147 -181,148',
  '162,12 160,14 160,20 164,15',
  '210,157 199,156 204,159',
  '-247,97 -251,98 -257,102 -252,101',
  '-119,-160 -120,-162 -133,-161',
  '-232,155 -234,153 -246,152',
  '304,-11 300,-13 297,-11 302,-11 303,-8 305,-9',
  '31,76 30,73 25,75',
  '18,82 19,78 18,78 16,82',
  '221,37 217,37 217,39 222,40',
  '249,-20 247,-20 248,-19 255,-17',
  '242,46 241,44 240,47 243,51',
  '-200,157 -210,157 -208,157 -211,159',
  '-191,138 -200,139 -196,140',
  '-318,-159 -327,-157 -322,-157',
  '49,156 41,155 46,157',
  '257,2 256,-2 255,4',
  '-117,-102 -116,-104 -122,-104',
  '-187,150 -194,150 -190,151',
  '-192,156 -196,156 -197,158',
]

const rad = (degrees: number) => (degrees * Math.PI) / 180

let rings: Float64Array[] | undefined

// The outlines in radians, lon and lat interleaved.
const ringsOf = () => (rings ??= COASTS.map(ring => Float64Array.from(ring.split(/[ ,]/), half => rad(Number(half) / 2))))

// Which texels of a face `width` by `height` are land: each row filled
// between the outlines' crossings of its latitude, taken in pairs.
function landOf(width: number, height: number): Uint8Array {
  const land = new Uint8Array(width * height)
  const column = (lon: number) => ((lon + Math.PI) / (2 * Math.PI)) * width - 0.5

  for (let y = 0; y < height; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / height) * Math.PI
    const crossings: number[] = []
    for (const ring of ringsOf()) {
      const points = ring.length / 2
      for (let i = 0; i < points; i++) {
        const j = (i + 1) % points
        const [ax = 0, ay = 0, bx = 0, by = 0] = [ring[2 * i], ring[2 * i + 1], ring[2 * j], ring[2 * j + 1]]
        if (ay > lat !== by > lat) crossings.push(ax + ((lat - ay) / (by - ay)) * (bx - ax))
      }
    }
    crossings.sort((a, b) => a - b)
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil(column(crossings[k] ?? 0)))
      const to = Math.min(width - 1, Math.floor(column(crossings[k + 1] ?? 0)))
      land.fill(1, y * width + from, y * width + to + 1)
    }
  }
  return land
}

// The deserts and dry steppes, by latitude and longitude in degrees:
// [south, north, west, east].
const DRY: readonly (readonly [number, number, number, number])[] = [
  [15, 32, -17, 33], // the Sahara
  [13, 32, 34, 58], // Arabia
  [24, 37, 50, 72], // Iran and the Thar
  [37, 48, 52, 112], // the Kyzylkum, the Taklamakan, the Gobi
  [-32, -18, 114, 145], // Australia's interior
  [-29, -17, 12, 26], // the Kalahari and the Namib
  [-28, -15, -72, -68], // the Atacama
  [-52, -38, -72, -64], // Patagonia
  [23, 42, -120, -100], // the American southwest
  [0, 12, 38, 52], // the Horn of Africa
]

// How dry a place is, 0 to 1: deep inside one of DRY's boxes, its edges
// worn ragged by `ragged`, a noise in degrees.
const dryness = (lat: number, lon: number, ragged: number) =>
  Math.max(0, ...DRY.map(([south, north, west, east]) => smooth(-3, 5, Math.min(lat - south, north - lat, lon - west, east - lon) + ragged)))

// Ice over Antarctica, Greenland and the high Arctic.
const isIce = (lat: number, lon: number) => lat < -62 || lat > 77 || (lat > 59 && lon > -74 && lon < -12)

const SEED = 1969

function earthTexel(isLand: boolean, isCoast: boolean, lat: number, lon: number): number {
  const [x, y, z] = [Math.cos(rad(lat)) * Math.sin(rad(lon)), Math.sin(rad(lat)), Math.cos(rad(lat)) * Math.cos(rad(lon))]
  const grain = noise3(x * 24, y * 24, z * 24, SEED)
  if (!isLand) return shade(isCoast ? 0x2a64b4 : mix(0x163a86, 0x1c4794, grain), lat < -60 ? 1.1 : 1)
  if (isIce(lat, lon)) return shade(0xeef2f6, 0.94 + 0.08 * grain)

  const wet = fbm3(x * 3, y * 3, z * 3, SEED + 1, 3)
  const north = Math.abs(lat)
  const green = north > 58 ? (wet > 0.5 ? 0x5a6a44 : 0x7d7a5c) : north < 12 ? 0x2a5a24 : wet > 0.5 ? 0x3f6e30 : 0x6a7a3c
  const sand = wet > 0.55 ? 0xb39a62 : 0xd2b47a
  return shade(mix(green, sand, dryness(lat, lon, 14 * (wet - 0.5))), 0.9 + 0.2 * grain)
}

// Clouds: the doldrums' band along the equator, and the storms of the middle latitudes.
function earthCloud(lat: number, lon: number): number {
  const [x, y, z] = [Math.cos(rad(lat)) * Math.sin(rad(lon)), Math.sin(rad(lat)), Math.cos(rad(lat)) * Math.cos(rad(lon))]
  const cover = fbm3(x * 4, y * 9, z * 4, SEED + 9, 5)
  const band = 0.1 * smooth(14, 2, Math.abs(lat - 6)) + 0.07 * smooth(25, 50, Math.abs(lat)) * smooth(70, 55, Math.abs(lat))
  return 0.88 * smooth(0.56, 0.72, cover + band)
}

const charts = new Map<string, Chart>()

// Earth's face `width` texels round: seas, shallows along the coasts, land
// by its climate, the ice, and the clouds as a layer of their own.
export function earthChart(width: number): Chart {
  const key = `earth:${width}`
  const known = charts.get(key)
  if (known) return known

  const height = Math.max(2, width >> 1)
  const land = landOf(width, height)
  const colors = new Uint32Array(width * height)
  const clouds = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    const lat = 90 - ((y + 0.5) / height) * 180
    for (let x = 0; x < width; x++) {
      const lon = ((x + 0.5) / width) * 360 - 180
      const i = y * width + x
      const near = (dx: number, dy: number) => land[Math.min(height - 1, Math.max(0, y + dy)) * width + ((x + dx + width) % width)] === 1
      const isCoast = land[i] !== 1 && (near(1, 0) || near(-1, 0) || near(0, 1) || near(0, -1))
      colors[i] = earthTexel(land[i] === 1, isCoast, lat, lon)
      clouds[i] = earthCloud(lat, lon)
    }
  }
  const made = { width, height, colors, clouds }
  charts.set(key, made)
  return made
}

// The Moon's seas, the dark basalt plains, as NASA's Lunar Reconnaissance
// Orbiter maps them: its albedo map (public domain) blurred and read for
// where it is dark. For each half-degree row of latitude from the north
// pole down, the half-degree columns from 180° west where sea begins and ends.
const MARIA: readonly string[] = [
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '317,318',
  '313,327 331,336 350,354',
  '308,340 347,357',
  '306,359',
  '305,360',
  '305,361',
  '311,362',
  '312,365',
  '312,339 345,368 387,388 400,402 412,416',
  '275,287 313,335 348,358 363,369 387,389 398,405 409,426',
  '272,291 314,332 364,370 387,391 397,428',
  '270,291 322,330 365,371 387,391 396,430',
  '213,223 268,290 325,325 365,371 387,431',
  '212,225 261,289 365,371 386,432',
  '211,227 258,269 277,284 365,371 386,432',
  '211,227 255,268 365,369 386,432',
  '211,228 249,268 366,368 386,432',
  '211,229 247,268 339,344 386,393 399,431',
  '212,230 244,269 338,345 386,390 404,430',
  '212,269 322,324 337,345 406,429',
  '212,270 319,327 337,345 406,428',
  '211,270 317,330 336,345 407,419 421,427',
  '209,271 315,345 409,415 423,426',
  '208,271 313,346',
  '207,271 312,347',
  '207,271 300,301 311,349',
  '206,269 297,304 310,350',
  '205,267 295,352',
  '204,264 291,353',
  '203,263 290,355',
  '202,263 289,356',
  '201,263 288,357',
  '200,264 288,358',
  '199,265 288,358 410,410',
  '199,266 288,359 410,411',
  '199,268 288,359 410,411',
  '198,269 288,360 410,411',
  '197,271 288,360 409,412',
  '197,272 277,280 287,361 408,412',
  '197,281 287,361 404,413',
  '197,282 286,362 403,413',
  '197,363 403,414',
  '197,363 403,417 429,431',
  '197,364 403,419 427,433',
  '197,365 403,420 426,434',
  '197,367 403,421 425,435',
  '197,368 388,389 403,435',
  '196,368 386,393 403,435',
  '196,369 385,396 402,435',
  '196,369 383,435',
  '196,370 382,435',
  '196,371 381,435',
  '196,372 381,435',
  '196,361 363,372 380,435',
  '195,360 364,373 379,420 423,433',
  '194,359 364,374 378,419 424,431',
  '194,360 364,375 377,418 425,430',
  '193,360 364,418 426,429',
  '193,360 364,417',
  '193,360 364,417',
  '193,360 365,418',
  '193,360 365,418 659,660',
  '193,360 365,419 657,662',
  '192,361 365,420 655,663',
  '192,362 365,421 654,664',
  '192,422 653,664',
  '191,423 651,664',
  '191,423 650,665',
  '191,423 650,665',
  '191,423 649,664',
  '191,423 649,664',
  '192,262 265,423 649,664',
  '193,261 266,423 649,663',
  '193,261 267,423 650,663',
  '194,260 267,365 370,423 651,662',
  '194,260 268,361 370,423 475,485 652,660',
  '195,260 267,356 369,424 473,485',
  '196,261 267,356 369,424 471,486',
  '197,355 368,424 469,496',
  '198,355 368,424 432,435 465,497',
  '199,355 367,424 431,435 463,497',
  '200,355 367,425 428,436 463,497',
  '201,355 366,436 462,497',
  '201,355 365,437 462,497',
  '202,355 363,438 462,498',
  '203,355 360,439 462,498',
  '204,354 359,440 462,498',
  '204,355 357,441 463,498 525,529',
  '204,441 463,498 524,530',
  '205,442 463,498 523,531',
  '205,442 463,498 523,532',
  '205,442 463,498 523,533',
  '206,302 306,442 463,498 522,535',
  '206,302 307,311 322,443 463,497 513,514 522,541',
  '206,302 310,310 325,443 463,497 514,517 520,544',
  '207,302 327,444 463,492 495,495 515,546',
  '208,302 329,446 463,490 520,547',
  '208,302 329,447 464,489 521,548',
  '209,302 330,449 465,489 521,548',
  '211,302 330,450 466,488 522,548',
  '212,302 330,451 467,487 522,548',
  '214,303 329,451 468,487 523,548',
  '217,303 329,452 469,486 526,547',
  '219,282 287,305 328,453 471,483 527,544',
  '221,281 289,306 327,385 387,454 473,475 527,540',
  '222,280 290,307 327,383 389,455 494,500 527,538',
  '223,280 290,308 325,382 389,456 493,502 527,537',
  '223,280 290,309 324,358 363,382 390,457 492,502 528,536',
  '224,280 290,309 321,354 365,381 390,459 490,503 529,535',
  '225,281 290,309 316,354 370,378 391,461 489,503 531,535',
  '226,282 290,309 315,354 372,375 391,463 489,503 532,535',
  '227,283 289,308 315,355 391,464 489,502 532,536',
  '228,285 287,309 314,358 391,466 489,501 531,538',
  '229,309 314,359 391,467 489,500 531,541',
  '229,360 391,469 489,498 530,543',
  '229,361 392,472 489,497 529,544',
  '230,362 393,479 489,496 528,544',
  '230,362 394,483 488,495 526,545',
  '230,363 395,495 525,545',
  '229,363 395,495 524,545',
  '229,363 396,495 523,545',
  '229,363 396,425 429,496 523,545',
  '229,362 397,424 431,496 522,545',
  '229,362 399,423 433,496 521,545',
  '229,346 350,362 401,423 435,496 521,544',
  '229,345 353,361 404,422 438,495 521,544',
  '230,343 354,361 407,422 439,491 521,544',
  '231,341 357,358 409,421 439,488 521,544',
  '232,339 410,421 440,487 521,543',
  '233,338 410,421 440,487 521,539',
  '222,225 233,337 410,421 440,487 521,537',
  '220,226 234,337 410,420 440,487 522,536',
  '219,226 235,337 409,420 440,487 522,536',
  '219,227 235,338 409,420 440,487 523,535',
  '218,226 236,338 408,420 440,485 524,536',
  '218,226 236,339 408,420 441,481 525,536',
  '218,226 237,340 409,420 441,479 526,536',
  '219,225 237,341 410,420 442,477 527,535',
  '220,224 237,342 411,420 443,476 528,534',
  '222,223 238,343 414,419 444,475',
  '239,343 416,419 445,474',
  '240,344 446,474',
  '241,344 447,474',
  '241,344 426,427 448,474',
  '242,344 425,430 448,475',
  '243,344 425,432 449,475',
  '244,345 424,434 449,476',
  '245,346 424,435 451,477',
  '245,348 424,435 456,477',
  '246,349 423,436 459,477',
  '247,349 422,436 464,477',
  '248,349 422,436 465,477',
  '251,278 281,349 421,436 466,476',
  '253,277 281,349 421,436 466,476 483,487',
  '253,276 281,348 421,436 465,476 482,488',
  '253,274 281,348 421,436 465,476 481,488',
  '253,272 280,347 421,437 463,475 481,488',
  '253,266 279,346 422,437 459,475 482,488',
  '164,165 254,263 276,345 423,438 458,472 483,488',
  '163,166 254,261 274,345 424,438 458,469 484,487',
  '163,167 173,175 273,344 425,438 458,469',
  '163,176 272,344 425,439 458,468',
  '164,176 271,344 426,439 459,468',
  '165,176 271,344 427,437 460,468',
  '166,176 270,344 461,467',
  '167,176 269,344 462,466',
  '167,176 268,344',
  '168,176 267,344',
  '169,176 267,345',
  '170,175 267,345',
  '172,174 268,346',
  '268,346',
  '268,346',
  '268,346 568,569',
  '268,345 566,571',
  '268,345 565,571',
  '268,344 565,571',
  '20,24 268,343 565,571',
  '2,3 18,25 269,342 564,571',
  '0,6 17,26 270,339 564,571',
  '0,7 16,26 271,294 298,312 318,336 565,570',
  '0,7 15,27 272,292 298,312 320,335 567,569',
  '0,7 15,27 273,291 297,311 329,334',
  '0,7 14,28 274,290 297,310 693,695',
  '0,7 13,28 44,46 275,288 296,310 691,696',
  '0,8 10,28 43,47 277,287 295,310 541,545 690,697',
  '0,28 42,47 279,285 294,311 540,547 686,697',
  '0,28 41,47 282,283 294,311 540,548 684,697',
  '0,29 40,46 294,311 540,548 654,656 684,698',
  '0,29 39,46 51,55 294,310 540,549 651,657 684,698 717,719',
  '0,29 38,45 50,57 294,309 529,534 540,549 650,657 684,698 716,719',
  '0,29 38,45 49,59 271,273 295,303 528,550 650,657 685,698 715,719',
  '0,30 37,44 49,60 270,275 297,300 528,566 650,657 686,697 713,719',
  '0,30 37,44 49,61 270,276 528,568 650,657 686,697 712,719',
  '0,30 37,44 50,61 270,277 528,569 650,657 687,696 710,719',
  '0,30 37,44 50,61 271,277 529,569 651,656 687,696 709,719',
  '0,30 37,44 50,61 271,277 530,569 652,655 688,696 709,719',
  '0,30 37,44 50,62 273,276 530,562 688,695 709,719',
  '0,13 16,29 37,44 50,62 532,562 689,695 710,719',
  '0,10 17,29 37,44 50,62 520,521 532,561 690,695 710,719',
  '0,6 18,29 38,45 49,63 519,526 532,562 691,695 711,719',
  '0,4 18,29 38,63 65,69 518,527 532,562 691,695 712,719',
  '0,3 19,29 38,70 518,528 531,563 689,695 713,719',
  '0,1 19,29 38,70 518,563 688,695 714,719',
  '19,29 38,69 518,565 687,695 717,719',
  '20,30 38,68 518,566 569,570 686,695',
  '20,30 38,67 518,566 569,572 685,695',
  '20,31 37,67 518,526 531,554 557,572 684,693',
  '20,32 37,67 512,516 518,524 531,553 558,573 683,693',
  '19,32 37,68 510,516 518,518 532,553 559,572 682,692',
  '19,32 37,70 509,516 532,554 561,566 682,691 709,709',
  '18,33 37,71 509,516 533,554 564,565 682,691 706,712',
  '17,73 508,515 535,554 564,564 682,691 705,714',
  '17,75 508,515 535,554 564,564 682,691 705,715',
  '16,77 508,515 537,555 562,564 682,691 705,715',
  '16,78 508,515 542,555 562,562 682,690 704,714',
  '15,79 507,515 526,527 547,555 683,689 703,713',
  '14,83 507,514 525,528 548,555 684,689 703,712',
  '13,85 506,514 525,530 550,555 686,687 702,711',
  '13,75 77,85 505,514 524,535 551,555 702,711',
  '14,75 77,86 504,515 523,535 552,555 702,711',
  '14,87 504,515 523,535 554,555 702,711',
  '15,88 503,516 522,536 702,712',
  '19,89 503,518 521,536 702,712',
  '20,90 503,519 521,536 702,712',
  '20,90 503,519 522,535 702,711',
  '21,90 503,519 523,535 702,711',
  '22,90 503,519 525,533 703,711',
  '23,30 33,90 503,519 526,530 703,711',
  '24,29 34,90 502,520 704,712',
  '24,28 34,90 503,520 704,712',
  '6,12 24,27 35,90 503,520 705,712',
  '4,12 23,27 35,74 81,89 504,519 706,711',
  '4,12 22,28 35,74 84,87 506,518 689,692',
  '4,12 21,29 36,74 508,517 686,699',
  '4,11 20,29 36,74 509,516 681,701',
  '5,9 19,29 37,76 510,514 679,702',
  '19,29 38,76 679,701',
  '18,27 39,76 679,701',
  '18,25 40,73 679,699',
  '19,23 42,72 679,689 695,697',
  '44,64 66,66 680,688',
  '46,61 682,686',
  '50,57',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
]

// The seas' tones where they differ, as patches: each one's middle in
// degrees, its half-widths in degrees of arc across and up, and its tone:
// above 1 darker and bluer, below it lighter and browner.
const TONES: readonly (readonly [number, number, number, number, number])[] = [
  [8, 31, 11, 9, 1.08], // Tranquillitatis, the darkest and bluest
  [28, 17.5, 6, 6, 0.9], // Serenitatis, light in its middle
  [24, -50, 8, 8, 1.06], // Procellarum about Aristarchus
  [-6, 52, 7, 9, 0.94], // Fecunditatis
  [56, 0, 30, 4, 0.92], // Frigoris
]

// Craters with names: [lat, lon, radius in degrees, how bright (dark below
// 1, as where lava filled them), how far their rays reach in degrees].
const CRATERS: readonly (readonly [number, number, number, number, number])[] = [
  [-43.3, -11.2, 1.4, 1.3, 55], // Tycho
  [9.6, -20.1, 1.6, 1.22, 18], // Copernicus
  [8.1, -38, 0.9, 1.22, 12], // Kepler
  [23.7, -47.4, 0.7, 1.4, 8], // Aristarchus
  [16.1, 46.8, 0.6, 1.2, 10], // Proclus
  [51.6, -9.4, 1.7, 0.66, 0], // Plato
  [-5.2, -68.6, 2.8, 0.68, 0], // Grimaldi
  [-20.4, 129.1, 2, 0.66, 0], // Tsiolkovsky, on the far side
  [-8.9, 61.1, 2.2, 1, 0], // Langrenus
  [-25.3, 60.4, 3, 1, 0], // Petavius
  [-58.4, -14.4, 3.7, 1, 0], // Clavius
  [-9.3, -1.9, 2.6, 1, 0], // Ptolemaeus
  [-13.4, -2.8, 1.8, 1, 0], // Alphonsus
  [-18.2, -1.9, 1.6, 1, 0], // Arzachel
  [-11.4, 26.4, 1.65, 1, 0], // Theophilus
  [-13.2, 24, 1.6, 1, 0], // Cyrillus
  [-18, 23.6, 1.6, 1, 0], // Catharina
  [-50, -6.2, 2.7, 1, 0], // Maginus
  [-49.6, -21.7, 2.4, 1, 0], // Longomontanus
  [-44.4, -54.6, 3.7, 1, 0], // Schickard
  [-17.6, -40.1, 1.8, 1, 0], // Gassendi
  [29.7, -4, 1.4, 0.9, 0], // Archimedes
  [50.2, 17.4, 1.5, 1, 0], // Aristoteles
  [14.5, -11.3, 1, 1, 0], // Eratosthenes
  [-5.1, 5.2, 2.5, 1, 0], // Hipparchus
  [-11.2, 4.1, 2.2, 1, 0], // Albategnius
  [31.9, 29.9, 1.6, 1, 0], // Posidonius
  [27.6, 56, 2, 1, 0], // Cleomedes
]

// The Moon's face `width` texels round: evenly bright highlands, the seas
// dark where they lie, the bright young craters with their rays
// and the old ones flooded dark, and craters everywhere pressed in as slopes
// (Chart.bumps) for the sun to catch: deep bowls the small ones, shallow
// with flat floors and peaks the big ones; few on the seas, which are younger.
export function moonChart(width: number): Chart {
  const key = `moon:${width}`
  const known = charts.get(key)
  if (known) return known

  const height = Math.max(2, width >> 1)
  const colors = new Uint32Array(width * height)
  const seas = new Float32Array(width * height)
  const rays = raysOf()
  for (let y = 0; y < height; y++) {
    const lat = 90 - ((y + 0.5) / height) * 180
    for (let x = 0; x < width; x++) {
      const lon = ((x + 0.5) / width) * 360 - 180
      const i = y * width + x
      const [sea, tone] = seaAt(lat, lon)
      seas[i] = sea
      colors[i] = moonTexel(lat, lon, rays, sea, tone)
    }
  }
  const bumps = new Float32Array(width * height * 2)
  for (const crater of cratersOf(width, seas)) press(crater, colors, bumps, width, height)
  const made = { width, height, colors, bumps }
  charts.set(key, made)
  return made
}

// A crater: its middle and radius in degrees; how steep its walls; the
// share of its radius that is flat floor, and that is central peak; how
// much its rim shines, fresh.
type Crater = { lat: number; lon: number; r: number; steep: number; floor: number; peak: number; shine: number }

// How a crater `r` degrees across its radius is shaped, `fresh` 0 to 1:
// small ones simple bowls, steep; bigger ones with flat floors and peaks in
// the middle, shallower; worn ones shallower still.
function shapeOf(r: number, fresh: number): Pick<Crater, 'steep' | 'floor' | 'peak'> {
  const worn = 0.55 + 0.45 * fresh
  if (r < 0.5) return { steep: (0.65 + 0.15 * fresh) * worn, floor: 0, peak: 0 }
  if (r < 1.5) return { steep: (0.45 + 0.15 * fresh) * worn, floor: 0.3, peak: r > 0.8 ? 0.12 : 0 }
  return { steep: (r > 3 ? 0.18 : 0.3) * worn, floor: 0.5, peak: 0.14 }
}

// The craters a face `width` texels round can show: the named ones, then
// thirteen hundred more, small ones many and big ones few, each at least two
// texels across; on the seas most of them never formed.
function cratersOf(width: number, seas: Float32Array): Crater[] {
  const height = Math.max(2, width >> 1)
  const texel = 360 / width
  const next = random(SEED + 21)
  const named = CRATERS.map(([lat, lon, r, bright]) => ({ lat, lon, r, ...shapeOf(r, bright > 1.1 ? 1 : 0.6), shine: 0 }))
  const scattered = Array.from({ length: 1300 }, () => {
    const lat = (Math.asin(2 * next() - 1) * 180) / Math.PI
    const lon = next() * 360 - 180
    const r = 0.3 + 4.2 * next() ** 6
    const fresh = next() ** 2
    return { lat, lon, r, ...shapeOf(r, fresh), shine: r < 1 ? fresh : 0 }
  }).filter(crater => {
    const x = Math.min(width - 1, Math.floor(((crater.lon + 180) / 360) * width))
    const y = Math.min(height - 1, Math.floor(((90 - crater.lat) / 180) * height))
    return crater.r > 1.1 * texel && ((seas[y * width + x] ?? 0) < 0.5 || next() < 0.25)
  })
  return [...scattered, ...named]
}

// Presses a crater into a face as slopes east and north in `bumps`: the
// peak falling away from its top, the floor flat, the walls rising to the
// rim, the rim falling away outside it. Only a fresh one's rim is brighter;
// its floor keeps the ground's own color, darkened only by the light.
function press(crater: Crater, colors: Uint32Array, bumps: Float32Array, width: number, height: number) {
  const reach = crater.r * 1.7
  const texel = 360 / width
  const top = Math.max(0, Math.floor(((90 - (crater.lat + reach)) / 180) * height))
  const bottom = Math.min(height - 1, Math.ceil(((90 - (crater.lat - reach)) / 180) * height))
  const across = Math.min(180, reach / Math.max(0.05, Math.cos(rad(crater.lat))))
  const first = Math.floor(((crater.lon - across + 180) / 360) * width)
  const count = Math.min(width, Math.ceil((2 * across) / texel) + 2)
  const { steep, floor, peak } = crater
  for (let y = top; y <= bottom; y++) {
    const lat = 90 - ((y + 0.5) / height) * 180
    for (let k = 0; k < count; k++) {
      const x = (((first + k) % width) + width) % width
      const lon = ((x + 0.5) / width) * 360 - 180
      const [east, north] = [apart(lon, crater.lon) * Math.cos(rad(lat)), lat - crater.lat]
      const far = Math.hypot(east, north)
      const d = far / crater.r
      if (d > 1.7 || far === 0) continue
      const slope =
        d < peak
          ? -steep * 1.6 * Math.sin((Math.PI * d) / peak)
          : d < floor
            ? 0
            : d < 1
              ? (steep * (d - floor)) / (1 - floor)
              : -steep * 0.85 * (1 - (d - 1) / 0.7) ** 2
      const i = y * width + x
      bumps[2 * i] = (bumps[2 * i] ?? 0) + (slope * east) / far
      bumps[2 * i + 1] = (bumps[2 * i + 1] ?? 0) + (slope * north) / far
      if (crater.shine > 0 && d > 0.85 && d < 1.3) colors[i] = mix(colors[i] ?? 0, 0xdedad2, 0.22 * crater.shine)
    }
  }
}

// The angle from `lon` to `to` in degrees, the short way round.
const apart = (lon: number, to: number) => ((((lon - to) % 360) + 540) % 360) - 180

// Rays: thin streaks out from a crater along great circles, each a bearing,
// a reach in degrees and a brightness; laid out once.
type Rays = { lat: number; lon: number; reach: number; rays: { bearing: number; reach: number; bright: number }[] }

let raySets: Rays[] | undefined

function raysOf(): Rays[] {
  if (raySets) return raySets
  const next = random(SEED + 3)
  raySets = CRATERS.filter(([, , , , reach]) => reach > 0).map(([lat, lon, , , reach]) => ({
    lat,
    lon,
    reach,
    rays: Array.from({ length: reach > 30 ? 14 : 7 }, () => ({ bearing: next() * 2 * Math.PI, reach: reach * (0.5 + 0.5 * next()), bright: 0.5 + 0.5 * next() })),
  }))
  return raySets
}

let mariaMask: Float32Array | undefined

// The seas as a mask 720 by 360, softened over a degree so the shores are not stepped.
function mariaOf(): Float32Array {
  if (mariaMask) return mariaMask
  const [W, H] = [720, 360]
  let mask = new Float32Array(W * H)
  MARIA.forEach((row, y) => {
    for (const run of row === '' ? [] : row.split(' ')) {
      const [from = 0, to = 0] = run.split(',').map(Number)
      mask.fill(1, y * W + from, y * W + to + 1)
    }
  })
  // A box blur two cells each way, across (round the Moon) then up and down.
  for (const isAcross of [true, false]) {
    const soft = new Float32Array(W * H)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sum = 0
        for (let k = -2; k <= 2; k++) sum += isAcross ? (mask[y * W + ((x + k + W) % W)] ?? 0) : (mask[Math.min(H - 1, Math.max(0, y + k)) * W + x] ?? 0)
        soft[y * W + x] = sum / 5
      }
    }
    mask = soft
  }
  mariaMask = mask
  return mask
}

// How much of (lat, lon) is sea, 0 to 1, and the tone of the sea there; each
// place moved a fraction of a degree by a noise first, so the shores wander
// finer than the mask is drawn.
function seaAt(lat: number, lon: number): readonly [number, number] {
  const [x, y, z] = [Math.cos(rad(lat)) * Math.sin(rad(lon)), Math.sin(rad(lat)), Math.cos(rad(lat)) * Math.cos(rad(lon))]
  const [wLat, wLon] = [lat + 1.2 * (fbm3(x * 9, y * 9, z * 9, SEED + 11, 2) - 0.5), lon + 1.2 * (fbm3(x * 9, y * 9, z * 9, SEED + 12, 2) - 0.5)]
  // The mask read between its cells.
  const mask = mariaOf()
  const [u, v] = [(((wLon + 180) % 360) + 360) % 360 * 2 - 0.5, Math.min(359, Math.max(0, (90 - wLat) * 2 - 0.5))]
  const [x0, y0] = [Math.floor(u), Math.floor(v)]
  const [fx, fy] = [u - x0, v - y0]
  const at = (cx: number, cy: number) => mask[Math.min(359, cy) * 720 + (((cx % 720) + 720) % 720)] ?? 0
  const value = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
  let tone = 1
  for (const [mLat, mLon, across, up, patch] of TONES) {
    const d = Math.hypot((apart(lon, mLon) * Math.cos(rad(lat))) / across, (lat - mLat) / up)
    tone += (patch - 1) * smooth(1.2, 0.6, d)
  }
  return [smooth(0.3, 0.7, value), tone]
}

function moonTexel(lat: number, lon: number, rays: readonly Rays[], sea: number, tone: number): number {
  const [x, y, z] = [Math.cos(rad(lat)) * Math.sin(rad(lon)), Math.sin(rad(lat)), Math.cos(rad(lat)) * Math.cos(rad(lon))]
  // The highlands evenly bright, barely mottled.
  let color = mix(0xc4c0b8, 0xb6b2aa, smooth(0.3, 0.7, fbm3(x * 2, y * 2, z * 2, SEED + 5, 3)))
  // The seas' basalt: darker and bluer where the tone is up, a slow sway within.
  const basalt = shade(mix(0x7c776f, 0x707278, smooth(0.98, 1.1, tone)), (2 - tone) * (0.95 + 0.1 * noise3(x * 5, y * 5, z * 5, SEED + 7)))
  color = mix(color, basalt, sea * 0.9)

  for (const [cLat, cLon, radius, bright] of CRATERS) {
    if (bright === 1) continue
    const d = Math.hypot(apart(lon, cLon) * Math.cos(rad(lat)), lat - cLat) / radius
    if (bright < 1 && d < 0.85) color = shade(color, bright + (1 - bright) * smooth(0.6, 0.85, d))
    else if (bright > 1 && d < 2) color = mix(color, 0xe8e6e0, (bright - 1) * 1.5 * smooth(2, 0.8, d))
  }

  for (const set of rays) {
    // How far this place is from the crater, and on what bearing; then how far off each ray.
    const dLon = rad(apart(lon, set.lon))
    const [cLat, pLat] = [rad(set.lat), rad(lat)]
    const far = 57.3 * Math.acos(Math.max(-1, Math.min(1, Math.sin(cLat) * Math.sin(pLat) + Math.cos(cLat) * Math.cos(pLat) * Math.cos(dLon))))
    if (far > set.reach || far < 0.6) continue
    const bearing = Math.atan2(Math.sin(dLon) * Math.cos(pLat), Math.cos(cLat) * Math.sin(pLat) - Math.sin(cLat) * Math.cos(pLat) * Math.cos(dLon))
    for (const ray of set.rays) {
      const off = Math.abs(Math.sin(bearing - ray.bearing)) * far
      if (far < ray.reach && Math.cos(bearing - ray.bearing) > 0 && off < 1.2) color = mix(color, 0xe6e4de, 0.35 * ray.bright * (1 - off / 1.2) * (1 - far / ray.reach))
    }
  }

  return color
}
