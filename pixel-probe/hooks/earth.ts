import { fbm3, noise3, random, smooth } from './noise'
import { mix, shade } from './pixels'
import type { Chart } from './worlds'

// The real Earth and Moon, for Apollo 11. Earth's land is Natural Earth's
// 1:110m outlines (public domain), simplified to half a degree and filled in
// here a row at a time; the Moon's near side is its seas and brightest
// craters where they lie. Both are faces laid flat as worlds.ts lays them:
// longitude across from -π, latitude down from the north pole.

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

// The Moon's seas, by their middles in degrees and their half-widths in
// degrees of arc across and up: Procellarum in several, as it sprawls.
const SEAS: readonly (readonly [number, number, number, number])[] = [
  [33, -16, 18, 15], // Imbrium
  [28, 17.5, 11, 11], // Serenitatis
  [8.5, 31, 13, 11], // Tranquillitatis
  [17, 59, 9.5, 7.5], // Crisium
  [-7.8, 51.3, 8, 13], // Fecunditatis
  [-15.2, 35.5, 5.5, 5.5], // Nectaris
  [-21, -17, 12, 10], // Nubium
  [-24.4, -38.6, 6.5, 6.5], // Humorum
  [-10, -23, 6, 6], // Cognitum
  [7.5, -31, 9, 7], // Insularum
  [13.3, 3.6, 4, 4], // Vaporum
  [56, 2, 30, 6], // Frigoris
  [2.4, 1.7, 3.5, 3], // Sinus Medii
  [11, -9, 4, 3], // Sinus Aestuum
  [30, -52, 13, 14], // Procellarum
  [12, -55, 12, 14],
  [-2, -46, 10, 10],
  [42, -45, 8, 8],
  [1.3, 87.5, 6, 6], // Smythii
  [13.3, 86.1, 5, 4], // Marginis
  [-19.4, -92.8, 4, 4], // Orientale
  [27.3, 147.9, 4, 4], // Moscoviense, on the far side
  // Where the seas run into one another.
  [20, 25, 6, 6],
  [0, 41, 8, 8],
  [-6, -20, 7, 6],
  [20, -33, 8, 7],
]

// Craters that stand out: [lat, lon, radius in degrees, how bright (dark below
// 1), how far their rays reach in degrees].
const CRATERS: readonly (readonly [number, number, number, number, number])[] = [
  [-43.3, -11.2, 1.4, 1.5, 55], // Tycho
  [9.6, -20.1, 1.6, 1.4, 18], // Copernicus
  [8.1, -38, 0.9, 1.4, 12], // Kepler
  [23.7, -47.4, 0.7, 1.7, 8], // Aristarchus
  [16.1, 46.8, 0.6, 1.4, 10], // Proclus
  [51.6, -9.4, 1.7, 0.6, 0], // Plato
  [-5.2, -68.6, 2.8, 0.62, 0], // Grimaldi
  [-8.9, 61.1, 2.2, 1.12, 0], // Langrenus
  [-25.3, 60.4, 3, 1.1, 0], // Petavius
  [-20.4, 129.1, 2, 0.6, 0], // Tsiolkovsky, on the far side
]

// The Moon's face `width` texels round: bright highlands, the dark seas,
// small craters everywhere, and the bright ones with their rays.
export function moonChart(width: number): Chart {
  const key = `moon:${width}`
  const known = charts.get(key)
  if (known) return known

  const height = Math.max(2, width >> 1)
  const colors = new Uint32Array(width * height)
  const rays = raysOf()
  for (let y = 0; y < height; y++) {
    const lat = 90 - ((y + 0.5) / height) * 180
    for (let x = 0; x < width; x++) {
      const lon = ((x + 0.5) / width) * 360 - 180
      colors[y * width + x] = moonTexel(lat, lon, rays)
    }
  }
  const made = { width, height, colors }
  charts.set(key, made)
  return made
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

function moonTexel(lat: number, lon: number, rays: readonly Rays[]): number {
  const [x, y, z] = [Math.cos(rad(lat)) * Math.sin(rad(lon)), Math.sin(rad(lat)), Math.cos(rad(lat)) * Math.cos(rad(lon))]
  const ground = fbm3(x * 3, y * 3, z * 3, SEED + 5, 4)
  let color = mix(0xbab6ae, 0x9c988f, smooth(0.35, 0.65, ground))

  // The seas, their edges wavering.
  let sea = 0
  // Each place is moved a few degrees by a noise first, so the seas' shores wander.
  const [wLat, wLon] = [lat + 9 * (fbm3(x * 4, y * 4, z * 4, SEED + 11, 3) - 0.5), lon + 9 * (fbm3(x * 4, y * 4, z * 4, SEED + 12, 3) - 0.5)]
  const ragged = 1.2 * (fbm3(x * 9, y * 9, z * 9, SEED + 6, 3) - 0.5)
  for (const [mLat, mLon, across, up] of SEAS) {
    const dx = (apart(wLon, mLon) * Math.cos(rad(lat))) / across
    const dy = (wLat - mLat) / up
    sea = Math.max(sea, smooth(1.1, 0.85, Math.hypot(dx, dy) / 1.1 + ragged))
  }
  const tint = noise3(x * 4, y * 4, z * 4, SEED + 7)
  color = mix(color, mix(0x67645f, 0x726b5e, tint), sea * 0.9)

  // Small craters everywhere, rims bright and floors dark.
  const pit = noise3(x * 60, y * 60, z * 60, SEED + 8)
  if (pit > 0.74) color = shade(color, 0.86)
  else if (pit > 0.7) color = shade(color, 1.12)

  for (const [cLat, cLon, radius, bright] of CRATERS) {
    const d = Math.hypot(apart(lon, cLon) * Math.cos(rad(lat)), lat - cLat) / radius
    if (d < 1) color = bright < 1 ? shade(color, bright) : mix(color, 0xf2f0ea, (bright - 1) * 1.6 * (1 - d * 0.4))
    else if (d < 2.2 && bright > 1) color = mix(color, 0xe8e6e0, (bright - 1) * smooth(2.2, 1, d))
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
      if (far < ray.reach && Math.cos(bearing - ray.bearing) > 0 && off < 1.2) color = mix(color, 0xe6e4de, 0.45 * ray.bright * (1 - off / 1.2) * (1 - far / ray.reach))
    }
  }

  return color
}
