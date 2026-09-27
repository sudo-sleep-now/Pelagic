import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CONFIG,VESSEL_NAMES } from './config.js';
import { Waves } from './ocean/waves.js';
import { Ocean } from './ocean/ocean.js';
import { Boundary } from './boundary.js';
import { Weather } from './environment/weather.js';
import { Environment } from './environment/lighting.js';
import { VesselAssets } from './vessels/assets.js';
import { Traffic } from './traffic/traffic.js';
import { Wakes } from './effects/wakes.js';
import { Rain } from './effects/rain.js';
import { PlayerBoat } from './player/player-boat.js';
import { OceanAudio } from './environment/audio.js';
import { MarineLife } from './marine/marine-life.js';
import { PACKET_COUNT } from './ocean/disturbances.js';

const canvas=document.getElementById('ocean');
const audio=new OceanAudio(canvas);
if(import.meta.env.DEV&&new URLSearchParams(location.search).has('audioAudit')) {
  const {auditAudio}=await import('./environment/audio.js');await auditAudio(canvas);
}
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,stencil:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,CONFIG.pixelRatio));
renderer.setSize(innerWidth,innerHeight); renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(44,innerWidth/innerHeight,1,18000);
camera.position.set(...CONFIG.camera.position);
if(camera.aspect<.75) {camera.fov=70;camera.position.multiplyScalar(2.2);camera.updateProjectionMatrix();}
else if(camera.aspect<1.55)camera.position.multiplyScalar(1.55/camera.aspect);
const controls=new OrbitControls(camera,canvas);
controls.target.set(...CONFIG.camera.target); controls.enableDamping=true; controls.dampingFactor=.055;
controls.enablePan=false; controls.minDistance=CONFIG.camera.minDistance; controls.maxDistance=CONFIG.camera.maxDistance;
controls.minPolarAngle=.12; controls.maxPolarAngle=Math.PI*.475; controls.rotateSpeed=.5; controls.zoomSpeed=.8;
controls.update();
const boundary=new Boundary(CONFIG.radius,CONFIG.center), waves=new Waves(), weather=new Weather(), environment=new Environment(scene);
const inspectionWaveSample={x:0,y:0,z:0,nx:0,ny:1,nz:0};
const ocean=new Ocean(scene,waves,environment,boundary,CONFIG,camera);
let inspection={};
if(import.meta.env.DEV) {const {inspectFromURL}=await import('./dev-inspection.js'); inspection=await inspectFromURL({camera,controls,weather,waves,environment,ocean});}
const assets=new VesselAssets(boundary,ocean.optics);
const wakes=new Wakes(scene,waves,environment,boundary), rain=new Rain(scene,environment,boundary);
const marine=new MarineLife({scene,waves,wakes,environment,boundary,optics:ocean.optics,inspection});
let traffic,player,assetsReady=false;
Promise.all([assets.load(VESSEL_NAMES),marine.load()]).then(()=>{
  traffic=new Traffic(scene,assets,waves,wakes,boundary,environment,inspection);
  if(!['asset','clip','caustics','marine','marineAsset'].includes(inspection.view)) {
    player=new PlayerBoat({scene,assets,waves,wakes,traffic,environment,camera,controls,canvas});
    if(inspection.pilot){player.enter(true);if(inspection.playerCamera==='helm')player.toggleCamera();}
  }
  assetsReady=true;
  if(import.meta.env.DEV) {
    const params=new URLSearchParams(location.search);
    if(['audit','physicsAudit','benchmark'].some(key=>params.has(key)))import('./dev-inspection.js').then(async({acceleratedAudit,warmPhysicsAudit,auditWaveAgreement,benchmarkRenderer})=>{
      // One sequence owns the simulation clock when combining inspection modes.
      if(params.has('audit')){auditing=true;try{time=await acceleratedAudit({traffic,wakes,waves,weather,camera,scene,canvas,renderer,environment,rain,ocean,player,marine,startTime:time});}finally{auditing=false;}}
      if(params.has('physicsAudit')) {
        time=warmPhysicsAudit({traffic,player,waves,wakes,weather,environment,camera,renderer,marine,startTime:time});
        auditWaveAgreement({waves,renderer,canvas});
      }
      if(params.has('benchmark'))await benchmarkRenderer({renderer,scene,camera,ocean,canvas,startTime:time});
      previous=performance.now();
    });
  }
}).catch(error=>{canvas.dataset.ready='error';console.error('Asset load failed:',error);});
let time=0, previous=performance.now(), paused=false,auditing=false,frozenHour=inspection.hour;
let frames=0, qualityFrames=0, recentSum=0, recentCount=0;
const samples=new Float32Array(240); let sampleIndex=0;
function frame(now) {
  if(auditing){previous=now;return;}
  const frameMs=now-previous; previous=now;
  const dt=paused||inspection.time!==undefined?0:Math.min(frameMs/1000,.05);
  time=inspection.time??time+dt;
  weather.update(dt); waves.update(dt,time,weather.current.wind,weather.current.angle);
  if(!player?.ownsCamera) {controls.maxPolarAngle=['asset','marineAsset','sky'].includes(inspection.view)?Math.PI*.95:inspection.view==='clip'?Math.PI*.495:Math.min(Math.PI*.475,Math.acos(Math.min(.99,12/controls.getDistance())));
  controls.update();
  if(inspection.view==='clip') {waves.sample(camera.position.x,camera.position.z,inspectionWaveSample);camera.position.y=Math.max(camera.position.y,inspectionWaveSample.y+1.1);}
  else if(!['asset','marineAsset'].includes(inspection.view))camera.position.y=Math.max(camera.position.y,12);}
  if(traffic)traffic.update(dt,time,camera);
  if(inspection.view==='ship'&&traffic){const v=traffic.vessels.find(v=>v.name===inspection.kind);if(v){camera.position.x+=v.root.position.x-controls.target.x;camera.position.z+=v.root.position.z-controls.target.z;controls.target.x=v.root.position.x;controls.target.z=v.root.position.z;controls.update();}}
  player?.update(dt,time);
  marine.update(dt,time,camera,traffic,player);
  environment.update(dt,time,weather.current,camera,renderer,frozenHour);
  audio.update(weather.current,player);
  wakes.update(time);rain.update(camera,weather.current.rain);
  const focus=player?.active?player.vessel.root.position:camera.position.y<150?camera.position:controls.target;
  ocean.setFocus(focus.x,focus.z,dt);
  ocean.update(renderer,time);
  renderer.render(scene,camera);
  if(assetsReady&&canvas.dataset.ready!=='true')canvas.dataset.ready='true';
  if(import.meta.env.DEV && assetsReady && frames%60===0 && window.__ocean) {canvas.dataset.stats=JSON.stringify(window.__ocean.stats());canvas.dataset.marine=JSON.stringify(marine.stats()); const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');canvas.dataset.renderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);canvas.dataset.browser=navigator.userAgent;}
  if(frameMs<250 && frameMs>0 && !paused) {
    const index=sampleIndex++%240;recentSum-=samples[index];samples[index]=frameMs;recentSum+=frameMs;
    recentCount=Math.min(240,recentCount+1);frames++;
  }
  if(recentCount>=120 && recentSum/recentCount>28)qualityFrames++;else qualityFrames=0;
  if(qualityFrames>90 && renderer.getPixelRatio()>CONFIG.minPixelRatio) {
    renderer.setPixelRatio(Math.max(CONFIG.minPixelRatio,renderer.getPixelRatio()*.85)); ocean.reduceQuality(); qualityFrames=0;
    samples.fill(0);recentSum=0;recentCount=0;
  }
}
renderer.setAnimationLoop(frame);
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.fov=camera.aspect<.75?70:44;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
addEventListener('visibilitychange',()=>{paused=document.hidden;previous=performance.now();});
if(import.meta.hot)import.meta.hot.dispose(()=>audio.dispose());
// Development-only inspection API; never creates or overlays UI and is absent from production builds.
if(import.meta.env.DEV) window.__ocean={scene,camera,renderer,controls,waves,weather,environment,ocean,
  setHour(hour){frozenHour=hour;}, resumeDay(){frozenHour=undefined;},
  setWeather(name,instant=true){weather.set(name,instant);},
  get traffic(){return traffic;},get player(){return player;},marine,stats(){const sorted=Array.from(samples).filter(x=>x>0).sort((a,b)=>a-b); return {time,hour:environment.hour,weather:weather.name,vessels:traffic?.vessels.length??0,playerBoats:player?1:0,marineAnimals:marine.animals.length,recycles:traffic?.recycles??0,wakeActive:wakes.active,wakeCapacity:wakes.capacity,gravityPackets:waves.disturbances.active,gravityCapacity:PACKET_COUNT,rainCount:rain.geometry.instanceCount,cameraY:camera.position.y,cameraDistance:controls.getDistance(),frameMedianMs:sorted[Math.floor(sorted.length*.5)],frameP95Ms:sorted[Math.floor(sorted.length*.95)],pixelRatio:renderer.getPixelRatio(),geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};},
};
