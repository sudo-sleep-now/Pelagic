import { CONFIG, smoothstep, randomGenerator } from '../config.js';
export const PRESETS = Object.freeze({
  clear: { cloud: .10, rain: 0, wind: .55, angle: .0, fog: .000021 },
  partly: { cloud: .48, rain: 0, wind: .72, angle: .28, fog: .000028 },
  overcast: { cloud: .89, rain: 0, wind: 1.12, angle: .48, fog: .000055 },
  rain: { cloud: .96, rain: .62, wind: 1.50, angle: .65, fog: .00012 },
  storm: { cloud: 1, rain: .93, wind: 2.25, angle: .90, fog: .00018 },
});
const KEYS = Object.keys(PRESETS.clear);
export class Weather {
  constructor() {
    this.name = 'clear'; this.targetName = 'clear';
    this.current = { ...PRESETS.clear }; this.from = { ...PRESETS.clear }; this.to = { ...PRESETS.clear };
    this.elapsed = 0; this.duration = CONFIG.weatherHoldSeconds; this.blending = false;
    this.random = randomGenerator(CONFIG.seed+91); this.cycles = 0;
  }
  set(name, instant=false) {
    if (!PRESETS[name]) throw new Error(`Unknown weather: ${name}`);
    this.name = name; this.targetName = name;
    Object.assign(this.from,this.current); Object.assign(this.to,PRESETS[name]);
    this.elapsed=0; this.blending=!instant;
    if(instant) Object.assign(this.current,this.to);
  }
  update(dt) {
    this.elapsed+=dt;
    if(this.blending) {
      const t=smoothstep(0,CONFIG.weatherBlendSeconds,this.elapsed);
      for(const key of KEYS) this.current[key]=this.from[key]+(this.to[key]-this.from[key])*t;
      if(t===1) { this.blending=false; this.elapsed=0; this.duration=CONFIG.weatherHoldSeconds*(.85+.5*this.random()); }
    } else if(this.elapsed>this.duration) {
      // A coherent weather progression. Storms are uncommon, after a rainy period.
      const options={clear:['partly','partly','overcast'],partly:['clear','overcast'],overcast:['rain','partly'],rain:['overcast','overcast','storm'],storm:['rain']};
      const choices=options[this.name]; this.set(choices[Math.floor(this.random()*choices.length)]); this.cycles++;
    }
  }
}
