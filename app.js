const defaults = [
  ['1','MIRZAYEV','GK','4 SEYV · 82% PASS'], ['2','KARIMOV','RB','PACE 88 · 2 TACKLE'], ['5','RAXIMOV','CB','91% PASS · 6 DUEL'],
  ['4','NORMATOV','CB','3 CLEARANCE · 5 DUEL'], ['3','YUSUPOV','LB','1 ASSIST · PACE 84'], ['8','AKBAROV','CM','88% PASS · 7.8 RATE'],
  ['6','USMONOV','DM','5 RECOVERY · 93% PASS'], ['10','TURSUNOV','AM','3 CHANCE · 2 KEY PASS'], ['11','ABDULLAEV','LW','4 DRIBBLE · PACE 91'],
  ['9','SHODIEV','ST','12 GOAL · 4 SHOT'], ['7','SOBIROV','RW','PACE 89 · 2 ASSIST']
];
const formations = {
  '433': [[50,78],[84,64],[62,66],[38,66],[16,64],[72,48],[50,51],[28,48],[78,29],[50,23],[22,29]],
  '4231': [[50,78],[84,64],[62,66],[38,66],[16,64],[65,50],[35,50],[50,38],[78,29],[50,25],[22,29]],
  '442': [[50,78],[84,64],[62,66],[38,66],[16,64],[77,48],[58,48],[42,48],[23,48],[65,27],[35,27]],
  '352': [[50,78],[74,64],[50,66],[26,64],[87,47],[67,48],[50,49],[33,48],[13,47],[64,27],[36,27]]
};
const makePlayers = () => defaults.map(([number,name,role,stat]) => ({number,name,role,stat,photo:''}));
const clonePlayers = rows => {
  const fallback = makePlayers();
  return fallback.map((player, index) => ({ ...player, ...(rows?.[index] || {}) }));
};
const makeTeam = (club, teamColor, accentColor) => ({
  club, teamColor, accentColor, sponsor: 'OFFICIAL PARTNER', formation: '433', logoUrl: '', players: makePlayers(), positions: null,
});
const TEAM_STORAGE_KEY = 'lineup-ar-team-presets-v2';
let teams = {
  home: makeTeam('TOSHKENT FC', '#00ad76', '#d8ff43'),
  away: makeTeam('AWAY FC', '#2948a8', '#ffdc45'),
};
try {
  const savedTeams = JSON.parse(localStorage.getItem(TEAM_STORAGE_KEY));
  if (savedTeams?.home && savedTeams?.away) teams = savedTeams;
} catch (_) { localStorage.removeItem(TEAM_STORAGE_KEY); }
let activeTeam = 'home';
let players = clonePlayers(teams.home.players || makePlayers());
let logoUrl = teams.home.logoUrl || '';
let videoUrl = '';
let trackingFrames = [];
let trackingLoopStarted = false;
let trackingEnabled = false;
let layoutMode = false;
let manualPositions = teams.home.positions || null;
let previousCutFrame = null;
let uploadedVideoFile = null;
let calibrationMode = false;
let calibrationAnchors = [];
let trackingReferencePositions = null;
let layerPreferences = { stats: true, lines: true };
try {
  layerPreferences = { ...layerPreferences, ...JSON.parse(localStorage.getItem('lineup-ar-layers-v1') || '{}') };
} catch (_) { localStorage.removeItem('lineup-ar-layers-v1'); }
const storedPreset = localStorage.getItem('lineup-ar-fixed-camera-preset');
if (storedPreset) {
  try {
    const parsed = JSON.parse(storedPreset);
    if (!manualPositions && Array.isArray(parsed) && parsed.length === 11) manualPositions = parsed;
  } catch (_) { localStorage.removeItem('lineup-ar-fixed-camera-preset'); }
}

const $ = id => document.getElementById(id);
const stage = $('broadcast-stage');
const video = $('stadium-video');
const cardBox = $('lineup-cards');

function positionsCopy(positions) {
  return Array.isArray(positions) && positions.length === 11 ? positions.map(([x, y]) => [x, y]) : null;
}
function saveTeams() {
  try { localStorage.setItem(TEAM_STORAGE_KEY, JSON.stringify(teams)); } catch (_) { /* Portrait files can exceed browser storage. */ }
}
function captureActiveTeam() {
  teams[activeTeam] = {
    club: $('club-name').value,
    teamColor: $('team-color').value,
    accentColor: $('accent-color').value,
    sponsor: $('sponsor').value,
    formation: $('formation').value,
    logoUrl,
    players: clonePlayers(players),
    positions: positionsCopy(manualPositions),
  };
  saveTeams();
}
function updateTeamTabs() {
  document.querySelectorAll('[data-team]').forEach(button => button.classList.toggle('active', button.dataset.team === activeTeam));
  $('active-team-label').textContent = activeTeam.toUpperCase();
}
function loadTeam(teamName) {
  if (teamName === activeTeam) return;
  captureActiveTeam();
  activeTeam = teamName;
  const team = teams[activeTeam];
  players = clonePlayers(team.players || makePlayers());
  logoUrl = team.logoUrl || '';
  manualPositions = positionsCopy(team.positions);
  $('club-name').value = team.club || 'CLUB NAME';
  $('team-color').value = team.teamColor || '#00ad76';
  $('accent-color').value = team.accentColor || '#d8ff43';
  $('sponsor').value = team.sponsor || 'OFFICIAL PARTNER';
  $('formation').value = team.formation || '433';
  stopTracking();
  syncTheme(); renderRosterEditor(); renderCards(); updateTeamTabs();
  setTrackingStatus(`${activeTeam.toUpperCase()} preset yuklandi`, 'ready');
  updateOperatorState();
}

function initials(name) { return name.split(/\s+/).map(s => s[0]).join('').slice(0,2) || 'FC'; }
function esc(v) { return String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function setTrackingStatus(message, state = '') {
  const status = $('tracking-status');
  status.className = `tracking-status${state ? ` ${state}` : ''}`;
  status.innerHTML = `<i></i><span>${esc(message)}</span>`;
}
function syncTheme() {
  const team = $('team-color').value, accent = $('accent-color').value;
  document.documentElement.style.setProperty('--team', team);
  document.documentElement.style.setProperty('--accent', accent);
  const club = $('club-name').value.trim() || 'CLUB NAME';
  $('intro-club').textContent = club; $('top-club').textContent = club;
  $('intro-formation').textContent = $('formation').selectedOptions[0].text + ' FORMATION';
  $('preview-club').textContent = club;
  $('preview-formation').textContent = $('formation').selectedOptions[0].text;
  $('sponsor-strip').textContent = $('sponsor').value.trim() || 'OFFICIAL PARTNER';
  const logo = $('intro-logo');
  logo.textContent = initials(club);
  logo.style.backgroundImage = logoUrl ? `url("${logoUrl}")` : '';
  if (logoUrl) logo.textContent = '';
}
function renderRosterEditor() {
  $('roster-editor').innerHTML = players.map((p,i) => `<article class="player-row">
    <input aria-label="${i+1}-o'yinchi raqami" class="editor-player-number" data-i="${i}" data-key="number" maxlength="2" value="${esc(p.number)}" />
    <div class="player-fields">
      <input aria-label="${i+1}-o'yinchi ismi" class="player-name-input" data-i="${i}" data-key="name" maxlength="20" value="${esc(p.name)}" />
      <input aria-label="${i+1}-o'yinchi roli" class="player-role-input" data-i="${i}" data-key="role" maxlength="4" value="${esc(p.role)}" />
      <input aria-label="${i+1}-o'yinchi statistikasi" class="player-stat-input" data-i="${i}" data-key="stat" maxlength="38" value="${esc(p.stat)}" />
    </div>
    <label class="photo-picker${p.photo ? ' has-photo' : ''}" title="${i+1}-o'yinchi suratini yuklash">
      <input aria-label="${i+1}-o'yinchi surati" class="photo-input" data-photo="${i}" type="file" accept="image/*" />
      <span class="photo-preview" style="${p.photo ? `background-image:url('${p.photo}')` : ''}"><span aria-hidden="true">＋</span></span>
    </label>
  </article>`).join('');
  document.querySelectorAll('[data-key]').forEach(input => input.addEventListener('input', e => {
    players[e.target.dataset.i][e.target.dataset.key] = e.target.value.toUpperCase(); captureActiveTeam(); renderCards(); updateOperatorState();
  }));
  document.querySelectorAll('[data-photo]').forEach(input => input.addEventListener('change', e => loadImage(e.target.files[0], url => {
    players[e.target.dataset.photo].photo = url; captureActiveTeam(); renderRosterEditor(); renderCards();
  })));
}
function renderCards() {
  const points = manualPositions || formations[$('formation').value];
  cardBox.innerHTML = players.map((p,i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const portrait = p.photo
      ? `background-image:url('${p.photo}')`
      : `background-image:url('./assets/demo-player-portraits-v1.png');background-size:400% 300%;background-position:${(col / 3) * 100}% ${(row / 2) * 100}%`;
    const depthScale = (.55 + points[i][1] / 100 * .72).toFixed(2);
    const lean = ((points[i][0] - 50) / 50 * 1.4).toFixed(2);
    const group = i === 0 ? 0 : i < 5 ? 1 : i < 8 ? 2 : 3;
    const groupIndex = i === 0 ? 0 : i < 5 ? i - 1 : i < 8 ? i - 5 : i - 8;
    return `<article class="player-card" style="--x:${points[i][0]};--y:${points[i][1]};--base-left:${points[i][0]}%;--base-top:${points[i][1]}%;--base-scale:${depthScale};--lean:${lean}deg;--order:${i};--group:${group};--group-index:${groupIndex}">
    <div class="card-shape"><div class="player-image" style="${portrait}"></div><b class="player-number">${esc(p.number)}</b><div class="player-name">${esc(p.name)}</div></div>
    <div class="card-stats">${esc(p.role)} · ${esc(p.stat)}</div>
  </article>`;
  }).join('');
  const links = [[0,1],[1,2],[2,3],[3,4],[2,6],[5,6],[6,7],[5,8],[6,9],[7,10]];
  $('tactic-lines').innerHTML = links.map(([a,b]) => `<line x1="${points[a][0]*10}" y1="${points[a][1]*5.6}" x2="${points[b][0]*10}" y2="${points[b][1]*5.6}" />`).join('');
  if (layoutMode) wireCardDragging();
}
function switchPanel(panelName) {
  document.querySelectorAll('[data-panel]').forEach(button => button.classList.toggle('active', button.dataset.panel === panelName));
  document.querySelectorAll('.panel-view').forEach(panel => panel.classList.toggle('active', panel.id === `panel-${panelName}`));
  document.querySelector('.panel-scroll').scrollTop = 0;
}
function applyLayerPreferences() {
  $('stats-toggle').checked = layerPreferences.stats;
  $('lines-toggle').checked = layerPreferences.lines;
  stage.classList.toggle('hide-stats', !layerPreferences.stats);
  stage.classList.toggle('hide-lines', !layerPreferences.lines);
  localStorage.setItem('lineup-ar-layers-v1', JSON.stringify(layerPreferences));
}
function updateOperatorState() {
  const videoReady = Boolean(videoUrl);
  const lineupReady = players.filter(player => String(player.name || '').trim() && String(player.number || '').trim()).length;
  const anchorReady = trackingEnabled || Boolean(manualPositions) || !videoReady;
  const onAir = stage.classList.contains('on-air');
  const mode = calibrationMode ? 'CALIBRATING' : layoutMode ? 'LAYOUT MODE' : onAir ? 'ON AIR' : 'PREVIEW';

  $('live-state-label').textContent = mode;
  $('live-status').classList.toggle('is-live', onAir);
  $('live-status').classList.toggle('is-tool', calibrationMode || layoutMode);
  $('stage-mode-badge').querySelector('span').textContent = onAir ? 'PROGRAM LIVE' : calibrationMode ? 'CALIBRATING' : layoutMode ? 'POSITIONING' : 'REHEARSAL';
  $('play-button').classList.toggle('is-live', onAir);
  $('play-button').innerHTML = onAir ? '<span>↻</span> REPLAY GRAPHIC' : '<span>▶</span> TAKE ON AIR';

  $('video-drop').classList.toggle('is-loaded', videoReady);
  $('video-source-badge').classList.toggle('is-ready', videoReady);
  $('video-source-badge').textContent = videoReady ? 'INPUT READY' : 'NO INPUT';
  $('upload-title').textContent = videoReady ? uploadedVideoFile?.name || 'Video yuklandi' : 'Stadion videosini yuklang';
  $('footer-source').textContent = videoReady ? 'VIDEO INPUT' : 'DEMO INPUT';

  $('workflow-video').classList.toggle('is-ready', videoReady);
  $('workflow-video-copy').textContent = videoReady ? 'Local video ready' : 'Demo pitch';
  $('workflow-team').classList.toggle('is-ready', lineupReady === 11);
  $('workflow-team-copy').textContent = `${activeTeam === 'home' ? 'Home' : 'Away'} · ${lineupReady} players`;
  $('workflow-anchor').classList.toggle('is-ready', anchorReady);
  $('workflow-anchor-copy').textContent = trackingEnabled ? 'Tracking locked' : manualPositions ? 'Custom fixed preset' : videoReady ? 'Position or calibrate' : 'Formation preset';

  $('ready-video').classList.toggle('is-ready', videoReady);
  $('ready-video').querySelector('b').textContent = videoReady ? 'READY' : 'DEMO';
  $('ready-squad').classList.toggle('is-ready', lineupReady === 11);
  $('ready-squad').querySelector('b').textContent = `${lineupReady} / 11`;
  $('ready-anchor').classList.toggle('is-ready', anchorReady);
  $('ready-anchor').querySelector('b').textContent = trackingEnabled ? 'TRACKED' : manualPositions ? 'FIXED' : videoReady ? 'OPTIONAL' : 'FORMATION';
  $('readiness-score').textContent = `${Number(videoReady) + Number(lineupReady === 11) + Number(anchorReady)} / 3`;
}
function loadImage(file, onDone) { if (!file) return; const reader = new FileReader(); reader.onload = e => onDone(e.target.result); reader.readAsDataURL(file); }
function lerp(a, b, t) { return a + (b - a) * t; }
function interpolateTracking(time) {
  if (!trackingFrames.length || time < trackingFrames[0].t - .12 || time > trackingFrames.at(-1).t + .12) return null;
  let low = 0, high = trackingFrames.length - 1;
  while (low < high) { const mid = Math.floor((low + high) / 2); if (trackingFrames[mid].t < time) low = mid + 1; else high = mid; }
  const next = trackingFrames[low], previous = trackingFrames[Math.max(0, low - 1)];
  const blend = next.t === previous.t ? 0 : Math.max(0, Math.min(1, (time - previous.t) / (next.t - previous.t)));
  return {
    h: previous.h.map((value, i) => lerp(value, next.h[i], blend)),
    confidence: lerp(previous.confidence, next.confidence, blend),
  };
}
function interpolateQuad(time) {
  if (!trackingFrames.length) return null;
  let low = 0, high = trackingFrames.length - 1;
  while (low < high) { const mid = Math.floor((low + high) / 2); if (trackingFrames[mid].t < time) low = mid + 1; else high = mid; }
  const next = trackingFrames[low], previous = trackingFrames[Math.max(0, low - 1)];
  const blend = next.t === previous.t ? 0 : Math.max(0, Math.min(1, (time - previous.t) / (next.t - previous.t)));
  return { quad: previous.quad.map((point, i) => [lerp(point[0], next.quad[i][0], blend), lerp(point[1], next.quad[i][1], blend)]), confidence: lerp(previous.confidence, next.confidence, blend) };
}
function pitchPoint(point, quad) {
  const [u, v] = [point[0] / 100, point[1] / 100];
  const top = [lerp(quad[0][0], quad[1][0], u), lerp(quad[0][1], quad[1][1], u)];
  const bottom = [lerp(quad[3][0], quad[2][0], u), lerp(quad[3][1], quad[2][1], u)];
  return [lerp(top[0], bottom[0], v), lerp(top[1], bottom[1], v)];
}
function projectHomography(point, values) {
  const [x, y] = [point[0] / 100, point[1] / 100];
  const d = values[6] * x + values[7] * y + values[8];
  if (Math.abs(d) < .000001) return null;
  return [(values[0] * x + values[1] * y + values[2]) / d, (values[3] * x + values[4] * y + values[5]) / d];
}
function applyTracking(time) {
  if (!trackingEnabled) return;
  const state = interpolateTracking(time);
  const points = trackingReferencePositions || manualPositions || formations[$('formation').value];
  const lost = !state || state.confidence < 0.38;
  document.querySelectorAll('.player-card').forEach((card, i) => {
    const projected = state && projectHomography(points[i], state.h);
    const [x, y] = projected || [0, 0];
    const depth = .68 + points[i][1] / 100 * .52;
    card.style.setProperty('--track-left', `${(x * 100).toFixed(3)}%`);
    card.style.setProperty('--track-top', `${(y * 100).toFixed(3)}%`);
    card.style.setProperty('--card-scale', depth.toFixed(3));
    card.classList.toggle('is-lost', lost);
  });
  $('confidence-label').textContent = lost ? 'TRACK LOST' : `TRACK ${(state.confidence * 100).toFixed(0)}%`;
}
function trackVideoFrame() {
  applyTracking(video.currentTime);
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(trackVideoFrame);
  else requestAnimationFrame(trackVideoFrame);
}
async function analysePitch(file, anchors, startTime) {
  setTrackingStatus('Maydon harakati hisoblanmoqda…', 'working');
  trackingFrames = []; stage.classList.remove('tracked');
  const data = new FormData(); data.append('video', file); data.append('anchors', JSON.stringify(anchors)); data.append('start_time', String(startTime));
  try {
    const response = await fetch('/api/track', { method: 'POST', body: data });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'Tracking xatosi');
    trackingFrames = result.frames;
    trackingEnabled = true;
    stage.classList.add('tracked');
    setTrackingStatus(`Maydonga biriktirildi: ${trackingFrames.length} kadr`, 'ready');
    $('confidence-label').textContent = 'TRACK READY';
    if (!trackingLoopStarted) { trackingLoopStarted = true; trackVideoFrame(); }
  } catch (error) {
    trackingEnabled = false;
    setTrackingStatus(`Tracking: ${error.message}`);
  }
  updateOperatorState();
}
function renderCalibrationMarkers() {
  $('calibration-points').innerHTML = calibrationAnchors.map(([x, y], i) =>
    `<span class="calibration-point" style="left:${x * 100}%;top:${y * 100}%">${i + 1}</span>`
  ).join('');
  stage.classList.remove('calibration-2', 'calibration-3', 'calibration-4');
  if (calibrationAnchors.length > 1) stage.classList.add(`calibration-${Math.min(4, calibrationAnchors.length)}`);
}
function stopTracking() {
  trackingEnabled = false;
  trackingFrames = [];
  trackingReferencePositions = null;
  stage.classList.remove('tracked');
  $('confidence-label').textContent = '';
}
function toggleCalibrationMode() {
  if (!videoUrl || !uploadedVideoFile) {
    setTrackingStatus('Avval stadion videosini yuklang');
    return;
  }
  calibrationMode = !calibrationMode;
  if (calibrationMode) {
    if (layoutMode) togglePlacementMode();
    stopTracking();
    calibrationAnchors = [];
    renderCalibrationMarkers();
    stage.classList.remove('on-air');
    stage.classList.add('calibration-mode');
    video.pause(); video.controls = true;
    $('calibrate-button').innerHTML = '<span>×</span> BEKOR';
    setTrackingStatus('4 ta oq chiziq kesishmasini bosing', 'working');
  } else {
    stage.classList.remove('calibration-mode', 'calibration-2', 'calibration-3', 'calibration-4');
    $('calibration-points').innerHTML = '';
    video.controls = false;
    $('calibrate-button').innerHTML = '<span>◇</span> 4 NUQTA';
    setTrackingStatus('Kalibrovka bekor qilindi');
  }
  updateOperatorState();
}
async function completeCalibration() {
  calibrationMode = false;
  stage.classList.remove('calibration-2', 'calibration-3');
  stage.classList.add('calibration-mode', 'calibration-4');
  video.controls = false;
  $('calibrate-button').innerHTML = '<span>◇</span> 4 NUQTA';
  trackingReferencePositions = (manualPositions || formations[$('formation').value]).map(([x, y]) => [x, y]);
  await analysePitch(uploadedVideoFile, calibrationAnchors, video.currentTime);
  stage.classList.remove('calibration-mode', 'calibration-4');
  $('calibration-points').innerHTML = '';
}
function goOnAir() {
  if (layoutMode) togglePlacementMode();
  syncTheme(); renderCards();
  stage.classList.remove('on-air');
  void stage.offsetWidth;
  stage.classList.add('on-air');
  previousCutFrame = null;
  if (videoUrl) video.play().catch(() => {});
  updateOperatorState();
}
function resetStage() { stage.classList.remove('on-air'); video.pause(); updateOperatorState(); }

function downloadProject() {
  captureActiveTeam();
  const project = { version: 2, exportedAt: new Date().toISOString(), activeTeam, teams, layers: layerPreferences };
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `lineup-ar-${$('club-name').value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'project'}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 500);
  setTrackingStatus('Project JSON saqlandi', 'ready');
}

function importProject(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = event => {
    try {
      const data = JSON.parse(event.target.result);
      if (!data?.teams?.home || !data?.teams?.away) throw new Error('Noto‘g‘ri project fayli');
      teams = data.teams;
      activeTeam = data.activeTeam === 'away' ? 'away' : 'home';
      const team = teams[activeTeam];
      players = clonePlayers(team.players || makePlayers());
      logoUrl = team.logoUrl || '';
      manualPositions = positionsCopy(team.positions);
      layerPreferences = { ...layerPreferences, ...(data.layers || {}) };
      $('club-name').value = team.club || 'CLUB NAME';
      $('team-color').value = team.teamColor || '#00ad76';
      $('accent-color').value = team.accentColor || '#d8ff43';
      $('sponsor').value = team.sponsor || 'OFFICIAL PARTNER';
      $('formation').value = team.formation || '433';
      saveTeams(); stopTracking(); syncTheme(); renderRosterEditor(); renderCards(); updateTeamTabs(); applyLayerPreferences(); updateOperatorState();
      setTrackingStatus('Project yuklandi', 'ready');
    } catch (error) {
      setTrackingStatus(`Project yuklanmadi: ${error.message}`);
    }
  };
  reader.readAsText(file);
}

function openProgramOutput() {
  if (!stage.classList.contains('on-air')) goOnAir();
  stage.requestFullscreen?.().catch(() => {});
  setTrackingStatus('PROGRAM: OBS Window Capture orqali oling', 'ready');
}

function savePreset() {
  if (manualPositions) localStorage.setItem('lineup-ar-fixed-camera-preset', JSON.stringify(manualPositions));
  captureActiveTeam();
}

function safeBounds(y) {
  const clampedY = Math.max(24, Math.min(92, y));
  const depth = (clampedY - 24) / 68;
  return { y: clampedY, left: 14 - depth * 12, right: 86 + depth * 12 };
}

function withinSafeZone(x, y) {
  const bounds = safeBounds(y);
  return [Math.max(bounds.left, Math.min(bounds.right, x)), bounds.y];
}
function togglePlacementMode() {
  layoutMode = !layoutMode;
  if (layoutMode) {
    stopTracking();
    manualPositions = (manualPositions || formations[$('formation').value]).map(([x, y]) => [x, y]);
    stage.classList.remove('on-air'); stage.classList.add('layout-mode');
    video.pause(); video.controls = Boolean(videoUrl);
    $('position-button').innerHTML = '<span>✓</span> SAQLASH';
    setTrackingStatus('JOYLA: kartani bosib, maydondagi o‘rniga torting', 'ready');
  } else {
    stage.classList.remove('layout-mode'); video.controls = false; savePreset();
    $('position-button').innerHTML = '<span>⌖</span> JOYLASH';
    setTrackingStatus('Fixed-camera preset saqlandi', 'ready');
  }
  renderCards();
  updateOperatorState();
}
function wireCardDragging() {
  document.querySelectorAll('.player-card').forEach((card, index) => {
    card.addEventListener('pointerdown', event => {
      if (!layoutMode) return;
      event.preventDefault();
      card.setPointerCapture(event.pointerId);
      const move = pointer => {
        const rect = stage.getBoundingClientRect();
        const [x, y] = withinSafeZone(
          (pointer.clientX - rect.left) / rect.width * 100,
          (pointer.clientY - rect.top) / rect.height * 100,
        );
        manualPositions[index] = [x, y];
        card.style.setProperty('--base-left', `${x}%`);
        card.style.setProperty('--base-top', `${y}%`);
        card.style.setProperty('--base-scale', (.55 + y / 100 * .72).toFixed(2));
        card.style.setProperty('--lean', ((x - 50) / 50 * 1.4).toFixed(2) + 'deg');
      };
      const end = () => {
        card.removeEventListener('pointermove', move);
        card.removeEventListener('pointerup', end);
        card.removeEventListener('pointercancel', end);
        savePreset();
      };
      card.addEventListener('pointermove', move);
      card.addEventListener('pointerup', end);
      card.addEventListener('pointercancel', end);
    });
  });
}
function monitorCameraCut() {
  if (!stage.classList.contains('on-air') || layoutMode || trackingEnabled || !videoUrl || video.paused) return;
  const canvas = monitorCameraCut.canvas || (monitorCameraCut.canvas = document.createElement('canvas'));
  canvas.width = 80; canvas.height = 45;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  if (previousCutFrame) {
    let delta = 0;
    for (let i = 0; i < pixels.length; i += 16) delta += Math.abs(pixels[i] - previousCutFrame[i]) + Math.abs(pixels[i + 1] - previousCutFrame[i + 1]) + Math.abs(pixels[i + 2] - previousCutFrame[i + 2]);
    const score = delta / ((pixels.length / 16) * 3);
    if (score > 34) {
      stage.classList.remove('on-air');
      $('confidence-label').textContent = 'CAMERA CUT';
      setTrackingStatus('Camera cut: grafik yashirildi', 'working');
      updateOperatorState();
    }
  }
  previousCutFrame = new Uint8ClampedArray(pixels);
}

$('formation').addEventListener('input', () => { stopTracking(); manualPositions = null; localStorage.removeItem('lineup-ar-fixed-camera-preset'); captureActiveTeam(); syncTheme(); renderCards(); updateOperatorState(); });
['club-name','team-color','accent-color','sponsor'].forEach(id => $(id).addEventListener('input', () => { captureActiveTeam(); syncTheme(); renderCards(); updateOperatorState(); }));
$('video-upload').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  stopTracking();
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  uploadedVideoFile = file;
  videoUrl = URL.createObjectURL(file); video.src = videoUrl; video.loop = false; stage.classList.add('has-video');
  $('video-name').textContent = file.name; video.play().catch(() => {});
  setTrackingStatus('Fixed camera: JOYLASH tugmasi bilan preset tuzing', 'ready');
  updateOperatorState();
});
$('logo-upload').addEventListener('change', e => loadImage(e.target.files[0], url => { logoUrl = url; captureActiveTeam(); syncTheme(); }));
$('play-button').addEventListener('click', goOnAir);
$('reset-button').addEventListener('click', resetStage);
$('position-button').addEventListener('click', togglePlacementMode);
$('calibrate-button').addEventListener('click', toggleCalibrationMode);
$('program-button').addEventListener('click', openProgramOutput);
$('export-button').addEventListener('click', downloadProject);
$('import-button').addEventListener('change', e => importProject(e.target.files[0]));
document.querySelectorAll('[data-team]').forEach(button => button.addEventListener('click', () => loadTeam(button.dataset.team)));
document.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click', () => switchPanel(button.dataset.panel)));
$('stats-toggle').addEventListener('change', event => { layerPreferences.stats = event.target.checked; applyLayerPreferences(); });
$('lines-toggle').addEventListener('change', event => { layerPreferences.lines = event.target.checked; applyLayerPreferences(); });
$('broadcast-stage').addEventListener('pointerdown', event => {
  if (!calibrationMode || calibrationAnchors.length >= 4) return;
  event.preventDefault();
  const rect = stage.getBoundingClientRect();
  const x = Math.max(.01, Math.min(.99, (event.clientX - rect.left) / rect.width));
  const y = Math.max(.01, Math.min(.99, (event.clientY - rect.top) / rect.height));
  calibrationAnchors.push([x, y]);
  renderCalibrationMarkers();
  if (calibrationAnchors.length === 4) completeCalibration();
});
$('restore-roster').addEventListener('click', () => { players = makePlayers(); captureActiveTeam(); renderRosterEditor(); renderCards(); updateOperatorState(); });
document.addEventListener('keydown', event => {
  const isEditing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if (isEditing) return;
  if (event.code === 'Space') { event.preventDefault(); goOnAir(); }
  if (event.key === 'Escape') resetStage();
  if (event.key.toLowerCase() === 'j') togglePlacementMode();
  if (['1', '2', '3'].includes(event.key)) switchPanel(['setup', 'squad', 'output'][Number(event.key) - 1]);
});
const initialTeam = teams[activeTeam];
$('club-name').value = initialTeam.club || 'TOSHKENT FC';
$('team-color').value = initialTeam.teamColor || '#00ad76';
$('accent-color').value = initialTeam.accentColor || '#d8ff43';
$('sponsor').value = initialTeam.sponsor || 'OFFICIAL PARTNER';
$('formation').value = initialTeam.formation || '433';
syncTheme(); renderRosterEditor(); renderCards(); updateTeamTabs(); applyLayerPreferences(); updateOperatorState();
setInterval(monitorCameraCut, 350);
