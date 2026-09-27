import * as THREE from 'three';

// Each ring is a circle whose centre travels from focus to the fixed global centre.
// Consecutive rings are nested when |focus|<radius: the mesh cannot fold or open a seam.
export function focusedWaterPoint(x,z,focusX,focusZ,radius,padding=8,out={}) {
  const t=1-Math.hypot(x,z)/(radius+padding);
  out.x=x+focusX*t;out.z=z+focusZ*t;return out;
}

export function circularMesh(radius,rings,sectors,padding=8) {
  // Shared concentric rings. The final few water rings double their angular resolution,
  // closing the displaced silhouette against the volume without expensive detail everywhere.
  const layers=[];let vertexCount=1;
  for(let j=1;j<=rings;j++) {
    const r=Math.pow(j/rings,1.48)*(radius+padding);
    const inner=sectors>=64&&sectors%8===0?(r<18?1/8:r<65?1/4:r<230?1/2:1):1;
    const multiplier=padding>0?(j===rings?8:j>=rings-2?4:j>=rings-4?2:inner):1;
    const count=sectors*multiplier;layers.push({start:vertexCount,count});vertexCount+=count;
  }
  const vertices=new Float32Array(vertexCount*3),indices=[];
  for(let j=1;j<=rings;j++) {
    const {start,count}=layers[j-1],r=Math.pow(j/rings,1.48)*(radius+padding);
    for(let i=0;i<count;i++){const a=i/count*Math.PI*2;vertices[(start+i)*3]=Math.cos(a)*r;vertices[(start+i)*3+2]=Math.sin(a)*r;}
    if(j===1){for(let i=0;i<count;i++)indices.push(0,start+(i+1)%count,start+i);continue;}
    const inner=layers[j-2];
    for(let i=0;i<inner.count;i++) {
      const a=inner.start+i,b=inner.start+(i+1)%inner.count;
      const factor=count/inner.count;
      let previous=start+i*factor;
      for(let k=1;k<factor;k++){const next=start+i*factor+k;indices.push(a,next,previous);previous=next;}
      const end=start+((i+1)*factor)%count;
      indices.push(a,b,previous,b,end,previous);
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeBoundingSphere();return geometry;
}
