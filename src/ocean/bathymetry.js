import { smoothstep } from '../config.js';

// Fixed bathymetry, in metres. All shelves retain clearance for the deepest vessel.
// The same function shapes the mesh and intersects refracted rays in the water shaders.
export function seabedDepth(x,z,radius=2000) {
  const r=Math.hypot(x,z)/radius,px=x*2000/radius,pz=z*2000/radius;
  const shaped=r+.065*Math.sin(px*.002+.6)*Math.cos(pz*.0026)+.04*Math.sin((px-pz)*.003);
  const shelf=smoothstep(.27,.78,shaped),edge=smoothstep(.86,1,r);
  const channel=40*Math.exp(-Math.pow((px*.67-pz*.74-270)/180,2))*shelf*(1-edge);
  const offshore=142-110*shelf+channel+11*Math.sin(px*.0021+.7)*Math.sin(pz*.0027)+6*Math.sin((px+pz)*.0043);
  return Math.max(24,offshore)*(1-edge)+30*edge;
}
export const bathymetryGLSL=/* glsl */`
float seabedDepth(vec2 p) {
  vec2 q=p-uCircleCenter;float r=length(q)/uCircleRadius;q*=2000.0/uCircleRadius;
  float shaped=r+.065*sin(q.x*.002+.6)*cos(q.y*.0026)+.04*sin((q.x-q.y)*.003);
  float shelf=smoothstep(.27,.78,shaped),edge=smoothstep(.86,1.0,r);
  float channel=40.0*exp(-pow((q.x*.67-q.y*.74-270.0)/180.0,2.0))*shelf*(1.0-edge);
  float offshore=142.0-110.0*shelf+channel+11.0*sin(q.x*.0021+.7)*sin(q.y*.0027)+6.0*sin((q.x+q.y)*.0043);
  return max(24.0,offshore)*(1.0-edge)+30.0*edge;
}
`;

export const underwaterGLSL=/* glsl */`
${bathymetryGLSL}
uniform sampler2D uCaustics;
const float WATER_IOR=1.333;
vec3 waterExtinction() {
  // Red light disappears first. Suspended particles increase extinction in heavy weather.
  return vec3(.026,.012,.007)+vec3(.012,.014,.015)*max(uRough-.65,0.0);
}
vec3 sandColor(vec3 point) {
  vec2 p=point.xz;float depth=seabedDepth(p);
  float footprint=max(length(dFdx(p)),length(dFdy(p)));
  float grain=1.0-smoothstep(.7,4.0,footprint);
  float patches=fbm(p*.013),stone=smoothstep(.64,.78,patches);
  float ripples=sin(dot(p,vec2(.92,.38))*1.1+fbm(p*.047)*3.0);
  vec3 albedo=mix(vec3(.62,.57,.43),vec3(.21,.25,.22),stone*.8);
  albedo*=.83+.22*noise2(p*.16)+.028*ripples*grain;
  vec3 bottomNormal=normalize(vec3(seabedDepth(p+vec2(2.0,0.0))-depth,2.0,seabedDepth(p+vec2(0.0,2.0))-depth));
  float incidence=max(dot(bottomNormal,uSunDir),0.0);
  // A ray-projected irradiance texture concentrates light where refracted rays converge.
  vec2 warped=p+vec2(fbm(p*.018),fbm(p*.018+37.0))*11.0;
  vec2 second=mat2(.7986,-.6018,.6018,.7986)*warped/90.5+vec2(.31,.17);
  float caustic=clamp((texture2D(uCaustics,warped/64.0+.5).r+texture2D(uCaustics,second).r)*2.0,.45,2.4);
  caustic=mix(1.0,caustic,(1.0-smoothstep(24.0,75.0,depth))*grain);
  vec3 lightPath=exp(-waterExtinction()*depth/max(.6,uSunDir.y));
  // Keep the projected light pattern visible on the seabed without letting it read as
  // a repeating dimple texture through shallow clear water.
  vec3 direct=uSunColor*incidence*mix(1.0,caustic,.10)*(1.0-.82*uCloud);
  vec3 ambient=vec3(.18,.24,.29)*mix(.055,1.0,uDaylight);
  return albedo*(direct+ambient)*lightPath;
}
float circleExit(vec3 origin,vec3 direction) {
  vec2 p=origin.xz-uCircleCenter;float a=dot(direction.xz,direction.xz);
  float b=dot(p,direction.xz),c=dot(p,p)-uCircleRadius*uCircleRadius;
  return max(0.0,(-b+sqrt(max(0.0,b*b-a*c)))/max(a,.00001));
}
vec3 underwaterRay(vec3 origin,vec3 direction) {
  // Intersect the slowly varying bathymetry; four refinements for downward surface rays.
  float t=max(0.0,(-seabedDepth(origin.xz)-origin.y)/min(direction.y,-.02));
  for(int i=0;i<4;i++) {
    vec3 p=origin+direction*t;
    t=max(0.0,(-seabedDepth(p.xz)-origin.y)/min(direction.y,-.02));
  }
  float edge=circleExit(origin,direction);
  // Grazing rays through the exposed section need a bracketed solve on the shelf slopes.
  if(direction.y>-.55) {
    float lo=0.0,hi=min(edge,180.0/max(-direction.y,.02));
    vec3 last=origin+direction*hi;
    if(last.y<=-seabedDepth(last.xz)) {
      for(int i=0;i<10;i++){float mid=(lo+hi)*.5;vec3 q=origin+direction*mid;
        if(q.y>-seabedDepth(q.xz))lo=mid;else hi=mid;}
      t=hi;
    } else t=edge+1.0;
  }
  float path=min(t,edge);
  vec3 transmittance=exp(-waterExtinction()*path);
  vec3 endpoint=origin+direction*path;
  vec3 endColor=t<edge?sandColor(endpoint):uFogColor*.6;
  vec3 scatter=vec3(.014,.125,.165)*mix(.035,1.0,uDaylight)*(1.0-.35*uCloud);
  return endColor*transmittance+scatter*(1.0-transmittance);
}
`;
