// Smooth finite crossing routes. Analytic positions/tangents avoid per-frame spline allocations.
export class Route {
  constructor(x,z,yaw,id,radius) {
    this.dx=-Math.sin(yaw);this.dz=-Math.cos(yaw);this.rx=Math.cos(yaw);this.rz=-Math.sin(yaw);
    this.phase=id*1.81;this.amplitude=14+(id%3)*9;this.frequency=Math.PI/(radius*1.25);
    this.initial=x*this.dx+z*this.dz;
    this.offset=x*this.rx+z*this.rz-this.amplitude*Math.sin(this.initial*this.frequency+this.phase);
    const reach=Math.sqrt(Math.max(0,radius*radius-this.offset*this.offset));
    this.start=-reach-650;this.end=reach+650;
  }
  sample(progress,out,laneOffset=0) {
    const lateral=this.offset+this.amplitude*Math.sin(progress*this.frequency+this.phase);
    const slope=this.amplitude*this.frequency*Math.cos(progress*this.frequency+this.phase);
    out.x=this.dx*progress+this.rx*(lateral+laneOffset);out.z=this.dz*progress+this.rz*(lateral+laneOffset);
    const tx=this.dx+this.rx*slope,tz=this.dz+this.rz*slope, inv=1/Math.hypot(tx,tz);
    out.dx=tx*inv;out.dz=tz*inv;
    out.yaw=Math.atan2(-out.dx,-out.dz);
    return out;
  }
}
