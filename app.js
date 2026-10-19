const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const state = {data: null, current: null, comparisonPlaying: false, comparisonTime: 0, comparisonStartedAt: 0, lastUpdate: 0};
const scene = $('scene-video');
const videos = [$('video-a'), $('video-b')];
let statusTimer;
function notify(message) { $('status-message').textContent = message; clearTimeout(statusTimer); statusTimer = setTimeout(() => $('status-message').textContent = '', 6500); }
function clock(seconds) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
function svg(tag, attributes = {}, text = '') { const node = document.createElementNS(NS, tag); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value); if (text) node.textContent = text; return node; }
function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
function setVideo(video, src, poster) { video.pause(); video.poster = poster; video.src = src; video.load(); }
function seekVideo(video, time) {
  const seek = () => { if (video.readyState >= 1 && Number.isFinite(video.duration)) video.currentTime = clamp(time, 0, Math.max(0, video.duration - 0.001)); };
  if (video.readyState >= 1) seek(); else video.addEventListener('loadedmetadata', seek, {once: true});
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
  scene.pause(); state.current = c; $('scene-play').textContent = '▶'; $('scene-play').setAttribute('aria-label', 'Play trajectory');
  for (const button of document.querySelectorAll('.case-tab')) button.setAttribute('aria-pressed', String(button.dataset.id === id));
  $('task-label').textContent = c.task;
  const [firstLine, ...remaining] = c.headline.split('. ');
  $('stage-headline').textContent = firstLine + (remaining.length ? '.' : '');
  if (remaining.length) $('stage-headline').append(document.createElement('br'), document.createTextNode(remaining.join('. ')));
  $('stage-description').textContent = c.description;
  for (const name of ['observe', 'explore']) { $(`${name}-image`).src = c.images[name]; $(`${name}-time`).textContent = clock(c.events[name] / c.fps); }
  $('scene-duration').textContent = clock(c.frames / c.fps);
  $('scene-scrub').max = String((c.frames - 1) / c.fps); $('scene-scrub').value = '0';
  const fraction = c.context_end / c.frames * 100;
  $('context-phase').style.width = `${fraction}%`; $('scene-scrub').style.setProperty('--split', `${fraction}%`);
  $('case-description').textContent = `${c.title} · ${c.source_case}`;
  $('timeline-markers').replaceChildren();
  for (const index of [...Object.values(c.events), c.context_end]) { const line = document.createElement('span'); line.className = 'timeline-marker'; line.style.left = `${index / c.frames * 100}%`; $('timeline-markers').append(line); }
  $('focus-toggle').hidden = !c.target_bounds; $('focus-toggle').setAttribute('aria-pressed', 'false'); $('landmark-overlay').style.display = 'none';
  setVideo(scene, c.video, c.images.observe); scene.playbackRate = Number($('scene-speed').value);
  setVideo($('camera-preview'), c.video, c.images.observe); buildMap(); updateScene();
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
      node.append(svg('line',{x1:point[0],y1:point[1],x2:x,y2:y,stroke:'#ffffffaa','stroke-width':2}),svg('circle',{cx:x,cy:y,r:10,fill:event==='revisit'?'#c04b38':'#446da2',stroke:'#fff','stroke-width':3}),svg('text',{x:x+15,y:y+5,fill:'#fff','font-size':15,'paint-order':'stroke',stroke:'#23344a','stroke-width':4},event==='observe'?'A · Observe':event==='explore'?'Explore':'B · Revisit'));
      node.addEventListener('click',()=>jumpEvent(event));node.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();jumpEvent(event);}});geometry.append(node);
    }
    root.append(svg('g',{id:root.id==='route-map'?'map-camera':'atlas-camera'}));
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
  const point = c.mapPoint(pose);
  for (const id of ['map-camera','atlas-camera']) {
    const group=$(id); group.replaceChildren();
    const marker=svg('g',{transform:`translate(${point[0]} ${point[1]}) rotate(${pose[3]-90})`});
    marker.append(svg('path',{d:'M0 0 L62 -40 Q78 0 62 40 Z',fill:'#ffb19e44',stroke:'#ffd1c3','stroke-width':2}),svg('circle',{r:7,fill:'#c04b38',stroke:'#fff','stroke-width':3}));group.append(marker);
  }
  const preview=$('camera-preview'); if(Math.abs(preview.currentTime-scene.currentTime)>.15) seekVideo(preview,scene.currentTime);
  highlightLandmark(pose);
}
function jumpEvent(event) { const c = state.current; if (!c) return; seekVideo(scene, c.events[event] / c.fps); }
function modelFor(side) { return state.data.comparisons.find(m => m.id === $(`model-${side}`).value); }
function comparisonLimit() { return Math.max(...['a', 'b'].map(side => { const m = modelFor(side); return m.frames / m.fps; })); }
function pauseComparison() { state.comparisonPlaying = false; for (const video of videos) video.pause(); $('compare-play').textContent = '▶ Play both'; }
function updateComparisonMedia(side) {
  const m = modelFor(side); const video = $(`video-${side}`);
  setVideo(video, m.video, m.poster); $(`endpoint-${side}`).src = m.poster; $(`reference-${side}`).src = m.reference;
  $(`fps-${side}`).textContent = `${m.fps} FPS`;
  $(`endpoint-label-${side}`).textContent = `${m.frames} frames · native cadence`;
  $(`reference-label-${side}`).textContent = `Selected GT reference · source frame ${m.reference_source_frame}`;
}
function updateComparisonTime(time, force = false) {
  const limit = comparisonLimit(); state.comparisonTime = clamp(time, 0, limit);
  $('compare-scrub').value = String(state.comparisonTime); $('compare-time').textContent = `${state.comparisonTime.toFixed(2)} s`;
  for (const side of ['a', 'b']) { const video = $(`video-${side}`), m = modelFor(side); const finalTime = (m.frames - 1) / m.fps; const target = Math.min(state.comparisonTime, finalTime);
    if (force || Math.abs(video.currentTime - target) > .12) seekVideo(video, target);
    if (state.comparisonTime >= finalTime) video.pause();
  }
}
function configureComparison() {
  pauseComparison(); for (const side of ['a', 'b']) updateComparisonMedia(side);
  const limit = comparisonLimit(); $('compare-scrub').max = String(limit); $('compare-duration').textContent = `${limit.toFixed(2)} s`; updateComparisonTime(0, true); updateEndpointMode();
}
function updateEndpointMode() {
  const enabled = $('endpoint-mode').checked; if (enabled) pauseComparison();
  for (const side of ['a', 'b']) { $(`video-${side}`).hidden = enabled; $(`endpoint-${side}`).hidden = !enabled; $(`reference-panel-${side}`).hidden = !enabled; const m = modelFor(side); $(`endpoint-label-${side}`).textContent = enabled ? `Generated endpoint · frame ${m.endpoint}` : `${m.frames} frames · native cadence`; }
  $('compare-play').disabled = enabled; $('compare-scrub').disabled = enabled;
  $('comparison-note').textContent = enabled ? 'Each generated endpoint is shown with its actual selected GT reference. Reference frames may differ between models.' : 'Playback follows elapsed Query time at each model’s native FPS. Matching playback time does not imply identical camera poses.';
}
function renderComparison() {
  for (const side of ['a', 'b']) { const select = $(`model-${side}`); for (const m of state.data.comparisons) { const option = document.createElement('option'); option.value = m.id; option.textContent = m.name; select.append(option); } select.addEventListener('change', configureComparison); }
  $('model-a').value = 'hy-worldplay'; $('model-b').value = 'matrix-game-3.5';
  const c = state.data.cases.find(c => c.id === state.data.comparison_case); $('shared-context').src = c.images.observe;
  $('view-comparison-case').addEventListener('click', () => selectCase(state.data.comparison_case)); configureComparison();
}
async function startComparison() {
  if (state.comparisonPlaying) { pauseComparison(); return; }
  if (state.comparisonTime >= comparisonLimit() - .04) updateComparisonTime(0, true);
  state.comparisonPlaying = true; state.comparisonStartedAt = performance.now() - state.comparisonTime * 1000; $('compare-play').textContent = 'Ⅱ Pause both';
  const results = await Promise.allSettled(videos.map(v => v.play()));
  if (results.some(r => r.status === 'rejected')) { pauseComparison(); notify('Video playback could not start. Please refresh the page and try again.'); }
}
function tick(now) {
  if (now - state.lastUpdate > 40) { state.lastUpdate = now; if (!scene.paused) updateScene(); if (state.comparisonPlaying) { const time = (now - state.comparisonStartedAt) / 1000; updateComparisonTime(time); if (time >= comparisonLimit()) pauseComparison(); } }
  requestAnimationFrame(tick);
}
async function init() {
  try { const response = await fetch('cases.json'); if (!response.ok) throw new Error('Could not load case data'); state.data = await response.json(); renderCaseTabs(); selectCase(state.data.initial_case); renderComparison(); }
  catch (error) { notify('The scene data could not be loaded. Please refresh the page.'); console.error(error); return; }
  setSceneView(true);
  $('view-atlas').addEventListener('click',()=>setSceneView(true));
  $('view-first-person').addEventListener('click',()=>setSceneView(false));
  $('scene-play').addEventListener('click', async () => { try { if (scene.paused) { if (scene.ended) scene.currentTime = 0; await scene.play(); } else scene.pause(); } catch { notify('The scene video could not be played.'); } });
  scene.addEventListener('play', () => { $('camera-preview').playbackRate=scene.playbackRate; $('camera-preview').play().catch(()=>{}); $('scene-play').textContent = 'Ⅱ'; $('scene-play').setAttribute('aria-label', 'Pause trajectory'); });
  scene.addEventListener('pause', () => { $('camera-preview').pause(); $('scene-play').textContent = '▶'; $('scene-play').setAttribute('aria-label', 'Play trajectory'); });
  for (const event of ['loadedmetadata', 'seeked', 'timeupdate', 'ended']) scene.addEventListener(event, updateScene);
  scene.addEventListener('error', () => notify('The scene video could not be loaded.'));
  $('scene-scrub').addEventListener('input', event => { seekVideo(scene, Number(event.target.value)); });
  $('scene-speed').addEventListener('change', event => scene.playbackRate = Number(event.target.value));
  for (const button of document.querySelectorAll('[data-event]')) button.addEventListener('click', () => jumpEvent(button.dataset.event));
  $('jump-revisit').addEventListener('click', () => jumpEvent('revisit'));
  $('focus-toggle').addEventListener('click', () => { const active = $('focus-toggle').getAttribute('aria-pressed') === 'true'; $('focus-toggle').setAttribute('aria-pressed', String(!active)); updateScene(); });
  $('compare-play').addEventListener('click', startComparison);
  $('compare-scrub').addEventListener('input', event => { pauseComparison(); updateComparisonTime(Number(event.target.value), true); });
  $('endpoint-mode').addEventListener('change', updateEndpointMode);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { scene.pause(); pauseComparison(); } });
  const observer = new IntersectionObserver(entries => { for (const entry of entries) if (!entry.isIntersecting) { if (entry.target.id === 'explore') scene.pause(); else pauseComparison(); } }, {threshold: .08}); observer.observe($('explore')); observer.observe($('compare'));
  requestAnimationFrame(tick);
}
init();
const motionButton = $('wall-motion');
if (motionButton) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reducedMotion.matches) {
    document.querySelector('.hero').classList.add('motion-paused');
    motionButton.setAttribute('aria-pressed', 'true');
    motionButton.textContent = 'Reduced motion';
    motionButton.disabled = true;
  }
  motionButton.addEventListener('click', () => {
    const paused = motionButton.getAttribute('aria-pressed') !== 'true';
    document.querySelector('.hero').classList.toggle('motion-paused', paused);
    motionButton.setAttribute('aria-pressed', String(paused));
    motionButton.textContent = paused ? '▶ Play background' : 'Ⅱ Pause background';
    motionButton.setAttribute('aria-label', paused ? 'Play background animation' : 'Pause background animation');
  });
}
