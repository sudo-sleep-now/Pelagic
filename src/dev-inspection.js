import * as THREE from 'three';
import { hullSeparation } from './traffic/spacing.js';
import { waveGLSL } from './ocean/waves.js';
import { PACKET_COUNT, HULL_COUNT,PACKET_LIFE } from './ocean/disturbances.js';
import { assetUrl } from './asset-url.js';
// Imported only by Vite's development branch. URL overrides allow visual QA with no scene UI.
export async function inspectFromURL({camera,controls,weather,waves,environment,ocean}) {
  const params=new URLSearchParams(location.search);
  ocean.uniforms.uDiagnostic.value=Number(params.get('surface')||0);
  const marine=['marine','marineAsset'].includes(params.get('view'));
  const manifest=await (await fetch(assetUrl(marine?'models/marine-manifest.json':'models/manifest.json'))).json();
  const options={hour:params.has('hour')?Number(params.get('hour')):undefined,time:params.has('time')?Number(params.get('time')):undefined,view:params.get('view'),kind:params.get('kind')||(marine?'whale':'cargo'),stage:params.get('stage')||'surface',angle:params.get('angle')||'starboard',fraction:Number(params.get('fraction')||.5),pilot:params.has('pilot'),playerCamera:params.get('camera')||'chase'};
  if(!manifest[options.kind])options.kind=marine?'whale':'cargo';
  const length=manifest[options.kind].length;
  if(params.has('weather')) {weather.set(params.get('weather'),true);waves.strength=weather.current.wind;waves.direction=weather.current.angle;waves.sync();}
  if(options.view==='asset'||options.view==='marineAsset') {
    ocean.setVisible(false);
    const angles={starboard:[160,65,110],port:[-160,65,-110],top:[5,235,35],low:[170,5,70],bow:[20,30,-175],stern:[20,30,175]};
    camera.position.set(...(angles[options.angle]||angles.starboard));
    camera.position.multiplyScalar(length/174);
    const bounds=manifest[options.kind].bounds;
    controls.target.set((bounds.min[0]+bounds.max[0])*.5,(bounds.min[1]+bounds.max[1])*.5,(bounds.min[2]+bounds.max[2])*.5);
    const direction=camera.position.clone().sub(controls.target).normalize();
    const right=new THREE.Vector3().crossVectors(camera.up,direction).normalize();
    const up=new THREE.Vector3().crossVectors(direction,right).normalize();
    const tanV=Math.tan(camera.fov*Math.PI/360),tanH=tanV*camera.aspect;
    let distance=0;
    for(let corner=0;corner<8;corner++) {
      const p=new THREE.Vector3(bounds[corner&1?'max':'min'][0],bounds[corner&2?'max':'min'][1],bounds[corner&4?'max':'min'][2]).sub(controls.target);
      distance=Math.max(distance,p.dot(direction)+Math.abs(p.dot(right))/tanH,p.dot(direction)+Math.abs(p.dot(up))/tanV);
    }
    camera.position.copy(controls.target).addScaledVector(direction,distance*1.16);
    controls.minDistance=Math.max(1.5,length*.07);controls.maxDistance=Math.max(500,distance*2);controls.update();
  } else if(options.view==='marine') {
    controls.minDistance=12;controls.maxDistance=100;
    const angles={starboard:[23,15,20],port:[-23,15,-20],top:[1,32,3],low:[24,12,9]};
    if(options.stage==='underwater'){camera.position.set(26,-2,20);controls.target.set(0,-6,0);}
    else {camera.position.set(...(angles[options.angle]||angles.starboard));controls.target.set(0,-1,0);}
    controls.update();
  } else if(options.view==='ship') {
    const loc={cargo:[-1450,-900],tanker:[-900,-700],fishing:[-350,-500],tug:[250,-300],yacht:[850,-100],ferry:[1450,100],carrier:[-1200,300],bulk:[0,500],destroyer:[1100,700],trawler:[450,900]}[options.kind]??[950,1050];
    const k=length/333;controls.minDistance=Math.max(15,length*.16);controls.maxDistance=Math.max(150,length*3);
    camera.position.set(loc[0]+320*k,Math.max(15,115*k),loc[1]+245*k);controls.target.set(loc[0],Math.max(1,length*.032),loc[1]);controls.update();
  } else if(options.view==='clip') {
    const scale=length/174;
    controls.minDistance=Math.max(1.5,length*.07);controls.maxDistance=Math.max(500,length*4);
    camera.position.set(2000+160*scale,60*scale,115*scale);controls.target.set(2000,12*scale,0);controls.update();
    if(options.angle==='low')camera.position.set(2000+140*scale,10*scale,65*scale);
    if(options.angle==='above')camera.position.set(2000+80*scale,160*scale,90*scale);
    if(options.angle==='inside')camera.position.set(2000-130*scale,50*scale,70*scale);
  } else if(options.view==='caustics') {
    ocean.setVisible(false);
    const patch=new THREE.Mesh(new THREE.PlaneGeometry(64,64),new THREE.MeshBasicMaterial({map:ocean.caustics.target.texture,toneMapped:false}));
    patch.rotation.x=-Math.PI/2;ocean.mesh.parent.add(patch);
    camera.position.set(0,76,0);controls.target.set(0,0,0);controls.update();
  } else if(options.view==='seabed') {
    camera.position.set(1460,105,1110);controls.target.set(1510,-22,990);controls.update();
  } else if(options.view==='volume') {
    ocean.volumeDebug=true;
    camera.position.set(2630,360,2350);controls.target.set(580,-65,710);controls.update();
  } else if(options.view==='close') {
    camera.position.set(1130,115,1230); controls.target.set(950,5,1050); controls.update();
  } else if(options.view==='waterline') {
    camera.position.set(1075,12,1175);controls.target.set(900,3,1000);controls.minDistance=15;controls.update();
  } else if(options.view==='sky') {
    controls.maxPolarAngle=Math.PI*.95;camera.position.set(1130,40,1230);controls.target.set(950,300,1050);controls.update();
  }
  return options;
}
export function publishMetrics(canvas,renderer,stats) {
  const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
  canvas.dataset.renderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  canvas.dataset.vendor=debug?gl.getParameter(debug.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR);
  canvas.dataset.stats=JSON.stringify(stats);
}

// Read the actual shared GLSL back from a floating-point render target. Samples
// include both pressure shoulders and travelling packet lobes, not just open sea.
export function auditWaveAgreement({waves,renderer,canvas}) {
  const points=[[0,0],[1100,1500],[-1700,400],[1400,-1300]], d=waves.disturbances;
  for(let i=0;i<HULL_COUNT;i++) {
    const h=d.hulls[i],s=d.hullShape[i];
    if(s.z>0)for(const fraction of [.27,.38,.49])points.push([h.x+h.z*s.x*fraction*s.w,h.y+h.w*s.x*fraction*s.w]);
  }
  for(let i=0;i<PACKET_COUNT;i++) {
    const a=d.a[i],b=d.b[i],c=d.c[i],age=waves.time-a.z;
    if(a.w<=0||age<.1||age>PACKET_LIFE)continue;
    const cg=c.y/(2*b.z),sn=Math.sqrt(1-c.x*c.x);
    for(const side of [-1,1])points.push([a.x+(b.x*c.x+b.y*sn*side)*cg*age,a.y+(b.y*c.x-b.x*sn*side)*cg*age]);
  }
  const n=points.length,positions=new Float32Array(n*3),data=new Float32Array(n*4);
  points.forEach(([x,z],i)=>positions.set([x,i,z],i*3));
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  const material=new THREE.ShaderMaterial({uniforms:waves.uniforms,depthTest:false,depthWrite:false,
    vertexShader:`varying vec2 vProbe;void main(){vProbe=position.xz;gl_Position=vec4((position.y+.5)/${n.toFixed(1)}*2.0-1.0,0.0,0.0,1.0);gl_PointSize=1.0;}`,
    fragmentShader:`varying vec2 vProbe;${waveGLSL}\nvoid main(){vec2 q=vProbe;vec3 normal;float compression;for(int i=0;i<6;i++){vec3 p=baseWavePosition(q,normal,compression);q+=vProbe-p.xz;}wavePosition(q,normal,compression);gl_FragColor=vec4(waterHeight(vProbe),normal);}`});
  const scene=new THREE.Scene(),mesh=new THREE.Points(geometry,material);mesh.frustumCulled=false;scene.add(mesh);
  const target=new THREE.WebGLRenderTarget(n,1,{type:THREE.FloatType,format:THREE.RGBAFormat,depthBuffer:false,stencilBuffer:false});
  const previous=renderer.getRenderTarget();
  const report={time:waves.time,samples:n,activePackets:d.active,maxHeightError:0,maxNormalError:0,maxDisturbance:0,finite:true};
  try {
    renderer.setRenderTarget(target);renderer.render(scene,new THREE.Camera());renderer.readRenderTargetPixels(target,0,0,n,1,data);
    const out={};
    points.forEach((_,i)=>{
      // Match the vertex attribute's float precision before comparing CPU doubles.
      waves.sample(positions[i*3],positions[i*3+2],out);
      report.maxHeightError=Math.max(report.maxHeightError,Math.abs(out.y-data[i*4]));
      report.maxNormalError=Math.max(report.maxNormalError,Math.hypot(out.nx-data[i*4+1],out.ny-data[i*4+2],out.nz-data[i*4+3]));
      report.maxDisturbance=Math.max(report.maxDisturbance,Math.abs(waves.disturbanceWork.height));
      report.finite&&=data.slice(i*4,i*4+4).every(Number.isFinite)&&data[i*4+2]>.1;
    });
  } finally {renderer.setRenderTarget(previous);target.dispose();geometry.dispose();material.dispose();}
  canvas.dataset.physicsAudit=JSON.stringify(report);return report;
}

export function warmPhysicsAudit({traffic,player,waves,wakes,weather,environment,camera,renderer,marine,startTime=0}) {
  let time=startTime;
  for(let step=0;step<400;step++) {
    const dt=.05;time+=dt;weather.update(dt);waves.update(dt,time,weather.current.wind,weather.current.angle);
    traffic.update(dt,time,camera);player?.update(dt,time);marine?.update(dt,time,camera,traffic,player);wakes.update(time);environment.update(dt,time,weather.current,camera,renderer);
  }
  return time;
}

// Runs real traffic, buoyancy and wake systems without waiting two hours in the browser.
// No new ships or buffers may appear during recycling; the saved report lives on the canvas dataset.
export async function acceleratedAudit({traffic,wakes,waves,weather,camera,scene,canvas,renderer,environment,rain,ocean,player,marine,startTime=0}) {
  const count=()=>{let n=0;scene.traverse(()=>n++);return n;};
  const resources=()=>({objects:count(),vessels:traffic.vessels.length,playerBoats:player?1:0,wakeBytes:wakes.origins.byteLength+wakes.shapes.byteLength+wakes.owners.byteLength+wakes.drifts.byteLength+wakes.tracks.byteLength,gravityUniformVectors:PACKET_COUNT*3+HULL_COUNT*2,gravityTypedBytes:waves.disturbances.clocks.byteLength+waves.disturbances.hullVelocity.byteLength,
    cloudNoiseBytes:environment.clouds.noise.image.data.byteLength,cloudAtlasBytes:environment.clouds.target.width*environment.clouds.target.height*8});
  const before=resources();
  const vessels=player?[...traffic.vessels,player.vessel]:traffic.vessels;
  const uniqueGeometry=new Set();scene.traverse(o=>{if(o.geometry)uniqueGeometry.add(o.geometry.id);});
  const geometryBudget=uniqueGeometry.size;
  let t=startTime,minClearance=Infinity,minHullSeparation=Infinity,minPlayerSeparation=Infinity,maxPlayerRadius=0,closest,maxRadius=0,maxActive=0,maxRain=0,maxGravity=0;
  const marineAudit={finite:true,maxRadius:0,minDepth:Infinity,maxDepth:0,minVesselGap:Infinity};
  const physics={finite:true,maxHeave:0,maxPitch:0,maxRoll:0,maxImpact:0,minWet:1,maxWet:0,hulls:{}};
  for(const v of vessels)physics.hulls[v.name+(v===player?.vessel?'-player':'')]={mass:v.buoyancy.mass,maxHeave:0,maxPitch:0,maxRoll:0};
  const checkpoints=[];
  for(let step=0;step<28800;step++) {
    const dt=.25;t+=dt;weather.update(dt);waves.update(dt,t,weather.current.wind,weather.current.angle);
    environment.update(dt,t,weather.current,camera,renderer);
    traffic.update(dt,t,camera);player?.update(dt,t);marine?.update(dt,t,camera,traffic,player);wakes.update(t);rain.update(camera,weather.current.rain);
    maxActive=Math.max(maxActive,wakes.active);maxRain=Math.max(maxRain,rain.geometry.instanceCount);
    maxGravity=Math.max(maxGravity,waves.disturbances.active);
    if(marine)for(const a of marine.behavior.animals){marineAudit.finite&&=[a.x,a.z,a.depth,a.pitch,a.roll,a.stroke,a.scale].every(Number.isFinite);marineAudit.maxRadius=Math.max(marineAudit.maxRadius,Math.hypot(a.x,a.z));marineAudit.minDepth=Math.min(marineAudit.minDepth,a.depth);marineAudit.maxDepth=Math.max(marineAudit.maxDepth,a.depth);
      for(const v of vessels){const dx=a.x-v.root.position.x,dz=a.z-v.root.position.z,c=Math.cos(v.yaw),s=Math.sin(v.yaw),f=-dx*s-dz*c,r=dx*c-dz*s;
        const horizontal=Math.hypot(Math.max(0,Math.abs(f)-v.spec.length*.5),Math.max(0,Math.abs(r)-v.spec.beam*.5))-(a.kind==='whale'?7.5:4)*a.scale;
        const radius=(a.kind==='whale'?1.4:.8)*a.scale,vertical=(v.root.position.y-v.spec.draft)-(a.height+radius);
        marineAudit.minVesselGap=Math.min(marineAudit.minVesselGap,Math.max(horizontal,vertical));}}
    for(const v of vessels) {
      const b=v.buoyancy,f=b.feedback;
      physics.finite&&=Number.isFinite(b.heave)&&Number.isFinite(b.pitch)&&Number.isFinite(b.roll)&&Number.isFinite(f.wetFraction)&&Number.isFinite(f.impact);
      physics.maxHeave=Math.max(physics.maxHeave,Math.abs(b.heave));physics.maxPitch=Math.max(physics.maxPitch,Math.abs(b.pitch));physics.maxRoll=Math.max(physics.maxRoll,Math.abs(b.roll));physics.maxImpact=Math.max(physics.maxImpact,f.impact);physics.minWet=Math.min(physics.minWet,f.wetFraction);physics.maxWet=Math.max(physics.maxWet,f.wetFraction);
      const hull=physics.hulls[v.name+(v===player?.vessel?'-player':'')];
      if(Math.abs(b.heave)>hull.maxHeave){hull.maxHeave=Math.abs(b.heave);hull.heaveTime=t;}
      if(Math.abs(b.pitch)>hull.maxPitch){hull.maxPitch=Math.abs(b.pitch);hull.pitchTime=t;}
      if(Math.abs(b.roll)>hull.maxRoll){hull.maxRoll=Math.abs(b.roll);hull.rollTime=t;}
    }
    if(player)maxPlayerRadius=Math.max(maxPlayerRadius,Math.hypot(player.dynamics.x,player.dynamics.z));
    for(let i=0;i<traffic.vessels.length;i++) {
      const a=traffic.vessels[i];maxRadius=Math.max(maxRadius,Math.hypot(a.pose.x,a.pose.z));
      if(player)minPlayerSeparation=Math.min(minPlayerSeparation,hullSeparation(a,player.vessel));
      for(let j=i+1;j<traffic.vessels.length;j++) {
        const b=traffic.vessels[j];const gap=Math.hypot(a.pose.x-b.pose.x,a.pose.z-b.pose.z)-(a.spec.length+b.spec.length)*.5;
        minClearance=Math.min(minClearance,gap);
        if(Math.hypot(a.pose.x,a.pose.z)<2000 && Math.hypot(b.pose.x,b.pose.z)<2000) {
          const hullGap=hullSeparation(a,b);
          if(hullGap<minHullSeparation){minHullSeparation=hullGap;closest={time:t,a:a.id,b:b.id,ax:a.pose.x,az:a.pose.z,bx:b.pose.x,bz:b.pose.z,ayaw:a.yaw,byaw:b.yaw};}
        }
      }
    }
    if((step+1)%2400===0) {
      ocean.update(renderer,t);renderer.render(scene,camera);
      checkpoints.push({time:t,objects:count(),vessels:traffic.vessels.length,recycles:traffic.recycles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,wakeActive:wakes.active,gravityPackets:waves.disturbances.active,hour:environment.hour,weather:weather.name,rainCount:rain.geometry.instanceCount});
    }
    if((step+1)%120===0){canvas.dataset.auditProgress=String((step+1)*.25);await new Promise(resolve=>setTimeout(resolve,0));}
  }
  const report={seconds:t-startTime,before,after:resources(),fleet:traffic.vessels.map(v=>v.name),trafficStates:traffic.vessels.map(v=>({name:v.name,speed:v.speed,maxStoppedAge:v.maxStoppedAge,age:v.age})),routeGuards:traffic.contacts,geometryBudget,maxActive,maxRain,maxGravity,physics,marineAudit,marine:marine?.stats(),minClearance,minHullSeparation,minPlayerSeparation,maxPlayerRadius,closest,maxRadius,checkpoints};
  canvas.dataset.audit=JSON.stringify(report);return t;
}

// Separate draw submission from frame cadence. Optional GPU timer queries measure actual
// device execution; background-tab throttling must not be reported as rendering cost.
export async function benchmarkRenderer({renderer,scene,camera,ocean,canvas,startTime=0}) {
  const gl=renderer.getContext(),extension=gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const costs=[],queries=[];
  for(let i=0;i<20;i++) {
    const query=extension&&i>=4?gl.createQuery():null;
    if(query)gl.beginQuery(extension.TIME_ELAPSED_EXT,query);
    const start=performance.now();ocean.update(renderer,startTime+i*.1);renderer.render(scene,camera);gl.flush();
    if(i>=4)costs.push(performance.now()-start);
    if(query){gl.endQuery(extension.TIME_ELAPSED_EXT);queries.push(query);}
  }
  costs.sort((a,b)=>a-b);
  const result={samples:costs.length,medianSubmissionMs:costs[Math.floor(costs.length*.5)],p95SubmissionMs:costs[Math.floor(costs.length*.95)],gpuTimingAvailable:Boolean(extension),width:canvas.width,height:canvas.height,pixelRatio:renderer.getPixelRatio(),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,causticTriangles:ocean.caustics.scene.children[0].geometry.index.count/3,
    cloudAtlas:[ocean.environment.clouds.target.width,ocean.environment.clouds.target.height],cloudSteps:ocean.environment.clouds.uniforms.uMarchSteps.value,cloudMaxHz:5};
  canvas.dataset.benchmark=JSON.stringify(result);
  if(extension) {
    const deadline=performance.now()+10000;
    while(!gl.getQueryParameter(queries.at(-1),gl.QUERY_RESULT_AVAILABLE)&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
    if(!gl.getParameter(extension.GPU_DISJOINT_EXT)&&gl.getQueryParameter(queries.at(-1),gl.QUERY_RESULT_AVAILABLE)) {
      const timings=queries.map(query=>gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6).sort((a,b)=>a-b);
      result.medianGpuMs=timings[Math.floor(timings.length*.5)];result.p95GpuMs=timings[Math.floor(timings.length*.95)];
    }
    queries.forEach(query=>gl.deleteQuery(query));canvas.dataset.benchmark=JSON.stringify(result);
  }
  return result;
}
