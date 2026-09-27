import * as THREE from 'three';
import { CONFIG,WATER_SOURCE_COUNT } from '../config.js';
import { waveGLSL } from '../ocean/waves.js';
import { skyGLSL } from '../environment/sky-shader.js';
import { boundaryGLSL } from '../boundary.js';

export class Wakes {
  constructor(scene,waves,environment,boundary) {
    this.capacity=CONFIG.wakeCapacity; this.bowCount=WATER_SOURCE_COUNT*2; this.total=this.capacity+this.bowCount;
    this.cursor=0; this.time=0; this.active=0;
    this.origins=new Float32Array(this.total*4); this.shapes=new Float32Array(this.total*4);
    this.drifts=new Float32Array(this.total*4);this.tracks=new Float64Array(WATER_SOURCE_COUNT*4);
    this.owners=new Int16Array(this.capacity).fill(-1); this.counts=new Uint16Array(WATER_SOURCE_COUNT);
    for(let i=0;i<this.total;i++)this.origins[i*4+2]=-10000;
    const plane=new THREE.PlaneGeometry(1,1,4,6);
    const geometry=new THREE.InstancedBufferGeometry(); geometry.index=plane.index;
    geometry.setAttribute('position',plane.attributes.position);geometry.setAttribute('uv',plane.attributes.uv);
    geometry.setAttribute('iOrigin',new THREE.InstancedBufferAttribute(this.origins,4).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('iShape',new THREE.InstancedBufferAttribute(this.shapes,4).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('iDrift',new THREE.InstancedBufferAttribute(this.drifts,4).setUsage(THREE.DynamicDrawUsage));
    geometry.instanceCount=this.total;
    this.geometry=geometry;
    this.uniforms={...waves.uniforms,...environment.uniforms,...boundary.uniforms};
    const material=new THREE.ShaderMaterial({
      uniforms:this.uniforms,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1,
      vertexShader:/* glsl */`${waveGLSL}
        uniform vec2 uWind;
        attribute vec4 iOrigin; attribute vec4 iShape;attribute vec4 iDrift;
        varying vec2 vUv; varying vec3 vWorld; varying float vFade; varying float vType;
        void main(){
          float age=uTime-iOrigin.z;
          vFade=pow(max(0.0,1.0-age/max(iOrigin.w,.01)),1.7)*smoothstep(0.0,.7,age);
          vFade*=iDrift.z;
          if(age<0.0||age>iOrigin.w){gl_Position=vec4(2.0,2.0,2.0,1.0);vFade=0.0;return;}
          vUv=uv;vType=iShape.w;
          vec2 forward=vec2(sin(iShape.x),cos(iShape.x)); vec2 right=vec2(forward.y,-forward.x);
          float spread=1.0+age*.018;
          vec2 p=iOrigin.xy+iDrift.xy*min(age,9.0)+uWind*age*.045+right*iShape.w*age*.09;
          // PlaneGeometry's +Z face must map to +Y after mapping XY into XZ.
          p+=right*position.x*iShape.y*spread-forward*position.y*iShape.z*spread;
          vWorld=vec3(p.x,waterHeight(p)+.026,p.y);
          gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);
        }`,
      fragmentShader:/* glsl */`${skyGLSL}
        ${boundaryGLSL}
        varying vec2 vUv; varying vec3 vWorld; varying float vFade; varying float vType;
        void main(){
          clipCircle(vWorld);
          float lateral=1.0-smoothstep(.15,.5,abs(vUv.x-.5));
          float longitudinal=smoothstep(0.0,.15,vUv.y)*(1.0-smoothstep(.65,1.0,vUv.y));
          float turbulent=fbm(vWorld.xz*.55+uWind*uSkyTime*.2);
          float foam=smoothstep(.26,.65,turbulent);
          float opacity=vFade*lateral*longitudinal*foam*.38;
          vec3 color=vec3(.62,.73,.76)*mix(.12,1.0,uDaylight);
          float haze=1.0-exp(-length(cameraPosition-vWorld)*uFogDensity);
          color=mix(color,uFogColor,haze);
          gl_FragColor=vec4(color,opacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh=new THREE.Mesh(geometry,material);this.mesh.frustumCulled=false;this.mesh.renderOrder=6;scene.add(this.mesh);
    this.boundary=boundary;
  }
  write(index,x,z,birth,life,angle,width,length,type,flowX=0,flowZ=0,density=1) {
    const i=index*4,o=this.origins,s=this.shapes;
    o[i]=x;o[i+1]=z;o[i+2]=birth;o[i+3]=life;
    s[i]=angle;s[i+1]=width;s[i+2]=length;s[i+3]=type;
    this.drifts[i]=flowX;this.drifts[i+1]=flowZ;this.drifts[i+2]=density;this.drifts[i+3]=0;
  }
  emit(owner,x,z,angle,beam,speed,birth=this.time,flowX=0,flowZ=0,density=1,segment=0) {
    for(let side=-1;side<=1;side+=2) {
      const i=this.cursor++%this.capacity;
      const rx=Math.cos(angle),rz=-Math.sin(angle);
      this.write(i,x+rx*side*beam*.18,z+rz*side*beam*.18,birth,CONFIG.wakeLifetime,angle,beam*.34,segment||Math.max(6,speed*1.3),side,flowX,flowZ,density);
      this.owners[i]=owner;
    }
  }
  follow(v,time,dt) {
    const f=v.buoyancy.feedback,s=v.spec,p=v.root.position,reverse=f.forwardSpeed<-.1,yaw=v.yaw+(reverse?Math.PI:0);
    const x=p.x+Math.sin(yaw)*s.length*.43,z=p.z+Math.cos(yaw)*s.length*.43,n=v.id*4,a=this.tracks;
    if(a[n+3]===0){a[n]=x;a[n+1]=z;a[n+2]=time;a[n+3]=1;return;}
    const distance=Math.hypot(x-a[n],z-a[n+1]);
    if(distance>Math.max(40,s.length*.7)){a[n]=x;a[n+1]=z;a[n+2]=time;return;}
    const speed=Math.abs(f.forwardSpeed),spacing=Math.max(1.6,s.beam*.30);
    if(speed>.3&&f.sternWet>.08&&(distance>spacing||time-a[n+2]>.9&&distance>.7)) {
      const angle=Math.atan2(-(x-a[n]),-(z-a[n+1]));
      const density=Math.min(1.25,.25+speed/s.speed*.9+f.impact*.8)*f.sternWet;
      this.emit(v.id,(x+a[n])*.5,(z+a[n+1])*.5,angle,s.beam,speed,time,f.waterVx,f.waterVz,density,distance*1.35+s.beam*.45);
      a[n]=x;a[n+1]=z;a[n+2]=time;
    }
  }
  bow(vessel,id,reverse=false) {
    const p=vessel.root.position,yaw=vessel.yaw+(reverse?Math.PI:0),forwardX=-Math.sin(yaw),forwardZ=-Math.cos(yaw),rightX=Math.cos(yaw),rightZ=-Math.sin(yaw);
    const spec=vessel.spec;
    const feedback=vessel.buoyancy.feedback;
    const power=Math.min(1.2,Math.abs(feedback.forwardSpeed)/Math.max(1,spec.speed)+feedback.impact*.9)*(reverse?feedback.sternWet:feedback.bowWet);
    for(let n=0;n<2;n++) {
      const side=n*2-1, i=this.capacity+id*2+n;
      const x=p.x+forwardX*spec.length*.38+rightX*spec.beam*.28*side;
      const z=p.z+forwardZ*spec.length*.38+rightZ*spec.beam*.28*side;
      this.write(i,x,z,this.time-.8,.81+2.0*power,yaw,Math.max(.7,spec.beam*.22)*(.4+.6*power),Math.max(1.7,spec.length*.07),0,0,0,Math.min(1.5,power*1.3));
    }
  }
  update(time) {
    this.time=time; this.counts.fill(0);this.active=0;
    const center=this.boundary.uniforms.uCircleCenter.value,r2=this.boundary.radius**2;
    for(let i=0;i<this.capacity;i++) {
      const n=i*4,age=time-this.origins[n+2];
      if(age<0||age>this.origins[n+3])continue;
      this.active++;
      // Conservative rectangle radius: recycle only after *all* remaining visible foam is gone.
      const maxSize=Math.hypot(this.shapes[n+1],this.shapes[n+2])*(1+age*.018)*.5+age*.7+Math.hypot(this.drifts[n],this.drifts[n+1])*Math.min(age,9);
      const distance=Math.hypot(this.origins[n]-center.x,this.origins[n+1]-center.y);
      if(distance<Math.sqrt(r2)+maxSize && this.owners[i]>=0)this.counts[this.owners[i]]++;
    }
    this.geometry.attributes.iOrigin.needsUpdate=true;this.geometry.attributes.iShape.needsUpdate=true;this.geometry.attributes.iDrift.needsUpdate=true;
  }
  clearOwner(owner) {
    for(let i=0;i<this.capacity;i++)if(this.owners[i]===owner){this.origins[i*4+2]=-10000;this.owners[i]=-1;}
    for(let i=0;i<2;i++)this.origins[(this.capacity+owner*2+i)*4+2]=-10000;
    this.counts[owner]=0;
    this.tracks[owner*4+3]=0;
  }
  hasVisibleWake(owner){return this.counts[owner]>0;}
}
