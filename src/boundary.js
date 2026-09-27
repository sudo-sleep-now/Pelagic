import * as THREE from 'three';

export const boundaryGLSL = /* glsl */`
uniform vec2 uCircleCenter;
uniform float uCircleRadius;
void clipCircle(vec3 world) {
  vec2 delta = world.xz - uCircleCenter;
  if (dot(delta, delta) > uCircleRadius * uCircleRadius) discard;
}
`;

// Shader injection always evaluates the final transformed vertex, after morph/skin/instance transforms.
export class Boundary {
  constructor(radius, center) {
    this.radius = radius;
    this.applied=new WeakSet();
    this.uniforms = { uCircleCenter: { value: new THREE.Vector2(...center) }, uCircleRadius: { value: radius } };
    this.depth = this.apply(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
    this.distance = this.apply(new THREE.MeshDistanceMaterial());
    this.stencilBack = this.stencilMaterial(THREE.BackSide, THREE.IncrementWrapStencilOp);
    this.stencilFront = this.stencilMaterial(THREE.FrontSide, THREE.DecrementWrapStencilOp);
  }
  apply(material) {
    if(this.applied.has(material))return material;
    this.applied.add(material);
    const before = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      before.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = 'varying vec3 vCircleWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
        vec4 circlePosition = vec4(transformed, 1.0);
        #ifdef USE_BATCHING
          circlePosition = batchingMatrix * circlePosition;
        #endif
        #ifdef USE_INSTANCING
          circlePosition = instanceMatrix * circlePosition;
        #endif
        vCircleWorld = (modelMatrix * circlePosition).xyz;
        #include <project_vertex>
      `);
      shader.fragmentShader = 'varying vec3 vCircleWorld;\n' + boundaryGLSL + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'void main() {\nclipCircle(vCircleWorld);');
    };
    material.customProgramCacheKey = () => 'circle-v3';
    return material;
  }
  stencilMaterial(side, op) {
    return this.apply(new THREE.MeshBasicMaterial({
      side, colorWrite: false, depthWrite: false, depthTest: false,
      stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc,
      stencilFail: op, stencilZFail: op, stencilZPass: op,
    }));
  }
  attachDepth(mesh) { mesh.customDepthMaterial = this.depth; mesh.customDistanceMaterial = this.distance; }
  // Winding-count cap: only crossing vessels contribute to stencil, then a cylindrical surface
  // at the *exact* world boundary paints a solid, opaque cross section where winding != 0.
  createCap(scene) {
    // Dense angular sampling keeps chord error < 1 mm at R=2000.
    // This inscribed surface never paints beyond the same cylindrical fragment cutoff.
    const geometry = new THREE.CylinderGeometry(this.radius, this.radius, 160, 4096, 1, true);
    const material = new THREE.MeshStandardMaterial({
      color: 0x46505a, roughness: 0.88, metalness: 0.08,
      side: THREE.FrontSide, stencilWrite: true, stencilRef: 0,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp,
    });
    const cap = new THREE.Mesh(geometry, material);
    cap.position.set(this.uniforms.uCircleCenter.value.x, 50, this.uniforms.uCircleCenter.value.y);
    cap.renderOrder = 3;
    cap.frustumCulled = false;
    cap.onAfterRender = (renderer) => renderer.clearStencil();
    scene.add(cap);
    this.cap = cap;
  }
}
