// The same sky function shades the dome and water's reflected sky. No environment capture per frame.
export const skyGLSL = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uFogColor;
uniform float uDaylight;
uniform float uNight;
uniform float uCloud;
uniform float uRain;
uniform float uRough;
uniform float uSkyTime;
uniform float uFogDensity;
uniform vec2 uWind;
uniform sampler2D uCloudMap;
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i), hash21(i+vec2(1,0)), f.x), mix(hash21(i+vec2(0,1)), hash21(i+vec2(1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s=0.0, a=0.5;
  for(int i=0;i<4;i++) { s+=a*noise2(p); p=mat2(1.6,-1.2,1.2,1.6)*p+7.1; a*=0.5; }
  return s;
}
vec2 cloudUV(vec3 rd) {
  return vec2(atan(rd.z,rd.x)/6.28318530718+.5,asin(clamp(rd.y,0.0,1.0))/1.57079632679);
}
float cloudOpacity(vec3 rd) {return rd.y>0.0?texture2D(uCloudMap,cloudUV(rd)).a:0.0;}
vec3 skyRadiance(vec3 rd, bool disks) {
  float h = max(rd.y, 0.0);
  vec3 sky = mix(uHorizon, uZenith, pow(h, 0.40));
  float sunDot = max(dot(rd,uSunDir),0.0);
  float sunGlow = pow(sunDot, 24.0) * 0.26 + pow(sunDot, 4.0) * 0.10;
  sky += uSunColor * sunGlow * (1.0 - uCloud * 0.75);
  float cloudMask = 0.0;
  if(rd.y > 0.0) {
    vec4 cloud=texture2D(uCloudMap,cloudUV(rd));
    cloudMask=cloud.a;
    sky=sky*(1.0-cloud.a)+cloud.rgb;
  }
  if(disks) {
    float sunDisk = smoothstep(0.99986,0.99994,sunDot);
    sky += uSunColor * sunDisk*5.0*(1.0-cloudMask*0.95);
    float moonDot = dot(rd,uMoonDir);
    float moonDisk = smoothstep(0.99991,0.99996,moonDot);
    sky += vec3(0.50,0.63,0.82)*moonDisk*uNight*2.1*(1.0-cloudMask);
  }
  return sky;
}
`;
