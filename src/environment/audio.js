import { randomGenerator } from '../config.js';

const clamp01=value=>Math.max(0,Math.min(1,value));
function automate(parameter,value,now,immediate,decay=.8) {
  if(immediate)parameter.setValueAtTime(value,now);
  else parameter.setTargetAtTime(value,now,decay);
}

// A single fixed graph: stereo wash, wind and rain, plus the nearby RIB motor.
// The input buffer and all nodes are allocated only after a user gesture.
export function createAmbienceGraph(context) {
  const nodes=[], keep=node=>{nodes.push(node);return node;};
  const master=keep(context.createGain());master.gain.value=0;
  const limiter=keep(context.createDynamicsCompressor());
  limiter.threshold.value=-18;limiter.knee.value=18;limiter.ratio.value=4;
  limiter.attack.value=.03;limiter.release.value=.4;
  master.connect(limiter);limiter.connect(context.destination);
  const buffer=context.createBuffer(2,context.sampleRate*8,context.sampleRate);
  const random=randomGenerator(40827),seam=Math.floor(context.sampleRate*.05);
  for(let channel=0;channel<2;channel++) {
    const data=buffer.getChannelData(channel);
    for(let i=0;i<data.length;i++)data[i]=random()*2-1;
    for(let i=0;i<seam;i++) {
      const blend=.5-.5*Math.cos(Math.PI*i/(seam-1));
      const j=data.length-seam+i;data[j]=data[j]*(1-blend)+data[i]*blend;
    }
  }
  function noiseBand(low,high,offset) {
    const source=keep(context.createBufferSource());source.buffer=buffer;source.loop=true;
    const hp=keep(context.createBiquadFilter());hp.type='highpass';hp.frequency.value=low;hp.Q.value=.5;
    const lp=keep(context.createBiquadFilter());lp.type='lowpass';lp.frequency.value=high;lp.Q.value=.5;
    const level=keep(context.createGain());level.gain.value=0;
    source.connect(hp);hp.connect(lp);lp.connect(level);level.connect(master);source.start(0,offset);
    return {level,lp};
  }
  const wash=noiseBand(80,650,0),wind=noiseBand(110,1100,2.7),rain=noiseBand(1800,5500,5.3);
  const tide=keep(context.createGain());tide.gain.value=.65;
  // Insert a slow, continuous wash envelope; no repeated splash sample.
  wash.lp.disconnect();wash.lp.connect(tide);tide.connect(wash.level);
  const swell=keep(context.createOscillator());swell.frequency.value=.085;
  const swellDepth=keep(context.createGain());swellDepth.gain.value=.30;
  swell.connect(swellDepth);swellDepth.connect(tide.gain);swell.start();
  const gust=keep(context.createOscillator());gust.frequency.value=.037;
  const gustDepth=keep(context.createGain());gustDepth.gain.value=150;
  gust.connect(gustDepth);gustDepth.connect(wind.lp.frequency);gust.start();
  const engine=keep(context.createGain());engine.gain.value=0;
  const engineFilter=keep(context.createBiquadFilter());engineFilter.type='lowpass';engineFilter.frequency.value=350;engineFilter.Q.value=.5;
  const fundamental=keep(context.createOscillator());fundamental.type='triangle';fundamental.frequency.value=38;
  const harmonic=keep(context.createOscillator());harmonic.type='sine';harmonic.frequency.value=76;
  const harmonicLevel=keep(context.createGain());harmonicLevel.gain.value=.24;
  fundamental.connect(engineFilter);harmonic.connect(harmonicLevel);harmonicLevel.connect(engineFilter);
  engineFilter.connect(engine);engine.connect(master);fundamental.start();harmonic.start();
  return {master,wash,wind,rain,engine,fundamental,harmonic,nodes,buffer};
}

export function setAmbience(graph,context,weather,player,muted=false,immediate=false) {
  const rough=clamp01((weather.wind-.4)/1.85),rain=clamp01(weather.rain);
  const throttle=player?.active?clamp01(Math.abs(player.dynamics.throttle)):0;
  const speed=player?.active?clamp01(Math.abs(player.dynamics.speed)/15):0;
  const load=Math.max(throttle,speed*.65),motor=player?.active ? .018+.09*load : 0;
  const now=context.currentTime;
  automate(graph.master.gain,muted?0:.28,now,immediate,.25);
  automate(graph.wash.level.gain,.22+.24*rough,now,immediate);automate(graph.wash.lp.frequency,650+rough*500,now,immediate);
  automate(graph.wind.level.gain,.035+.12*rough,now,immediate);automate(graph.wind.lp.frequency,850+rough*900,now,immediate);
  automate(graph.rain.level.gain,.22*rain,now,immediate);automate(graph.engine.gain,motor,now,immediate,.25);
  automate(graph.fundamental.frequency,38+load*65,now,immediate,.18);automate(graph.harmonic.frequency,76+load*130,now,immediate,.18);
  return motor;
}

export class OceanAudio {
  constructor(canvas) {
    this.canvas=canvas;this.context=null;this.graph=null;this.muted=false;this.tick=0;
    this.weather={wind:.55,rain:0};this.player=null;this.motor=0;
    this.onPointer=()=>{this.unlock();this.publish();};
    this.onKey=event=>{
      if(event.target!==canvas||event.ctrlKey||event.altKey||event.metaKey)return;
      if(event.code==='KeyM'&&!event.repeat){event.preventDefault();this.muted=!this.muted;}
      this.unlock();
      this.publish();
    };
    this.onVisibility=()=>{
      if(!this.context)return;
      if(document.hidden)this.context.suspend().catch(()=>{});
      else if(!this.muted)this.context.resume().catch(()=>{});
    };
    canvas.addEventListener('pointerdown',this.onPointer);
    addEventListener('keydown',this.onKey);document.addEventListener('visibilitychange',this.onVisibility);
    this.publish();
  }
  unlock() {
    if(this.muted)return;
    const AudioContext=window.AudioContext||window.webkitAudioContext;
    if(!AudioContext)return;
    if(!this.context) {
      this.context=new AudioContext();this.graph=createAmbienceGraph(this.context);
      setAmbience(this.graph,this.context,this.weather,this.player,false);
    }
    if(this.context.state==='suspended'&&!document.hidden)this.context.resume().then(()=>this.publish()).catch(()=>{});
  }
  update(weather,player) {
    this.weather=weather;this.player=player;
    // Control-rate updates avoid accumulating thousands of AudioParam events.
    if(++this.tick%6===0&&this.graph&&this.context.state==='running')this.motor=setAmbience(this.graph,this.context,weather,player,this.muted);
    if(import.meta.env.DEV&&this.tick%30===0)this.publish();
  }
  publish() {
    if(import.meta.env.DEV)this.canvas.dataset.audio=JSON.stringify({state:this.context?.state??'awaiting-interaction',muted:this.muted,
      wind:this.weather.wind,rain:this.weather.rain,motor:this.motor,nodes:this.graph?.nodes.length??0,bufferBytes:this.graph?this.graph.buffer.length*8:0});
  }
  dispose() {
    this.canvas.removeEventListener('pointerdown',this.onPointer);removeEventListener('keydown',this.onKey);
    document.removeEventListener('visibilitychange',this.onVisibility);
    this.graph?.nodes.forEach(node=>node.disconnect());this.context?.close();
  }
}

// Development-only numerical check of the actual Web Audio graph and limiter.
export async function auditAudio(canvas) {
  const cases=[['clear',{wind:.55,rain:0},null],['storm',{wind:2.25,rain:.93},null],
    ['motor',{wind:.55,rain:0},{active:true,dynamics:{throttle:1,speed:14}}],['muted',{wind:2.25,rain:.93},null]];
  const results=[];
  for(const [name,weather,player] of cases) {
    const context=new OfflineAudioContext(2,48000*2,48000),graph=createAmbienceGraph(context);
    setAmbience(graph,context,weather,player,name==='muted',true);
    const rendered=await context.startRendering();let peak=0,energy=0,finite=true;
    for(let c=0;c<2;c++)for(const value of rendered.getChannelData(c)) {
      finite=finite&&Number.isFinite(value);peak=Math.max(peak,Math.abs(value));energy+=value*value;
    }
    results.push({name,peak,rms:Math.sqrt(energy/(rendered.length*2)),finite,nodes:graph.nodes.length,bufferBytes:graph.buffer.length*8});
    graph.nodes.forEach(node=>node.disconnect());
  }
  const clear=results[0],storm=results[1],muted=results[3];
  canvas.dataset.audioAudit=JSON.stringify({pass:results.every(x=>x.finite&&x.peak<.3)&&storm.rms>clear.rms*1.5&&muted.peak===0,results});
}
