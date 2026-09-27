import { Vector4 } from 'three';
import { damp } from '../config.js';
import { Disturbances, disturbanceGLSL, PACKET_LIFE } from './disturbances.js';

// Gravity waves in metres. Fixed directions preserve travelling crests when the wind turns;
// energy moves gradually between bands instead of rotating an entire wave field under ships.
const SPECTRUM = [
  [307,1.35,.28,.12,0], [183,.95,.27,.87,1.7], [117,.65,.26,-.62,3.1],
  [81,.55,.24,.50,.8], [57,.40,.22,-.18,2.2], [38,.27,.21,1.30,4.5],
  [27,.17,.19,.35,1.4], [19,.11,.17,-1.10,5.3], [13.1,.065,.16,1.80,2.9],
  [9.4,.037,.14,-.50,4.1], [6.9,.019,.12,.78,.4], [4.7,.010,.10,-2.10,3.7],
];
export class Waves {
  constructor() {
    this.time=0; this.strength=.55; this.direction=0;
    this.a=SPECTRUM.map(()=>new Vector4()); this.b=SPECTRUM.map(()=>new Vector4());
    this.rates=new Float64Array(12);this.accelerations=new Float64Array(12);
    this.strengthRate=0;this.directionRate=0;
    this.strengthAcceleration=0;this.directionAcceleration=0;this.lastWind=.55;this.lastAngle=0;
    this.disturbances=new Disturbances();this.disturbanceWork={height:0,gx:0,gz:0,velocity:0,foam:0};
    this.baseBound={value:0};this.heightBound={value:0};
    this.work={x:0,y:0,z:0,nx:0,ny:1,nz:0}; this.sync();
    this.uniforms={uWaveA:{value:this.a},uWaveB:{value:this.b},uTime:{value:0},uBaseHeightBound:this.baseBound,uWaterHeightBound:this.heightBound,...this.disturbances.uniforms};
  }
  sync() {
    for(let i=0;i<SPECTRUM.length;i++) {
      const [length,amp,q,angle,phase]=SPECTRUM[i], k=2*Math.PI/length;
      const alignment=.80+.20*Math.pow(Math.cos(angle-.35-this.direction),2);
      // Storm growth belongs primarily to rolling swell and medium waves. Fine
      // crossing waves stay small instead of accumulating into pointed peaks.
      const windGain=i<6?.90:.30/(1+(i-6)*.25);
      const scale=i<3?.55+.45*this.strength:(.28+windGain*this.strength)*alignment;
      const group=1+.12*Math.sin(this.time*.11+phase)*Math.sin(this.time*.073+phase*2.1);
      const sa=Math.sin(this.time*.11+phase),ca=Math.cos(this.time*.11+phase),sb=Math.sin(this.time*.073+phase*2.1),cb=Math.cos(this.time*.073+phase*2.1);
      const groupRate=.12*(.11*ca*sb+.073*sa*cb),groupAcceleration=.12*(-(.11**2+.073**2)*sa*sb+2*.11*.073*ca*cb);
      const alignmentRate=.20*Math.sin(2*(angle-.35-this.direction))*this.directionRate;
      const alignmentAcceleration=.20*(Math.sin(2*(angle-.35-this.direction))*this.directionAcceleration-2*Math.cos(2*(angle-.35-this.direction))*this.directionRate**2);
      const scaleRate=i<3?.45*this.strengthRate:windGain*this.strengthRate*alignment+(.28+windGain*this.strength)*alignmentRate;
      const scaleAcceleration=i<3?.45*this.strengthAcceleration:windGain*this.strengthAcceleration*alignment+2*windGain*this.strengthRate*alignmentRate+(.28+windGain*this.strength)*alignmentAcceleration;
      this.rates[i]=amp*(scaleRate*group+scale*groupRate);
      this.accelerations[i]=amp*(scaleAcceleration*group+scale*groupAcceleration+2*scaleRate*groupRate);
      this.a[i].set(Math.cos(angle),Math.sin(angle),k,amp*scale*group);
      // A gentle transverse phase warp breaks long, parallel crests into short-crested seas.
      this.b[i].set(Math.sqrt(9.81*k),q,phase,i<3?.35:1.10);
    }
    this.baseBound.value=this.a.reduce((sum,a)=>sum+1.2*Math.abs(a.w),0);
  }
  updateHeightBound() {
    const d=this.disturbances;let bound=this.baseBound.value;
    for(const h of d.hullShape)bound+=Math.abs(h.z);
    for(const a of d.a){const age=this.time-a.z;if(age<0||age>PACKET_LIFE)continue;
      const fade=Math.sin(Math.PI*Math.min(1,age/.55)*.5)**2*(1-age/PACKET_LIFE)**2;
      bound+=2*Math.abs(a.w)*fade;
    }
    this.heightBound.value=bound+.02;return this.heightBound.value;
  }
  update(dt,time,wind,windAngle) {
    this.time=time; this.strength=damp(this.strength,wind,.035,dt);
    this.direction=damp(this.direction,windAngle,.012,dt);
    this.strengthRate=.035*(wind-this.strength);this.directionRate=.012*(windAngle-this.direction);
    this.strengthAcceleration=.035*((dt>0?(wind-this.lastWind)/dt:0)-this.strengthRate);
    this.directionAcceleration=.012*((dt>0?(windAngle-this.lastAngle)/dt:0)-this.directionRate);
    this.lastWind=wind;this.lastAngle=windAngle;
    this.sync();this.uniforms.uTime.value=time;this.disturbances.update(time);
  }
  baseDisplace(x,z,out,kinematics=false) {
    let px=x,pz=z,y=0,ax=1,ay=0,az=0,bx=0,by=0,bz=1;
    let vx=0,vy=0,vz=0,ddx=0,ddy=0,ddz=0;
    for(let i=0;i<SPECTRUM.length;i++) {
      const a=this.a[i],b=this.b[i];
      const transverse=a.z*.39*(-a.y*x+a.x*z)+this.time*.13+b.z*2.13;
      const phase=a.z*(a.x*x+a.y*z)-b.x*this.time+b.z+b.w*Math.sin(transverse);
      const bend=b.w*a.z*.39*Math.cos(transverse);
      const gx=a.z*a.x-bend*a.y,gz=a.z*a.y+bend*a.x;
      // Short-crested wave groups travel at the deep-water group velocity.
      // Their analytic envelope gradients are part of both the surface and its forces.
      const u=a.z*.27*(a.x*x+a.y*z)-b.x*.135*this.time+b.z*1.17;
      const v=a.z*.43*(-a.y*x+a.x*z)-b.x*.027*this.time+b.z*2.41;
      const su=Math.sin(u),cu=Math.cos(u),sv=Math.sin(v),cv=Math.cos(v);
      const envelope=.78+.42*su*sv;
      const ex=.42*a.z*(.27*a.x*cu*sv-.43*a.y*su*cv);
      const ez=.42*a.z*(.27*a.y*cu*sv+.43*a.x*su*cv);
      const A=a.w*envelope,Ax=a.w*ex,Az=a.w*ez;
      const s=Math.sin(phase),c=Math.cos(phase),qa=A*b.y;
      px+=qa*a.x*c;pz+=qa*a.y*c;y+=A*s;
      const hx=b.y*(Ax*c-A*gx*s),hz=b.y*(Az*c-A*gz*s);
      ax+=a.x*hx;az+=a.y*hx;ay+=Ax*s+A*gx*c;
      bx+=a.x*hz;bz+=a.y*hz;by+=Az*s+A*gz*c;
      if(kinematics) {
        const ut=-b.x*.135,vt=-b.x*.027;
        const et=.42*(ut*cu*sv+vt*su*cv),ett=.42*(-(ut*ut+vt*vt)*su*sv+2*ut*vt*cu*cv);
        const phaseRate=-b.x+b.w*.13*Math.cos(transverse),phaseAcceleration=-b.w*.13*.13*Math.sin(transverse);
        const Ad=this.rates[i]*envelope+a.w*et,Add=this.accelerations[i]*envelope+2*this.rates[i]*et+a.w*ett;
        const horizontal=b.y*(Ad*c-A*s*phaseRate),vertical=Ad*s+A*c*phaseRate;
        const hdd=b.y*(Add*c-2*Ad*s*phaseRate-A*c*phaseRate*phaseRate-A*s*phaseAcceleration);
        vx+=a.x*horizontal;vz+=a.y*horizontal;vy+=vertical;
        ddx+=a.x*hdd;ddz+=a.y*hdd;ddy+=Add*s+2*Ad*c*phaseRate-A*s*phaseRate*phaseRate+A*c*phaseAcceleration;
      }
    }
    const nx=by*az-bz*ay,ny=bz*ax-bx*az,nz=bx*ay-by*ax,inv=1/Math.hypot(nx,ny,nz);
    out.x=px;out.y=y;out.z=pz;out.nx=nx*inv;out.ny=ny*inv;out.nz=nz*inv;
    out.jxx=ax;out.jxz=bx;out.jzx=az;out.jzz=bz;
    if(kinematics){out.vx=vx;out.vy=vy;out.vz=vz;out.ax=ddx;out.ay=ddy;out.az=ddz;}
    return out;
  }
  displace(x,z,out,kinematics=false,exclude=-1) {
    this.baseDisplace(x,z,out,kinematics);return this.addDisturbance(out,kinematics,exclude);
  }
  sample(x,z,out,kinematics=false,exclude=-1) {
    let qx=x,qz=z;
    for(let i=0;i<3;i++){
      const w=this.baseDisplace(qx,qz,this.work),dx=x-w.x,dz=z-w.z,det=w.jxx*w.jzz-w.jxz*w.jzx;
      qx+=(w.jzz*dx-w.jxz*dz)/det;qz+=(w.jxx*dz-w.jzx*dx)/det;
    }
    this.baseDisplace(qx,qz,out,kinematics);return this.addDisturbance(out,kinematics,exclude);
  }
  addDisturbance(out,kinematics,exclude) {
    const d=this.disturbances.sample(out.x,out.z,this.disturbanceWork,exclude);
    const nx=out.nx-out.ny*d.gx,nz=out.nz-out.ny*d.gz,inv=1/Math.hypot(nx,out.ny,nz);
    out.y+=d.height;out.nx=nx*inv;out.ny*=inv;out.nz=nz*inv;
    if(kinematics){out.vy+=d.velocity+d.gx*out.vx+d.gz*out.vz;out.heightRate=out.vy+out.nx/out.ny*out.vx+out.nz/out.ny*out.vz;}
    return out;
  }
}
export const waveGLSL=/* glsl */`
uniform vec4 uWaveA[12];
uniform vec4 uWaveB[12];
uniform float uTime;
uniform float uBaseHeightBound,uWaterHeightBound;
${disturbanceGLSL}
vec3 waveEnvelope(vec2 p,vec4 a,vec4 b) {
  vec2 sideways=vec2(-a.y,a.x);
  float u=a.z*.27*dot(a.xy,p)-b.x*.135*uTime+b.z*1.17;
  float v=a.z*.43*dot(sideways,p)-b.x*.027*uTime+b.z*2.41;
  float su=sin(u),cu=cos(u),sv=sin(v),cv=cos(v);
  vec2 gradient=.42*a.z*(.27*a.xy*cu*sv+.43*sideways*su*cv);
  return vec3(.78+.42*su*sv,gradient);
}
vec2 correctWaveParameter(vec2 seed,vec2 worldP) {
  // Interpolated vertex parameters inherit the regular mesh. One inverse
  // correction restores the smooth world-space field for close surface shading.
  vec2 displaced=seed;
  for(int i=0;i<12;i++) {
    vec4 a=uWaveA[i],b=uWaveB[i];vec2 sideways=vec2(-a.y,a.x);
    float transverse=a.z*.39*dot(sideways,seed)+uTime*.13+b.z*2.13;
    float phase=a.z*dot(a.xy,seed)-b.x*uTime+b.z+b.w*sin(transverse);
    displaced+=a.xy*(a.w*b.y*waveEnvelope(seed,a,b).x*cos(phase));
  }
  return seed+worldP-displaced;
}
vec3 baseWaveMapping(vec2 p,out vec3 normal,out float compression,out vec4 jacobian) {
  vec3 point=vec3(p.x,0.0,p.y),tx=vec3(1.0,0.0,0.0),tz=vec3(0.0,0.0,1.0);
  for(int i=0;i<12;i++) {
    vec4 a=uWaveA[i],b=uWaveB[i];vec2 sideways=vec2(-a.y,a.x);
    float transverse=a.z*.39*dot(sideways,p)+uTime*.13+b.z*2.13;
    float phase=a.z*dot(a.xy,p)-b.x*uTime+b.z+b.w*sin(transverse);
    vec2 g=a.z*a.xy+b.w*a.z*.39*cos(transverse)*sideways;
    vec3 envelope=waveEnvelope(p,a,b);float A=a.w*envelope.x;vec2 Ag=a.w*envelope.yz;
    float s=sin(phase),c=cos(phase),qa=A*b.y;
    point+=vec3(qa*a.x*c,A*s,qa*a.y*c);
    vec2 h=b.y*(Ag*c-A*g*s),vertical=Ag*s+A*g*c;
    tx+=vec3(a.x*h.x,vertical.x,a.y*h.x);
    tz+=vec3(a.x*h.y,vertical.y,a.y*h.y);
  }
  normal=normalize(cross(tz,tx));compression=1.0-(tx.x*tz.z-tx.z*tz.x);
  jacobian=vec4(tx.x,tz.x,tx.z,tz.z);return point;
}
vec3 baseWavePosition(vec2 p,out vec3 normal,out float compression) {vec4 j;return baseWaveMapping(p,normal,compression,j);}
vec3 wavePosition(vec2 p,out vec3 normal,out float compression) {
  vec3 point=baseWavePosition(p,normal,compression);vec4 d=disturbanceSurface(point.xz,0.0);
  point.y+=d.x;normal=normalize(vec3(normal.x-normal.y*d.y,normal.y,normal.z-normal.y*d.z));return point;
}
vec3 filteredWaveNormal(vec2 p,vec2 worldP,float footprint,out float compression,out float wakeFoam) {
  vec3 tx=vec3(1.0,0.0,0.0),tz=vec3(0.0,0.0,1.0);
  for(int i=0;i<12;i++) {
    vec4 a=uWaveA[i],b=uWaveB[i];vec2 sideways=vec2(-a.y,a.x);
    float transverse=a.z*.39*dot(sideways,p)+uTime*.13+b.z*2.13;
    float phase=a.z*dot(a.xy,p)-b.x*uTime+b.z+b.w*sin(transverse);
    vec2 g=a.z*a.xy+b.w*a.z*.39*cos(transverse)*sideways;
    float bandWeight=1.0-smoothstep(.55,2.2,a.z*footprint);
    vec3 envelope=waveEnvelope(p,a,b);float A=a.w*bandWeight*envelope.x;vec2 Ag=a.w*bandWeight*envelope.yz;
    float s=sin(phase),c=cos(phase);vec2 h=b.y*(Ag*c-A*g*s),vertical=Ag*s+A*g*c;
    tx+=vec3(a.x*h.x,vertical.x,a.y*h.x);
    tz+=vec3(a.x*h.y,vertical.y,a.y*h.y);
  }
  compression=1.0-(tx.x*tz.z-tx.z*tz.x);vec3 normal=normalize(cross(tz,tx));vec4 d=disturbanceSurface(worldP,footprint);
  wakeFoam=d.w;
  return normalize(vec3(normal.x-normal.y*d.y,normal.y,normal.z-normal.y*d.z));
}
float baseWaterHeight(vec2 p) {
  vec2 q=p;vec3 n;float c;
  for(int i=0;i<3;i++){
    vec4 j;vec3 w=baseWaveMapping(q,n,c,j);vec2 delta=p-w.xz;float determinant=j.x*j.w-j.y*j.z;
    q+=vec2(j.w*delta.x-j.y*delta.y,j.x*delta.y-j.z*delta.x)/determinant;
  }
  return baseWavePosition(q,n,c).y;
}
float waterHeight(vec2 p) {return baseWaterHeight(p)+disturbanceSurface(p,0.0).x;}
`;
