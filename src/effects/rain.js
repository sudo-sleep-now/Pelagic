import * as THREE from 'three';
import { CONFIG, randomGenerator } from '../config.js';
import { boundaryGLSL } from '../boundary.js';
export class Rain {
  constructor(scene,environment,boundary) {
    const random=randomGenerator(CONFIG.seed+13);
    const drops=new Float32Array(CONFIG.rainCapacity*4);
    for(let i=0;i<CONFIG.rainCapacity;i++){drops[i*4]=(random()-.5)*240;drops[i*4+1]=random();drops[i*4+2]=(random()-.5)*240;drops[i*4+3]=.6+random()*.7;}
    const base=new THREE.PlaneGeometry(1,1),g=new THREE.InstancedBufferGeometry();g.index=base.index;
    g.setAttribute('position',base.attributes.position);g.setAttribute('uv',base.attributes.uv);
    g.setAttribute('iDrop',new THREE.InstancedBufferAttribute(drops,4));g.instanceCount=CONFIG.rainCapacity;
    this.anchor=new THREE.Vector3();this.right=new THREE.Vector3();this.geometry=g;
    this.uniforms={...environment.uniforms,...boundary.uniforms,uAnchor:{value:this.anchor},uCameraRight:{value:this.right}};
    const material=new THREE.ShaderMaterial({uniforms:this.uniforms,transparent:true,depthWrite:false,
      vertexShader:/* glsl */`
        attribute vec4 iDrop;uniform vec3 uAnchor;uniform vec3 uCameraRight;uniform float uSkyTime;uniform vec2 uWind;
        varying vec3 vWorld;varying vec2 vUv;
        void main(){
          vUv=uv;float fall=fract(iDrop.y-uSkyTime*.20*iDrop.w);
          vec3 p=uAnchor+vec3(iDrop.x,fall*160.0-65.0,iDrop.z);
          p.xz+=uWind*(1.0-fall)*15.0;
          p+=uCameraRight*position.x*.15+vec3(uWind.x*.10,1.0,uWind.y*.10)*position.y*(3.0+iDrop.w*2.0);
          vWorld=p;gl_Position=projectionMatrix*viewMatrix*vec4(p,1.0);
        }`,
      fragmentShader:/* glsl */`${boundaryGLSL}
        uniform float uRain;uniform float uDaylight;varying vec3 vWorld;varying vec2 vUv;
        void main(){clipCircle(vWorld);if(vWorld.y<0.0)discard;float fade=sin(vUv.y*3.14159)*(1.0-smoothstep(.0,.5,abs(vUv.x-.5)));gl_FragColor=vec4(vec3(.52,.63,.70)*mix(.25,1.0,uDaylight),fade*uRain*.26);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh=new THREE.Mesh(g,material);this.mesh.frustumCulled=false;this.mesh.renderOrder=8;scene.add(this.mesh);this.boundary=boundary;
  }
  update(camera,rain) {
    this.mesh.visible=rain>.01; this.geometry.instanceCount=Math.floor(CONFIG.rainCapacity*rain);
    this.anchor.copy(camera.position);this.anchor.y=Math.min(160,camera.position.y);
    const c=this.boundary.uniforms.uCircleCenter.value, dx=this.anchor.x-c.x,dz=this.anchor.z-c.y;
    const d=Math.hypot(dx,dz),max=this.boundary.radius-140;
    if(d>max){this.anchor.x=c.x+dx/d*max;this.anchor.z=c.y+dz/d*max;}
    this.right.setFromMatrixColumn(camera.matrixWorld,0);
  }
}
