const NS = 'http://www.w3.org/2000/svg';
const node = (name,attrs={},text='') => {const e=document.createElementNS(NS,name);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);e.textContent=text;return e;};
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
let paused=reduced.matches, visible=false, progress=0, previous=0;
const cards=[...document.querySelectorAll('[data-trajectory]')].map((card,index)=>{
  const type=card.dataset.trajectory,root=card.querySelector('svg'),fixed=type==='reversed'||type==='full';
  root.innerHTML=`<defs><pattern id="dots-${index}" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#d8e0e5"/></pattern><marker id="arrow-${index}" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M1 1 L5 4 L1 7" fill="none" stroke="#486e9d" stroke-width="1.7"/></marker></defs><rect width="480" height="290" fill="url(#dots-${index})"/>`;
  const object=fixed?[240,54]:type==='straight'?[220,145]:[145,86];
  const anchor=node('g',{transform:`translate(${object[0]} ${object[1]})`});
  anchor.append(node('circle',{r:36,fill:'#e9efed'}),node('path',{d:'M-17 -5 L0 -15 L17 -5 L0 5 Z',fill:'#b4c7d9',stroke:'#6685a3','stroke-width':1.5}),node('path',{d:'M-17 -5 L0 5 L0 25 L-17 15 Z',fill:'#8caac4',stroke:'#6685a3','stroke-width':1.5}),node('path',{d:'M0 5 L17 -5 L17 15 L0 25 Z',fill:'#dce6ee',stroke:'#6685a3','stroke-width':1.5}));root.append(anchor);
  if(fixed){
    root.append(node('circle',{cx:240,cy:180,r:64,fill:'none',stroke:'#dfe6eb','stroke-width':2}));
    const d=type==='full'?'M240 116 A64 64 0 1 1 240 244 A64 64 0 1 1 240 116':'M240 116 A64 64 0 0 1 240 244';
    root.append(node('path',{d,fill:'none',stroke:'#486e9d','stroke-width':3,'marker-end':`url(#arrow-${index})`}));
    if(type==='reversed')root.append(node('path',{d:'M232 244 A64 64 0 0 0 232 116',fill:'none',stroke:'#b64d39','stroke-width':2.5,'stroke-dasharray':'5 5'}));
    root.append(node('text',{x:240,y:277,'text-anchor':'middle',fill:'#606975','font-size':15},'Fixed camera position'));
  }else{
    root.append(node('path',{d:'M90 200 L390 200',fill:'none',stroke:'#486e9d','stroke-width':3,'marker-end':`url(#arrow-${index})`}));
    root.append(node('circle',{cx:90,cy:200,r:5,fill:'#486e9d'}),node('circle',{cx:390,cy:200,r:5,fill:'#b64d39'}));
    root.append(node('text',{x:90,y:254,'text-anchor':'middle',fill:'#606975','font-size':15},'Start'),node('text',{x:390,y:254,'text-anchor':'middle',fill:'#606975','font-size':15},'Revisit'));
  }
  const camera=node('g',{'class':'diagram-camera'});
  camera.append(node('path',{d:'M10 0 L104 -60 Q126 0 104 60 Z',fill:'#486e9d13',stroke:'#486e9d66','stroke-width':1.5,'class':'diagram-fov'}),node('rect',{x:-13,y:-10,width:26,height:20,rx:5,fill:'#263548',stroke:'#fff','stroke-width':2.5}),node('path',{d:'M13 -5 L23 -11 L23 11 L13 5 Z',fill:'#263548',stroke:'#fff','stroke-width':2}),node('circle',{cx:0,cy:0,r:3,fill:'#fff'}));root.append(camera);
  const arrow=node('path',{d:'M-6 -7 L3 0 L-6 7',fill:'none',stroke:'#486e9d','stroke-width':3,'stroke-linecap':'round','stroke-linejoin':'round'});root.append(arrow);
  return {card,type,camera,arrow,phase:card.querySelector('.trajectory-phase'),bar:card.querySelector('.trajectory-progress span')};
});
const mix=(a,b,t)=>a+(b-a)*Math.max(0,Math.min(1,t));
function draw(t){
  const p=Math.min(t/.88,1);
  for(const d of cards){
    let x=240,y=180,angle=-90,query=false;
    if(d.type==='reversed'){angle=-90+(p<.5?mix(0,180,(p-.1)/.4):mix(180,0,(p-.5)/.4));query=p>.5;}
    else if(d.type==='full'){angle=-90+mix(0,360,(p-.1)/.8);query=p>.82;}
    else if(d.type==='straight'){x=mix(90,390,(p-.1)/.55);y=200;angle=mix(0,180,(p-.65)/.25);query=p>.65;}
    else{x=mix(90,390,(p-.28)/.4);y=200;angle=p<.28?mix(-90,0,(p-.1)/.18):mix(0,-180,(p-.68)/.22);query=p>.68;}
    d.camera.setAttribute('transform',`translate(${x} ${y}) rotate(${angle})`);
    const fixed=d.type==='reversed'||d.type==='full',r=angle*Math.PI/180;
    const ax=fixed?240+64*Math.cos(r):query?x+30*Math.cos(r):Math.min(390,x+48);
    const ay=fixed?180+64*Math.sin(r):query?y+30*Math.sin(r):y;
    d.arrow.setAttribute('transform',`translate(${ax} ${ay}) rotate(${fixed?angle+(d.type==='reversed'&&query?-90:90):angle})`);
    d.arrow.setAttribute('stroke',query?'#b64d39':'#486e9d');
    d.card.classList.toggle('is-revisiting',query);
    d.phase.textContent=p<.1?'Observe':query?'Revisit':'Explore';
    d.bar.style.width=`${p*100}%`;
  }
}
const motion=document.getElementById('protocol-motion');
function controls(){motion.textContent=paused?'Play animation':'Pause animation';motion.setAttribute('aria-pressed',String(paused));}
motion.addEventListener('click',()=>{paused=!paused;controls();});
document.getElementById('protocol-replay').addEventListener('click',()=>{progress=0;draw(0);if(!reduced.matches)paused=false;controls();});
reduced.addEventListener('change',()=>{paused=reduced.matches;controls();});
new IntersectionObserver(([e])=>{visible=e.isIntersecting;},{rootMargin:'80px'}).observe(document.querySelector('.protocol-groups'));
function frame(now){const dt=previous?Math.min(now-previous,100):0;previous=now;if(!paused&&visible&&!document.hidden){progress=(progress+dt/11000)%1;draw(progress);}requestAnimationFrame(frame);}
draw(0);controls();requestAnimationFrame(frame);
