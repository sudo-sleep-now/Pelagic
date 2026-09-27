import * as THREE from 'three';
import { CONFIG, smoothstep } from '../config.js';
import { skyGLSL } from './sky-shader.js';
import { Clouds } from './clouds.js';
export class Environment {
  constructor(scene) {
    this.scene=scene;this.lastIBL=-Infinity;
    this.hour = CONFIG.startHour;
    this.uniforms = {
      uSunDir:{value:new THREE.Vector3()},uSunColor:{value:new THREE.Color()},uMoonDir:{value:new THREE.Vector3()},
      uZenith:{value:new THREE.Color()},uHorizon:{value:new THREE.Color()},uFogColor:{value:new THREE.Color()},
      uDaylight:{value:1},uNight:{value:0},uCloud:{value:.1},uRain:{value:0},uRough:{value:.55},
      uSkyTime:{value:0},uFogDensity:{value:.00002},uWind:{value:new THREE.Vector2(1,0)},
    };
    this.clouds=new Clouds(this.uniforms);
    this.uniforms.uCloudMap={value:this.clouds.target.texture};
    this.sun=new THREE.DirectionalLight(0xffefdb,3.2); this.moon=new THREE.DirectionalLight(0x809dc9,.14);
    this.ambient=new THREE.HemisphereLight(0xb7d5e8,0x243b44,1.2);
    for(const light of [this.sun,this.moon,this.ambient]){light.layers.enable(2);light.layers.enable(3);}
    scene.add(this.sun,this.sun.target,this.moon,this.moon.target,this.ambient);
    // Self-shadowing of the closest large ship only. Ocean lighting is analytic, no reflection RTTs.
    this.sun.castShadow=true; this.sun.shadow.mapSize.set(2048,2048);
    this.sun.shadow.camera.left=-145; this.sun.shadow.camera.right=145;
    this.sun.shadow.camera.top=145; this.sun.shadow.camera.bottom=-145;
    this.sun.shadow.camera.near=1; this.sun.shadow.camera.far=1600;
    this.sun.shadow.bias=-.00008; this.sun.shadow.normalBias=.12;
    scene.fog = new THREE.FogExp2(0xb1c4ce,.000021);
    this.fog=scene.fog;
    this.shadowFocus=new THREE.Vector3();
    this.nightColor=new THREE.Color(.008,.017,.036);
    this.dayZenith=new THREE.Color(.085,.245,.43);
    this.dayHorizon=new THREE.Color(.46,.61,.72);
    this.warmHorizon=new THREE.Color(.63,.37,.23);
    this.overcastZenith=new THREE.Color(.30,.36,.42);
    this.overcastHorizon=new THREE.Color(.47,.53,.57);
    this.sky=new THREE.Mesh(new THREE.SphereGeometry(12000,48,24), new THREE.ShaderMaterial({
      uniforms:this.uniforms,side:THREE.BackSide,depthWrite:false,fog:false,
      vertexShader:`varying vec3 vRay; void main(){vRay=position; vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position=p.xyww;}`,
      fragmentShader:/* glsl */`${skyGLSL}
        varying vec3 vRay;
        void main(){
          vec3 rd=normalize(vRay);
          vec3 color=skyRadiance(rd,true);
          if(rd.y<0.0) color=mix(uHorizon,uZenith*.45+uHorizon*.25,smoothstep(0.0,.65,-rd.y));
          if(uNight>.01 && rd.y>.05) {
            vec2 uv=vec2(atan(rd.z,rd.x)*159.15, asin(rd.y)*318.3);
            vec2 cell=floor(uv), f=fract(uv)-.5;
            float seed=hash21(cell);
            float radius=mix(.025,.12,hash21(cell+31.));
            float star=(1.0-smoothstep(radius*.2,radius,length(f)))*step(.993,seed);
            star*=1.0-cloudOpacity(rd);
            color+=vec3(.48,.58,.78)*star*uNight*(.85+.15*sin(uSkyTime*.6+seed*99.));
          }
          gl_FragColor=vec4(color,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    this.sky.frustumCulled=false; this.sky.renderOrder=-10; scene.add(this.sky);
    this.iblScene=new THREE.Scene();this.iblSky=this.sky.clone();this.iblSky.position.set(0,0,0);this.iblScene.add(this.iblSky);
    this.iblCube=new THREE.WebGLCubeRenderTarget(64,{type:THREE.HalfFloatType});
    this.iblCamera=new THREE.CubeCamera(1,14000,this.iblCube);
  }
  updateIBL(renderer,time) {
    if(time>=this.lastIBL&&time-this.lastIBL<20)return;
    this.lastIBL=time;
    if(!this.pmrem)this.pmrem=new THREE.PMREMGenerator(renderer);
    const target=renderer.getRenderTarget(),tone=renderer.toneMapping;
    renderer.toneMapping=THREE.NoToneMapping;this.iblCamera.update(renderer,this.iblScene);
    this.iblTarget=this.pmrem.fromCubemap(this.iblCube.texture,this.iblTarget??null);
    this.scene.environment=this.iblTarget.texture;this.scene.environmentIntensity=.75;
    renderer.setRenderTarget(target);renderer.toneMapping=tone;
  }
  update(dt,time,weather,camera,renderer,frozenHour) {
    this.hour=frozenHour??((CONFIG.startHour+time/CONFIG.daySeconds*24)%24);
    const solar=(this.hour-6)/24*Math.PI*2;
    const u=this.uniforms, dir=u.uSunDir.value;
    dir.set(-Math.cos(solar), Math.sin(solar), -.36).normalize();
    const elevation=dir.y, day=smoothstep(-.12,.13,elevation), night=1-smoothstep(-.14,.03,elevation);
    const sunset=(1-smoothstep(.05,.42,Math.abs(elevation)))*day;
    u.uDaylight.value=day; u.uNight.value=night; u.uCloud.value=weather.cloud; u.uRain.value=weather.rain;
    u.uRough.value=weather.wind; u.uSkyTime.value=time;
    u.uWind.value.set(Math.cos(weather.angle),Math.sin(weather.angle)).multiplyScalar(.4+weather.wind);
    u.uSunColor.value.setRGB(1.0, .90-.42*sunset, .75-.47*sunset).multiplyScalar(day*(1-weather.cloud*.64));
    u.uZenith.value.copy(this.nightColor).lerp(this.dayZenith,day).lerp(this.overcastZenith,weather.cloud*day*.73);
    u.uHorizon.value.copy(this.nightColor).multiplyScalar(2.8).lerp(this.dayHorizon,day).lerp(this.warmHorizon,sunset*(1-weather.cloud)*.63).lerp(this.overcastHorizon,weather.cloud*day*.67);
    u.uFogColor.value.copy(u.uHorizon.value).lerp(u.uZenith.value,.12);
    u.uFogDensity.value=weather.fog*(.8+.2*day);
    this.fog.color.copy(u.uFogColor.value); this.fog.density=u.uFogDensity.value;
    this.sun.color.copy(u.uSunColor.value); this.sun.intensity=3.1*day*(1-weather.cloud*.77);
    this.sun.position.copy(this.shadowFocus).addScaledVector(dir,900); this.sun.target.position.copy(this.shadowFocus);
    this.sun.castShadow=day>.05;
    u.uMoonDir.value.copy(dir).negate();
    this.moon.position.copy(u.uMoonDir.value).multiplyScalar(1000); this.moon.intensity=.20*night*(1-weather.cloud*.72);
    this.ambient.color.copy(u.uHorizon.value); this.ambient.groundColor.setRGB(.065,.10,.12);
    this.ambient.intensity=.36+.94*day*(1-weather.cloud*.25);
    renderer.toneMappingExposure=.87+.20*night;
    this.sky.position.copy(camera.position);
  }
}
