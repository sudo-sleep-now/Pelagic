import * as THREE from 'three';
import { boundaryGLSL } from '../boundary.js';
import { randomGenerator } from '../config.js';

// Fixed mist/droplet pool. Atmospheric wind stretches the blow after its initial jet.
export class MarineSpray {
  constructor(scene,environment,boundary) {
    this.capacity=256;this.cursor=0;this.emitted=0;this.random=randomGenerator(7208);
    this.origins=new Float32Array(this.capacity*4);this.motion=new Float32Array(this.capacity*4);
    for(let i=0;i<this.capacity;i++)this.origins[i*4+3]=-1e5;
    const plane=new THREE.PlaneGeometry(1,1),g=new THREE.InstancedBufferGeometry();g.index=plane.index;g.setAttribute('position',plane.attributes.position);g.setAttribute('uv',plane.attributes.uv);
    g.setAttribute('iOrigin',new THREE.InstancedBufferAttribute(this.origins,4).setUsage(THREE.DynamicDrawUsage));g.setAttribute('iMotion',new THREE.InstancedBufferAttribute(this.motion,4).setUsage(THREE.DynamicDrawUsage));g.instanceCount=this.capacity;
    this.uniforms={...environment.uniforms,...boundary.uniforms,uMistTime:{value:0}};
    const mat=new THREE.ShaderMaterial({uniforms:this.uniforms,transparent:true,depthWrite:false,
      vertexShader:`uniform float uMistTime;uniform vec2 uWind;attribute vec4 iOrigin,iMotion;varying vec2 vUv;varying vec3 vWorld;varying float vAge,vLife;void main(){
        vUv=uv;vAge=uMistTime-iOrigin.w;vLife=iMotion.w;
        if(vAge<0.0||vAge>vLife){gl_Position=vec4(2.0,2.0,2.0,1.0);return;}
        vec3 p=iOrigin.xyz+iMotion.xyz*vAge;p.y-=.8*vAge*vAge;p.xz+=uWind*vAge*vAge*.055;
        float size=(.14+vAge*.46)*mix(.7,1.3,fract(iOrigin.x*7.1));
        vec3 right=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]),up=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
        vWorld=p+(right*position.x+up*position.y)*size;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);
      }`,fragmentShader:`${boundaryGLSL}uniform float uDaylight;varying vec2 vUv;varying vec3 vWorld;varying float vAge,vLife;void main(){clipCircle(vWorld);
        if(vAge<0.0||vAge>vLife)discard;float r=length(vUv-.5)*2.0;float fade=pow(1.0-vAge/vLife,1.3);float a=exp(-r*r*5.0)*(1.0-smoothstep(.7,1.0,r))*fade*.32;
        if(a<.002)discard;gl_FragColor=vec4(vec3(.70,.78,.8)*mix(.09,1.0,uDaylight),a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
    this.mesh=new THREE.Mesh(g,mat);this.mesh.frustumCulled=false;this.mesh.renderOrder=8;scene.add(this.mesh);
  }
  emit(p,time,whale=true,splash=false) {
    const n=splash?18:whale?42:16,r=this.random;
    for(let j=0;j<n;j++) {
      const i=(this.cursor++%this.capacity)*4,angle=r()*Math.PI*2,lateral=splash?2.2:.45,speed=splash?1.3:whale?3.8:2.3;
      this.origins.set([p.x,p.y,p.z,time+j/(n*8)],i);
      this.motion.set([Math.cos(angle)*r()*lateral,speed*(.65+r()*.55),Math.sin(angle)*r()*lateral,splash?1.5:whale?2.8:1.8],i);
    }
    this.emitted+=n;this.mesh.geometry.attributes.iOrigin.needsUpdate=true;this.mesh.geometry.attributes.iMotion.needsUpdate=true;
  }
  update(time){this.uniforms.uMistTime.value=time;}
}
