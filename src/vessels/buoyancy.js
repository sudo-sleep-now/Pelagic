import {hullBreadth,DEFAULT_WATERPLANE} from './hull-profile.js';
const RHO=1025,G=9.81;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

// Retained as a general utility; hull motion below is integrated from forces and moments.
export function springStep(state,target,frequency,dt) {
  const displacement=state.position-target,term=state.velocity+frequency*displacement,decay=Math.exp(-frequency*dt);
  state.position=target+(displacement+term*dt)*decay;state.velocity=(state.velocity-frequency*term*dt)*decay;
}

// Twelve hydrostatic strips approximate the source hull's breadth and raked keel.
// Force units are N, moments N m, mass kg, angular rates rad/s. Waterplane restoring
// stiffness, added mass, metacentric stability and water-relative damping are separate.
export class Buoyancy {
  constructor(waves,spec) {
    this.waves=waves;this.spec=spec;this.initialized=false;
    const L=spec.length,B=spec.beam,D=spec.hydrodynamics?.effectiveDraft??spec.draft??Math.max(.5,L*.055);
    this.profile={block:.70,addedHeave:.65,addedPitch:.65,addedRoll:.35,gm:Math.max(.65,B*.085),cgHeight:Math.max(.6,B*.10),heaveDamping:.58,pitchDamping:.52,rollDamping:.23,planing:0,...spec.hydrodynamics};
    const h=this.profile,hullBeam=h.hullBeam??B,centres=h.hullSpacing?[-h.hullSpacing*.5,h.hullSpacing*.5]:[0];
    this.points=[];let volume=0,centroid=0;
    for(let row=0;row<6;row++) {
      const t=(row+.5)/6,half=hullBeam*.5*hullBreadth(t,h.waterplaneStations??DEFAULT_WATERPLANE)*(h.waterplaneScale??1),draft=D*(.55+.45*Math.sin(Math.PI*t)**.25),fore=(t-.5)*L;
      for(const centre of centres)for(const side of [-1,1]) {
        const area=half*L/6,v=area*draft*h.block;
        this.points.push({x:centre+side*half*.58,fore,draft,area,volume:v,weight:0,depth:draft,wet:1,rate:0});volume+=v;centroid+=v*fore;
      }
    }
    this.mass=RHO*volume;this.cgFore=centroid/volume;
    this.effectiveMass=this.mass*(1+h.addedHeave);
    this.pitchInertia=this.mass*(L*.26)**2*(1+h.addedPitch);
    this.rollInertia=this.mass*(B*.34)**2*(1+h.addedRoll);
    this.heaveStiffness=0;this.pitchStiffness=0;this.stripRollStiffness=0;
    for(const p of this.points){p.weight=p.volume/volume;const k=RHO*G*p.volume*1.45/p.draft;this.heaveStiffness+=k;this.pitchStiffness+=k*(p.fore-this.cgFore)**2;this.stripRollStiffness+=k*p.x*p.x;}
    this.rollStiffness=this.mass*G*h.gm;
    this.heaveDrag=2*h.heaveDamping*Math.sqrt(this.heaveStiffness*this.effectiveMass);
    this.pitchDrag=2*h.pitchDamping*Math.sqrt(this.pitchStiffness*this.pitchInertia);
    this.rollDrag=2*h.rollDamping*Math.sqrt(this.rollStiffness*this.rollInertia);
    this.samples=this.points.map(()=>({x:0,y:0,z:0,nx:0,ny:1,nz:0,vx:0,vy:0,vz:0,ax:0,ay:0,az:0,heightRate:0}));
    this.states=Array.from({length:3},()=>({position:0,velocity:0}));
    this.heave=0;this.pitch=0;this.roll=0;this.impact=0;
    this.feedback={mass:this.mass,hullVx:0,hullVz:0,waterVx:0,waterVz:0,waterAx:0,waterAz:0,wetFraction:1,propellerWet:1,bowWet:1,sternWet:1,impact:0,planing:0,forwardSpeed:0,speedLoss:1,waterlineError:0,buoyancyRatio:1};
  }
  reset() {
    this.initialized=false;this.impact=0;this.feedback.planing=0;
    for(const s of this.states){s.position=0;s.velocity=0;}
    for(const p of this.points){p.depth=p.draft;p.wet=1;}
  }
  update(dt,x,z,yaw,root,motion) {
    const fx=-Math.sin(yaw),fz=-Math.cos(yaw),rx=Math.cos(yaw),rz=-Math.sin(yaw),h=this.profile,f=this.feedback,states=this.states;
    const vx=motion?.vx??0,vz=motion?.vz??0,owner=motion?.owner??-1;
    let mean=0,flowX=0,flowZ=0,accX=0,accZ=0,waterVy=0,pitchV=0,rollV=0,foreMoment=0,sideMoment=0,pitchDen=0,rollDen=0;
    for(let i=0;i<this.points.length;i++) {
      const p=this.points[i],s=this.samples[i];this.waves.sample(x+fx*p.fore+rx*p.x,z+fz*p.fore+rz*p.x,s,true,owner);
      p.rate=(s.heightRate??s.vy??0)-(s.nx/Math.max(.1,s.ny))*vx-(s.nz/Math.max(.1,s.ny))*vz;
      const w=p.weight,lever=p.fore-this.cgFore;mean+=w*s.y;flowX+=w*(s.vx??0);flowZ+=w*(s.vz??0);accX+=w*(s.ax??0);accZ+=w*(s.az??0);waterVy+=w*(s.vy??0);
      foreMoment+=w*lever*s.y;sideMoment+=w*p.x*s.y;pitchDen+=w*lever*lever;rollDen+=w*p.x*p.x;
      pitchV+=w*lever*(s.vy??0);rollV+=w*p.x*(s.vy??0);
    }
    pitchV/=Math.max(.01,pitchDen);rollV/=Math.max(.01,rollDen);
    if(!this.initialized) {
      states[1].position=clamp(foreMoment/Math.max(.01,pitchDen),-.28,.28);states[2].position=clamp(sideMoment/Math.max(.01,rollDen),-.35,.35);
      states[0].position=mean-states[1].position*this.cgFore;
      states[0].velocity=waterVy;states[1].velocity=pitchV;states[2].velocity=rollV;this.initialized=true;
    }
    f.hullVx=vx;f.hullVz=vz;f.waterVx=flowX;f.waterVz=flowZ;f.waterAx=accX;f.waterAz=accZ;
    f.forwardSpeed=(vx-flowX)*fx+(vz-flowZ)*fz;
    const speed=Math.max(0,f.forwardSpeed),froude=speed/Math.sqrt(G*this.spec.length);
    const planingTarget=h.planing*clamp((froude-.48)/.72,0,1);
    f.planing+=(planingTarget-f.planing)*(1-Math.exp(-dt*2.2));
    let wet=0,bow=0,stern=0,impact=0,totalBuoyancy=0,waterlineError=0;
    const steps=Math.max(1,Math.ceil(dt*120)),step=dt/steps;
    for(let n=0;n<steps;n++) {
      const sp=Math.sin(states[1].position),sr=Math.sin(states[2].position),cp=Math.cos(states[1].position),cr=Math.cos(states[2].position);
      let force=-this.mass*G,mp=0,mr=0;wet=0;bow=0;stern=0;totalBuoyancy=0;waterlineError=0;
      for(let i=0;i<this.points.length;i++) {
        const p=this.points[i],s=this.samples[i],eta=s.y+p.rate*((n+1)*step-dt);
        const localY=states[0].position+p.fore*sp+p.x*sr*cp;
        const depth=clamp(p.draft+eta-localY,0,p.draft+Math.max(.5,this.spec.freeboard??2));
        const immersed=clamp(depth/p.draft,0,1),ratio=Math.pow(depth/p.draft,1.45);
        const buoyancy=RHO*G*p.volume*ratio,weight=this.mass*G*p.weight;
        force+=buoyancy;totalBuoyancy+=buoyancy;mp+=(buoyancy-weight)*(p.fore-this.cgFore)*cp;mr+=(buoyancy-weight)*p.x*cr;
        wet+=p.weight*immersed;if(p.fore>=this.spec.length*.25)bow+=immersed;if(p.fore<=-this.spec.length*.25)stern+=immersed;
        const relative=states[0].velocity+p.fore*states[1].velocity*cp+p.x*states[2].velocity*cr-(s.vy??0);
        // Entry momentum produces a dissipative slam pulse; it cannot accelerate a departing hull.
        const entering=clamp((depth-p.depth)/Math.max(step,.0001),0,10);
        const slam=relative<-.65&&p.wet<.82&&depth>0?RHO*p.area*Math.min(14,relative*relative)*.10*clamp(entering/2,0,1):0;
        force+=slam;mp+=slam*(p.fore-this.cgFore);mr+=slam*p.x;impact=Math.max(impact,slam/this.mass/G);
        waterlineError+=p.weight*(eta-localY);p.depth=depth;p.wet=immersed;
      }
      const lift=Math.min(this.mass*G*.52,.5*RHO*speed*speed*(this.heaveStiffness/(RHO*G))*.22*(.22+.55*Math.max(0,states[1].position)))*f.planing*wet;
      force+=lift;mp+=lift*this.spec.length*.10+(motion?.thrust??0)*(h.cgHeight+.35);
      // Calibrate the strip moment to the hull's metacentric righting stiffness;
      // sparse point columns otherwise make broad hulls unrealistically stiff.
      mr*=this.rollStiffness/this.stripRollStiffness;
      mr-=this.mass*h.cgHeight*(motion?.lateralAcceleration??0);
      force-=this.heaveDrag*(states[0].velocity-waterVy)*wet;
      const pitchRate=states[1].velocity-pitchV,rollRate=states[2].velocity-rollV;
      // Bilge/section pressure drag grows quadratically with angular flow speed.
      // This dissipates energetic rolls without clamping angles or moving the hull.
      mp-=this.pitchDrag*pitchRate*(1+Math.abs(pitchRate)/.5)*wet;
      mr-=this.rollDrag*rollRate*(1+Math.abs(rollRate)/.3)*wet;
      const mass=this.mass*(1+h.addedHeave*wet);
      const pitchInertia=this.pitchInertia*(1+h.addedPitch*wet)/(1+h.addedPitch);
      const rollInertia=this.rollInertia*(1+h.addedRoll*wet)/(1+h.addedRoll);
      states[0].velocity+=force/mass*step;
      states[1].velocity+=mp/pitchInertia*step;states[2].velocity+=mr/rollInertia*step;
      for(const state of states)state.position+=state.velocity*step;
    }
    this.heave=states[0].position;this.pitch=states[1].position;this.roll=states[2].position;
    this.impact=Math.max(impact,this.impact*Math.exp(-dt*6));
    f.wetFraction=wet;f.bowWet=bow/(this.points.length/3);f.sternWet=stern/(this.points.length/3);
    f.propellerWet=clamp(f.sternWet*1.45,0,1);f.impact=this.impact;f.waterlineError=waterlineError;f.buoyancyRatio=totalBuoyancy/(this.mass*G);
    f.speedLoss=1/(1+.12*Math.abs(states[1].velocity)+this.impact*.45);
    root.position.set(x,this.heave,z);root.rotation.set(this.pitch,yaw,this.roll,'YXZ');
  }
}
