const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const state = {data: null, current: null, comparisonPlaying: false, comparisonPending: false, comparisonNear: false, comparisonTime: 0, comparisonRequest: 0, lastUpdate: 0, lastSceneFrame: -1};
const scene = $('scene-video');
const videos = [$('video-a'), $('video-b'), $('video-gt')];
let statusTimer;
function notify(message) { $('status-message').textContent = message; clearTimeout(statusTimer); statusTimer = setTimeout(() => $('status-message').textContent = '', 6500); }
function clock(seconds) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
function svg(tag, attributes = {}, text = '') { const node = document.createElementNS(NS, tag); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value); if (text) node.textContent = text; return node; }
function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
const MEDIA_VERSION = '20261104-motion';
function loadVideo(video) {
  if (!video.dataset.source || video.getAttribute('src')) return;
  video.src = `${video.dataset.source}?v=${MEDIA_VERSION}`; video.preload = 'auto'; video.load();
}
function setVideo(video, src, poster, defer = false) {
  video.pause();
  if (video.seekHandler) video.removeEventListener('loadedmetadata', video.seekHandler);
  video.seekHandler = null; video.poster = poster; video.dataset.source = src;
  video.removeAttribute('src'); video.preload = 'none'; video.load();
  if (!defer) loadVideo(video);
}
function seekVideo(video, time) {
  if (video.seekHandler) video.removeEventListener('loadedmetadata', video.seekHandler);
  const seek = () => {
    video.seekHandler = null;
    if (video.readyState >= 1 && Number.isFinite(video.duration)) {
      const target = clamp(time, 0, Math.max(0, video.duration - 0.001));
      if (Math.abs(video.currentTime - target) > .025) video.currentTime = target;
    }
  };
  if (video.readyState >= 1) seek(); else { video.seekHandler = seek; video.addEventListener('loadedmetadata', seek, {once: true}); }
}
function readyVideo(video, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {clearTimeout(timer); for (const e of ['canplay','loadeddata','seeked','error']) video.removeEventListener(e, check); signal.removeEventListener('abort', aborted);};
    const aborted = () => {cleanup(); reject(new DOMException('Playback cancelled', 'AbortError'));};
    const check = () => {
      if (signal.aborted) return aborted();
      if (video.error) {cleanup(); reject(new Error(video.error.message || 'Video unavailable'));}
      else if (video.readyState >= 3 && !video.seeking) {cleanup(); resolve();}
    };
    for (const e of ['canplay','loadeddata','seeked','error']) video.addEventListener(e, check);
    signal.addEventListener('abort', aborted, {once:true});
    timer = setTimeout(() => {cleanup(); reject(new Error('Loading took too long'));}, 30000); check();
  });
}
function pauseScene() {
  state.sceneController?.abort(); state.scenePending = false; scene.pause(); $('scene-buffering').hidden = true; $('scene-start').hidden = false;
}
async function toggleScene() {
  if (!scene.paused || state.scenePending) {pauseScene(); return;}
  const controller = new AbortController(); state.sceneController = controller; state.scenePending = true;
  if (scene.error) scene.load();
  if (scene.ended) seekVideo(scene, 0);
  $('scene-start').hidden = true; $('scene-buffering').hidden = false;
  try {
    await readyVideo(scene, controller.signal);
    if (controller.signal.aborted) return;
    await scene.play(); notify('');
  } catch (error) {
    if (!controller.signal.aborted && error.name !== 'AbortError') notify('Video is still loading. Please press Play to retry.');
  } finally {
    if (state.sceneController === controller) {state.scenePending = false; $('scene-buffering').hidden = true; $('scene-start').hidden = !scene.paused;}
  }
}
function sourceFrame() { const c = state.current; return c ? clamp(Math.floor(scene.currentTime * c.fps + .001), 0, c.frames - 1) : 0; }
function renderCaseTabs() {
  const root = $('case-tabs');
  for (const [index, c] of state.data.cases.entries()) {
    const button = document.createElement('button'); button.className = 'case-tab'; button.dataset.id = c.id; button.setAttribute('aria-pressed', 'false');
    const number = document.createElement('span'); number.className = 'tab-index'; number.textContent = `0${index + 1}`;
    button.append(number, document.createTextNode(c.title)); button.addEventListener('click', () => selectCase(c.id)); root.append(button);
  }
}
function selectCase(id) {
  const c = state.data.cases.find(item => item.id === id); if (!c) return;
  pauseScene(); state.current = c; state.lastSceneFrame = -1; $('scene-play').textContent = '▶'; $('scene-play').setAttribute('aria-label', 'Play trajectory');
  for (const button of $('case-tabs').children) button.setAttribute('aria-pressed', String(button.dataset.id === id));
  $('task-label').textContent = c.task;
  $('stage-headline').textContent = c.headline;
  $('stage-description').textContent = c.description;
  for (const name of ['observe', 'explore', 'revisit']) { $(`${name}-image`).src = c.images[name]; $(`${name}-time`).textContent = clock(c.events[name] / c.fps); }
  $('scene-duration').textContent = clock(c.frames / c.fps);
  $('scene-scrub').max = String((c.frames - 1) / c.fps); $('scene-scrub').value = '0';
  const fraction = c.context_end / c.frames * 100;
  $('context-phase').style.width = `${fraction}%`; $('scene-scrub').style.setProperty('--split', `${fraction}%`);
  $('case-description').textContent = `${c.title} · ${c.source_case}`;
  $('timeline-markers').replaceChildren();
  for (const index of [...Object.values(c.events), c.context_end]) { const line = document.createElement('span'); line.className = 'timeline-marker'; line.style.left = `${index / c.frames * 100}%`; $('timeline-markers').append(line); }
  $('focus-toggle').hidden = !c.target_bounds; $('focus-toggle').setAttribute('aria-pressed', 'false'); $('landmark-overlay').style.display = 'none';
  setVideo(scene, c.video, c.images.observe); scene.playbackRate = Number($('scene-speed').value);
  $('seek-poster').hidden = true; state.seekTarget = null; buildMap(); updateScene();
  if (state.comparisonGroup && state.comparisonGroup.case_id !== id) selectComparisonCase(id);
}
function buildMap() {
  const c = state.current, a = state.data.atlas;
  const b = a.world_bounds;
  c.mapPoint = p => [(p[1] - b.y_min) / (b.y_max - b.y_min) * a.width, (b.x_max - p[0]) / (b.x_max - b.x_min) * a.height];
  const points = c.poses.map(c.mapPoint);
  c.inPlace = Math.hypot(...[0,1].map(i => Math.max(...points.map(p=>p[i]))-Math.min(...points.map(p=>p[i])))) < 1;
  // One shared crop for all four routes keeps landmarks stable when switching cases.
  const all = state.data.cases.flatMap(item => item.poses.map(c.mapPoint));
  const x0 = Math.min(...all.map(p=>p[0]))-240, y0 = Math.min(...all.map(p=>p[1]))-180;
  const x1 = Math.max(...all.map(p=>p[0]))+270, y1 = Math.max(...all.map(p=>p[1]))+180;
  c.mapScale = (x1-x0)/1000;
  for (const root of [$('route-map'), $('atlas-stage')]) {
    root.replaceChildren(); root.setAttribute('viewBox', `${x0} ${y0} ${x1-x0} ${y1-y0}`);
    root.append(svg('image', {href:a.image, width:a.width, height:a.height}));
    const geometry = svg('g', {id:root.id==='route-map'?'map-geometry':'atlas-geometry'}); root.append(geometry);
    if (c.target_bounds) {
      const lo=c.mapPoint([c.target_bounds.max[0],c.target_bounds.min[1]]), hi=c.mapPoint([c.target_bounds.min[0],c.target_bounds.max[1]]);
      geometry.append(svg('rect',{x:lo[0],y:lo[1],width:hi[0]-lo[0],height:hi[1]-lo[1],fill:'#d96b4d25',stroke:'#ffb19e','stroke-width':3}));
    }
    for (const [start,end,color] of [[0,c.context_end,'#9cbeef'],[c.context_end-1,c.frames,'#ffb19e']]) {
      geometry.append(svg('polyline',{points:points.slice(start,end).map(p=>p.join(',')).join(' '),fill:'none',stroke:'#23344a','stroke-width':9,'stroke-linejoin':'round'}));
      geometry.append(svg('polyline',{points:points.slice(start,end).map(p=>p.join(',')).join(' '),fill:'none',stroke:color,'stroke-width':4,'stroke-linejoin':'round'}));
    }
    // Clickable event bearings also distinguish pure rotation at a fixed position.
    for (const [event,index] of Object.entries(c.events)) {
      const pose=c.poses[index], point=points[index], yaw=pose[3]*Math.PI/180;
      const r=c.inPlace?({observe:35,explore:55,revisit:75}[event]):18;
      const x=point[0]+Math.sin(yaw)*r,y=point[1]-Math.cos(yaw)*r;
      const node=svg('g',{class:'atlas-event',role:'button',tabindex:0,'aria-label':`Jump to ${event}`});
      node.append(svg('line',{x1:point[0],y1:point[1],x2:x,y2:y,stroke:'#ffffffaa','stroke-width':2}),svg('circle',{cx:x,cy:y,r:10,fill:event==='revisit'?'#c04b38':'#446da2',stroke:'#fff','stroke-width':3}),svg('title',{},`Jump to ${event}`));
      node.addEventListener('click',()=>jumpEvent(event));node.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();jumpEvent(event);}});geometry.append(node);
    }
    const progress = svg('polyline',{class:'atlas-progress-line',points:''}); geometry.append(progress);
    const camera=svg('g',{id:root.id==='route-map'?'map-camera':'atlas-camera'});
    const marker=svg('g');
    marker.append(svg('circle',{r:20,class:'atlas-camera-pulse'}),svg('path',{d:'M8 0 L70 -40 Q90 0 70 40 Z',fill:'#ffd39b40',stroke:'#ffdfb5','stroke-width':2}),svg('rect',{x:-14,y:-10,width:28,height:20,rx:4,fill:'#fff0d5',stroke:'#14242d','stroke-width':2}),svg('path',{d:'M14 -5 L24 -12 L24 12 L14 5 Z',fill:'#fff0d5',stroke:'#14242d','stroke-width':2}));
    camera.append(marker); root.append(camera); camera.marker=marker; camera.progress=progress;
  }
  $('path-motion').textContent=c.inPlace?'In-place rotation':'Move & turn';
}
function setSceneView(atlas) {
  $('scene-stage').classList.toggle('atlas-mode',atlas);
  $('view-atlas').setAttribute('aria-pressed',String(atlas));$('view-first-person').setAttribute('aria-pressed',String(!atlas));
}
function highlightLandmark(pose) {
  const c = state.current; const active = $('focus-toggle').getAttribute('aria-pressed') === 'true'; const bounds = c.target_bounds;
  if (!bounds || !active) { $('landmark-overlay').style.display = 'none'; return; }
  const angle = pose[3] * Math.PI / 180, cs = Math.cos(angle), sn = Math.sin(angle); const points = [];
  for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) {
    const dx = x - pose[0], dy = y - pose[1], dz = z - pose[2]; const forward = dx * cs + dy * sn, right = -dx * sn + dy * cs;
    if (forward <= 10) { $('landmark-overlay').style.display = 'none'; return; }
    points.push([960 + 960 * right / forward, 540 - 960 * dz / forward]);
  }
  // Convex hull of the source landmark's projected 3D bounding box, not a segmentation mask.
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const lower = [], upper = [];
  for (const point of points) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop(); lower.push(point); }
  for (const point of [...points].reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop(); upper.push(point); }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  $('landmark-polygon').setAttribute('points', hull.map(p => p.join(',')).join(' ')); $('landmark-overlay').style.display = 'block';
}
function updateScene() {
  const c = state.current; if (!c) return;
  const frame = sourceFrame(); const pose = c.poses[frame]; const query = frame >= c.context_end;
  $('scene-time').textContent = clock(scene.currentTime); $('scene-scrub').value = String(scene.currentTime);
  $('stage-phase').textContent = query ? 'REVISIT / QUERY' : 'OBSERVATION HISTORY'; $('stage-phase').classList.toggle('query', query);
  const event = query ? 'revisit' : frame >= c.events.explore ? 'explore' : 'observe';
  for (const element of document.querySelectorAll('[data-event]')) element.classList.toggle('active', element.dataset.event === event);
  if (frame === state.lastSceneFrame) return;
  state.lastSceneFrame = frame;
  const point = c.mapPoint(pose);
  for (const id of ['map-camera','atlas-camera']) {
    const group=$(id);
    group.marker.setAttribute('transform',`translate(${point[0]} ${point[1]}) rotate(${pose[3]-90}) scale(${c.mapScale*2.2})`);
    group.progress.setAttribute('points',c.poses.slice(0,frame+1).filter((_,i)=>i%3===0||i===frame).map(c.mapPoint).map(p=>p.join(',')).join(' '));
  }

  highlightLandmark(pose);
}
function jumpEvent(event) {
  const c = state.current; if (!c) return;
  state.seekTarget = c.events[event] / c.fps;
  const poster = $('seek-poster'); poster.src = c.images[event]; poster.hidden = false;
  seekVideo(scene, state.seekTarget); updateScene();
  if (!scene.seeking && scene.readyState >= 2) finishEventSeek();
}
function finishEventSeek() {
  if (state.seekTarget == null || scene.seeking || scene.readyState < 2 || Math.abs(scene.currentTime - state.seekTarget) > .1) return;
  const target = state.seekTarget;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (state.seekTarget === target && !scene.seeking) { $('seek-poster').hidden = true; state.seekTarget = null; }
  }));
}
function modelFor(side) { return state.comparisonGroup.models.find(m => m.id === $(`model-${side}`).value); }
function comparisonMedia() { return [...['a','b'].map(side=>({video:$(`video-${side}`),model:modelFor(side)})),{video:$('video-gt'),model:state.comparisonGroup.gt}]; }
function comparisonLimit() { return Math.max(...comparisonMedia().map(({model})=>model.frames/model.fps)); }
function pauseComparison() { state.comparisonRequest++; state.comparisonController?.abort(); state.comparisonPlaying = false; state.comparisonPending = false; for (const video of videos) video.pause(); $('compare-play').textContent = '▶ Play all'; }
function ensureComparisonLoaded() { for (const video of videos) { if(video.error){video.load();seekVideo(video,state.comparisonTime);}else loadVideo(video); } }
function comparisonLeader() { return comparisonMedia().reduce((a,b)=>a.model.frames/a.model.fps>b.model.frames/b.model.fps?a:b).video; }
function updateComparisonMedia(side) {
  const m=modelFor(side),video=$(`video-${side}`);if(video.dataset.source!==m.video)setVideo(video,m.video,m.poster,!state.comparisonNear);$(`endpoint-${side}`).src=m.poster;
  $(`fps-${side}`).textContent=`${m.fps} FPS`;
}
function updateComparisonTime(time,force=false) {
  state.comparisonTime=clamp(time,0,comparisonLimit());$('compare-scrub').value=String(state.comparisonTime);$('compare-time').textContent=`${state.comparisonTime.toFixed(2)} s`;
  for(const {video,model} of comparisonMedia()) {
    const finalTime=(model.frames-1)/model.fps,target=Math.min(state.comparisonTime,finalTime);
    if(force)seekVideo(video,target);
  }
}
function configureComparison() {
  pauseComparison();for(const side of ['a','b'])updateComparisonMedia(side);
  const gt=state.comparisonGroup.gt;if($('video-gt').dataset.source!==gt.video)setVideo($('video-gt'),gt.video,gt.poster,!state.comparisonNear);$('endpoint-gt').src=gt.poster;
  const limit=comparisonLimit();$('compare-scrub').max=String(limit);$('compare-duration').textContent=`${limit.toFixed(2)} s`;updateComparisonTime(0,true);updateEndpointMode();
}
function updateEndpointMode() {
  const enabled=$('endpoint-mode').checked;if(enabled)pauseComparison();
  for(const side of ['a','b']) {
    $(`video-${side}`).hidden=enabled;$(`endpoint-${side}`).hidden=!enabled;
    const m=modelFor(side);$(`endpoint-label-${side}`).textContent=enabled?`Generated endpoint · frame ${m.endpoint}`:`${m.frames} frames · native cadence`;
    $(`endpoint-label-${side}`).previousElementSibling.textContent=enabled?'Generated endpoint':'Generated Query';
  }
  $('video-gt').hidden=enabled;$('endpoint-gt').hidden=!enabled;
  $('shared-gt-description').textContent=enabled?'Ground-truth revisit target for the selected trajectory.':'Ground-truth Query for the selected trajectory. Plays with the generated continuations.';
  $('compare-play').disabled=enabled;$('compare-scrub').disabled=enabled;
  $('comparison-note').textContent=enabled?'Generated endpoints are shown with one shared GT target. Models may end at different camera poses.':'Playback follows elapsed Query time at each model’s native FPS, with one shared GT video.';
}
function selectComparisonCase(id) {
  const group=state.data.comparison_groups.find(g=>g.case_id===id);if(!group)return;
  pauseComparison();state.comparisonGroup=group;const c=state.data.cases.find(c=>c.id===id);$('comparison-case-title').textContent=c.title;
  for(const button of $('comparison-case-tabs').children)button.setAttribute('aria-pressed',String(button.dataset.resultCase===id));
  for(const side of ['a','b']) {
    const select=$(`model-${side}`),previous=select.value;select.replaceChildren();
    for(const m of group.models){const option=document.createElement('option');option.value=m.id;option.textContent=m.name;select.append(option);}
    select.value=group.models.some(m=>m.id===previous)?previous:(side==='a'?'hy-worldplay':'matrix-game-3.5');
  }
  configureComparison();
}
function renderComparison() {
  for(const [index,c] of state.data.cases.entries()) {
    const button=document.createElement('button');button.className='case-tab';button.dataset.resultCase=c.id;button.setAttribute('aria-pressed','false');
    const number=document.createElement('span');number.className='tab-index';number.textContent=`0${index+1}`;button.append(number,document.createTextNode(c.title));
    button.addEventListener('click',()=>selectComparisonCase(c.id));$('comparison-case-tabs').append(button);
  }
  for(const side of ['a','b'])$(`model-${side}`).addEventListener('change',configureComparison);
  $('view-comparison-case').addEventListener('click',()=>selectCase(state.comparisonGroup.case_id));selectComparisonCase(state.current.id);
}
async function startComparison() {
  if (state.comparisonPlaying || state.comparisonPending) { pauseComparison(); return; }
  if (state.comparisonTime >= comparisonLimit() - .04) updateComparisonTime(0, true);
  const request=++state.comparisonRequest,controller=new AbortController();state.comparisonController=controller;
  state.comparisonPending=true;$('compare-play').textContent='Loading…';ensureComparisonLoaded();
  try {
    await Promise.all(videos.map(v=>readyVideo(v,controller.signal)));
    if(request!==state.comparisonRequest)return;
    const results=await Promise.allSettled(videos.filter(v=>!v.ended).map(v=>v.play()));
    if(request!==state.comparisonRequest)return;
    const failure=results.find(r=>r.status==='rejected');
    if(failure)throw failure.reason;
    state.comparisonPending=false;state.comparisonPlaying=true;$('compare-play').textContent='Ⅱ Pause all';notify('');
  } catch(error) {
    if(request!==state.comparisonRequest)return;
    pauseComparison();if(error.name!=='AbortError')notify('Videos are still loading. Please press Play to retry.');
  }
}
function tick(now) {
  if (now - state.lastUpdate > 40) { state.lastUpdate = now; if (!scene.paused) updateScene(); if (state.comparisonPlaying) { const leader=comparisonLeader();updateComparisonTime(leader.currentTime);if(leader.ended)pauseComparison(); } }
  requestAnimationFrame(tick);
}
async function init() {
  try { const response = await fetch('cases.json?v=20261104-motion-playback'); if (!response.ok) throw new Error('Could not load case data'); state.data = await response.json(); renderCaseTabs(); selectCase(state.data.initial_case); renderComparison(); }
  catch (error) { notify('The scene data could not be loaded. Please refresh the page.'); console.error(error); return; }
  setSceneView(true);
  $('view-atlas').addEventListener('click',()=>setSceneView(true));
  $('view-first-person').addEventListener('click',()=>setSceneView(false));
  $('scene-play').addEventListener('click', toggleScene); $('scene-start').addEventListener('click',toggleScene);
  scene.addEventListener('play', () => { $('scene-play').textContent = 'Ⅱ'; $('scene-play').setAttribute('aria-label', 'Pause trajectory');$('scene-start').hidden=true; });
  scene.addEventListener('pause', () => { $('scene-play').textContent = '▶'; $('scene-play').setAttribute('aria-label', 'Play trajectory');if(!state.scenePending)$('scene-start').hidden=false; });
  scene.addEventListener('waiting',()=>{if(!scene.paused)$('scene-buffering').hidden=false;});
  scene.addEventListener('playing',()=>{$('scene-buffering').hidden=true;});
  scene.addEventListener('ended',()=>{$('scene-start').hidden=false;});
  for (const event of ['loadedmetadata', 'seeked', 'timeupdate', 'ended']) scene.addEventListener(event, updateScene);
  for (const event of ['seeked', 'loadeddata', 'canplay']) scene.addEventListener(event, finishEventSeek);
  scene.addEventListener('error', () => notify('The scene video could not be loaded.'));
  $('scene-scrub').addEventListener('input', event => { state.seekTarget = null; $('seek-poster').hidden = true; seekVideo(scene, Number(event.target.value)); });
  $('scene-speed').addEventListener('change', event => scene.playbackRate = Number(event.target.value));
  for (const button of document.querySelectorAll('[data-event]')) button.addEventListener('click', () => jumpEvent(button.dataset.event));
  $('jump-revisit').addEventListener('click', () => jumpEvent('revisit'));
  $('focus-toggle').addEventListener('click', () => { const active = $('focus-toggle').getAttribute('aria-pressed') === 'true'; $('focus-toggle').setAttribute('aria-pressed', String(!active));state.lastSceneFrame=-1;updateScene(); });
  $('compare-play').addEventListener('click', startComparison);
  $('compare-scrub').addEventListener('input', event => { pauseComparison(); updateComparisonTime(Number(event.target.value), true); });
  $('endpoint-mode').addEventListener('change', updateEndpointMode);
  for(const video of videos)video.addEventListener('waiting',()=>{
    if(!state.comparisonPlaying)return;
    const time=state.comparisonTime;state.comparisonPlaying=false;for(const v of videos)v.pause();updateComparisonTime(time,true);startComparison();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { pauseScene(); pauseComparison(); } });
  const observer = new IntersectionObserver(entries => { for (const entry of entries) if (!entry.isIntersecting) { if (entry.target.id === 'explore') pauseScene(); else pauseComparison(); } }, {threshold: .08}); observer.observe($('explore')); observer.observe($('compare'));
  new IntersectionObserver(([entry])=>{if(entry.isIntersecting){state.comparisonNear=true;ensureComparisonLoaded();}},{rootMargin:'300px'}).observe($('compare'));
  requestAnimationFrame(tick);
}
init();
const motionButton = $('wall-motion');
if (motionButton) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reducedMotion.matches) {
    document.querySelector('.hero').classList.add('motion-paused');
    motionButton.setAttribute('aria-pressed', 'true');
    motionButton.textContent = 'Gallery paused';
    motionButton.disabled = true;
  }
  motionButton.addEventListener('click', () => {
    const paused = motionButton.getAttribute('aria-pressed') !== 'true';
    document.querySelector('.hero').classList.toggle('motion-paused', paused);
    motionButton.setAttribute('aria-pressed', String(paused));
    motionButton.textContent = paused ? 'Play gallery' : 'Pause gallery';
    motionButton.setAttribute('aria-label', paused ? 'Play scene gallery animation' : 'Pause scene gallery animation');
  });
}
