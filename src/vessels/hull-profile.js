// Monotone cubic Hermite interpolation, also used by the Blender hull generator.
export function hullBreadth(t,stations) {
  t=Math.max(0,Math.min(1,t));
  const n=stations.length,slope=i=>(stations[i+1][1]-stations[i][1])/(stations[i+1][0]-stations[i][0]);
  const tangent=i=>{
    if(i===0)return slope(0);if(i===n-1)return slope(n-2);
    const a=slope(i-1),b=slope(i);if(a*b<=0)return 0;
    const h0=stations[i][0]-stations[i-1][0],h1=stations[i+1][0]-stations[i][0];
    return 3*(h0+h1)/((2*h1+h0)/a+(h1+2*h0)/b);
  };
  for(let i=0;i<n-1;i++)if(t<=stations[i+1][0]){
    const [a,wa]=stations[i],[b,wb]=stations[i+1],h=b-a,u=(t-a)/h;
    return (2*u**3-3*u*u+1)*wa+(u**3-2*u*u+u)*h*tangent(i)+(-2*u**3+3*u*u)*wb+(u**3-u*u)*h*tangent(i+1);
  }
  return stations[n-1][1];
}
export const DEFAULT_WATERPLANE=[[0,.74],[.07,.94],[.22,1],[.64,1],[.79,.91],[.90,.66],[.97,.27],[1,.012]];
