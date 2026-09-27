import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assetUrl } from '../asset-url.js';

export class VesselAssets {
  constructor(boundary,optics) { this.boundary=boundary;this.optics=optics; this.models=new Map(); this.windows=[]; this.loader=new GLTFLoader(); }
  async load(names=['cargo']) {
    this.manifest=await (await fetch(assetUrl('models/manifest.json'))).json();
    await Promise.all(names.map(async name=>{
      const [high,low]=await Promise.all([this.loader.loadAsync(assetUrl(`models/${name}.glb`)),this.loader.loadAsync(assetUrl(`models/${name}-low.glb`))]);
      const prepare=root=>{
        root.traverse(mesh=>{
          if(!mesh.isMesh)return;
          mesh.material.transparent=false; mesh.material.opacity=1; mesh.material.depthWrite=true; mesh.material.side=THREE.FrontSide;
          mesh.material.envMapIntensity=.65;
          this.boundary.apply(mesh.material); this.boundary.attachDepth(mesh);
          this.optics?.prepare(mesh,!['window','light','rubber','skin','canvas'].includes(mesh.material.name));
          mesh.castShadow=false; mesh.receiveShadow=true; mesh.renderOrder=5;
          if(mesh.material.name==='window'&&name!=='rib') this.windows.push(mesh.material);
          if(mesh.material.name==='light') mesh.material.emissiveIntensity=.1;
        });
        return root;
      };
      this.models.set(name,{high:prepare(high.scene),low:prepare(low.scene),spec:this.manifest[name]});
    }));
  }
  instantiate(name) {
    const model=this.models.get(name), root=new THREE.Group();
    const high=model.high.clone(true), low=model.low.clone(true);
    root.add(high,low); high.visible=false;
    const stencil=new THREE.Group(); root.add(stencil); stencil.visible=false;
    // Reuses the selected LOD's closed source geometry and shared winding materials.
    const stencilLevels=[high,low].map(level=>{
      const group=new THREE.Group(); stencil.add(group);
      level.updateMatrixWorld(true);
      level.traverse(mesh=>{
        if(!mesh.isMesh)return;
        for(const [material,order] of [[this.boundary.stencilBack,1],[this.boundary.stencilFront,2]]) {
          const proxy=new THREE.Mesh(mesh.geometry,material); proxy.matrixAutoUpdate=false;
          proxy.matrix.copy(mesh.matrixWorld); proxy.renderOrder=order;this.optics?.prepare(proxy,false);group.add(proxy);
        }
      });
      return group;
    });
    stencilLevels[0].visible=false;
    const shadowMeshes=[]; high.traverse(m=>{if(m.isMesh)shadowMeshes.push(m);});low.traverse(m=>{if(m.isMesh)shadowMeshes.push(m);});
    const vessel={name,root,high,low,stencil,stencilLevels,shadowMeshes,spec:model.spec,detail:false};
    return vessel;
  }
  updateLights(night) {
    for(const mat of this.windows) {mat.emissive.setRGB(.75,.51,.24);mat.emissiveIntensity=.65*night;}
  }
  updateLOD(vessel,camera,forceHigh=false) {
    const distance=camera.position.distanceTo(vessel.root.position);
    const threshold=vessel.spec.length>100?1550:500;
    if(forceHigh)vessel.detail=true;
    else if(vessel.detail && distance>threshold*1.12) vessel.detail=false;
    else if(!vessel.detail && distance<threshold*.9) vessel.detail=true;
    vessel.high.visible=vessel.detail; vessel.low.visible=!vessel.detail;
    vessel.stencilLevels[0].visible=vessel.detail; vessel.stencilLevels[1].visible=!vessel.detail;
    const radius=this.boundary.radius, distanceToCenter=Math.hypot(vessel.root.position.x-this.boundary.uniforms.uCircleCenter.value.x,vessel.root.position.z-this.boundary.uniforms.uCircleCenter.value.y);
    vessel.crossing=Math.abs(distanceToCenter-radius)<vessel.spec.length*.58+10;
    vessel.stencil.visible=vessel.crossing;
  }
}
