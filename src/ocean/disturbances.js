import { Vector4 } from 'three';
import { WATER_SOURCE_COUNT } from '../config.js';

// Finite, retarded gravity-wave packets. They remain at their release positions when
// a boat turns or stops. The two packet lobes obey omega²=gk and cg=omega/(2k).
export const PACKET_COUNT=96, HULL_COUNT=WATER_SOURCE_COUNT, PACKET_LIFE=16;
export class Disturbances {
  constructor() {
    this.a=Array.from({length:PACKET_COUNT},()=>new Vector4(0,0,-10000,0));
    this.b=Array.from({length:PACKET_COUNT},()=>new Vector4());
    this.c=Array.from({length:PACKET_COUNT},()=>new Vector4());
    this.hulls=Array.from({length:HULL_COUNT},()=>new Vector4());
    this.hullShape=Array.from({length:HULL_COUNT},()=>new Vector4());
    this.clocks=new Float64Array(HULL_COUNT);this.cursor=0;this.time=0;this.active=0;
    this.hullVelocity=new Float64Array(HULL_COUNT*2);
    this.uniforms={uPacketA:{value:this.a},uPacketB:{value:this.b},uPacketC:{value:this.c},
      uHullWake:{value:this.hulls},uHullShape:{value:this.hullShape}};
  }
  update(time){this.time=time;this.active=0;for(const p of this.a)if(time-p.z>=0&&time-p.z<PACKET_LIFE&&p.w>0)this.active++;}
  vessel(v,dt,time) {
    const id=v.id;if(id>=HULL_COUNT)return;
    const h=v.buoyancy.feedback,s=v.spec,fx=-Math.sin(v.yaw),fz=-Math.cos(v.yaw);
    const speed=Math.abs(h.forwardSpeed??v.speed),wet=h.wetFraction;
    // Hull-pressure doublet: a raised bow shoulder and a compensating trough.
    const amplitude=Math.min(1.15,s.draft*.13)*Math.min(1,speed*speed/18)*wet;
    this.hulls[id].set(v.root.position.x,v.root.position.z,fx,fz);
    const old=this.hullShape[id].z,blend=1-Math.exp(-dt*3.5);
    this.hullShape[id].set(s.length,s.beam,old+(amplitude-old)*blend,Math.sign(h.forwardSpeed||1));
    this.hullVelocity[id*2]=h.hullVx??fx*(h.forwardSpeed??v.speed);this.hullVelocity[id*2+1]=h.hullVz??fz*(h.forwardSpeed??v.speed);
    this.clocks[id]+=dt;
    if(this.clocks[id]<3||speed<.9||wet<.08)return;
    this.clocks[id]%=3;
    const direction=Math.sign(h.forwardSpeed||1),i=this.cursor++%PACKET_COUNT;
    // Finite hulls at high Froude number excite shorter, narrower wakes.
    const cos=Math.min(Math.sqrt(2/3),Math.sqrt(9.81*s.length/(2*Math.PI))/speed);
    const k=9.81/(speed*speed*cos*cos),omega=Math.sqrt(9.81*k);
    const A=Math.min(.95,s.draft*.10+.04)*Math.min(1,speed*speed/14)*wet;
    this.a[i].set(v.root.position.x-fx*s.length*.40*direction,v.root.position.z-fz*s.length*.40*direction,time,A);
    this.b[i].set(fx*direction,fz*direction,k,Math.max(2.2,s.beam*.40));
    this.c[i].set(cos,omega,id,Math.max(3,Math.min(24,Math.PI/k)));
  }
  pulse(id,x,z,yaw,amplitude,width,wavelength,time) {
    const i=this.cursor++%PACKET_COUNT,k=2*Math.PI/wavelength;
    this.a[i].set(x,z,time,amplitude);
    this.b[i].set(-Math.sin(yaw),-Math.cos(yaw),k,width);
    this.c[i].set(.65,Math.sqrt(9.81*k),id,Math.max(3,wavelength*.6));
  }
  clearOwner(id) {
    this.hullShape[id].z=0;this.clocks[id]=0;
    for(let i=0;i<PACKET_COUNT;i++)if(this.c[i].z===id)this.a[i].w=0;
  }
  hasVisiblePackets(owner,radius,centerX=0,centerZ=0) {
    for(let i=0;i<PACKET_COUNT;i++) {
      const a=this.a[i],b=this.b[i],c=this.c[i],age=this.time-a.z;
      if(c.z!==owner||a.w<=0||age<0||age>=PACKET_LIFE)continue;
      // Match the surface shader's conservative finite envelope cutoff.
      const extent=c.y/(2*b.z)*age+(c.w+age*.35)*4+(b.w+age*.26)*4;
      if(Math.hypot(a.x-centerX,a.y-centerZ)<radius+extent)return true;
    }
    return false;
  }
  sample(x,z,out,exclude=-1) {
    let height=0,gx=0,gz=0,velocity=0,foam=0;
    for(let i=0;i<HULL_COUNT;i++) {
      const a=this.hulls[i],b=this.hullShape[i];if(i===exclude||b.z===0)continue;
      const dx=x-a.x,dz=z-a.y,fx=a.z*b.w,fz=a.w*b.w;
      const f=dx*fx+dz*fz,r=dx*fz-dz*fx,L=b.x,B=b.y;
      if(Math.abs(f)>L*1.4||Math.abs(r)>B*4)continue;
      const u=(f-L*.38)/Math.max(1,L*.11),v=r/Math.max(.8,B*.65);
      const E=b.z*Math.exp(-.5*(u*u+v*v));
      // A zero-volume Mexican-hat pressure profile, with analytic derivatives.
      const H=E*(1-u*u),df=E*(u*u*u-3*u)/Math.max(1,L*.11),dr=-H*v/Math.max(.8,B*.65);
      height+=H;gx+=df*fx+dr*fz;gz+=df*fz-dr*fx;
      velocity-=(df*fx+dr*fz)*this.hullVelocity[i*2]+(df*fz-dr*fx)*this.hullVelocity[i*2+1];
      foam+=Math.max(0,H)*.45;
    }
    for(let i=0;i<PACKET_COUNT;i++) {
      const a=this.a[i],b=this.b[i],c=this.c[i],age=this.time-a.z;
      if(c.z===exclude||a.w===0||age<0||age>PACKET_LIFE)continue;
      const dx=x-a.x, dz=z-a.y,cg=c.y/(2*b.z),sin=Math.sqrt(1-c.x*c.x);
      const along=c.w+age*.35,across=b.w+age*.26;
      if(dx*dx+dz*dz>(cg*age+along*4+across*4)**2)continue;
      const fade=Math.sin(Math.PI*Math.min(1,age/.55)*.5)**2*(1-age/PACKET_LIFE)**2;
      for(let side=-1;side<=1;side+=2) {
        const nx=b.x*c.x+b.y*sin*side,nz=b.y*c.x-b.x*sin*side,tx=-nz,tz=nx;
        const q=dx*nx+dz*nz-cg*age,r=dx*tx+dz*tz;
        const E=a.w*fade*Math.exp(-.5*(q*q/(along*along)+r*r/(across*across)));
        if(E<1e-7)continue;
        const phase=b.z*(dx*nx+dz*nz)-c.y*age,cs=Math.cos(phase),sn=Math.sin(phase);
        const H=E*cs,dq=E*(-q/(along*along)*cs-b.z*sn),dr=-E*r/(across*across)*cs;
        height+=H;gx+=dq*nx+dr*tx;gz+=dq*nz+dr*tz;
        // Vertical rate includes travelling phase, envelope translation and decay.
        const fadeRate=age<.55?Math.PI/.55*Math.cos(Math.PI*age/.55*.5)/Math.max(.0001,Math.sin(Math.PI*age/.55*.5)):0;
        velocity+=E*(c.y*sn+cs*(fadeRate-2/Math.max(.001,PACKET_LIFE-age)+q*cg/(along*along)+q*q*.35/(along**3)+r*r*.26/(across**3)));
        foam+=Math.max(0,b.z*H)*.65;
      }
    }
    out.height=height;out.gx=gx;out.gz=gz;out.velocity=velocity;out.foam=Math.min(1,foam);return out;
  }
}

// Same packet positions, envelopes, phases and gradients as CPU sampling.
export const disturbanceGLSL=/* glsl */`
uniform vec4 uPacketA[${PACKET_COUNT}],uPacketB[${PACKET_COUNT}],uPacketC[${PACKET_COUNT}];
uniform vec4 uHullWake[${HULL_COUNT}],uHullShape[${HULL_COUNT}];
vec4 disturbanceSurface(vec2 p,float footprint) {
  vec4 result=vec4(0.0);
  for(int i=0;i<${HULL_COUNT};i++) {
    vec4 a=uHullWake[i],b=uHullShape[i];if(b.z<=0.0)continue;
    vec2 d=p-a.xy,f=a.zw*b.w,r=vec2(f.y,-f.x);
    float s=dot(d,f),t=dot(d,r);
    if(abs(s)>b.x*1.4||abs(t)>b.y*4.0)continue;
    vec2 scale=vec2(max(1.0,b.x*.11),max(.8,b.y*.65));
    vec2 q=vec2(s-b.x*.38,t)/scale;
    float E=b.z*exp(-.5*dot(q,q)),H=E*(1.0-q.x*q.x);
    vec2 grad=f*E*(q.x*q.x*q.x-3.0*q.x)/scale.x-r*H*q.y/scale.y;
    float bandAttenuation=1.0-smoothstep(.6,2.2,footprint/min(scale.x,scale.y));
    result+=vec4(H,grad*bandAttenuation,max(0.0,H)*.45);
  }
  for(int i=0;i<${PACKET_COUNT};i++) {
    vec4 a=uPacketA[i],b=uPacketB[i],c=uPacketC[i];float age=uTime-a.z;
    if(a.w<=0.0||age<0.0||age>${PACKET_LIFE.toFixed(1)})continue;
    vec2 d=p-a.xy;float cg=c.y/(2.0*b.z),sn=sqrt(1.0-c.x*c.x);
    float along=c.w+age*.35,across=b.w+age*.26;
    if(dot(d,d)>pow(cg*age+along*4.0+across*4.0,2.0))continue;
    float fade=pow(sin(1.57079632679*min(1.0,age/.55)),2.0)*pow(1.0-age/${PACKET_LIFE.toFixed(1)},2.0);
    float bandAttenuation=1.0-smoothstep(.6,2.2,b.z*footprint);
    for(int j=0;j<2;j++) {
      float side=float(j)*2.0-1.0;
      vec2 n=b.xy*c.x+vec2(b.y,-b.x)*sn*side,t=vec2(-n.y,n.x);
      vec2 q=vec2(dot(d,n)-cg*age,dot(d,t));
      float E=a.w*fade*exp(-.5*(q.x*q.x/(along*along)+q.y*q.y/(across*across)));
      if(E<.0000001)continue;
      float phase=b.z*dot(d,n)-c.y*age,cs=cos(phase),ss=sin(phase),H=E*cs;
      vec2 grad=n*E*(-q.x/(along*along)*cs-b.z*ss)-t*H*q.y/(across*across);
      result+=vec4(H,grad*bandAttenuation,max(0.0,b.z*H)*.65);
    }
  }
  result.w=min(1.0,result.w);return result;
}
`;
