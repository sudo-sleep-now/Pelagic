import { CONFIG,damp,smoothstep } from '../config.js';
import { seabedDepth } from '../ocean/bathymetry.js';

const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
export const MARINE_STARTS=[
  ['whale',1080,1430,.68,137,.77,-1],['whale',-1050,-350,-.9,179,.22,-1],
  ['orca',975,1420,.45,51,.79,-1],['orca',988,1447,.53,63,.46,2],
  ['orca',1008,1456,.51,71,.67,2],['orca',956,1452,.63,57,.88,2],
  ['orca',-1250,650,2.1,67,.18,-1],
];

// Smooth breath cycles, independent steering and soft pod cohesion. Metres/seconds.
// Updates only fixed records; never spawns an animal or teleports at the perimeter.
export class MarineBehavior {
  constructor(starts=MARINE_STARTS) {
    this.animals=starts.map(([kind,x,z,yaw,period,phase,leader],index)=>({
      kind,x,z,yaw,period,offset:phase*period,leader,index,scale:kind==='whale'?(index===0?1:.93):([1,.88,.78,.91,1][Math.max(0,index-2)]??1),
      speed:kind==='whale'?2.4:4.7,depth:kind==='whale'?8:5,pitch:0,roll:0,phase,state:'submerged',stroke:0,
      blows:0,dives:0,lastBreath:-1,lastCycle:-1,breath:false,tailSplash:false,wet:0,avoidUntil:0,avoidDepth:0,
    }));
  }
  update(dt,time,vessels=[],player=null) {
    for(const a of this.animals) {
      const whale=a.kind==='whale',clock=(time+a.offset)/a.period,cycle=Math.floor(clock),p=clock-cycle;
      const surf=whale?.72:.76,dive=whale?.91:.86,ascend=whale?.58:.60;
      const deep=(whale?13:8)+2.5*Math.sin(time*.014+a.index*1.9);
      let depth=deep,pitch=0;
      if(p>=ascend&&p<surf) {const u=smoothstep(ascend,surf,p);depth=deep*(1-u)+.65*u;pitch=.13*Math.sin(Math.PI*u);a.state='ascending';}
      else if(p>=surf&&p<dive) {depth=.65+.09*Math.sin(time*.6+a.index);a.state='surfacing';}
      else if(p>=dive) {const u=(p-dive)/(1-dive);depth=.65+(deep-.65)*smoothstep(.15,1,u);pitch=-(whale?.40:.30)*Math.sin(Math.PI*u);a.state='diving';}
      else a.state='submerged';
      if(time<a.avoidUntil){depth=Math.max(depth,a.avoidDepth);a.state='avoiding';pitch=-.18;}
      depth=Math.min(depth,seabedDepth(a.x,a.z,CONFIG.radius)-(whale?3:2));
      a.phase=p;a.depth=damp(a.depth,depth,whale?1.7:2.4,dt);a.pitch=damp(a.pitch,pitch,2.5,dt);
      a.wet=1-smoothstep(1.4,4.5,a.depth);
      const strokeRate=whale?1.6:4.0;
      a.stroke+=dt*strokeRate*(1+.12*Math.sin(time*.23+a.index));
      let vx=-Math.sin(a.yaw),vz=-Math.cos(a.yaw);
      const wander=a.yaw+Math.sin(time*.024+a.index*2.7)*dt*(whale?.020:.047)+Math.sin(time*.071+a.index)*dt*.014;
      vx=-Math.sin(wander);vz=-Math.cos(wander);
      const radial=Math.hypot(a.x,a.z),edge=smoothstep(CONFIG.radius-280,CONFIG.radius-85,radial);
      vx=vx*(1-edge)-a.x/Math.max(1,radial)*edge;vz=vz*(1-edge)-a.z/Math.max(1,radial)*edge;
      let targetSpeed=(whale?2.3:4.8)*(.9+.14*Math.sin(time*.034+a.index*2));
      if(a.leader>=0) {
        const lead=this.animals[a.leader],side=(a.index%2?1:-1)*(12+(a.index%3)*6),behind=18+(a.index-3)*10;
        const tx=lead.x+Math.sin(lead.yaw)*behind+Math.cos(lead.yaw)*side,tz=lead.z+Math.cos(lead.yaw)*behind-Math.sin(lead.yaw)*side;
        const dx=tx-a.x,dz=tz-a.z,d=Math.hypot(dx,dz),cohesion=Math.min(.8,d/65)*.65;
        vx=vx*(1-cohesion)+dx/Math.max(1,d)*cohesion;vz=vz*(1-cohesion)+dz/Math.max(1,d)*cohesion;
        targetSpeed=lead.speed+Math.max(-1.2,Math.min(1.5,(d-12)*.03));
      }
      for(const b of this.animals) {
        if(b===a)continue;
        const dx=a.x-b.x,dz=a.z-b.z,d=Math.hypot(dx,dz),margin=whale||b.kind==='whale'?30:17;
        if(d<margin){const push=(1-d/margin)*2.5;vx+=dx/Math.max(1,d)*push;vz+=dz/Math.max(1,d)*push;targetSpeed*=Math.max(.25,Math.min(1,d/(margin*.7)));}
      }
      for(let i=0;i<vessels.length+(player?1:0);i++) {
        const v=i<vessels.length?vessels[i]:player;
        const pos=v.root.position,c=Math.cos(v.yaw),s=Math.sin(v.yaw),fdb=v.buoyancy?.feedback;
        const relativeX=-Math.sin(a.yaw)*a.speed-(fdb?.hullVx??-s*v.speed),relativeZ=-Math.cos(a.yaw)*a.speed-(fdb?.hullVz??-c*v.speed);
        const baseX=a.x-pos.x,baseZ=a.z-pos.z,t=Math.max(0,Math.min(12,-(baseX*relativeX+baseZ*relativeZ)/Math.max(.01,relativeX**2+relativeZ**2)));
        const dx=baseX+relativeX*t,dz=baseZ+relativeZ*t;
        const f=dx*-s+dz*-c,r=dx*c-dz*s,L=v.spec.length*.5+35,B=v.spec.beam*.5+35;
        const q=Math.hypot(f/L,r/B);
        if(q<1.8){const push=(1.8-q)*1.7;vx+=(r/B*c-f/L*s)*push;vz+=(-r/B*s-f/L*c)*push;targetSpeed*=Math.max(.35,Math.min(1,q));}
        if(q<1.3&&a.depth*a.scale<v.spec.draft+(whale?2.6:1.8)){a.avoidUntil=time+12;a.avoidDepth=(v.spec.draft+(whale?4.2:3))/a.scale;}
      }
      // The fixed circle takes precedence over pod cohesion and ship avoidance.
      // Reserve enough room for a whale's slow turn before its entire body reaches the edge.
      const boundaryBlend=smoothstep(CONFIG.radius-320,CONFIG.radius-180,radial);
      vx=vx*(1-boundaryBlend)-a.x/Math.max(1,radial)*boundaryBlend;
      vz=vz*(1-boundaryBlend)-a.z/Math.max(1,radial)*boundaryBlend;
      const target=Math.atan2(-vx,-vz),turn=wrap(target-a.yaw),limit=(whale?.085:.23)*dt;
      const delta=Math.max(-limit,Math.min(limit,turn*(1-Math.exp(-dt*(whale?.8:1.4)))));
      a.yaw+=delta;a.roll=damp(a.roll,Math.max(-.22,Math.min(.22,-delta/Math.max(dt,.001)*a.speed*.14)),2,dt);
      a.speed=damp(a.speed,targetSpeed*(a.state==='surfacing'?.75:1),.65,dt);
      a.x-=Math.sin(a.yaw)*a.speed*dt;a.z-=Math.cos(a.yaw)*a.speed*dt;
      const breathIndex=p>=surf+.012&&p<dive-.02?Math.floor((p-surf-.012)*a.period/(whale?7.5:6)): -1;
      const key=cycle*10+breathIndex;
      a.breath=breathIndex>=0&&key!==a.lastBreath&&a.state!=='avoiding';
      if(a.breath){a.lastBreath=key;a.blows++;}
      a.tailSplash=p>=dive+.021&&p<dive+.065&&a.lastCycle!==cycle&&a.state!=='avoiding';
      if(a.tailSplash){a.lastCycle=cycle;a.dives++;}
    }
  }
}
