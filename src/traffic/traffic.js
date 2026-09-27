import * as THREE from 'three';
import { CONFIG, damp } from '../config.js';
import { Route } from './routes.js';
import { Buoyancy } from '../vessels/buoyancy.js';
import { boundaryGLSL } from '../boundary.js';
import { hullSeparation } from './spacing.js';

const INITIAL=[
  ['cargo',-1450,-900,-Math.PI/2],['tanker',-900,-700,Math.PI/2+.01],['fishing',-350,-500,-Math.PI/2-.01],
  ['tug',250,-300,Math.PI/2-.01],['yacht',850,-100,-Math.PI/2+.01],['ferry',1450,100,Math.PI/2+.01],
  ['carrier',-1200,300,-Math.PI/2],['bulk',0,500,Math.PI/2-.01],['destroyer',1100,700,-Math.PI/2-.01],['trawler',450,900,Math.PI/2],
];
export class Traffic {
  constructor(scene,assets,waves,wakes,boundary,environment,inspection={}) {
    this.scene=scene;this.assets=assets;this.waves=waves;this.wakes=wakes;this.boundary=boundary;this.environment=environment;
    this.inspection=inspection;this.recycles=0;this.contacts=0;this.vessels=[];
    const entries=['marine','marineAsset'].includes(inspection.view)?[]:inspection.view==='asset'||inspection.view==='clip'?[[inspection.kind,0,0,0]]:INITIAL.slice(0,CONFIG.trafficCount);
    entries.forEach(([name,x,z,yaw],id)=>{
      const v=assets.instantiate(name); v.id=id;v.route=new Route(x,z,yaw,id,CONFIG.radius);
      v.progress=v.route.initial;v.yaw=inspection.view==='clip'?-Math.PI/2:yaw;v.speed=v.spec.speed*(.87+id*.022);v.targetSpeed=v.speed;
      v.nominalSpeed=v.speed;v.pose={x,z,dx:0,dz:0,yaw};v.buoyancy=new Buoyancy(waves,v.spec);v.emitClock=id*.13;
      v.previousPose={...v.pose};v.guard={pose:v.previousPose,spec:v.spec,yaw};
      v.motion={vx:0,vz:0,yawRate:0,thrust:0,lateralAcceleration:0,owner:id};
      v.prediction={pose:{x:0,z:0,dx:0,dz:0,yaw:0},yaw:0,spec:v.spec};
      v.laneOffset=0;v.laneTarget=0;v.laneUntil=0;
      v.age=0;v.lights=this.navigationLights(v,boundary,environment);
      v.stoppedAge=0;v.maxStoppedAge=0;
      scene.add(v.root);this.vessels.push(v);
      if(inspection.view!=='asset'&&inspection.view!=='clip') for(let age=2;age<48;age+=1.7) {
        v.route.sample(v.progress-v.speed*age,v.pose);
        this.wakes.emit(id,CONFIG.center[0]+v.pose.x-v.pose.dx*v.spec.length*.44,CONFIG.center[1]+v.pose.z-v.pose.dz*v.spec.length*.44,v.pose.yaw,v.spec.beam,v.speed,-age);
      }
      v.route.sample(v.progress,v.pose);
    });
    boundary.createCap(scene);
  }
  navigationLights(v,boundary,environment) {
    const B=v.spec.beam,L=v.spec.length,F=v.spec.freeboard,H=v.spec.navigationHeight??F+7,Z=v.spec.navigationZ??L*.26,X=v.spec.navigationX??B*.44;
    const MH=v.spec.mastHeight??H+(L>100?9:4),MZ=v.spec.mastZ??Z;
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute([X,H,Z,-X,H,Z,0,MH,MZ,0,F+2,L*.46],3));
    g.setAttribute('color',new THREE.Float32BufferAttribute([.20,1,.34,1,.08,.04,1,.88,.62,1,.85,.57],3));
    const material=new THREE.ShaderMaterial({
      uniforms:{...boundary.uniforms,uNight:environment.uniforms.uNight},transparent:true,depthWrite:false,vertexColors:true,
      vertexShader:`uniform float uNight; varying vec3 vWorld; varying vec3 vColor; void main(){vWorld=(modelMatrix*vec4(position,1.0)).xyz;vColor=color;vec4 mv=viewMatrix*vec4(vWorld,1.0);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(1500.0/max(1.0,-mv.z),1.7,9.0);}`,
      fragmentShader:`${boundaryGLSL} uniform float uNight; varying vec3 vWorld;varying vec3 vColor; void main(){clipCircle(vWorld);float r=length(gl_PointCoord-.5);float a=(1.0-smoothstep(.05,.5,r))*uNight;if(a<.005)discard;gl_FragColor=vec4(vColor*1.6,a);#include <tonemapping_fragment>\n#include <colorspace_fragment>}`.replace(';#include',';\n#include'),
    });
    const points=new THREE.Points(g,material);points.renderOrder=7;v.root.add(points);return points;
  }
  avoidCollisions(time) {
    const vs=this.vessels;
    for(let i=0;i<vs.length;i++) {
      const v=vs[i];v.targetSpeed=v.nominalSpeed;
      if(time>=v.laneUntil)v.laneTarget=0;
    }
    for(let i=0;i<vs.length;i++)for(let j=i+1;j<vs.length;j++) {
      const a=vs[i],b=vs[j],ax=a.pose.x,bx=b.pose.x,az=a.pose.z,bz=b.pose.z;
      const px=bx-ax,pz=bz-az;
      // Predict the paths the ships are actually making. Using nominal speed here
      // keeps treating a yielded vessel as if it were crossing, which can lock an
      // entire knot of traffic into mutual standstills.
      const vx=b.pose.dx*b.speed-a.pose.dx*a.speed,vz=b.pose.dz*b.speed-a.pose.dz*a.speed;
      const speedSq=vx*vx+vz*vz;
      const t=speedSq>.04?-(px*vx+pz*vz)/speedSq:-1;
      let unsafe=false;
      if(t>.25&&t<120) {
        // Check the predicted oriented hulls, not a generous radius around their
        // centres. This permits parallel traffic to pass while retaining real clearance.
        const predictedA=a.prediction,predictedB=b.prediction;
        a.route.sample(a.progress+a.speed*t,predictedA.pose,a.laneTarget);
        b.route.sample(b.progress+b.speed*t,predictedB.pose,b.laneTarget);
        predictedA.yaw=predictedA.pose.yaw;predictedB.yaw=predictedB.pose.yaw;
        unsafe=hullSeparation(predictedA,predictedB)<42;
      }
      const currentGap=hullSeparation(a,b);
      const closing=px*vx+pz*vz<0;
      if(!unsafe&&currentGap<42&&closing)unsafe=true;
      if(unsafe) {
        const yieldVessel=a.spec.length===b.spec.length?(a.id>b.id?a:b):(a.spec.length<b.spec.length?a:b);
        const other=yieldVessel===a?b:a;
        const sign=(yieldVessel.id+other.id)%2?1:-1;
        const offset=sign*(yieldVessel.spec.beam+other.spec.beam)*.5+sign*30;
        yieldVessel.laneTarget=offset;
        yieldVessel.laneUntil=Math.max(yieldVessel.laneUntil,time+Math.max(24,Math.min(120,t>0?t+18:36)));
      }
    }
  }
  avoidPlayer() {
    const p=this.playerVessel;if(!p)return;
    for(const v of this.vessels) {
      const dx=p.pose.x-v.pose.x,dz=p.pose.z-v.pose.z;
      const vx=p.pose.dx*p.speed-v.pose.dx*v.speed,vz=p.pose.dz*p.speed-v.pose.dz*v.speed;
      const t=Math.max(0,Math.min(65,-(dx*vx+dz*vz)/Math.max(.001,vx*vx+vz*vz)));
      const clearance=(v.spec.length+p.spec.length)*.55+30;
      if(Math.hypot(dx+vx*t,dz+vz*t)<clearance)v.targetSpeed=Math.min(v.targetSpeed,v.nominalSpeed*.12);
      if(Math.hypot(dx,dz)<clearance*.7)v.targetSpeed=0;
    }
  }
  update(dt,time,camera) {
    const inspect=this.inspection;
    const isolated=inspect.view==='asset'||inspect.view==='clip';
    if(!isolated){this.avoidCollisions(time);this.avoidPlayer();}
    for(const v of this.vessels) {
      const pose=v.pose;v.age+=dt;
      const oldSpeed=v.speed,oldYaw=v.yaw,oldProgress=v.progress;Object.assign(v.previousPose,pose);v.guard.yaw=oldYaw;
      v.speed=damp(v.speed,v.targetSpeed*v.buoyancy.feedback.speedLoss,.13,dt);
      const oldLaneOffset=v.laneOffset;
      v.laneOffset=damp(v.laneOffset,v.laneTarget,.085,dt);
      if(inspect.view==='asset') {pose.x=0;pose.z=0;pose.yaw=0;}
      else if(inspect.view==='clip') {pose.x=CONFIG.radius+(inspect.fraction-.5)*v.spec.length;pose.z=0;pose.yaw=-Math.PI/2;}
      else {
        v.progress+=v.speed*dt;v.route.sample(v.progress,pose,v.laneOffset);
        const sideSpeed=dt>0?(v.laneOffset-oldLaneOffset)/dt:0;
        if(Math.abs(sideSpeed)>.015) {
          const vx=pose.dx*v.speed+v.route.rx*sideSpeed,vz=pose.dz*v.speed+v.route.rz*sideSpeed,groundSpeed=Math.hypot(vx,vz);
          if(groundSpeed>.05){pose.dx=vx/groundSpeed;pose.dz=vz/groundSpeed;pose.yaw=Math.atan2(-pose.dx,-pose.dz);v.groundSpeed=groundSpeed;}
        } else v.groundSpeed=v.speed;
      }
      const angle=Math.atan2(Math.sin(pose.yaw-v.yaw),Math.cos(pose.yaw-v.yaw));
      const yawResponse=.7*Math.min(1,65/v.spec.length),turnLimit=.035*Math.min(1,100/v.spec.length)*dt;
      v.yaw+=Math.max(-turnLimit,Math.min(turnLimit,angle*(1-Math.exp(-dt*yawResponse))));
      if(!isolated)for(const other of this.vessels){
        if(other===v)continue;
        // The route autopilot cannot advance through an already occupied hull envelope.
        // This final conservative guard also covers yielding/stopped traffic and edge crossings.
        const gap=hullSeparation(v,other),previousGap=hullSeparation(v.guard,other);
        if(gap<20&&gap<previousGap-1e-7){v.progress=oldProgress;Object.assign(pose,v.previousPose);v.yaw=oldYaw;v.speed=0;v.targetSpeed=0;this.contacts++;break;}
      }
      const motion=v.motion;motion.vx=pose.dx*(v.groundSpeed??v.speed);motion.vz=pose.dz*(v.groundSpeed??v.speed);
      motion.yawRate=dt>0?(v.yaw-oldYaw)/dt:0;motion.lateralAcceleration=-motion.yawRate*v.speed;
      const acceleration=dt>0?Math.max(-.20,Math.min(.20,(v.speed-oldSpeed)/dt)):0;
      motion.thrust=v.buoyancy.mass*acceleration+v.buoyancy.mass*.015*v.speed*Math.abs(v.speed);
      v.buoyancy.update(dt,pose.x+CONFIG.center[0],pose.z+CONFIG.center[1],v.yaw,v.root,motion);
      v.stoppedAge=Math.abs(v.speed)<.10?v.stoppedAge+dt:0;v.maxStoppedAge=Math.max(v.maxStoppedAge,v.stoppedAge);
      if(inspect.view==='asset')v.root.position.y=0;
      this.assets.updateLOD(v,camera);
      v.lights.visible=this.environment.uniforms.uNight.value>.02;
      v.emitClock+=dt;
      if(!isolated) {
        this.waves?.disturbances.vessel(v,dt,time);
        this.wakes.follow(v,time,dt);
        this.wakes.bow(v,v.id,v.speed<-.1);
        const radial=Math.hypot(pose.x,pose.z);
        if(v.progress>0 && radial>CONFIG.radius+v.spec.length*.6+50 && !this.wakes.hasVisibleWake(v.id) && !this.waves.disturbances.hasVisiblePackets(v.id,CONFIG.radius,...CONFIG.center)) {
          v.progress=v.route.start;v.laneOffset=0;v.laneTarget=0;v.laneUntil=0;v.buoyancy.reset();v.age=0;this.recycles++;
        }
      }
    }
    this.assets.updateLights(this.environment.uniforms.uNight.value);
    // One closest vessel gets a fitted map, including small boats viewed up close.
    let nearest=null,distance=Infinity;
    for(const v of this.vessels) {
      const d=camera.position.distanceToSquared(v.root.position);
      if(d<distance){distance=d;nearest=v;}
    }
    for(const v of this.vessels)for(const mesh of v.shadowMeshes)mesh.castShadow=v===nearest&&distance<1100*1100&&mesh.material.name!=='window';
    if(nearest){this.environment.shadowFocus.copy(nearest.root.position);
      const span=Math.max(18,nearest.spec.length*.59),c=this.environment.sun.shadow.camera;
      if(c.right!==span){c.left=c.bottom=-span;c.right=c.top=span;c.updateProjectionMatrix();}
    }
  }
}
