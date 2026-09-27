const clamp=x=>Math.max(-1,Math.min(1,x));
const forward=new Set(['KeyW','ArrowUp']),reverse=new Set(['KeyS','ArrowDown']);
const left=new Set(['KeyA','ArrowLeft']),right=new Set(['KeyD','ArrowRight']);
const editable=target=>target?.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName||'');

export class PilotInput {
  constructor() {this.keys=new Set();this.throttle=0;this.rudderImpulse=0;this.impulseTime=0;this.pointerThrottle=0;this.pointerRudder=0;}
  press(code) {
    this.keys.add(code);
    // A boat throttle lever stays where it is set. Holding W/S uses keyboard repeat;
    // individual taps are useful for precise manoeuvring and don't need a HUD.
    if(forward.has(code))this.throttle=clamp(this.throttle+.16);
    if(reverse.has(code))this.throttle=clamp(this.throttle-.16);
    if(left.has(code)){this.rudderImpulse=-1;this.impulseTime=.20;}
    if(right.has(code)){this.rudderImpulse=1;this.impulseTime=.20;}
    if(code==='KeyN'||code==='Space')this.throttle=0;
  }
  release(code){this.keys.delete(code);}
  clear(){this.keys.clear();this.throttle=0;this.pointerThrottle=0;this.pointerRudder=0;this.impulseTime=0;}
  update(dt) {this.impulseTime=Math.max(0,this.impulseTime-dt);}
  get steer() {
    let value=0;for(const code of left)if(this.keys.has(code))value--;
    for(const code of right)if(this.keys.has(code))value++;
    return clamp((value||this.impulseTime>0&&this.rudderImpulse||0)+this.pointerRudder);
  }
  get demand(){return this.pointerThrottle||this.throttle;}
  get brake(){return this.keys.has('Space');}
}

export class PilotControls {
  constructor(canvas,boat) {
    this.canvas=canvas;this.boat=boat;this.input=new PilotInput();this.pointer=null;this.lastTap=0;
    this.keydown=e=>{
      if(editable(e.target)||e.ctrlKey||e.metaKey||e.altKey)return;
      if(e.code==='KeyP'&&!e.repeat){e.preventDefault();boat.toggle();return;}
      if(!boat.active)return;
      if(e.code==='Escape'){e.preventDefault();boat.leave();return;}
      if(e.code==='KeyC'&&!e.repeat){e.preventDefault();boat.toggleCamera();return;}
      if(e.code==='KeyR'&&!e.repeat){e.preventDefault();boat.reset();return;}
      if(forward.has(e.code)||reverse.has(e.code)||left.has(e.code)||right.has(e.code)||['Space','KeyN'].includes(e.code)) {
        e.preventDefault();this.input.press(e.code);boat.publishState();
      }
    };
    this.keyup=e=>this.input.release(e.code);
    this.blur=()=>{this.input.clear();this.pointer=null;};
    this.down=e=>{
      if(!boat.active){this.tapStart={x:e.clientX,y:e.clientY,time:performance.now()};return;}
      if(this.pointer!==null)return;
      e.preventDefault();e.stopImmediatePropagation();this.pointer=e.pointerId;
      this.start={x:e.clientX,y:e.clientY,time:performance.now()};canvas.setPointerCapture(e.pointerId);
    };
    this.move=e=>{
      if(e.pointerId!==this.pointer)return;
      e.preventDefault();
      this.input.pointerRudder=clamp((e.clientX-this.start.x)/Math.min(150,canvas.clientWidth*.28));
      this.input.pointerThrottle=clamp((this.start.y-e.clientY)/Math.min(150,canvas.clientHeight*.22));
    };
    this.up=e=>{
      const start=this.pointer===e.pointerId?this.start:this.tapStart;
      if(this.pointer===e.pointerId){this.pointer=null;this.input.pointerRudder=0;this.input.pointerThrottle=0;this.input.throttle=0;}
      if(e.pointerType==='touch'&&start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)<14&&performance.now()-start.time<280) {
        if(performance.now()-this.lastTap<320){boat.toggle();this.lastTap=0;}else this.lastTap=performance.now();
      }
      this.tapStart=null;
    };
    addEventListener('keydown',this.keydown);addEventListener('keyup',this.keyup);addEventListener('blur',this.blur);
    addEventListener('visibilitychange',()=>{if(document.hidden)this.blur();});
    canvas.addEventListener('dblclick',()=>boat.toggle());
    canvas.addEventListener('pointerdown',this.down,{capture:true});canvas.addEventListener('pointermove',this.move);
    canvas.addEventListener('pointerup',this.up);canvas.addEventListener('pointercancel',this.blur);
  }
}
