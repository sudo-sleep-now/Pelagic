import * as THREE from 'three';

// Bounded 64 m repeating optical patch: project a fine grid of sunlight rays through
// short wind waves. Overlapping triangles add energy; compressed areas become bright.
// This is a local approximation, not a photon simulation of the entire 4 km ocean.
export class Caustics {
  constructor(waves,environment) {
    this.target=new THREE.WebGLRenderTarget(512,512,{depthBuffer:false,stencilBuffer:false,
      minFilter:THREE.LinearMipmapLinearFilter,magFilter:THREE.LinearFilter,type:THREE.HalfFloatType,generateMipmaps:true});
    this.target.texture.wrapS=this.target.texture.wrapT=THREE.RepeatWrapping;
    this.uniforms={...waves.uniforms,...environment.uniforms};
    this.scene=new THREE.Scene();this.camera=new THREE.Camera();this.lastTime=-100;
    this.savedColor=new THREE.Color();
    const geometry=new THREE.PlaneGeometry(112,112,224,224).rotateX(-Math.PI/2);
    const material=new THREE.ShaderMaterial({uniforms:this.uniforms,side:THREE.DoubleSide,
      depthTest:false,depthWrite:false,blending:THREE.CustomBlending,
      blendEquation:THREE.AddEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,
      vertexShader:/* glsl */`
        uniform float uTime,uRough;uniform vec3 uSunDir;
        varying vec2 vSource;varying float vEnergy;
        void main() {
          vec2 p=position.xz,gradient=vec2(0.0);float height=0.0;
          for(int i=0;i<12;i++) {
            vec2 band;float amplitude;
            if(i==0){band=vec2(2.0,1.0);amplitude=.21;}
            else if(i==1){band=vec2(-1.0,3.0);amplitude=.14;}
            else if(i==2){band=vec2(4.0,-2.0);amplitude=.10;}
            else if(i==3){band=vec2(1.0,6.0);amplitude=.063;}
            else if(i==4){band=vec2(-7.0,-2.0);amplitude=.045;}
            else if(i==5){band=vec2(6.0,8.0);amplitude=.033;}
            else if(i==6){band=vec2(-12.0,3.0);amplitude=.075;}
            else if(i==7){band=vec2(4.0,-15.0);amplitude=.06;}
            else if(i==8){band=vec2(14.0,11.0);amplitude=.048;}
            else if(i==9){band=vec2(-8.0,-18.0);amplitude=.04;}
            else if(i==10){band=vec2(21.0,5.0);amplitude=.035;}
            else{band=vec2(-18.0,19.0);amplitude=.025;}
            vec2 k=band*.09817477;float omega=sqrt(9.81*length(k));
            float phase=dot(k,p)-omega*uTime+float(i)*2.71;
            float a=amplitude*(.55+.6*uRough);
            height+=a*sin(phase);gradient+=a*k*cos(phase);
          }
          vec3 normal=normalize(vec3(-gradient.x,1.0,-gradient.y));
          vec3 ray=refract(-normalize(vec3(uSunDir.x,max(uSunDir.y,.03),uSunDir.z)),normal,1.0/1.333);
          vec2 floorPoint=p+ray.xz*(20.0+height)/max(-ray.y,.2);
          vSource=p;float cosine=max(dot(normal,uSunDir),0.0);
          vEnergy=max(uSunDir.y,0.0)*(1.0-(.0204+.9796*pow(1.0-cosine,5.0)));
          gl_Position=vec4(floorPoint/32.0,0.0,1.0);
        }
      `,
      fragmentShader:/* glsl */`
        varying vec2 vSource;varying float vEnergy;
        void main() {
          vec2 dx=dFdx(vSource),dy=dFdy(vSource);
          float sourceArea=abs(dx.x*dy.y-dx.y*dy.x);
          float projectedArea=4096.0/(512.0*512.0);
          float focus=min(sourceArea/projectedArea,12.0);
          gl_FragColor=vec4(vec3(.25*focus*vEnergy),1.0);
        }
      `});
    const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;this.scene.add(mesh);
  }
  update(renderer,time,camera) {
    if(this.uniforms.uDaylight.value<.05)return;
    const interval=camera?.position.y>180?1/8:1/24;
    if(time-this.lastTime<interval && time>=this.lastTime)return;
    this.lastTime=time;
    const previous=renderer.getRenderTarget(),alpha=renderer.getClearAlpha();
    renderer.getClearColor(this.savedColor);renderer.setRenderTarget(this.target);
    renderer.setClearColor(0,0);renderer.clear();renderer.render(this.scene,this.camera);
    renderer.setRenderTarget(previous);renderer.setClearColor(this.savedColor,alpha);
  }
}
