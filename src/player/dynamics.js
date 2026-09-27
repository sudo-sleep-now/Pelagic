import { damp } from '../config.js';

// Planar rigid-body approximation in metres and seconds: thrust along the hull, quadratic
// drag, stronger lateral water resistance, and a steering response with yaw inertia.
export class BoatDynamics {
  constructor(spec,{radius=2000,center=[0,0],x=1100,z=1500,yaw=.58}={}) {
    this.spec=spec;this.radius=radius;this.center=center;this.home={x,z,yaw};this.reset();
    this.water=null;
  }
  reset() {
    Object.assign(this,{x:this.home.x,z:this.home.z,yaw:this.home.yaw,vx:0,vz:0,speed:0,
      yawRate:0,throttle:0,rudder:0,contact:false,edgeContact:false,contacts:0});
    this.thrust=0;this.lateralAcceleration=0;
  }
  step(dt,throttle,rudder,brake=false,ships=[]) {
    this.contact=false;this.edgeContact=false;
    const steps=Math.max(1,Math.ceil(dt/(1/60))),h=dt/steps;
    for(let i=0;i<steps;i++) {
      this.throttle=damp(this.throttle,brake?0:Math.max(-1,Math.min(1,throttle)),4.2,h);
      this.rudder=damp(this.rudder,Math.max(-1,Math.min(1,rudder)),7,h);
      let fx=-Math.sin(this.yaw),fz=-Math.cos(this.yaw),rx=Math.cos(this.yaw),rz=-Math.sin(this.yaw);
      const water=this.water,wx=water?.waterVx??0,wz=water?.waterVz??0,wet=water?.wetFraction??1,propeller=water?.propellerWet??1;
      let forward=(this.vx-wx)*fx+(this.vz-wz)*fz,lateral=(this.vx-wx)*rx+(this.vz-wz)*rz;
      const thrust=this.throttle*(this.throttle>=0?3.25:1.55)*propeller*propeller;
      this.thrust=thrust*(water?.mass??1);
      const froude=Math.abs(forward)/Math.sqrt(9.81*this.spec.length);
      const waveResistance=water?.planing!==undefined?.13*Math.exp(-(((froude-.58)/.19)**2))*(1-water.planing):0;
      const drag=(.08*forward+.0108*forward*Math.abs(forward)+waveResistance*forward+(brake?2.6*forward:0))*wet;
      forward=Math.max(-4,Math.min(this.spec.speed,forward+(thrust-drag)*h));
      lateral*=Math.exp(-(.85+.23*Math.abs(forward))*wet*h);
      // Outboard steering needs water flow or immersed prop wash, and lateral load is
      // bounded rather than allowing a half-g spin at full speed.
      const turn=-this.rudder*(forward+this.throttle*2*propeller)*.06/(1+.003*forward*forward)*wet;
      const turnLimit=Math.min(.55,3.8/Math.max(1,Math.abs(forward)));
      this.yawRate=damp(this.yawRate,Math.max(-turnLimit,Math.min(turnLimit,turn)),3.2*(.015+.985*wet),h);
      this.lateralAcceleration=-this.yawRate*forward*wet;
      this.yaw=Math.atan2(Math.sin(this.yaw+this.yawRate*h),Math.cos(this.yaw+this.yawRate*h));
      // Preserve world momentum while the hull turns; sideways drag aligns it over time.
      this.vx=wx+fx*forward+rx*lateral+(water?.waterAx??0)*.38*wet*h;
      this.vz=wz+fz*forward+rz*lateral+(water?.waterAz??0)*.38*wet*h;
      this.x+=this.vx*h;this.z+=this.vz*h;
      this.confine();
      for(let pass=0;pass<3;pass++)for(const ship of ships)this.resolveContact(ship);
      this.confine();
    }
    this.speed=this.vx*-Math.sin(this.yaw)+this.vz*-Math.cos(this.yaw);
  }
  confine() {
    const limit=this.radius-this.spec.length*.56-8,r=Math.hypot(this.x,this.z);
    if(r<=limit)return;
    const nx=this.x/r,nz=this.z/r;this.x=nx*limit;this.z=nz*limit;
    const outward=this.vx*nx+this.vz*nz;
    if(outward>0){this.vx-=outward*nx*1.08;this.vz-=outward*nz*1.08;}
    this.edgeContact=true;
  }
  resolveContact(ship) {
    const b=ship.pose,L=ship.spec.length,B=ship.spec.beam;
    const dx=this.x-b.x,dz=this.z-b.z;
    if(Math.hypot(dx,dz)>(L+this.spec.length)*.6+5)return false;
    const arx=Math.cos(this.yaw),arz=-Math.sin(this.yaw),afx=-Math.sin(this.yaw),afz=-Math.cos(this.yaw);
    const brx=Math.cos(ship.yaw),brz=-Math.sin(ship.yaw),bfx=-Math.sin(ship.yaw),bfz=-Math.cos(ship.yaw);
    let depth=Infinity,nx=0,nz=0;
    for(let axis=0;axis<4;axis++) {
      const x=axis===0?arx:axis===1?afx:axis===2?brx:bfx,z=axis===0?arz:axis===1?afz:axis===2?brz:bfz;
      const ra=Math.abs(arx*x+arz*z)*this.spec.beam*.5+Math.abs(afx*x+afz*z)*this.spec.length*.5;
      const rb=Math.abs(brx*x+brz*z)*B*.5+Math.abs(bfx*x+bfz*z)*L*.5;
      const projected=dx*x+dz*z,overlap=ra+rb+.35-Math.abs(projected);
      if(overlap<=0)return false;
      if(overlap<depth){depth=overlap;const sign=projected<0?-1:1;nx=x*sign;nz=z*sign;}
    }
    this.x+=nx*(depth+.015);this.z+=nz*(depth+.015);
    const closing=this.vx*nx+this.vz*nz;
    if(closing<0){this.vx-=closing*nx*1.08;this.vz-=closing*nz*1.08;}
    if(!this.contact)this.contacts++;
    this.contact=true;return true;
  }
}
