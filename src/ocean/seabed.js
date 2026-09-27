import * as THREE from 'three';
import { circularMesh } from './geometry.js';
import { bathymetryGLSL, underwaterGLSL } from './bathymetry.js';
import { skyGLSL } from '../environment/sky-shader.js';
import { boundaryGLSL } from '../boundary.js';
import { seabedDepth } from './bathymetry.js';

export class Seabed {
  constructor(scene,uniforms,config) {
    this.group=new THREE.Group();scene.add(this.group);
    this.edgeGroup=new THREE.Group();this.group.add(this.edgeGroup);
    const geometry=circularMesh(config.radius,96,384,0);
    const position=geometry.attributes.position;
    for(let i=0;i<position.count;i++)position.setY(i,-seabedDepth(position.getX(i),position.getZ(i),config.radius));
    geometry.computeVertexNormals();geometry.computeBoundingSphere();
    const floor=new THREE.Mesh(geometry,new THREE.ShaderMaterial({uniforms,
      vertexShader:`varying vec3 vWorld;void main(){vWorld=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);}`,
      fragmentShader:`${skyGLSL}\n${boundaryGLSL}\n${underwaterGLSL}
        varying vec3 vWorld;void main(){clipCircle(vWorld);gl_FragColor=vec4(sandColor(vWorld),1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`}));
    floor.position.set(config.center[0],0,config.center[1]);this.group.add(floor);this.floor=floor;
    // Close the substrate below the irregular seabed: an opaque stratified section of rock.
    const sectors=2048,vertices=new Float32Array((sectors+1)*6),indices=[];
    for(let i=0;i<=sectors;i++) {
      const a=i/sectors*Math.PI*2,x=Math.cos(a)*config.radius,z=Math.sin(a)*config.radius;
      const top=-seabedDepth(x,z,config.radius);
      vertices.set([x,-168,z,x,top,z],i*6);
      if(i<sectors){const n=i*2;indices.push(n,n+1,n+2,n+1,n+3,n+2);}
    }
    const wallGeometry=new THREE.BufferGeometry();wallGeometry.setAttribute('position',new THREE.BufferAttribute(vertices,3));wallGeometry.setIndex(indices);
    const wall=new THREE.Mesh(wallGeometry,new THREE.ShaderMaterial({uniforms,
      vertexShader:`varying vec3 vWorld;void main(){vWorld=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);}`,
      fragmentShader:`${skyGLSL}\n${boundaryGLSL}\n${bathymetryGLSL}
        varying vec3 vWorld;
        void main(){vec3 p=vWorld;float sand=smoothstep(19.0,0.0,-p.y-seabedDepth(p.xz));
          float strata=.80+.13*noise2(p.xz*.05+p.y*.035)+.09*sin(p.y*.19+fbm(p.xz*.03)*12.0);
          vec3 albedo=mix(vec3(.20,.18,.15),vec3(.46,.41,.31),sand)*strata;
          vec3 n=normalize(vec3(p.x-uCircleCenter.x,0.0,p.z-uCircleCenter.y));
          vec3 light=vec3(.25,.30,.34)*mix(.06,1.0,uDaylight)+uSunColor*max(dot(n,uSunDir),0.0)*.6;
          vec3 color=albedo*light;color=mix(color,uFogColor,1.0-exp(-length(cameraPosition-p)*uFogDensity));
          gl_FragColor=vec4(color,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`}));
    wall.position.copy(floor.position);wall.frustumCulled=false;this.edgeGroup.add(wall);
    const base=new THREE.Mesh(new THREE.CircleGeometry(config.radius,384),new THREE.MeshStandardMaterial({color:0x35322c,roughness:1}));
    base.rotation.x=Math.PI/2;base.position.set(config.center[0],-168,config.center[1]);this.edgeGroup.add(base);
  }
}
