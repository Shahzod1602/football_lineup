const defaults = [
  ['1','MIRZAYEV','GK','4 SEYV · 82% PASS'], ['2','KARIMOV','RB','PACE 88 · 2 TACKLE'], ['5','RAXIMOV','CB','91% PASS · 6 DUEL'],
  ['4','NORMATOV','CB','3 CLEARANCE · 5 DUEL'], ['3','YUSUPOV','LB','1 ASSIST · PACE 84'], ['8','AKBAROV','CM','88% PASS · 7.8 RATE'],
  ['6','USMONOV','DM','5 RECOVERY · 93% PASS'], ['10','TURSUNOV','AM','3 CHANCE · 2 KEY PASS'], ['11','ABDULLAEV','LW','4 DRIBBLE · PACE 91'],
  ['9','SHODIEV','ST','12 GOAL · 4 SHOT'], ['7','SOBIROV','RW','PACE 89 · 2 ASSIST']
];
const formations = {
  '433': [[50,78],[84,64],[62,66],[38,66],[16,64],[72,48],[50,51],[28,48],[22,29],[50,23],[78,29]],
  '4231': [[50,78],[84,64],[62,66],[38,66],[16,64],[65,50],[35,50],[50,38],[22,29],[50,25],[78,29]],
  '442': [[50,78],[84,64],[62,66],[38,66],[16,64],[77,48],[58,48],[42,48],[23,48],[65,27],[35,27]],
  '352': [[50,78],[74,64],[50,66],[26,64],[87,47],[67,48],[50,49],[33,48],[13,47],[64,27],[36,27]]
};
function validLayoutAngle(value) { return [0, 90, 180, 270].includes(Number(value)) ? Number(value) : 90; }
function rotateLayout(points, fromAngle, toAngle) {
  return points.map(([x, y]) => {
    // Horizontal presets fit the wide program frame; player portraits stay upright.
    let u = x, v = y;
    if (fromAngle === 90) { u = 50 + (y - 45) / .7; v = 50 - (x - 50) / 1.2; }
    if (fromAngle === 180) { u = 100 - x; v = 100 - y; }
    if (fromAngle === 270) { u = 50 - (y - 45) / .7; v = 50 + (x - 50) / 1.2; }
    if (toAngle === 90) return [50 + (50 - v) * 1.2, 45 + (u - 50) * .7];
    if (toAngle === 180) return [100 - u, 100 - v];
    if (toAngle === 270) return [50 - (50 - v) * 1.2, 45 - (u - 50) * .7];
    return [u, v];
  });
}
function migrateTeamLayout(team) {
  if (team.layoutAngle == null) {
    if (Array.isArray(team.positions) && team.positions.length === 11) team.positions = rotateLayout(team.positions, 0, 90);
    team.layoutAngle = 90;
  } else team.layoutAngle = validLayoutAngle(team.layoutAngle);
  return team;
}
const makePlayers = () => defaults.map(([number,name,role,stat]) => ({number,name,role,stat,photo:''}));
const clonePlayers = rows => {
  const fallback = makePlayers();
  return fallback.map((player, index) => ({ ...player, ...(rows?.[index] || {}) }));
};
const makeTeam = (club, teamColor, accentColor) => ({
  club, teamColor, accentColor, sponsor: 'OFFICIAL PARTNER', formation: '433', layoutAngle: 90, logoUrl: '', players: makePlayers(), positions: null,
});
const TEAM_STORAGE_KEY = 'lineup-ar-team-presets-v2';
let teams = {
  home: makeTeam('TOSHKENT FC', '#00ad76', '#d8ff43'),
  away: makeTeam('AWAY FC', '#2948a8', '#ffdc45'),
};
const defaultTeams = structuredClone(teams);
let startupWarning = '';
const storageFailures = new Set();
function writeStorage(key, value) {
  try { localStorage.setItem(key, value); storageFailures.delete(key); }
  catch (_) { storageFailures.add(key); }
  showSaveStatus();
  return !storageFailures.has(key);
}
function removeStorage(key) {
  try { localStorage.removeItem(key); storageFailures.delete(key); }
  catch (_) { storageFailures.add(key); }
  showSaveStatus();
}
function showSaveStatus() {
  const label = document.getElementById('save-status');
  if (!label) return;
  label.textContent = storageFailures.size ? 'SAQLANMADI · Xotira to‘lgan yoki yopiq. OUTPUT → EXPORT orqali nusxa oling.' : startupWarning;
}
try {
  const savedTeams = JSON.parse(localStorage.getItem(TEAM_STORAGE_KEY));
  if (savedTeams) { const saved = ProjectData.project({teams:savedTeams}, defaultTeams); teams = {home:migrateTeamLayout(saved.teams.home),away:migrateTeamLayout(saved.teams.away)}; }
} catch (_) { startupWarning = 'Saqlangan loyiha o‘qilmadi. Standart tarkib ochildi; to‘g‘ri project faylini LOAD orqali yuklang.'; }
let activeTeam = 'home';
let players = clonePlayers(teams.home.players || makePlayers());
let logoUrl = teams.home.logoUrl || '';
let videoUrl = '';
let liveStream = null;
let liveSourceName = '';
let sourceRequest = 0;
let sourcePending = false;
let trackingRequest = null;
let liveTrackingSession = null;
let liveCalibrationFrame = null;
let livePose = null;
let calibrationRevision = 0;
let trackingFrames = [];
let trackingLoopStarted = false;
let trackingEnabled = false;
let layoutMode = false;
let manualPositions = teams.home.positions || null;
let layoutAngle = teams.home.layoutAngle;
let autoLayout = teams.home.autoLayout?.slots?.length === 11 ? { slots: teams.home.autoLayout.slots, matrix: null } : null;
let autoNeedsCalibration = Boolean(autoLayout);
let autoMappingMode = false;
let autoFitBlocked = false;
let previousCutFrame = null;
let uploadedVideoFile = null;
let calibrationMode = false;
let calibrationAnchors = [];
let trackingReferencePositions = null;
let layerPreferences = { stats: true, lines: true };
try {
  layerPreferences = { ...layerPreferences, ...ProjectData.layers(JSON.parse(localStorage.getItem('lineup-ar-layers-v1') || '{}')) };
} catch (_) { startupWarning ||= 'Saqlangan sozlamalar o‘qilmadi.'; }
let storedPreset;
try { storedPreset = localStorage.getItem('lineup-ar-fixed-camera-preset'); } catch (_) {}
if (storedPreset) {
  try {
    const parsed = JSON.parse(storedPreset);
    if (!manualPositions) {
      if (Array.isArray(parsed) && parsed.length === 11) manualPositions = rotateLayout(ProjectData.points(parsed,-100,200), 0, layoutAngle);
      else if (Array.isArray(parsed?.positions) && parsed.positions.length === 11) manualPositions = rotateLayout(ProjectData.points(parsed.positions,-100,200), validLayoutAngle(parsed.layoutAngle), layoutAngle);
    }
  } catch (_) { startupWarning ||= 'Saqlangan joylashuv o‘qilmadi.'; }
}

const $ = id => document.getElementById(id);
const stage = $('broadcast-stage');
const video = $('stadium-video');
const cardBox = $('lineup-cards');

function hasVideoSource() { return Boolean(videoUrl || liveStream); }
function sourceStatus(message) { $('source-status').textContent = message; }
async function refreshCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
    const selected = $('camera-select').value;
    $('camera-select').replaceChildren(new Option('Standart kamera', ''), ...cameras.map((device, i) => new Option(device.label || `Kamera ${i + 1}`, device.deviceId)));
    if (cameras.some(device => device.deviceId === selected)) $('camera-select').value = selected;
  } catch (_) { /* The default camera remains available before permission. */ }
}
function releaseSource() {
  stopTracking();
  if (autoLayout) autoNeedsCalibration = true;
  stage.classList.remove('auto-preview');
  calibrationMode = false; layoutMode = false; calibrationAnchors = [];
  stage.classList.remove('on-air', 'layout-mode', 'calibration-mode', 'calibration-2', 'calibration-3', 'calibration-4', 'has-video');
  $('calibration-points').replaceChildren();
  $('position-button').innerHTML = '<span>⌖</span> JOYLASH';
  $('calibrate-button').innerHTML = '<span>◇</span> 4 NUQTA';
  const oldStream = liveStream;
  liveStream = null; liveSourceName = '';
  oldStream?.getTracks().forEach(track => track.stop());
  video.pause(); video.srcObject = null; video.removeAttribute('src'); video.load(); video.controls = false;
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = ''; uploadedVideoFile = null; previousCutFrame = null;
  $('video-upload').value = '';
  $('video-name').textContent = 'Demo pitch ishlatilmoqda';
}
function disconnectSource(message = 'Jonli manba uzildi.') {
  sourceRequest++; sourcePending = false;
  releaseSource(); sourceStatus(message); setTrackingStatus('Video manbasini ulang'); updateOperatorState();
}
async function startLiveSource(kind) {
  const method = kind === 'screen' ? 'getDisplayMedia' : 'getUserMedia';
  if (!navigator.mediaDevices?.[method]) {
    sourceStatus('Jonli manba uchun localhost yoki HTTPS va mos brauzer kerak.');
    return;
  }
  const request = ++sourceRequest;
  sourcePending = true; updateOperatorState(); sourceStatus('Brauzerda video manbasini tanlang va ruxsat bering…');
  let stream;
  try {
    const deviceId = $('camera-select').value;
    stream = kind === 'screen'
      ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      : await navigator.mediaDevices.getUserMedia({ video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }), width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: false });
    if (request !== sourceRequest) { stream.getTracks().forEach(track => track.stop()); return; }
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') throw new Error('Video manbasi faol emas.');
    releaseSource();
    liveStream = stream; liveSourceName = track.label || (kind === 'screen' ? 'Efir oynasi' : 'Kamera');
    video.srcObject = stream; video.loop = false;
    track.addEventListener('ended', () => {
      if (liveStream === stream) disconnectSource('Jonli manba to‘xtadi. Qayta ulaning.');
    });
    await video.play();
    if (request !== sourceRequest) return;
    stage.classList.add('has-video');
    $('video-name').textContent = liveSourceName;
    sourceStatus(`LIVE · ${liveSourceName}`);
    setTrackingStatus('Jonli manba: JOYLASH → 4 NUQTA → TAKE ON AIR', 'ready');
    refreshCameras();
  } catch (error) {
    stream?.getTracks().forEach(track => track.stop());
    if (request !== sourceRequest) return;
    if (liveStream === stream) releaseSource();
    const messages = {
      NotAllowedError: 'Ruxsat berilmadi yoki tanlash bekor qilindi.',
      NotFoundError: 'Kamera topilmadi. Kamera yoki OBS Virtual Camera’ni ulang.',
      NotReadableError: 'Kamera ochilmadi. Boshqa dastur band qilmaganini tekshiring.',
      OverconstrainedError: 'Tanlangan kamera mavjud emas. Boshqa kamerani tanlang.',
    };
    sourceStatus(messages[error.name] || `Jonli manba ochilmadi: ${error.message}`);
  } finally {
    if (request === sourceRequest) { sourcePending = false; updateOperatorState(); }
  }
}

function updatePitchHint() {
  const end = $('pitch-region').value === 'half' ? 'Markaz chizig‘i' : 'Raqib darvozasi chizig‘i';
  $('pitch-map-end').textContent = $('pitch-region').value === 'half' ? 'MARKAZ' : 'RAQIB';
  const labels = ['O‘z darvozasi chizig‘i × CHAP yon chiziq', `${end} × CHAP yon chiziq`, `${end} × O‘NG yon chiziq`, 'O‘z darvozasi chizig‘i × O‘NG yon chiziq'];
  const index = Math.min(calibrationAnchors.length, 3);
  const hint = autoMappingMode ? `${index + 1}/4 · ${labels[index]}` : 'Chap/o‘ng — o‘z darvozangizdan hujum tomonga qaraganda. Videoda sxemadagi nuqtalarni belgilang.';
  $('pitch-point-hint').textContent = hint;
  stage.dataset.calibrationHint = hint;
  document.querySelectorAll('[data-pitch-point]').forEach((point,i) => {
    point.classList.toggle('is-next', autoMappingMode && i === index);
    point.classList.toggle('is-done', autoMappingMode && i < calibrationAnchors.length);
  });
}
function resetAutoLayout() {
  autoLayout = null; autoNeedsCalibration = false; autoFitBlocked = false;
  stage.classList.remove('auto-layout', 'auto-preview', 'auto-blocked', 'auto-unverified');
  delete stage.dataset.autoMode;
  $('auto-layout-status').textContent = 'Formation tanlang, keyin AUTO JOYLASH ni bosing.';
  $('auto-role-warning').textContent = '';
}
function loadAutoPreset(team) {
  resetAutoLayout();
  const slots = team.autoLayout?.slots;
  if (Array.isArray(slots) && slots.length === 11 && slots.every(slot => typeof slot.role === 'string' && Array.isArray(slot.point) && slot.point.length === 2 && slot.point.every(v=>Number.isFinite(v) && v>=0 && v<=1))) {
    autoLayout = {slots, matrix:null}; autoNeedsCalibration = true;
  }
}
function startAutoPlacement() {
  if (!hasVideoSource() || video.readyState < 2) { $('auto-layout-status').textContent = 'Avval videoni ulang va maydonning keng planini oching.'; return; }
  if (calibrationMode) stopTracking();
  if (autoLayout) autoNeedsCalibration = true;
  stage.classList.remove('auto-preview');
  toggleCalibrationMode(true);
  if (!calibrationMode) return;
  autoMappingMode = true;
  stage.classList.add('auto-calibration');
  $('auto-layout-status').textContent = 'Muzlatilgan kadrda sxemadagi 1–2–3–4 nuqtalarni belgilang.';
  updatePitchHint(); updateOperatorState();
}
function fitAutoCards(points, trackingMatrix = null) {
  if (!autoLayout) return;
  const rect = stage.getBoundingClientRect();
  const matrix = autoLayout.matrix && trackingMatrix ? SmartLayout.multiply(trackingMatrix, autoLayout.matrix) : autoLayout.matrix;
  const depths = matrix ? SmartLayout.depthFactors(autoLayout.slots, matrix) : Array(11).fill(1);
  const fit = SmartLayout.fitCards(points, depths, rect.width, rect.height, layerPreferences.stats);
  autoFitBlocked = fit.mode === 'blocked';
  stage.classList.toggle('auto-layout', true);
  stage.classList.toggle('auto-blocked', autoFitBlocked);
  stage.dataset.autoMode = fit.mode;
  const cards = [...cardBox.children];
  fit.boxes.forEach((box,i) => {
    cards[i].style.setProperty('--auto-width', `${box.width}px`);
    cards[i].style.setProperty('--auto-height', `${box.height}px`);
    cards[i].style.setProperty('--auto-name-size', `${Math.max(11,Math.min(16,box.width*.15))}px`);
    cards[i].style.zIndex = String(Math.round(points[i][1]*1000));
    cards[i].title = `${players[i].number} · ${players[i].name} · ${autoLayout.slots[i].role}`;
  });
  const labels = {full:'11 karta joylashdi · statistika bilan', 'no-stats':'11 karta joylashdi · statistikasiz', compact:'Ixcham kartalar · raqam va ism saqlandi', blocked:'Kartalar o‘qiladigan hajmda sig‘mayapti. Kengroq plan kerak.'};
  $('auto-layout-status').textContent = autoNeedsCalibration ? 'Saqlangan joylashuv. Yangi video uchun AUTO JOYLASH bilan maydonni qayta belgilang.' : labels[fit.mode];
  const mismatches = autoLayout.slots.flatMap((slot,i) => SmartLayout.roleCost(players[i].role,slot.role)>=3 ? [`${players[i].name}: ${players[i].role} → ${slot.role}`] : []);
  $('auto-role-warning').textContent = mismatches.length ? `Pozitsiyalarni tekshiring: ${mismatches.join('; ')}. SQUAD yoki formation’ni moslab, AUTO JOYLASH’ni qaytaring.` : '';
  $('play-button').disabled = autoNeedsCalibration || autoFitBlocked;
  $('auto-preview-button').disabled = autoNeedsCalibration || autoFitBlocked;
}
function exitAutoToManual() {
  const state = trackingEnabled ? (liveStream ? livePose : interpolateTracking(video.currentTime)) : null;
  const reference = trackingReferencePositions || manualPositions || formationPositions();
  const points = state?.h ? reference.map(p=>projectHomography(p,state.h)?.map(v=>v*100) || p) : reference;
  const rect = stage.getBoundingClientRect();
  manualPositions = points.map(([x,y],i) => [x, y - (parseFloat(cardBox.children[i]?.style.getPropertyValue('--auto-height')) || 80)/rect.height*100]);
  stopTracking(); resetAutoLayout(); syncTheme();
}
function positionsCopy(positions) {
  return Array.isArray(positions) && positions.length === 11 ? positions.map(([x, y]) => [x, y]) : null;
}
function formationPositions() { return rotateLayout(formations[$('formation').value], 0, layoutAngle); }
function saveTeams() {
  return writeStorage(TEAM_STORAGE_KEY, JSON.stringify(teams));
}
function captureActiveTeam() {
  teams[activeTeam] = {
    club: $('club-name').value,
    teamColor: $('team-color').value,
    accentColor: $('accent-color').value,
    sponsor: $('sponsor').value,
    formation: $('formation').value,
    layoutAngle,
    logoUrl,
    players: clonePlayers(players),
    positions: positionsCopy(manualPositions),
    autoLayout: autoLayout ? { slots: autoLayout.slots } : null,
  };
  return saveTeams();
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
  loadAutoPreset(team);
  layoutAngle = team.layoutAngle;
  $('layout-angle').value = String(layoutAngle);
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
  stage.classList.toggle('auto-layout', Boolean(autoLayout));
  const sideways = layoutAngle === 90 || layoutAngle === 270;
  stage.classList.toggle('sideways-layout', sideways);
  $('safe-zone').querySelector('polygon').setAttribute('points', sideways ? '80,78 920,78 920,404 80,404' : '145,138 855,138 982,520 18,520');
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
    players[e.target.dataset.i][e.target.dataset.key] = e.target.value.toUpperCase();
    if (autoLayout && e.target.dataset.key === 'role') { autoNeedsCalibration = true; stopTracking(); }
    captureActiveTeam(); renderCards(); updateOperatorState();
  }));
  document.querySelectorAll('[data-photo]').forEach(input => input.addEventListener('change', e => { const targetPlayers = players, index = e.target.dataset.photo; loadImage(e.target.files[0], url => {
    if (players !== targetPlayers) return;
    players[index].photo = url; captureActiveTeam(); renderRosterEditor(); renderCards();
  }); }));
}
function renderCards() {
  const points = manualPositions || formationPositions();
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
    <div class="card-stats">${esc(autoLayout?.slots[i]?.role || p.role)} · ${esc(p.stat)}</div>
  </article>`;
  }).join('');
  const links = tacticalLinks();
  $('tactic-lines').innerHTML = links.map(([a,b]) => `<line data-a="${a}" data-b="${b}" />`).join('');
  updateTacticalLines(points.map(p=>p.map(v=>v/100)));
  if (layoutMode) wireCardDragging();
  if (trackingEnabled) applyTracking(video.currentTime);
  else if (autoLayout) fitAutoCards(points.map(p => p.map(v => v / 100)));
}
function tacticalLinks() {
  let slots;
  try { slots = autoLayout?.slots || SmartLayout.assignPlayers(players, $('formation').value); }
  catch (_) { return []; }
  // Connect nearby tactical neighbours, independent of roster row order.
  const edges = new Set();
  slots.forEach((slot,i) => {
    const neighbours = slots.map((s,j)=>({j,d:Math.hypot(s.point[0]-slot.point[0],s.point[1]-slot.point[1])})).filter(s=>s.j!==i).sort((a,b)=>a.d-b.d).slice(0,2);
    neighbours.forEach(({j})=>edges.add([Math.min(i,j),Math.max(i,j)].join(',')));
  });
  return [...edges].map(e=>e.split(',').map(Number));
}
function updateTacticalLines(points) {
  $('tactic-lines').querySelectorAll('line').forEach(line=>{
    const a=points[Number(line.dataset.a)], b=points[Number(line.dataset.b)];
    const visible=a&&b&&[...a,...b].every(Number.isFinite);
    line.style.display=visible?'':'none';
    if(!visible)return;
    for(const [key,value] of Object.entries({x1:a[0]*1000,y1:a[1]*560,x2:b[0]*1000,y2:b[1]*560}))line.setAttribute(key,value);
  });
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
  writeStorage('lineup-ar-layers-v1', JSON.stringify(layerPreferences));
}
function updateOperatorState() {
  stage.classList.toggle('auto-unverified', Boolean(autoLayout) && autoNeedsCalibration);
  const videoReady = hasVideoSource();
  const isLive = Boolean(liveStream);
  const pose = isLive ? livePose : interpolateTracking(video.currentTime);
  const trackingLocked = trackingEnabled && Boolean(pose && pose.confidence >= .38);
  const lineupReady = players.filter(player => String(player.name || '').trim() && String(player.number || '').trim()).length;
  const anchorReady = autoLayout && (autoNeedsCalibration || autoFitBlocked) ? false : trackingEnabled ? trackingLocked : Boolean(manualPositions) || !videoReady;
  const onAir = stage.classList.contains('on-air');
  const mode = calibrationMode ? 'CALIBRATING' : layoutMode ? 'LAYOUT MODE' : onAir ? 'ON AIR' : 'PREVIEW';

  $('live-state-label').textContent = mode;
  $('live-status').classList.toggle('is-live', onAir);
  $('live-status').classList.toggle('is-tool', calibrationMode || layoutMode);
  $('stage-mode-badge').querySelector('span').textContent = onAir ? 'PROGRAM LIVE' : calibrationMode ? 'CALIBRATING' : layoutMode ? 'POSITIONING' : 'REHEARSAL';
  $('play-button').classList.toggle('is-live', onAir);
  $('play-button').innerHTML = onAir ? '<span>↻</span> REPLAY GRAPHIC' : '<span>▶</span> TAKE ON AIR';

  $('camera-start').disabled = sourcePending;
  $('auto-place-button').disabled = !videoReady || sourcePending;
  $('auto-preview-button').disabled = !autoLayout || autoNeedsCalibration || autoFitBlocked;
  $('layout-angle').disabled = Boolean(autoLayout) || autoMappingMode;
  $('play-button').disabled = calibrationMode || Boolean(trackingRequest) || (trackingEnabled && !trackingLocked) || (Boolean(autoLayout) && (autoNeedsCalibration || autoFitBlocked));
  $('screen-start').disabled = sourcePending;
  $('source-stop').disabled = !videoReady && !sourcePending;
  $('calibrate-button').disabled = !videoReady || sourcePending;
  $('calibrate-button').title = 'Maydondagi 4 ta yoyilgan oq chiziq kesishmasini tanlang';
  $('video-drop').classList.toggle('is-loaded', Boolean(videoUrl));
  $('video-source-badge').classList.toggle('is-ready', videoReady);
  $('video-source-badge').textContent = isLive ? 'LIVE INPUT' : videoReady ? 'INPUT READY' : 'NO INPUT';
  $('upload-title').textContent = uploadedVideoFile?.name || 'Stadion videosini yuklang';
  $('footer-source').textContent = isLive ? 'LIVE INPUT' : videoReady ? 'VIDEO INPUT' : 'DEMO INPUT';

  $('workflow-video').classList.toggle('is-ready', videoReady);
  $('workflow-video-copy').textContent = isLive ? 'Jonli manba ulangan' : videoReady ? 'Local video ready' : 'Demo pitch';
  $('workflow-team').classList.toggle('is-ready', lineupReady === 11);
  $('workflow-team-copy').textContent = `${activeTeam === 'home' ? 'Home' : 'Away'} · ${lineupReady} players`;
  $('workflow-anchor').classList.toggle('is-ready', anchorReady);
  $('workflow-anchor-copy').textContent = autoLayout && autoNeedsCalibration ? 'AUTO JOYLASH bilan qayta belgilang' : autoLayout && autoFitBlocked ? 'Kengroq plan kerak' : trackingEnabled ? trackingLocked ? 'Tracking locked' : 'Tracking kutilmoqda / lost' : manualPositions ? 'Custom fixed preset' : videoReady ? 'Position or calibrate' : 'Formation preset';

  $('ready-video').classList.toggle('is-ready', videoReady);
  $('ready-video').querySelector('b').textContent = videoReady ? 'READY' : 'DEMO';
  $('ready-squad').classList.toggle('is-ready', lineupReady === 11);
  $('ready-squad').querySelector('b').textContent = `${lineupReady} / 11`;
  $('ready-anchor').classList.toggle('is-ready', anchorReady);
  $('ready-anchor').querySelector('b').textContent = autoLayout && autoNeedsCalibration ? 'REMAP' : autoLayout && autoFitBlocked ? 'WIDE VIEW' : trackingEnabled ? trackingLocked ? 'TRACKED' : 'NOT LOCKED' : manualPositions ? 'FIXED' : videoReady ? 'OPTIONAL' : 'FORMATION';
  $('readiness-score').textContent = `${Number(videoReady) + Number(lineupReady === 11) + Number(anchorReady)} / 3`;
}
function loadImage(file, onDone) {
  if (!file) return;
  if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) { setTrackingStatus('20 MB gacha bo‘lgan suratni tanlang.'); return; }
  const image = new Image(), url = URL.createObjectURL(file);
  image.onload = () => {
    try {
      const scale = Math.min(1,512 / Math.max(image.naturalWidth,image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1,Math.round(image.naturalWidth*scale)); canvas.height = Math.max(1,Math.round(image.naturalHeight*scale));
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
      onDone(canvas.toDataURL('image/webp', .85));
    } catch (_) { setTrackingStatus('Suratni o‘qib bo‘lmadi.'); }
    finally { URL.revokeObjectURL(url); }
  };
  image.onerror = () => { URL.revokeObjectURL(url); setTrackingStatus('Suratni o‘qib bo‘lmadi.'); };
  image.src = url;
}
function lerp(a, b, t) { return a + (b - a) * t; }
function interpolateTracking(time) {
  if (!trackingFrames.length || time < trackingFrames[0].t - .12 || time > trackingFrames.at(-1).t + .12) return null;
  let low = 0, high = trackingFrames.length - 1;
  while (low < high) { const mid = Math.floor((low + high) / 2); if (trackingFrames[mid].t < time) low = mid + 1; else high = mid; }
  const next = trackingFrames[low], previous = trackingFrames[Math.max(0, low - 1)];
  const blend = next.t === previous.t ? 0 : Math.max(0, Math.min(1, (time - previous.t) / (next.t - previous.t)));
  return {
    h: previous.h.map((value, i) => lerp(value, next.h[i], blend)),
    confidence: (previous.lost || (next.lost && time >= next.t)) ? 0 : previous.confidence,
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
  const state = liveStream ? livePose : interpolateTracking(time);
  const points = trackingReferencePositions || manualPositions || formationPositions();
  const lost = !state || state.confidence < 0.38;
  const wasLost = stage.classList.contains('track-lost');
  stage.classList.toggle('track-lost', lost);
  document.querySelectorAll('.player-card').forEach((card, i) => {
    const projected = state && projectHomography(points[i], state.h);
    const [x, y] = projected || [0, 0];
    const depth = .68 + points[i][1] / 100 * .52;
    card.style.setProperty('--track-left', `${(x * 100).toFixed(3)}%`);
    card.style.setProperty('--track-top', `${(y * 100).toFixed(3)}%`);
    card.style.setProperty('--card-scale', depth.toFixed(3));
    card.classList.toggle('is-lost', lost || !projected || x < -.1 || x > 1.1 || y < -.1 || y > 1.1);
  });
  updateTacticalLines(points.map(p => state && projectHomography(p,state.h)));
  $('confidence-label').textContent = lost ? 'TRACK LOST' : `TRACK ${(state.confidence * 100).toFixed(0)}%`;
  if (autoLayout && !lost) fitAutoCards(points.map(p => projectHomography(p, state.h)), state.h);
  if (!liveStream && wasLost !== lost) {
    setTrackingStatus(lost ? 'Tracking yo‘qoldi. Maydonni qayta belgilang.' : 'Maydonga biriktirildi', lost ? 'working' : 'ready');
    updateOperatorState();
  }
}
function trackVideoFrame() {
  applyTracking(video.currentTime);
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(trackVideoFrame);
  else requestAnimationFrame(trackVideoFrame);
}
async function analysePitch(file, anchors, startTime) {
  trackingRequest?.abort();
  const request = new AbortController();
  trackingRequest = request;
  setTrackingStatus('Maydon harakati hisoblanmoqda…', 'working');
  trackingFrames = []; stage.classList.remove('tracked');
  const geometry = VideoGeometry.cover(video.videoWidth, video.videoHeight);
  const data = new FormData(); data.append('video', file); data.append('anchors', JSON.stringify(anchors.map(geometry.toSource))); data.append('start_time', String(startTime));
  try {
    const response = await fetch('/api/track', { method: 'POST', body: data, signal: request.signal });
    const result = await response.json();
    if (request.signal.aborted) return;
    if (!response.ok) throw new Error(result.detail || 'Tracking xatosi');
    trackingFrames = result.frames.map(frame => ({...frame, h: geometry.toStageHomography(frame.h)}));
    trackingEnabled = true;
    stage.classList.add('tracked');
    setTrackingStatus(`Maydonga biriktirildi: ${trackingFrames.length} kadr`, 'ready');
    $('confidence-label').textContent = 'TRACK READY';
    if (!trackingLoopStarted) { trackingLoopStarted = true; trackVideoFrame(); }
  } catch (error) {
    if (request.signal.aborted) return;
    trackingEnabled = false;
    if (autoLayout) { autoNeedsCalibration = true; stage.classList.remove('auto-preview'); }
    setTrackingStatus(`Tracking: ${error.message}`);
  }
  if (trackingRequest === request) trackingRequest = null;
  updateOperatorState();
}
function renderCalibrationMarkers() {
  $('calibration-points').innerHTML = calibrationAnchors.map(([x, y], i) =>
    `<span class="calibration-point" style="left:${x * 100}%;top:${y * 100}%">${i + 1}</span>`
  ).join('');
  stage.classList.remove('calibration-2', 'calibration-3', 'calibration-4');
  if (calibrationAnchors.length > 1) stage.classList.add(`calibration-${Math.min(4, calibrationAnchors.length)}`);
  updatePitchHint();
}
function stopTracking() {
  stage.classList.remove('on-air', 'auto-preview');
  if (autoLayout) autoNeedsCalibration = true;
  setTrackingStatus('Tracking to‘xtadi. Maydonni qayta belgilang.');
  calibrationRevision++;
  liveTrackingSession?.stop(); liveTrackingSession = null;
  livePose = null; liveCalibrationFrame = null;
  clearCalibrationUI();
  stage.classList.remove('live-frame');
  trackingRequest?.abort(); trackingRequest = null;
  trackingEnabled = false;
  trackingFrames = [];
  trackingReferencePositions = null;
  stage.classList.remove('tracked', 'track-lost');
  $('confidence-label').textContent = '';
}
function clearCalibrationUI() {
  autoMappingMode = false;
  stage.classList.remove('auto-calibration');
  calibrationMode = false;
  stage.classList.remove('calibration-mode', 'calibration-2', 'calibration-3', 'calibration-4');
  $('calibration-points').replaceChildren();
  $('calibrate-button').innerHTML = '<span>◇</span> 4 NUQTA';
  video.controls = false;
  updatePitchHint();
}
function toggleCalibrationMode(forAuto = false) {
  if (autoLayout && !forAuto && !calibrationMode) { startAutoPlacement(); return; }
  if (calibrationMode) {
    stopTracking();
    setTrackingStatus('Kalibrovka bekor qilindi');
    updateOperatorState();
    return;
  }
  if (!hasVideoSource() || video.readyState < 2) {
    setTrackingStatus('Avval videoni ulang va kadr paydo bo‘lishini kuting');
    return;
  }
  if (layoutMode) togglePlacementMode();
  stopTracking();
  if (liveStream) {
    try {
      const rect = stage.getBoundingClientRect();
      liveCalibrationFrame = captureLiveFrame(video, rect.width / rect.height);
      showLiveFrame(liveCalibrationFrame, $('live-tracking-frame'));
      stage.classList.add('live-frame');
    } catch (error) { setTrackingStatus(error.message); return; }
  } else {
    video.pause(); video.controls = !forAuto;
  }
  calibrationMode = true;
  calibrationAnchors = [];
  renderCalibrationMarkers();
  stage.classList.remove('on-air');
  stage.classList.add('calibration-mode');
  $('calibrate-button').innerHTML = '<span>×</span> BEKOR';
  setTrackingStatus(liveStream ? 'Kadr muzlatildi. Maydon bo‘ylab 4 ta oq chiziq kesishmasini bosing' : '4 ta oq chiziq kesishmasini bosing', 'working');
  updateOperatorState();
}
async function completeCalibration() {
  const revision = calibrationRevision;
  if (autoMappingMode) {
    try {
      const plan = SmartLayout.plan(calibrationAnchors, players, $('formation').value);
      const rect = stage.getBoundingClientRect();
      const fit = SmartLayout.fitCards(plan.positions.map(p=>p.map(v=>v/100)), SmartLayout.depthFactors(plan.slots, plan.matrix), rect.width, rect.height, layerPreferences.stats);
      if (fit.mode === 'blocked') throw new Error('11 karta o‘qiladigan hajmda sig‘mayapti. BEKOR ni bosib, kengroq planda qayta belgilang.');
      autoLayout = { slots: plan.slots, matrix: plan.matrix };
      autoNeedsCalibration = false;
      manualPositions = plan.positions;
      stage.classList.add('auto-layout', 'auto-preview');
      captureActiveTeam(); renderCards();
    } catch (error) {
      calibrationAnchors = []; renderCalibrationMarkers();
      $('auto-layout-status').textContent = error.message;
      setTrackingStatus(error.message, 'working');
      return;
    }
  }
  calibrationMode = false;
  stage.classList.remove('calibration-2', 'calibration-3');
  stage.classList.add('calibration-mode', 'calibration-4');
  video.controls = false;
  $('calibrate-button').innerHTML = '<span>◇</span> 4 NUQTA';
  trackingReferencePositions = (manualPositions || formationPositions()).map(([x, y]) => [x, y]);
  if (liveStream) {
    trackingEnabled = true;
    stage.classList.add('tracked');
    const session = new LivePitchSession({
      video, reference: liveCalibrationFrame,
      onFrame(frame, pose) {
        if (liveTrackingSession !== session) return;
        livePose = pose;
        showLiveFrame(frame, $('live-tracking-frame'));
        stage.classList.add('live-frame');
        applyTracking(video.currentTime);
        setTrackingStatus(`LIVE TRACK · ${Math.round(pose.fps)} FPS · ${Math.round(pose.latency)} ms · ${Math.round(pose.confidence * 100)}%`, 'ready');
        updateOperatorState();
      },
      onFailure(message) {
        if (liveTrackingSession !== session) return;
        if (autoLayout) autoNeedsCalibration = true;
        livePose = null;
        stage.classList.remove('live-frame');
        applyTracking(video.currentTime);
        setTrackingStatus(message, 'working');
        updateOperatorState();
      },
    });
    liveTrackingSession = session;
    liveCalibrationFrame = null;
    session.start(calibrationAnchors);
    applyTracking(video.currentTime);
    setTrackingStatus('Jonli tracking ulanmoqda…', 'working');
  } else {
    await analysePitch(uploadedVideoFile, calibrationAnchors, video.currentTime);
  }
  if (revision !== calibrationRevision) return;
  clearCalibrationUI();
  updateOperatorState();
}
function goOnAir() {
  if (autoLayout && (autoNeedsCalibration || autoFitBlocked)) { $('auto-layout-status').textContent = 'AUTO JOYLASH orqali maydonni qayta belgilang yoki kengroq planni tanlang.'; return false; }
  if (calibrationMode || trackingRequest || (trackingEnabled && !(liveStream ? livePose : interpolateTracking(video.currentTime))?.confidence)) { setTrackingStatus('Tracking tayyor bo‘lishini kuting yoki qayta kalibrovka qiling.'); return false; }
  if (trackingEnabled && (liveStream ? livePose : interpolateTracking(video.currentTime)).confidence < .38) { setTrackingStatus('Tracking yo‘qoldi. Qayta kalibrovka qiling.'); return false; }
  if (layoutMode) togglePlacementMode();
  syncTheme(); renderCards();
  stage.classList.remove('on-air', 'auto-preview');
  void stage.offsetWidth;
  stage.classList.add('on-air');
  applyTracking(video.currentTime);
  previousCutFrame = null;
  if (hasVideoSource()) video.play().catch(() => {});
  updateOperatorState();
  return true;
}
function resetStage() { stage.classList.remove('on-air', 'auto-preview'); if (!liveStream) video.pause(); updateOperatorState(); }

function downloadProject() {
  captureActiveTeam();
  const project = { version: 3, exportedAt: new Date().toISOString(), activeTeam, teams, layers: layerPreferences };
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
  if (file.size > 32 * 1024 * 1024) { setTrackingStatus('Project fayli 32 MB dan oshmasin.'); return; }
  const revision = ++importProject.revision;
  const reader = new FileReader();
  reader.onload = event => {
    if (revision !== importProject.revision) return;
    try {
      const data = ProjectData.project(JSON.parse(event.target.result), defaultTeams);
      stopTracking();
      startupWarning = '';
      teams = { home: migrateTeamLayout(data.teams.home), away: migrateTeamLayout(data.teams.away) };
      activeTeam = data.activeTeam === 'away' ? 'away' : 'home';
      const team = teams[activeTeam];
      players = clonePlayers(team.players || makePlayers());
      logoUrl = team.logoUrl || '';
      manualPositions = positionsCopy(team.positions);
      loadAutoPreset(team);
      layoutAngle = team.layoutAngle;
      $('layout-angle').value = String(layoutAngle);
      layerPreferences = { ...layerPreferences, ...(data.layers || {}) };
      $('club-name').value = team.club || 'CLUB NAME';
      $('team-color').value = team.teamColor || '#00ad76';
      $('accent-color').value = team.accentColor || '#d8ff43';
      $('sponsor').value = team.sponsor || 'OFFICIAL PARTNER';
      $('formation').value = team.formation || '433';
      saveTeams(); syncTheme(); renderRosterEditor(); renderCards(); updateTeamTabs(); applyLayerPreferences(); updateOperatorState();
      setTrackingStatus('Project yuklandi', 'ready');
    } catch (error) {
      setTrackingStatus(`Project yuklanmadi: ${error.message}`);
    }
  };
  reader.onerror = () => setTrackingStatus('Project faylini o‘qib bo‘lmadi.');
  reader.readAsText(file);
}
importProject.revision = 0;

async function openProgramOutput() {
  try {
    await $('program-output').requestFullscreen();
    if (autoLayout) {
      if (trackingEnabled) applyTracking(video.currentTime);
      else fitAutoCards((manualPositions || formationPositions()).map(p=>p.map(v=>v/100)));
    }
    if (!stage.classList.contains('on-air') && !goOnAir()) return;
    setTrackingStatus('PROGRAM: OBS Window Capture orqali oling', 'ready');
  } catch (_) { setTrackingStatus('Fullscreen ochilmadi.'); }
}

function savePreset() {
  if (manualPositions) writeStorage('lineup-ar-fixed-camera-preset', JSON.stringify({ layoutAngle, positions: manualPositions }));
  captureActiveTeam();
}

function safeBounds(y) {
  if (layoutAngle === 90 || layoutAngle === 270) return { y: Math.max(14, Math.min(72, y)), left: 8, right: 92 };
  const clampedY = Math.max(24, Math.min(92, y));
  const depth = (clampedY - 24) / 68;
  return { y: clampedY, left: 14 - depth * 12, right: 86 + depth * 12 };
}

function withinSafeZone(x, y) {
  const bounds = safeBounds(y);
  return [Math.max(bounds.left, Math.min(bounds.right, x)), bounds.y];
}
function togglePlacementMode() {
  if (autoLayout) exitAutoToManual();
  if (calibrationMode) toggleCalibrationMode();
  layoutMode = !layoutMode;
  if (layoutMode) {
    stopTracking();
    manualPositions = (manualPositions || formationPositions()).map(([x, y]) => [x, y]);
    stage.classList.remove('on-air'); stage.classList.add('layout-mode');
    if (!liveStream) video.pause(); video.controls = Boolean(videoUrl);
    $('position-button').innerHTML = '<span>✓</span> SAQLASH';
    setTrackingStatus('JOYLA: kartani bosib, maydondagi o‘rniga torting', 'ready');
  } else {
    stage.classList.remove('layout-mode'); video.controls = false; savePreset();
    $('position-button').innerHTML = '<span>⌖</span> JOYLASH';
    setTrackingStatus(storageFailures.size ? 'Joylashuv hali saqlanmadi. EXPORT orqali nusxa oling.' : 'Fixed-camera preset saqlandi', 'ready');
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
        updateTacticalLines(manualPositions.map(p=>p.map(v=>v/100)));
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
  if (!stage.classList.contains('on-air') || layoutMode || trackingEnabled || !hasVideoSource() || video.paused || video.readyState < 2) return;
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

$('formation').addEventListener('input', () => { stopTracking(); resetAutoLayout(); manualPositions = layoutMode ? formationPositions() : null; removeStorage('lineup-ar-fixed-camera-preset'); captureActiveTeam(); syncTheme(); renderCards(); updateOperatorState(); });
$('layout-angle').addEventListener('change', () => {
  const nextAngle = validLayoutAngle($('layout-angle').value);
  stopTracking();
  if (manualPositions) manualPositions = rotateLayout(manualPositions, layoutAngle, nextAngle);
  layoutAngle = nextAngle;
  savePreset(); syncTheme(); renderCards(); updateOperatorState();
  setTrackingStatus(`Tarkib ${layoutAngle}° ga o‘zgardi. Tracking uchun 4 NUQTA bilan qayta belgilang.`, 'ready');
});
$('reset-layout').addEventListener('click', () => {
  stopTracking();
  resetAutoLayout();
  manualPositions = layoutMode ? formationPositions() : null;
  removeStorage('lineup-ar-fixed-camera-preset');
  captureActiveTeam(); syncTheme(); renderCards(); updateOperatorState();
  setTrackingStatus(`${layoutAngle}° boshlang‘ich joylashuv tiklandi`, 'ready');
});
['club-name','team-color','accent-color','sponsor'].forEach(id => $(id).addEventListener('input', () => { captureActiveTeam(); syncTheme(); renderCards(); updateOperatorState(); }));
$('video-upload').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  sourceRequest++; sourcePending = false; releaseSource();
  uploadedVideoFile = file;
  videoUrl = URL.createObjectURL(file); video.src = videoUrl; video.loop = false; stage.classList.add('has-video');
  $('video-name').textContent = file.name; video.play().catch(() => {});
  sourceStatus('Video fayl ulandi. Jonli manba uchun KAMERA yoki EFIR OYNASI’ni bosing.');
  setTrackingStatus('Fixed camera: JOYLASH tugmasi bilan preset tuzing', 'ready');
  updateOperatorState();
});
$('camera-start').addEventListener('click', () => startLiveSource('camera'));
$('screen-start').addEventListener('click', () => startLiveSource('screen'));
$('source-stop').addEventListener('click', () => disconnectSource());
navigator.mediaDevices?.addEventListener('devicechange', refreshCameras);
window.addEventListener('pagehide', () => disconnectSource());
refreshCameras();
$('logo-upload').addEventListener('change', e => { const target = teams[activeTeam], name=activeTeam; loadImage(e.target.files[0], url => { if(activeTeam!==name || teams[name]!==target)return; logoUrl = url; captureActiveTeam(); syncTheme(); }); });
$('play-button').addEventListener('click', goOnAir);
$('reset-button').addEventListener('click', resetStage);
$('position-button').addEventListener('click', togglePlacementMode);
$('calibrate-button').addEventListener('click', () => toggleCalibrationMode());
$('auto-place-button').addEventListener('click', startAutoPlacement);
$('auto-preview-button').addEventListener('click', () => { if (autoLayout && !autoNeedsCalibration && !autoFitBlocked) { stage.classList.remove('on-air'); stage.classList.add('auto-preview'); renderCards(); updateOperatorState(); } });
$('pitch-region').addEventListener('change', () => { if (calibrationMode) stopTracking(); updatePitchHint(); updateOperatorState(); });
$('program-button').addEventListener('click', openProgramOutput);
$('export-button').addEventListener('click', downloadProject);
$('import-button').addEventListener('change', e => importProject(e.target.files[0]));
document.querySelectorAll('[data-team]').forEach(button => button.addEventListener('click', () => loadTeam(button.dataset.team)));
document.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click', () => switchPanel(button.dataset.panel)));
$('stats-toggle').addEventListener('change', event => { layerPreferences.stats = event.target.checked; applyLayerPreferences(); if (autoLayout) renderCards(); });
$('lines-toggle').addEventListener('change', event => { layerPreferences.lines = event.target.checked; applyLayerPreferences(); });
new ResizeObserver(() => { if (autoLayout && cardBox.children.length === 11) { if (trackingEnabled) applyTracking(video.currentTime); else fitAutoCards((manualPositions || formationPositions()).map(p=>p.map(v=>v/100))); updateOperatorState(); } }).observe(stage);
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
$('restore-roster').addEventListener('click', () => { players = makePlayers(); if (autoLayout) { autoNeedsCalibration = true; stopTracking(); } captureActiveTeam(); renderRosterEditor(); renderCards(); updateOperatorState(); });
document.addEventListener('keydown', event => {
  const isEditing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if (isEditing) return;
  if (event.code === 'Space') { event.preventDefault(); goOnAir(); }
  if (event.key === 'Escape') resetStage();
  if (event.key.toLowerCase() === 'j') togglePlacementMode();
  if (['1', '2', '3'].includes(event.key)) switchPanel(['setup', 'squad', 'output'][Number(event.key) - 1]);
});
const initialTeam = teams[activeTeam];
loadAutoPreset(initialTeam);
$('club-name').value = initialTeam.club || 'TOSHKENT FC';
$('team-color').value = initialTeam.teamColor || '#00ad76';
$('accent-color').value = initialTeam.accentColor || '#d8ff43';
$('sponsor').value = initialTeam.sponsor || 'OFFICIAL PARTNER';
$('formation').value = initialTeam.formation || '433';
$('layout-angle').value = String(layoutAngle);
syncTheme(); renderRosterEditor(); renderCards(); updateTeamTabs(); applyLayerPreferences(); updateOperatorState(); showSaveStatus();
setInterval(monitorCameraCut, 350);
