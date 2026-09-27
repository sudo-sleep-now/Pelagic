import * as THREE from 'three';
import { waveGLSL } from './waves.js';
import { skyGLSL } from '../environment/sky-shader.js';
import { boundaryGLSL } from '../boundary.js';
import { circularMesh } from './geometry.js';
import { bathymetryGLSL, underwaterGLSL } from './bathymetry.js';
import { Caustics } from './caustics.js';
import { Seabed } from './seabed.js';
import { ObjectOptics,objectOpticsGLSL } from './object-optics.js';


export class Ocean {
  constructor(scene, waves, environment, boundary, config,camera) {
    this.environment=environment;this.camera=camera;this.waves=waves;this.visible=true;this.volumeDebug=false;
    this.optics=new ObjectOptics(scene,waves,camera,boundary);
    this.caustics = new Caustics(waves, environment);
    this.focus=new THREE.Vector2();this.radius=config.radius;this.center=config.center;
    this.uniforms = { ...waves.uniforms, ...environment.uniforms, ...boundary.uniforms,
      uQuality: { value: 1 }, uPixelScale:{value:1/900}, uDiagnostic:{value:0}, uCaustics: { value: this.caustics.target.texture },
      uWaterFocus:{value:this.focus},uMeshRadius:{value:config.radius+8},
      ...this.optics.uniforms,
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side:THREE.DoubleSide,
      vertexShader: /* glsl */`
        ${waveGLSL}
        uniform vec2 uCircleCenter;
        uniform vec2 uWaterFocus;uniform float uMeshRadius;
        varying vec3 vWorld; varying vec3 vNormal; varying float vCompression; varying vec2 vParam;
        void main() {
          vParam = position.xz+uWaterFocus*(1.0-length(position.xz)/uMeshRadius)+uCircleCenter;
          vec3 point = wavePosition(vParam, vNormal, vCompression);point.xz-=uCircleCenter;
          vWorld = (modelMatrix*vec4(point,1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vWorld,1.0);
        }
      `,
      fragmentShader: /* glsl */`
        ${skyGLSL}
        ${waveGLSL}
        ${boundaryGLSL}
        ${underwaterGLSL}
          ${objectOpticsGLSL}
        uniform float uQuality,uDiagnostic,uPixelScale;
        varying vec3 vWorld; varying vec3 vNormal; varying float vCompression; varying vec2 vParam;
        vec2 rippleBand(vec2 p,vec2 direction,float k,float amplitude,float phase,float footprint) {
          float attenuation=exp(-.5*k*k*footprint*footprint);
          vec2 sideways=vec2(-direction.y,direction.x);float omega=sqrt(9.81*k);
          float across=k*.13*dot(sideways,p)-omega*.06*uTime+phase;
          float group=k*.07*dot(direction,p)-omega*.035*uTime+phase*1.4;
          float theta=k*dot(direction,p)-omega*uTime+phase+.5*sin(across);
          vec2 phaseSlope=k*direction+.065*k*cos(across)*sideways;
          float envelope=.75+.25*sin(group);
          vec2 groupSlope=.0175*k*cos(group)*direction;
          return amplitude*(envelope*cos(theta)*phaseSlope+sin(theta)*groupSlope)*attenuation;
        }
        vec2 rippleGradient(vec2 p,float footprint) {
          // Millimetre-scale travelling ripples with analytic, filtered slopes.
          // No value-noise bumps, tiled drop cells, or finite-difference dents.
          vec2 g=rippleBand(p,vec2(.905,.425),2.856,.0034,.7,footprint)
                +rippleBand(p,vec2(.471,-.882),4.654,.0019,2.1,footprint)
                +rippleBand(p,vec2(.955,-.296),7.570,.0009,4.0,footprint)
                +rippleBand(p,vec2(-.629,.778),12.083,.00045,1.3,footprint);
          g*=.8+.25*uRough;
          g+=uRain*rippleBand(p,vec2(-.60,.80),28.0,.0003,2.6,footprint);
          return g;
        }
        void main() {
          clipCircle(vWorld);
          vec3 view = normalize(cameraPosition-vWorld);
          float distanceToEye = length(cameraPosition-vWorld);
          float fineFade = 1.0-smoothstep(450.0,2500.0,distanceToEye);
          vec2 p = vWorld.xz;
          // A continuous projected pixel size. Derivatives of the interpolated
          // displaced mesh change at triangle edges and can print the topology on water.
          float footprint=distanceToEye*uPixelScale/max(.13,abs(view.y));
          vec2 grad=rippleGradient(p,footprint);
          vec2 parameter=vParam;
          if(footprint<18.0)parameter+= (correctWaveParameter(vParam,p)-vParam)*(1.0-smoothstep(8.0,18.0,footprint));
          float exactCompression,wakeFoam; vec3 exactNormal=filteredWaveNormal(parameter,p,footprint,exactCompression,wakeFoam);
          vec3 n = normalize(exactNormal+vec3(-grad.x,0.0,-grad.y)*fineFade*uQuality);
          if(uDiagnostic==1.0){gl_FragColor=vec4(n*.5+.5,1.0);return;}
          if(uDiagnostic==2.0)n=exactNormal;
          if(cameraPosition.y<vWorld.y) {
            vec3 incident=normalize(vWorld-cameraPosition);
            float cosine=max(dot(n,incident),.02);
            float insideFresnel=.0204+.9796*pow(1.0-cosine,5.0);
            vec3 airRay=refract(incident,-n,1.333);
            vec3 throughSurface=skyRadiance(normalize(airRay),false);
            vec3 beneathSurface=underwaterRay(vWorld,reflect(incident,n));
            vec3 underside=mix(throughSurface,beneathSurface,insideFresnel);
            float undersideHaze=1.0-exp(-distanceToEye*uFogDensity);
            underside=mix(underside,uFogColor,min(undersideHaze,.65));
            gl_FragColor=vec4(underside,1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            return;
          }
          float nv = max(dot(n,view),0.02);
          float fresnel = .0204 + .9796*pow(1.0-nv,5.0);
          vec3 reflected = reflect(-view,n); reflected.y=abs(reflected.y);
          vec3 reflection = skyRadiance(reflected,false);
          reflection=reflectedObjects(vWorld,n,reflection);
          vec3 transmitted = refract(-view,n,1.0/WATER_IOR);
          vec3 body = underwaterRay(vWorld,transmitted);
          if(uDiagnostic==3.0)body=vec3(.014,.125,.165);
          body=submergedObjects(vWorld,n,body,vec3(.014,.125,.165)*mix(.035,1.0,uDaylight)*(1.0-.35*uCloud));
          vec3 color = mix(body,reflection,fresnel);
          // Restrained rough-surface sun glitter; no mirror plane or bloom.
          vec3 halfVector = normalize(view+uSunDir);
          float nh = max(dot(n,halfVector),0.0), nl = max(dot(n,uSunDir),0.0);
          float rough = .18+.025*uRough+.035*(1.0-fineFade);
          float alpha2=rough*rough;
          float denom=nh*nh*(alpha2-1.0)+1.0;
          float distribution=alpha2/(3.14159*denom*denom);
          float vh=max(dot(view,halfVector),0.0);
          float sf=.0204+.9796*pow(1.0-vh,5.0);
          float visibility=1.0/(4.0*max(nv,.16)*max(nl,.16));
          color += uSunColor * min(2.1,distribution*sf*visibility*nl)*(.65-.46*uCloud);
          float moonSpec=pow(max(dot(n,normalize(view+uMoonDir)),0.0),190.0);
          color+=vec3(.11,.16,.24)*moonSpec*uNight;
          float foamNoise=fbm(p*.13-uWind*uTime*.055);
          float foamBreakup=fbm(p*.47+uWind.yx*uTime*.10);
          float foamCoverage=mix(foamNoise,foamBreakup,.38);
          float crest=smoothstep(.15,.27,exactCompression)*smoothstep(.52,.67,foamCoverage);
          float whitecap=max(crest*smoothstep(.85,1.8,uRough)*.48,wakeFoam*.45);
          color=mix(color,vec3(.68,.76,.76)*mix(.14,1.0,uDaylight),whitecap);
          float haze=1.0-exp(-distanceToEye*uFogDensity);
          color=mix(color,uFogColor,min(haze,.83));
          gl_FragColor=vec4(color,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.geometry = circularMesh(config.radius, config.water.rings, config.water.sectors);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.position.set(...[config.center[0],0,config.center[1]]);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
    this.seabed = new Seabed(scene, this.uniforms, config);
    this.createVolume(scene, config);
  }
  createVolume(scene, config) {
    // The finite boundary is an exposed section of the water column, with a wave-following
    // waterline and a bottom that meets the actual seabed. No rectangular glass tank.
    const sectors=4096,vertices=new Float32Array((sectors+1)*6),indices=[];
    for(let i=0;i<=sectors;i++) {
      const angle=i/sectors*Math.PI*2,x=Math.cos(angle)*config.radius,z=Math.sin(angle)*config.radius;
      vertices.set([x,0,z,x,1,z],i*6);
      if(i<sectors){const j=i*2;indices.push(j,j+1,j+2,j+1,j+3,j+2);}
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(vertices,3));geometry.setIndex(indices);
    const material=new THREE.ShaderMaterial({uniforms:this.uniforms,
      vertexShader:`${waveGLSL}
uniform vec2 uCircleCenter;uniform float uCircleRadius;${bathymetryGLSL}
        varying vec3 vWorld;
        void main(){vec2 p=position.xz+uCircleCenter;
          float y=position.y>.5?waterHeight(p)+.12:-seabedDepth(p);
          vWorld=vec3(p.x,y,p.y);gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);}`,
      fragmentShader:`${skyGLSL}
${boundaryGLSL}
${underwaterGLSL}
        varying vec3 vWorld;
        void main(){vec3 normal=normalize(vec3(vWorld.x-uCircleCenter.x,0.0,vWorld.z-uCircleCenter.y));
          vec3 view=normalize(cameraPosition-vWorld);
          vec3 ray=refract(-view,normal,1.0/WATER_IOR);
          vec3 color=underwaterRay(vWorld-normal*.05,ray);
          float F=.0204+.9796*pow(1.0-max(dot(normal,view),0.0),5.0);
          color=mix(color,skyRadiance(reflect(-view,normal),false),F*.24);
          color=mix(color,uFogColor,1.0-exp(-length(cameraPosition-vWorld)*uFogDensity));
          gl_FragColor=vec4(color,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`});
    this.volume=new THREE.Mesh(geometry,material);this.volume.frustumCulled=false;this.volume.renderOrder=4;scene.add(this.volume);
  }
  update(renderer,time){
    this.uniforms.uPixelScale.value=2*Math.tan(this.camera.fov*Math.PI/360)/this.optics.uniforms.uOpticsSize.value.y;
    this.waves.updateHeightBound();
    this.volume.visible=this.visible;this.seabed.edgeGroup.visible=this.visible;this.seabed.floor.visible=this.visible;
    this.environment.clouds.update(renderer,time);this.environment.updateIBL(renderer,time);this.caustics.update(renderer,time,this.camera);this.optics.update(renderer,time);
  }
  setFocus(x,z,dt) {
    let dx=x-this.center[0],dz=z-this.center[1];const d=Math.hypot(dx,dz),limit=this.radius-35;
    if(d>limit){dx*=limit/d;dz*=limit/d;}
    const a=1-Math.exp(-dt*3.5);this.focus.x+=(dx-this.focus.x)*a;this.focus.y+=(dz-this.focus.y)*a;
  }
  setVisible(visible){this.visible=visible;this.mesh.visible=visible;this.volume.visible=visible;this.seabed.group.visible=visible;}
  reduceQuality() { this.uniforms.uQuality.value = 0.7;this.environment.clouds.reduceQuality(); }
}
