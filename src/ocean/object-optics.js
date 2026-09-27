import * as THREE from 'three';
import { waveGLSL } from './waves.js';
import { randomGenerator } from '../config.js';

// Two bounded object captures: submerged color/depth and reflected above-water objects.
// They share the real geometry, transforms, sky lighting and the exact wave clipping field.
export class ObjectOptics {
  constructor(scene,waves,camera,boundary) {
    Object.assign(this,{scene,waves,camera,boundary});this.pass={value:0};
    this.target=new THREE.WebGLRenderTarget(640,360,{type:THREE.HalfFloatType,depthBuffer:true,stencilBuffer:true});
    this.target.depthTexture=new THREE.DepthTexture(640,360,THREE.UnsignedInt248Type);this.target.depthTexture.format=THREE.DepthStencilFormat;
    this.reflection=new THREE.WebGLRenderTarget(640,360,{type:THREE.HalfFloatType,depthBuffer:true,stencilBuffer:true});
    this.mirror=new THREE.PerspectiveCamera();this.direction=new THREE.Vector3();this.eye=new THREE.Vector3();this.look=new THREE.Vector3();
    this.reflectionMatrix=new THREE.Matrix4();this.inverseProjection=new THREE.Matrix4();this.cameraWorld=new THREE.Matrix4();
    this.uniforms={uSubmerged:{value:this.target.texture},uSubmergedDepth:{value:this.target.depthTexture},uObjectReflection:{value:this.reflection.texture},
      uOpticsSize:{value:new THREE.Vector2(1,1)},uProjectionInverse:{value:this.inverseProjection},uCameraWorld:{value:this.cameraWorld},uReflectionMatrix:{value:this.reflectionMatrix}};
    const random=randomGenerator(40987),noise=new Uint8Array(128*128);
    for(let i=0;i<noise.length;i++)noise[i]=Math.floor(random()*255);
    this.paint=new THREE.DataTexture(noise,128,128,THREE.RedFormat);this.paint.wrapS=this.paint.wrapT=THREE.RepeatWrapping;
    this.paint.minFilter=this.paint.magFilter=THREE.LinearFilter;this.paint.needsUpdate=true;
    this.size=new THREE.Vector2();this.clearColor=new THREE.Color();this.lastReflection=-Infinity;
  }
  prepare(mesh,weathering=true) {
    mesh.layers.enable(2);mesh.layers.enable(3);
    const material=mesh.material;
    if(material.userData.oceanOptics)return;
    material.userData.oceanOptics=true;
    const before=material.onBeforeCompile;
    material.onBeforeCompile=(shader,renderer)=>{
      before.call(material,shader,renderer);
      Object.assign(shader.uniforms,this.waves.uniforms,{uObjectPass:this.pass,uPaintNoise:{value:this.paint},uWeathering:{value:weathering?1:0}});
      shader.vertexShader='varying vec3 vPaintLocal;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvPaintLocal=position;');
      shader.fragmentShader=`uniform float uObjectPass,uWeathering;uniform sampler2D uPaintNoise;varying vec3 vPaintLocal;\n${waveGLSL}\n`+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('void main() {',`void main() {
        if(uObjectPass>.5) {
          float y=vCircleWorld.y;
          if(uObjectPass<1.5&&y>uWaterHeightBound+.035)discard;
          if(uObjectPass>1.5&&y<-uWaterHeightBound-.035)discard;
          float surface=0.0;
          if(abs(y)<=uWaterHeightBound+.035){
            // Local wake height narrows the conservative bound without evaluating
            // the inverse wave mapping on dry decks or deeply submerged hulls.
            surface=disturbanceSurface(vCircleWorld.xz,0.0).x;
            float relative=y-surface;
            if(uObjectPass<1.5&&relative>uBaseHeightBound+.035)discard;
            if(uObjectPass>1.5&&relative<-uBaseHeightBound-.035)discard;
            if(abs(relative)<=uBaseHeightBound+.035)surface+=baseWaterHeight(vCircleWorld.xz);
          }
          if(uObjectPass<1.5&&vCircleWorld.y>surface+.035)discard;
          if(uObjectPass>1.5&&vCircleWorld.y<surface-.035)discard;
        }`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        float paintGrain=texture2D(uPaintNoise,vPaintLocal.xz*.19+vPaintLocal.y*.027).r;
        float panel=texture2D(uPaintNoise,vec2(vPaintLocal.z*.007,vPaintLocal.y*.012)+.27).r;
        float streak=texture2D(uPaintNoise,vec2(vPaintLocal.z*.08,vPaintLocal.y*.006)).r;
        float wear=uWeathering*smoothstep(.55,.90,streak)*(.08+.10*smoothstep(1.0,9.0,vPaintLocal.y));
        diffuseColor.rgb*=mix(1.0,.91+.07*paintGrain+.08*panel,uWeathering);
        diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.09,.84,.69),wear);
      `);
      shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
        roughnessFactor=clamp(roughnessFactor+(paintGrain-.5)*.10*uWeathering,.12,.96);
        // Wet paint responds to the shared displaced waterline, including heave.
        float wetPaint=0.0;
        if(uWeathering>.5&&vCircleWorld.y<uBaseHeightBound+.7){
          vec3 wetNormal;float wetCompression;float waterline=baseWavePosition(vCircleWorld.xz,wetNormal,wetCompression).y;
          wetPaint=1.0-smoothstep(waterline+.08,waterline+.7,vCircleWorld.y);
        }
        roughnessFactor=mix(roughnessFactor,.32,wetPaint*.7);diffuseColor.rgb*=1.0-wetPaint*.16;
      `);
    };
    material.customProgramCacheKey=()=>`circle-object-optics-v3`;
  }
  update(renderer,time) {
    if(!this.camera)return;
    if(this.boundary.cap&&!this.boundary.cap.material.userData.oceanOptics){this.boundary.apply(this.boundary.cap.material);this.prepare(this.boundary.cap,false);}
    const camera=this.camera;camera.updateMatrixWorld();this.inverseProjection.copy(camera.projectionMatrixInverse);this.cameraWorld.copy(camera.matrixWorld);
    renderer.getDrawingBufferSize(this.size);this.uniforms.uOpticsSize.value.copy(this.size);
    const scale=Math.min(.55,1024/Math.max(this.size.x,this.size.y));
    const width=Math.max(192,Math.round(this.size.x*scale)),height=Math.max(192,Math.round(this.size.y*scale));
    if(width!==this.target.width||height!==this.target.height){this.target.setSize(width,height);this.reflection.setSize(width,height);}
    const target=renderer.getRenderTarget(),tone=renderer.toneMapping,autoShadow=renderer.shadowMap.autoUpdate,mask=camera.layers.mask,clearAlpha=renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);renderer.setClearColor(0x000000,0);
    renderer.shadowMap.autoUpdate=false;renderer.toneMapping=THREE.NoToneMapping;
    this.pass.value=1;camera.layers.set(2);renderer.setRenderTarget(this.target);renderer.clear();renderer.render(this.scene,camera);
    camera.layers.mask=mask;
    if(time<this.lastReflection||time-this.lastReflection>=.065) {
      this.lastReflection=time;
      const m=this.mirror;m.copy(camera,false);m.layers.set(3);m.position.copy(camera.position);m.position.y=-camera.position.y;
      camera.getWorldDirection(this.direction);this.direction.y=-this.direction.y;this.look.copy(m.position).add(this.direction);
      m.up.copy(camera.up);m.up.y=-m.up.y;m.lookAt(this.look);m.updateMatrixWorld();
      this.reflectionMatrix.multiplyMatrices(m.projectionMatrix,m.matrixWorldInverse);
      this.pass.value=2;renderer.setRenderTarget(this.reflection);renderer.clear();renderer.render(this.scene,m);
    }
    this.pass.value=0;renderer.setRenderTarget(target);renderer.toneMapping=tone;renderer.shadowMap.autoUpdate=autoShadow;renderer.setClearColor(this.clearColor,clearAlpha);
  }
}

export const objectOpticsGLSL=/* glsl */`
uniform sampler2D uSubmerged,uSubmergedDepth,uObjectReflection;
uniform vec2 uOpticsSize;
uniform mat4 uProjectionInverse,uCameraWorld,uReflectionMatrix;
vec3 submergedObjects(vec3 water,vec3 normal,vec3 body,vec3 scatter) {
  vec2 uv=gl_FragCoord.xy/uOpticsSize;
  vec4 probe=texture2D(uSubmerged,uv);
  if(probe.a<.01)return body;
  float depth=texture2D(uSubmergedDepth,uv).r;
  vec4 viewPoint=uProjectionInverse*vec4(uv*2.0-1.0,depth*2.0-1.0,1.0);
  vec3 hit=(uCameraWorld*vec4(viewPoint.xyz/viewPoint.w,1.0)).xyz;
  float path=length(hit-water);
  vec3 viewNormal=mat3(viewMatrix)*normal;
  vec2 bent=uv+viewNormal.xy*min(.012,path*.00055);
  vec4 object=texture2D(uSubmerged,bent);
  vec3 transmission=exp(-waterExtinction()*path);
  // Filtering against the cleared alpha-zero background stores premultiplied edge color.
  vec3 submerged=(object.rgb/max(object.a,.001))*transmission+scatter*(1.0-transmission);
  return mix(body,submerged,object.a);
}
vec3 reflectedObjects(vec3 water,vec3 normal,vec3 sky) {
  vec4 projected=uReflectionMatrix*vec4(water,1.0);
  vec2 uv=projected.xy/projected.w*.5+.5;
  vec3 viewNormal=mat3(viewMatrix)*normal;uv+=viewNormal.xy*.008;
  if(projected.w<=0.0||any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0))))return sky;
  vec4 object=texture2D(uObjectReflection,uv);
  return mix(sky,object.rgb/max(object.a,.001),object.a*.85);
}
`;
