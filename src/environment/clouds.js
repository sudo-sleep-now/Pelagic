import * as THREE from 'three';
import { randomGenerator } from '../config.js';

// One immutable, tileable volume and one hemispherical lighting atlas. The same
// atlas supplies the sky, water reflection and star occlusion, at at most 5 Hz.
export class Clouds {
  constructor(environmentUniforms) {
    const size=64,noise=new Uint8Array(size**3),random=randomGenerator(40819);
    for(let i=0;i<noise.length;i++)noise[i]=Math.floor(random()*256);
    this.noise=new THREE.Data3DTexture(noise,size,size,size);
    this.noise.format=THREE.RedFormat;this.noise.type=THREE.UnsignedByteType;
    this.noise.minFilter=this.noise.magFilter=THREE.LinearFilter;
    this.noise.wrapS=this.noise.wrapT=this.noise.wrapR=THREE.RepeatWrapping;
    this.noise.unpackAlignment=1;this.noise.needsUpdate=true;
    this.target=new THREE.WebGLRenderTarget(1536,768,{type:THREE.HalfFloatType,depthBuffer:false,stencilBuffer:false});
    this.target.texture.wrapS=THREE.RepeatWrapping;
    this.lastTime=-Infinity;
    this.uniforms={...environmentUniforms,uCloudNoise:{value:this.noise},uMarchSteps:{value:32}};
    const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms:this.uniforms,depthTest:false,depthWrite:false,
      vertexShader:`out vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`,
      fragmentShader:/* glsl */`
        precision highp sampler3D;
        uniform sampler3D uCloudNoise;
        uniform vec3 uSunDir,uSunColor,uZenith,uHorizon;
        uniform vec2 uWind;
        uniform float uSkyTime,uDaylight,uCloud,uRain;
        uniform int uMarchSteps;
        in vec2 vUv;out vec4 outColor;
        float noise3(vec3 p){vec3 f=fract(p);f=f*f*(3.0-2.0*f);return texture(uCloudNoise,(floor(p)+f+.5)/64.0).r;}
        float density(vec3 p) {
          float h=(p.y-1900.0)/1450.0;
          float profile=smoothstep(0.0,.10,h)*(1.0-smoothstep(.58,1.0,h));
          if(profile<=0.0)return 0.0;
          p.xz-=uWind*uSkyTime*7.0;
          float weather=.72*noise3(vec3(p.xz*.00028,2.3))+.28*noise3(vec3(p.xz*.00073+17.0,7.1));
          float coverage=mix(.65,.25,uCloud);
          float column=smoothstep(coverage-.06,coverage+.12,weather);
          // Broad connected masses with a flatter base and rounded, eroded tops.
          float shape=.53*noise3(p*.0013)+.28*noise3(p*.0045+11.0)+.13*noise3(p*.012+31.0)+.06*noise3(p*.032+53.0);
          float billow=max(0.0,shape-mix(.56,.34,column))*3.2;
          float erosion=.08*noise3(p*.023+57.0)*(1.0-smoothstep(0.0,.5,billow));
          float stratus=smoothstep(.63,.95,uCloud)*.18*(1.0-smoothstep(.15,.72,h));
          return (max(0.0,billow-erosion)*column+stratus)*profile;
        }
        void main() {
          float azimuth=(vUv.x-.5)*6.28318530718;
          float elevation=vUv.y*1.57079632679;
          vec3 rd=vec3(cos(azimuth)*cos(elevation),sin(elevation),sin(azimuth)*cos(elevation));
          if(rd.y<.018){outColor=vec4(0.0);return;}
          float near=1900.0/rd.y,far=min(3350.0/rd.y,150000.0);
          float stepSize=(far-near)/float(uMarchSteps);
          float extinction=mix(.005,.012,uCloud);
          vec3 accumulated=vec3(0.0);float transmission=1.0;
          float sunDot=max(0.0,dot(rd,uSunDir));
          vec3 ambient=mix(vec3(.013,.022,.040),vec3(.15,.19,.25),uDaylight)*(1.0-uRain*.24);
          // Stable per-texel offsets remove coherent rings from slab sampling.
          float jitter=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
          for(int i=0;i<32;i++) {
            if(i>=uMarchSteps||transmission<.012)break;
            float t=near+(float(i)+jitter)*stepSize;
            vec3 p=rd*t;float d=density(p);
            if(d<.001)continue;
            float shadow=exp(-extinction*(density(p+uSunDir*250.0)*350.0+density(p+uSunDir*650.0)*650.0));
            float phase=.45+.65*pow(sunDot,8.0);
            vec3 direct=uSunColor*phase*shadow*1.40*(1.0-uRain*.45);
            float heightLight=mix(.58,1.05,smoothstep(1900.0,3200.0,p.y));
            vec3 light=ambient*heightLight+direct+uSunColor*.30*pow(sunDot,12.0)*exp(-d*9.0);
            vec3 haze=mix(uHorizon,uZenith,pow(rd.y,.4));
            light=mix(light,haze,1.0-exp(-t*.000014));
            float alpha=1.0-exp(-d*extinction*stepSize);
            accumulated+=light*alpha*transmission;transmission*=1.0-alpha;
          }
          float horizon=smoothstep(.018,.065,rd.y);
          outColor=vec4(accumulated*horizon,(1.0-transmission)*horizon);
        }`});
    this.scene=new THREE.Scene();
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);mesh.frustumCulled=false;this.scene.add(mesh);
    this.camera=new THREE.Camera();
  }
  update(renderer,time) {
    if(time>=this.lastTime&&time-this.lastTime<.20)return;
    this.lastTime=time;
    const previous=renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);renderer.render(this.scene,this.camera);renderer.setRenderTarget(previous);
  }
  reduceQuality() {
    if(this.target.width<=1024)return;
    this.target.setSize(1024,512);this.uniforms.uMarchSteps.value=24;
  }
}
