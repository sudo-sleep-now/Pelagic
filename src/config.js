// Every distance is in metres. No configuration is exposed over the scene.
export const CONFIG = Object.freeze({
  radius: 2000,
  center: [0, 0],
  daySeconds: 900,
  startHour: 16.35,
  weatherHoldSeconds: 180,
  weatherBlendSeconds: 100,
  pixelRatio: 1.5,
  minPixelRatio: 0.8,
  camera: { position: [2600, 1450, 2850], target: [90, -45, 100], minDistance: 50, maxDistance: 6800 },
  water: { rings: 224, sectors: 512 },
  trafficCount: 10,
  marineCount: 7,
  wakeCapacity: 1536,
  wakeLifetime: 62,
  rainCapacity: 4500,
  seed: 408,
});
export const VESSEL_NAMES=Object.freeze(['cargo','tanker','fishing','tug','yacht','ferry','sailboat','patrol','rib','carrier','bulk','destroyer','trawler']);
export const WATER_SOURCE_COUNT=CONFIG.trafficCount+1+CONFIG.marineCount;
export function randomGenerator(seed) {
  let a = seed >>> 0;
  return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export const damp = (a, b, speed, dt) => a + (b - a) * (1 - Math.exp(-speed * dt));
export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
