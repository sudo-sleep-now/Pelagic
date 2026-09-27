// Signed separation of oriented hull rectangles (metres). Positive means disjoint;
// negative means overlap on every separating axis. A broad sphere test alone is too conservative.
export function hullSeparation(a,b,margin=0) {
  const ax=Math.cos(a.yaw),az=-Math.sin(a.yaw),afx=-Math.sin(a.yaw),afz=-Math.cos(a.yaw);
  const bx=Math.cos(b.yaw),bz=-Math.sin(b.yaw),bfx=-Math.sin(b.yaw),bfz=-Math.cos(b.yaw);
  const px=b.pose.x-a.pose.x,pz=b.pose.z-a.pose.z;
  let separation=-Infinity;
  for(let i=0;i<4;i++) {
    const x=i===0?ax:i===1?afx:i===2?bx:bfx,z=i===0?az:i===1?afz:i===2?bz:bfz;
    const ra=Math.abs(ax*x+az*z)*a.spec.beam*.5+Math.abs(afx*x+afz*z)*a.spec.length*.5;
    const rb=Math.abs(bx*x+bz*z)*b.spec.beam*.5+Math.abs(bfx*x+bfz*z)*b.spec.length*.5;
    separation=Math.max(separation,Math.abs(px*x+pz*z)-ra-rb-margin);
  }
  return separation;
}
