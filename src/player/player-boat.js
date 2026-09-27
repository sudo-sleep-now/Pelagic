import * as THREE from 'three';
import { CONFIG, damp } from '../config.js';
import { Buoyancy } from '../vessels/buoyancy.js';
import { BoatDynamics } from './dynamics.js';
import { PilotControls } from './controls.js';

export class PlayerBoat {
  constructor({scene,assets,waves,wakes,traffic,environment,camera,controls,canvas}) {
    Object.assign(this,{assets,waves,wakes,traffic,environment,camera,orbit:controls,canvas});
    this.vessel=assets.instantiate('rib');const v=this.vessel;v.id=CONFIG.trafficCount;
    this.dynamics=new BoatDynamics(v.spec,{radius:CONFIG.radius,center:CONFIG.center});
    v.pose={x:this.dynamics.x,z:this.dynamics.z,dx:0,dz:0,yaw:this.dynamics.yaw};v.yaw=this.dynamics.yaw;v.speed=0;
    v.buoyancy=new Buoyancy(waves,v.spec);v.lights=traffic.navigationLights(v,traffic.boundary,environment);
    this.dynamics.water=v.buoyancy.feedback;this.dynamics.owner=v.id;
    scene.add(v.root);traffic.playerVessel=v;
    this.active=false;this.returning=false;this.view='chase';this.tick=0;
    this.saved={position:new THREE.Vector3(),target:new THREE.Vector3(),up:new THREE.Vector3(),fov:44,near:1,far:18000};
    this.positionTarget=new THREE.Vector3();this.lookTarget=new THREE.Vector3();this.lookCurrent=new THREE.Vector3();
    this.work=new THREE.Vector3();this.waveSample={x:0,y:0,z:0,nx:0,ny:1,nz:0};
    this.input=new PilotControls(canvas,this);canvas.tabIndex=0;
    this.update(0,0);this.describe();
  }
  get ownsCamera(){return this.active||this.returning;}
  describe() {
    this.canvas.setAttribute('aria-label',this.active?
      'Piloting a rigid inflatable boat. W or up increases throttle; S or down reduces throttle and reverses. A and D steer. Space stops. C changes camera. Escape returns to the ocean view. M toggles sound.':
      'Interactive ocean. Drag to orbit and scroll to zoom. Press P or double-click to pilot the orange boat. M toggles sound.');
  }
  toggle(){if(this.active)this.leave();else this.enter();}
  enter(immediate=false) {
    if(!this.returning) {
      const s=this.saved,c=this.camera;s.position.copy(c.position);s.target.copy(this.orbit.target);s.up.copy(c.up);
      s.fov=c.fov;s.near=c.near;s.far=c.far;
    }
    this.active=true;this.returning=false;this.view='chase';this.orbit.enabled=false;
    this.lookCurrent.copy(this.orbit.target);this.input.input.clear();
    this.camera.near=.12;this.camera.far=16000;this.camera.updateProjectionMatrix();
    this.setShadowSpan(26);this.canvas.focus({preventScroll:true});this.describe();
    if(immediate){this.computeCamera();this.camera.position.copy(this.positionTarget);this.lookCurrent.copy(this.lookTarget);this.camera.lookAt(this.lookCurrent);}
    this.publishState();
  }
  leave() {
    if(!this.active)return;
    this.active=false;this.returning=true;this.input.input.clear();this.setShadowSpan(145);this.describe();this.publishState();
  }
  reset() {
    this.dynamics.reset();this.input.input.clear();this.wakes.clearOwner(this.vessel.id);
    this.vessel.buoyancy.reset();this.waves.disturbances.clearOwner(this.vessel.id);
    this.update(0,this.waves.time);
    if(this.active){this.computeCamera();this.camera.position.copy(this.positionTarget);this.lookCurrent.copy(this.lookTarget);this.camera.lookAt(this.lookCurrent);}
    this.publishState();
  }
  toggleCamera(){this.view=this.view==='chase'?'helm':'chase';this.camera.near=this.view==='helm'?.08:.12;this.camera.updateProjectionMatrix();this.publishState();}
  setShadowSpan(span) {
    const camera=this.environment.sun.shadow.camera;
    camera.left=-span;camera.right=span;camera.top=span;camera.bottom=-span;camera.updateProjectionMatrix();
  }
  update(dt,time) {
    const input=this.input.input;input.update(dt);
    this.dynamics.step(dt,this.active?input.demand:0,this.active?input.steer:0,this.active&&input.brake,this.traffic.vessels);
    const m=this.dynamics,v=this.vessel,pose=v.pose,absoluteSpeed=Math.hypot(m.vx,m.vz);
    pose.x=m.x;pose.z=m.z;pose.yaw=m.yaw;pose.dx=absoluteSpeed>.02?m.vx/absoluteSpeed:-Math.sin(m.yaw);pose.dz=absoluteSpeed>.02?m.vz/absoluteSpeed:-Math.cos(m.yaw);
    v.yaw=m.yaw;v.speed=absoluteSpeed;
    v.buoyancy.update(dt,m.x+CONFIG.center[0],m.z+CONFIG.center[1],m.yaw,v.root,m);
    this.waves.disturbances.vessel(v,dt,time);
    v.lights.visible=this.environment.uniforms.uNight.value>.02;
    this.wakes.follow(v,time,dt);
    this.wakes.bow(v,v.id,m.speed<0);
    if(this.ownsCamera)this.updateCamera(dt);
    this.assets.updateLOD(v,this.camera,this.active);
    for(const mesh of v.shadowMeshes)mesh.castShadow=this.active&&mesh.material.name!=='window';
    if(this.active)this.environment.shadowFocus.copy(v.root.position);
    if(import.meta.env.DEV&&++this.tick%10===0)this.publishState();
  }
  computeCamera() {
    const v=this.vessel,yaw=v.yaw;
    if(this.view==='helm') {
      this.positionTarget.set(0,2.43,1.85).applyQuaternion(v.root.quaternion).add(v.root.position);
      this.lookTarget.set(0,2.38,-16).applyQuaternion(v.root.quaternion).add(v.root.position);
    } else {
      this.positionTarget.set(Math.sin(yaw)*18.5,7.2,Math.cos(yaw)*18.5).add(v.root.position);
      this.lookTarget.set(-Math.sin(yaw)*4,1.0,-Math.cos(yaw)*4).add(v.root.position);
    }
    this.waves.sample(this.positionTarget.x,this.positionTarget.z,this.waveSample);
    this.positionTarget.y=Math.max(this.positionTarget.y,this.waveSample.y+(this.view==='helm'?1.12:2.6));
  }
  updateCamera(dt) {
    const camera=this.camera;
    if(this.active) {
      this.computeCamera();const rate=this.view==='helm'?12:5,alpha=1-Math.exp(-dt*rate);
      camera.position.lerp(this.positionTarget,alpha);this.lookCurrent.lerp(this.lookTarget,alpha);
      // The helm must stay attached horizontally; damping world translation at cruising
      // speed would pull the eye backwards through the seated driver and console.
      if(this.view==='helm'){camera.position.x=this.positionTarget.x;camera.position.z=this.positionTarget.z;}
      this.waves.sample(camera.position.x,camera.position.z,this.waveSample);
      camera.position.y=Math.max(camera.position.y,this.waveSample.y+1.05);
      camera.up.set(0,1,0);camera.lookAt(this.lookCurrent);
      const fov=damp(camera.fov,this.view==='helm'?68:55,5,dt);
      if(Math.abs(fov-camera.fov)>.001){camera.fov=fov;camera.updateProjectionMatrix();}
    } else if(this.returning) {
      const alpha=1-Math.exp(-dt*4);camera.position.lerp(this.saved.position,alpha);this.lookCurrent.lerp(this.saved.target,alpha);
      camera.up.copy(this.saved.up);camera.lookAt(this.lookCurrent);
      camera.fov=damp(camera.fov,this.saved.fov,4,dt);camera.updateProjectionMatrix();
      if(camera.position.distanceToSquared(this.saved.position)<.2&&this.lookCurrent.distanceToSquared(this.saved.target)<.2) {
        camera.position.copy(this.saved.position);this.orbit.target.copy(this.saved.target);camera.fov=this.saved.fov;
        camera.near=this.saved.near;camera.far=this.saved.far;camera.updateProjectionMatrix();
        this.orbit.enabled=true;this.orbit.update();this.returning=false;
      }
    }
  }
  state() {
    const m=this.dynamics,v=this.vessel;
    return {active:this.active,returning:this.returning,camera:this.view,x:m.x,z:m.z,y:v.root.position.y,yaw:m.yaw,
      speed:m.speed,knots:m.speed*1.94384,throttle:this.input.input.demand,engine:m.throttle,rudder:m.rudder,
      pitch:v.root.rotation.x,roll:v.root.rotation.z,contacts:m.contacts,edgeContact:m.edgeContact,
      cameraY:this.camera.position.y,detail:v.detail,waterSpeed:v.buoyancy.feedback.forwardSpeed,
      wet:v.buoyancy.feedback.wetFraction,propellerWet:v.buoyancy.feedback.propellerWet,
      planing:v.buoyancy.feedback.planing,impact:v.buoyancy.impact,heaveVelocity:v.buoyancy.states[0].velocity,
      buoyancyRatio:v.buoyancy.feedback.buoyancyRatio};
  }
  publishState(){if(import.meta.env.DEV)this.canvas.dataset.player=JSON.stringify(this.state());}
}
