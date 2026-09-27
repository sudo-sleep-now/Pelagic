import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG,damp,smoothstep } from '../config.js';
import { MarineBehavior,MARINE_STARTS } from './behavior.js';
import { MarineSpray } from './spray.js';
import { assetUrl } from '../asset-url.js';

export class MarineLife {
  constructor({scene,waves,wakes,environment,boundary,optics,inspection={}}) {
    Object.assign(this,{scene,waves,wakes,environment,boundary,optics,inspection});this.behavior=new MarineBehavior();this.animals=[];
    this.spray=new MarineSpray(scene,environment,boundary);this.sample={};this.anchor=new THREE.Vector3();this.tailPoint=new THREE.Vector3();this.blows=0;this.tailPulses=0;
  }
  async load() {
    this.manifest=await(await fetch(assetUrl('models/marine-manifest.json'))).json();const loader=new GLTFLoader(),models=new Map();
    await Promise.all(['whale','orca'].map(async kind=>{
      const [high,low]=await Promise.all([loader.loadAsync(assetUrl(`models/${kind}.glb`)),loader.loadAsync(assetUrl(`models/${kind}-low.glb`))]);
      for(const gltf of [high,low])gltf.scene.traverse(m=>{if(m.isMesh){m.material.transparent=false;m.material.depthWrite=true;m.material.side=THREE.FrontSide;m.material.envMapIntensity=.85;
        this.boundary.apply(m.material);this.boundary.attachDepth(m);this.optics.prepare(m,false);m.receiveShadow=true;m.renderOrder=5;}});
      models.set(kind,{high:high.scene,low:low.scene});
    }));
    const inspect=['marine','marineAsset'].includes(this.inspection.view);
    if(inspect){this.behavior=new MarineBehavior([[this.inspection.kind,0,0,0,137,.78,-1]]);this.behavior.animals[0].scale=1;}
    for(const a of this.behavior.animals) {
      const model=models.get(a.kind),root=new THREE.Group(),high=model.high.clone(true),low=model.low.clone(true);root.add(high,low);root.scale.setScalar(a.scale);
      const parts=[high,low].map(level=>{const p={};level.traverse(o=>{for(const name of ['Tail','LeftFlipper','RightFlipper'])if(o.name.startsWith(name))p[name]=o;});return p;});
      const spec=this.manifest[a.kind],v={state:a,id:CONFIG.trafficCount+1+a.index,name:a.kind,root,high,low,parts,spec,yaw:a.yaw,speed:a.speed,pendingBreath:-1,buoyancy:{feedback:{}}};
      for(const level of [high,low])level.traverse(m=>{
        if(!m.isMesh||!m.name.startsWith('Body'))return;
        m.material=m.material.clone();delete m.material.userData.oceanOptics;
        this.boundary.apply(m.material);this.optics.prepare(m,false);
        const before=m.material.onBeforeCompile,stroke={value:0},length={value:spec.length};
        m.material.onBeforeCompile=(shader,renderer)=>{
          before.call(m.material,shader,renderer);Object.assign(shader.uniforms,{uSwimStroke:stroke,uAnimalLength:length});
          shader.vertexShader=`uniform float uSwimStroke,uAnimalLength;
            float swimSlope(float z){float u=clamp(z/(uAnimalLength*.38),0.0,1.0);float f=u*u*(3.0-2.0*u);
              float df=(u>0.0&&u<1.0)?6.0*u*(1.0-u)/(uAnimalLength*.38):0.0;float phase=uSwimStroke-z/uAnimalLength*2.0;
              return (sin(phase)*2.0*f*df-cos(phase)*f*f*2.0/uAnimalLength)*uAnimalLength*.009;}
          `+shader.vertexShader;
          shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nobjectNormal.z-=objectNormal.y*swimSlope(position.z);');
          shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
            float flex=smoothstep(0.0,uAnimalLength*.38,position.z);
            transformed.y+=sin(uSwimStroke-position.z/uAnimalLength*2.0)*flex*flex*uAnimalLength*.009;
          `);
        };
        m.material.customProgramCacheKey=()=>`marine-body-flex-v1`;
        m.onBeforeRender=()=>{stroke.value=a.stroke;};
      });
      root.position.set(a.x,-a.depth,a.z);a.height=root.position.y;this.scene.add(root);this.animals.push(v);
    }
    return this;
  }
  update(dt,time,camera,traffic,player) {
    if(!this.animals.length)return;
    const vessels=traffic?.vessels??[];this.behavior.update(dt,time,vessels,player?.vessel);
    const isolated=['marine','marineAsset'].includes(this.inspection.view);
    for(const v of this.animals) {
      const a=v.state,whale=a.kind==='whale';
      if(isolated) {
        a.x=a.z=0;a.yaw=0;
        const stage=this.inspection.stage;
        a.depth=stage==='underwater'?6:stage==='dive'?1.1:.62;a.pitch=stage==='dive'?-.38:0;a.roll=0;
        a.wet=stage==='underwater'?0:1;a.state=stage??'surfacing';
        if(stage==='surface'&&time<.2)a.breath=true;
      }
      const s=this.waves.sample(a.x,a.z,this.sample,false,v.id);
      const surfaceInfluence=1-Math.min(1,a.depth/6);
      const target=s.y*surfaceInfluence-a.depth*a.scale;
      a.height=damp(a.height,target,whale?2.2:3.5,dt);
      v.root.position.set(a.x,this.inspection.view==='marineAsset'?0:a.height,a.z);v.yaw=a.yaw;v.speed=a.speed;
      v.root.rotation.set(a.pitch,a.yaw,a.roll,'YXZ');
      const distance=camera.position.distanceTo(v.root.position),detail=distance<(whale?550:330)||isolated;
      v.high.visible=detail;v.low.visible=!detail;
      const tailAngle=Math.sin(a.stroke)*(whale?.13:.23);
      for(const p of v.parts) {
        if(p.Tail){p.Tail.rotation.x=tailAngle;const z=p.Tail.position.z,flex=smoothstep(0,v.spec.length*.38,z);p.Tail.position.y=Math.sin(a.stroke-z/v.spec.length*2)*flex*flex*v.spec.length*.009;}
        if(p.LeftFlipper)p.LeftFlipper.rotation.z=.10+Math.sin(a.stroke*.5)*.06+a.roll*.7;
        if(p.RightFlipper)p.RightFlipper.rotation.z=-.10-Math.sin(a.stroke*.5+.4)*.06+a.roll*.7;
      }
      v.root.updateMatrixWorld(true);
      this.anchor.fromArray(v.spec.blowhole).applyMatrix4(v.root.matrixWorld);
      const headSurface=this.waves.sample(this.anchor.x,this.anchor.z,this.sample,false,v.id).y;
      // A breath is visible only once the actual blowhole emerges through the local wave.
      if(a.breath)v.pendingBreath=time;
      if(v.pendingBreath>=0&&time-v.pendingBreath<2.5&&this.anchor.y>headSurface-.12&&this.inspection.view!=='marineAsset') {this.spray.emit(this.anchor,time,whale);this.blows++;v.pendingBreath=-1;}
      if(a.tailSplash&&this.inspection.view!=='marineAsset') {
        this.tailPoint.set(0,.1,v.spec.length*.38).applyMatrix4(v.root.matrixWorld);
        const tailWater=this.waves.sample(this.tailPoint.x,this.tailPoint.z,this.sample,false,v.id).y;
        if(this.tailPoint.y>tailWater-.7) {
          this.tailPoint.y=tailWater+.07;this.spray.emit(this.tailPoint,time,whale,true);
          this.waves.disturbances.pulse(v.id,this.tailPoint.x,this.tailPoint.z,a.yaw,whale?.50:.22,whale?3:1.6,whale?12:6,time);
          this.wakes.emit(v.id,this.tailPoint.x,this.tailPoint.z,a.yaw,v.spec.beam,a.speed,time,0,0,whale?1.2:.65,4);this.tailPulses++;
        }
      }
      const f=v.buoyancy.feedback;f.forwardSpeed=a.speed;f.wetFraction=a.wet;f.bowWet=a.wet*.75;f.sternWet=a.wet*.6;f.impact=0;
      f.waterVx=s.vx;f.waterVz=s.vz;f.hullVx=-Math.sin(a.yaw)*a.speed;f.hullVz=-Math.cos(a.yaw)*a.speed;
      if(this.inspection.view!=='marineAsset'){this.waves.disturbances.vessel(v,dt,time);this.wakes.follow(v,time,dt);this.wakes.bow(v,v.id);}
    }
    this.spray.update(time);
  }
  stats() {return {count:this.animals.length,blows:this.blows,tailPulses:this.tailPulses,sprayCapacity:this.spray.capacity,sprayEmitted:this.spray.emitted,animals:this.behavior.animals.map(a=>({kind:a.kind,x:a.x,z:a.z,depth:a.depth,state:a.state,phase:a.phase,scale:a.scale,blows:a.blows,dives:a.dives}))};}
}
