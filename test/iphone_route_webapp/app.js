const DEFAULT_CENTER = [34.0703, 134.5548];
const DEFAULT_ZOOM = 13;

// 自転車向け公開ルーティングサービス（OSRM互換）
const ROUTING_BASE_URL = "https://routing.openstreetmap.de/routed-bike";

// ルートから30m以上外れた場合のみ自動再検索
const REROUTE_THRESHOLD_METERS = 30;

// 連続再検索防止
const REROUTE_COOLDOWN_MS = 15000;

// 目的地から20m以内でゴール判定
const GOAL_THRESHOLD_METERS = 20;
const MOVE_SPEED_MPS = 0.2;   // 0.71km/h 4.3km/h以上なら走行扱い
const STOP_SPEED_MPS = 0.6;   // 0.36km/h 2.2km/h以下が継続したら停止
const STOP_CONFIRM_MS = 3000;
const LOCATION_STALE_MS = 12000;

const map = L.map("map", {
  zoomControl: true
}).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  tileSize: 256,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let currentPosition = null;
let destinationPosition = null;

let currentMarker = null;
let accuracyCircle = null;
let destinationMarker = null;
let routeLine = null;

let currentRouteCoordinates = [];

let watchId = null;
let followCurrentPosition = true;
let firstLocationFix = true;

let rerouteInProgress = false;
let lastRerouteAt = 0;

let goalReached = false;
let audioContext = null;
let wakeLock = null;
let isMoving = false;
let stopCandidateAt = null;
let lastLocationReceivedAt = 0;
let previousFix = null;
let currentSpeed = null;
let courseHeading = null;
let courseAt = 0;
let compassHeading = null;
let compassAt = 0;
let compassListenerStarted = false;
let compassPermission = '未許可';
let routeTurns = [];
let currentArrow = null;
let routeRevision = 0;
let activeSearchController = null;

const locationButton = document.getElementById("locationButton");
const routeButton = document.getElementById("routeButton");
const followButton = document.getElementById("followButton");
const appleMapsButton = document.getElementById("appleMapsButton");
const clearButton = document.getElementById("clearButton");

const statusText = document.getElementById("status");
const currentLocationText = document.getElementById("currentLocation");
const accuracyText = document.getElementById("accuracy");
const destinationText = document.getElementById("destination");
const distanceText = document.getElementById("distance");
const durationText = document.getElementById("duration");

const goalOverlay = document.getElementById("goalOverlay");
const confettiLayer = document.getElementById("confettiLayer");
const arrowOverlay = document.getElementById("arrowOverlay");
const arrowSymbol = document.getElementById("arrowSymbol");
const arrowWaiting = document.getElementById("arrowWaiting");
const arrowFoot = document.getElementById("arrowFoot");
const motionState = document.getElementById("motionState");
const speedText = document.getElementById("speedText");
const headingState = document.getElementById("headingState");
const compassButton = document.getElementById("compassButton");
const ARROW_ANGLES = { up: 0, right: 90, down: 180, left: 270 };


// iOS Safari は方位センサー取得にタップ操作による許可が必要な場合がある。
function orientationChanged(event) {
  let heading = null;
  if (Number.isFinite(event.webkitCompassHeading)) {
    // iPhone上端が向く方角（磁北基準）
    if (!Number.isFinite(event.webkitCompassAccuracy) ||
        event.webkitCompassAccuracy <= 50 || event.webkitCompassAccuracy < 0) {
      heading = event.webkitCompassHeading;
    }
  } else if (event.absolute === true && Number.isFinite(event.alpha)) {
    // 端末が絶対方位を通知するブラウザのみ
    heading = (360 - event.alpha) % 360;
  }
  if (heading !== null) {
    compassHeading = NaviCore.norm360(heading);
    compassAt = Date.now();
    headingState.textContent = '端末の方位センサー';
    compassButton.hidden = true;
    renderArrow();
  }
}

function attachCompassListener() {
  if (compassListenerStarted) return;
  compassListenerStarted = true;
  window.addEventListener('deviceorientation', orientationChanged);
  window.addEventListener('deviceorientationabsolute', orientationChanged);
}

async function enableCompass() {
  if (typeof DeviceOrientationEvent === 'undefined') {
    compassPermission = '利用不可';
    headingState.textContent = '未対応（GPS方位を代用）';
    return;
  }
  try {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      // requestPermission() は必ずユーザーのタップの中から呼び出す
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== 'granted') {
        compassPermission = '拒否';
        headingState.textContent = '未許可（GPS方位を代用）';
        return;
      }
    }
    compassPermission = '許可済み';
    headingState.textContent = '方位センサーの更新待ち';
    attachCompassListener();
  } catch (error) {
    console.warn('Compass permission error:', error);
    compassPermission = '利用不可';
    headingState.textContent = '利用不可（GPS方位を代用）';
  }
}

function updateMotion(position) {
  const now = Date.now();
  const coords = position.coords;
  const fixTime = Number.isFinite(position.timestamp) ? position.timestamp : now;
  const fix = { lat: coords.latitude, lon: coords.longitude,
    accuracy: Math.max(0, Number(coords.accuracy) || 100), time: fixTime };
  const estimated = NaviCore.estimateMotion(previousFix, fix);
  const measured = Number.isFinite(coords.speed) && coords.speed >= 0 ? coords.speed : null;
  // speed が未提供でも、1秒ごとの小移動を累積して速度を求められるようにする。
  // GPSのブレで動いたと誤認しないよう、基準点を毎回更新しない。
  if (!previousFix || (fixTime > previousFix.time &&
      (measured !== null || estimated.heading !== null || fixTime - previousFix.time > 10000))) {
    previousFix = fix;
  }
  currentSpeed = measured !== null ? measured : estimated.speed;
  if (Number.isFinite(coords.heading) && coords.heading >= 0 &&
      Number.isFinite(currentSpeed) && currentSpeed > 0.8) {
    courseHeading = NaviCore.norm360(coords.heading);
    courseAt = now;
  } else if (measured === null && Number.isFinite(estimated.heading)) {
    courseHeading = estimated.heading;
    courseAt = now;
  }
  lastLocationReceivedAt = now;

  // GPSの精度が悪い場合は、誤った走行検出を避ける。
  if (fix.accuracy <= 40 && currentSpeed !== null) {
    if (!isMoving && currentSpeed >= MOVE_SPEED_MPS) {
      isMoving = true;
      stopCandidateAt = null;
    } else if (isMoving) {
      if (currentSpeed <= STOP_SPEED_MPS) {
        if (stopCandidateAt === null) stopCandidateAt = now;
        if (now - stopCandidateAt >= STOP_CONFIRM_MS) isMoving = false;
      } else {
        stopCandidateAt = null;
      }
    }
  }
  motionState.textContent = isMoving ? '移動中' : '停止中';
  speedText.textContent = currentSpeed === null ? '計測中' : `${(currentSpeed*3.6).toFixed(1)} km/h`;
}

function getReferenceHeading() {
  const now = Date.now();
  if (Number.isFinite(compassHeading) && now - compassAt < 10000) {
    return { heading: compassHeading, source: 'compass' };
  }
  if (Number.isFinite(courseHeading) && now - courseAt < 10000) {
    return { heading: courseHeading, source: 'gps' };
  }
  return null;
}

function renderArrow() {
  const shouldShow = isMoving && currentPosition && destinationPosition &&
    currentRouteCoordinates.length >= 2 && !goalReached &&
    document.visibilityState === 'visible';
  arrowOverlay.classList.toggle('show', Boolean(shouldShow));
  arrowOverlay.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
  if (!shouldShow) { currentArrow = null; return; }

  const target = NaviCore.routeBearing(
    currentPosition.lat, currentPosition.lon,
    currentRouteCoordinates, routeTurns, currentSpeed || 0
  );
  const reference = getReferenceHeading();
  if (!target || !reference) {
    arrowSymbol.hidden = true;
    arrowWaiting.hidden = false;
    arrowFoot.textContent = '端末の方位またはGPS進行方位を取得中';
    return;
  }
  arrowSymbol.hidden = false;
  arrowWaiting.hidden = true;
  const arrow = NaviCore.getArrow(target.bearing, reference.heading, currentArrow);
  if (arrow !== currentArrow) {
    currentArrow = arrow;
    // 角度の累積なしに4方向を確定的に描画する
    arrowSymbol.style.transform = `rotate(${ARROW_ANGLES[arrow]}deg)`;
    arrowSymbol.setAttribute('aria-label', { up: '上', right: '右', down: '下', left: '左' }[arrow] + '方向');
  }
  arrowFoot.textContent = reference.source === 'compass'
    ? 'iPhone上端の向きを基準に案内'
    : 'GPSの進行方位を基準に案内（端末方位ではありません）';
}

// GPS更新が止まったときに、走行中の矢印を残しっぱなしにしない。
setInterval(() => {
  if (isMoving && lastLocationReceivedAt &&
      Date.now() - lastLocationReceivedAt >= LOCATION_STALE_MS) {
    isMoving = false;
    stopCandidateAt = null;
    motionState.textContent = '停止中（GPS更新待ち）';
    renderArrow();
  }
}, 1000);

compassButton.addEventListener('click', () => {
  enableCompass();
  requestWakeLock();
});

// 権限リクエストの不要なブラウザでは自動的に方位監視を開始する。
if (typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission !== 'function') {
  attachCompassListener();
}

const currentPositionIcon = L.divIcon({
  className: "",
  html: '<div class="current-position-dot"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9]
});

function setStatus(message) {
  statusText.textContent = message;
}

function updateButtons() {
  routeButton.disabled = !(currentPosition && destinationPosition);
  appleMapsButton.disabled = !destinationPosition;
}

function startLocationTracking() {
  if (!navigator.geolocation) {
    setStatus("このブラウザは位置情報取得に対応していません。");
    return;
  }

  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  setStatus("現在地を取得しています...");

  watchId = navigator.geolocation.watchPosition(
    handleLocationUpdate,
    handleLocationError,
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 1000
    }
  );
}

async function handleLocationUpdate(position) {
  const lat = position.coords.latitude;
  const lon = position.coords.longitude;
  const accuracy = position.coords.accuracy;

  currentPosition = { lat, lon };
  updateMotion(position);

  if (!currentMarker) {
    currentMarker = L.marker([lat, lon], {
      icon: currentPositionIcon,
      zIndexOffset: 1000
    })
      .addTo(map)
      .bindPopup("現在地");
  } else {
    currentMarker.setLatLng([lat, lon]);
  }

  if (!accuracyCircle) {
    accuracyCircle = L.circle([lat, lon], {
      radius: accuracy,
      weight: 1,
      opacity: 0.5,
      fillOpacity: 0.08
    }).addTo(map);
  } else {
    accuracyCircle.setLatLng([lat, lon]);
    accuracyCircle.setRadius(accuracy);
  }

  currentLocationText.textContent =
    `${lat.toFixed(6)}, ${lon.toFixed(6)}`;

  accuracyText.textContent =
    `±${Math.round(accuracy)} m`;

  if (firstLocationFix) {
    map.setView([lat, lon], 17);
    firstLocationFix = false;
  } else if (followCurrentPosition) {
    // GPS更新のたびに現在位置を地図中央へ移動
    map.panTo([lat, lon], {
      animate: true,
      duration: 0.35,
      easeLinearity: 0.25
    });
  }

  // ゴール判定
  if (destinationPosition && !goalReached) {
    const distanceToGoal = haversineDistanceMeters(
      lat,
      lon,
      destinationPosition.lat,
      destinationPosition.lon
    );

    if (distanceToGoal <= GOAL_THRESHOLD_METERS) {
      goalReached = true;
      renderArrow();
      showGoalCelebration();
      setStatus(`ゴール！ 目的地まで約${Math.round(distanceToGoal)}mです。`);
      updateButtons();
      return;
    }
  }

  renderArrow();

  // 30m以上ルートから外れた場合のみ再検索
  if (
    !goalReached &&
    destinationPosition &&
    currentRouteCoordinates.length >= 2 &&
    !rerouteInProgress
  ) {
    const distanceFromRoute = distanceToRouteMeters(
      lat,
      lon,
      currentRouteCoordinates
    );

    if (distanceFromRoute > REROUTE_THRESHOLD_METERS) {
      const now = Date.now();

      if (now - lastRerouteAt >= REROUTE_COOLDOWN_MS) {
        setStatus(
          `ルートから約${Math.round(distanceFromRoute)}m外れました。再検索します...`
        );

        lastRerouteAt = now;
        await searchRoute(true);
        return;
      }
    }
  }

  if (goalReached) {
    setStatus("ゴール！目的地に到着しました。");
  } else if (destinationPosition) {
    setStatus("現在地を継続更新中です。");
  } else {
    setStatus("現在地を継続更新中です。地図上で目的地をタップしてください。");
  }

  updateButtons();
}

function handleLocationError(error) {
  console.error(error);

  if (error.code === 1) {
    setStatus("位置情報の利用が許可されていません。Safariの設定を確認してください。");
  } else if (error.code === 2) {
    setStatus("現在地を取得できませんでした。");
  } else if (error.code === 3) {
    setStatus("位置情報取得がタイムアウトしました。");
  } else {
    setStatus("位置情報取得中にエラーが発生しました。");
  }
}

locationButton.addEventListener("click", () => {
  firstLocationFix = true;
  followCurrentPosition = true;
  followButton.textContent = "追従：ON";
  startLocationTracking();
});

followButton.addEventListener("click", () => {
  followCurrentPosition = !followCurrentPosition;
  followButton.textContent =
    `追従：${followCurrentPosition ? "ON" : "OFF"}`;

  if (followCurrentPosition && currentPosition) {
    map.panTo(
      [currentPosition.lat, currentPosition.lon],
      { animate: true, duration: 0.35 }
    );
  }
});

map.on("dragstart", () => {
  followCurrentPosition = false;
  followButton.textContent = "追従：OFF";
});

map.on("click", event => {
  const { lat, lng } = event.latlng;

  routeRevision++;
  if (activeSearchController) activeSearchController.abort();
  destinationPosition = {
    lat,
    lon: lng
  };

  goalReached = false;
  hideGoalCelebration();

  if (destinationMarker) {
    map.removeLayer(destinationMarker);
  }

  destinationMarker = L.marker([lat, lng])
    .addTo(map)
    .bindPopup("目的地")
    .openPopup();

  destinationText.textContent =
    `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

  distanceText.textContent = "-";
  durationText.textContent = "-";

  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }

  currentRouteCoordinates = [];
  routeTurns = [];
  renderArrow();

  if (currentPosition) {
    setStatus("目的地を設定しました。「自転車ルート」を押してください。");
  } else {
    setStatus("目的地を設定しました。現在地の取得を待っています。");
  }

  updateButtons();
});

routeButton.addEventListener("click", async () => {
  // タップ直後に許可ダイアログを起動する（await searchRouteより前）
  if (compassPermission !== '許可済み') enableCompass();
  requestWakeLock();
  await searchRoute(false);
});

async function searchRoute(isAutomatic = false) {
  if (!currentPosition || !destinationPosition) {
    setStatus("現在地と目的地の両方を設定してください。");
    return;
  }

  if (rerouteInProgress) {
    return;
  }

  rerouteInProgress = true;
  const revisionAtStart = routeRevision;
  const controller = new AbortController();
  activeSearchController = controller;

  if (!isAutomatic) {
    setStatus("自転車ルートを検索しています...");
  }

  const start =
    `${currentPosition.lon},${currentPosition.lat}`;

  const goal =
    `${destinationPosition.lon},${destinationPosition.lat}`;

  const url =
    `${ROUTING_BASE_URL}/route/v1/driving/${start};${goal}` +
    `?overview=full&geometries=geojson&steps=true`;

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    if (revisionAtStart !== routeRevision) return;

    if (!data.routes || data.routes.length === 0) {
      setStatus("自転車ルートが見つかりませんでした。");
      return;
    }

    const route = data.routes[0];

    const coordinates =
      route.geometry.coordinates.map(
        coord => [coord[1], coord[0]]
      );

    currentRouteCoordinates = coordinates;
    routeTurns = NaviCore.extractTurns(route, coordinates);

    if (routeLine) {
      map.removeLayer(routeLine);
    }

    routeLine = L.polyline(coordinates, {
      weight: 6,
      opacity: 0.85
    }).addTo(map);

    distanceText.textContent =
      formatDistance(route.distance);

    durationText.textContent =
      formatDuration(route.duration);

    if (isAutomatic) {
      followCurrentPosition = true;
      followButton.textContent = "追従：ON";

      if (currentPosition) {
        map.panTo(
          [currentPosition.lat, currentPosition.lon],
          { animate: true, duration: 0.35 }
        );
      }

      setStatus("ルートを自動再検索しました。現在地を追従します。");
    } else {
      // ルート検索後も現在位置追従を維持する。
      // ルート全体表示は行わず、現在位置を中心にしたまま走行する。
      followCurrentPosition = true;
      followButton.textContent = "追従：ON";

      if (currentPosition) {
        map.setView(
          [currentPosition.lat, currentPosition.lon],
          Math.max(map.getZoom(), 16)
        );
      }

      setStatus("自転車ルートを表示しました。移動すると矢印に切り替わります。");
    }
    renderArrow();

  } catch (error) {
    if (error.name === "AbortError") return;
    console.error(error);

    setStatus(
      isAutomatic
        ? "自動再検索に失敗しました。位置追跡は継続します。"
        : "ルート検索に失敗しました。"
    );
  } finally {
    if (activeSearchController === controller) activeSearchController = null;
    rerouteInProgress = false;
  }
}

appleMapsButton.addEventListener("click", () => {
  if (!destinationPosition) {
    return;
  }

  const destination =
    `${destinationPosition.lat},${destinationPosition.lon}`;

  window.location.href =
    `https://maps.apple.com/?daddr=${encodeURIComponent(destination)}`;
});

clearButton.addEventListener("click", () => {
  routeRevision++;
  if (activeSearchController) activeSearchController.abort();
  destinationPosition = null;
  currentRouteCoordinates = [];
  routeTurns = [];
  goalReached = false;
  renderArrow();

  hideGoalCelebration();

  if (destinationMarker) {
    map.removeLayer(destinationMarker);
    destinationMarker = null;
  }

  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }

  destinationText.textContent = "未指定";
  distanceText.textContent = "-";
  durationText.textContent = "-";

  setStatus(
    currentPosition
      ? "現在地を継続更新中です。地図上で目的地をタップしてください。"
      : "現在地を取得しています..."
  );

  updateButtons();
});

function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }

  return `${(meters / 1000).toFixed(2)} km`;
}

function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return `約${minutes}分`;
  }

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;

  return `約${hours}時間${restMinutes}分`;
}

function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = degrees => degrees * Math.PI / 180;

  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaPhi = toRad(lat2 - lat1);
  const deltaLambda = toRad(lon2 - lon1);

  const a =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) *
    Math.cos(phi2) *
    Math.sin(deltaLambda / 2) ** 2;

  const c =
    2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function distanceToRouteMeters(lat, lon, routeCoordinates) {
  let minDistance = Infinity;

  for (let i = 0; i < routeCoordinates.length - 1; i++) {
    const a = routeCoordinates[i];
    const b = routeCoordinates[i + 1];

    const distance = distancePointToSegmentMeters(
      lat,
      lon,
      a[0],
      a[1],
      b[0],
      b[1]
    );

    if (distance < minDistance) {
      minDistance = distance;
    }
  }

  return minDistance;
}

function distancePointToSegmentMeters(
  pLat,
  pLon,
  aLat,
  aLon,
  bLat,
  bLon
) {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon =
    111320 * Math.cos(pLat * Math.PI / 180);

  const ax = (aLon - pLon) * metersPerDegreeLon;
  const ay = (aLat - pLat) * metersPerDegreeLat;

  const bx = (bLon - pLon) * metersPerDegreeLon;
  const by = (bLat - pLat) * metersPerDegreeLat;

  const abx = bx - ax;
  const aby = by - ay;

  const lengthSquared =
    abx * abx + aby * aby;

  if (lengthSquared === 0) {
    return Math.sqrt(ax * ax + ay * ay);
  }

  let t =
    -(ax * abx + ay * aby) /
    lengthSquared;

  t = Math.max(0, Math.min(1, t));

  const closestX = ax + t * abx;
  const closestY = ay + t * aby;

  return Math.sqrt(
    closestX * closestX +
    closestY * closestY
  );
}

function showGoalCelebration() {
  goalOverlay.classList.add("show");
  goalOverlay.setAttribute("aria-hidden", "false");

  createConfetti();
  playGoalSound();
}

function hideGoalCelebration() {
  goalOverlay.classList.remove("show");
  goalOverlay.setAttribute("aria-hidden", "true");
  confettiLayer.innerHTML = "";
}

function createConfetti() {
  confettiLayer.innerHTML = "";

  const colors = [
    "#ff3b30",
    "#ff9500",
    "#ffcc00",
    "#34c759",
    "#007aff",
    "#5856d6",
    "#af52de"
  ];

  for (let i = 0; i < 90; i++) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";

    const angle = Math.random() * Math.PI * 2;
    const distance = 180 + Math.random() * 520;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance + 120;

    piece.style.setProperty("--x", `${x}px`);
    piece.style.setProperty("--y", `${y}px`);
    piece.style.setProperty("--r", `${Math.random() * 1080 - 540}deg`);
    piece.style.backgroundColor =
      colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay =
      `${Math.random() * 0.18}s`;

    confettiLayer.appendChild(piece);
  }
}

function prepareAudio() {
  try {
    if (!audioContext) {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      if (AudioContextClass) {
        audioContext = new AudioContextClass();
      }
    }

    if (audioContext && audioContext.state === "suspended") {
      audioContext.resume();
    }
  } catch (error) {
    console.warn("AudioContext initialization failed:", error);
  }
}

function playGoalSound() {
  if (!audioContext) {
    return;
  }

  try {
    const now = audioContext.currentTime;
    const bufferSize =
      Math.floor(audioContext.sampleRate * 0.18);

    const buffer = audioContext.createBuffer(
      1,
      bufferSize,
      audioContext.sampleRate
    );

    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      const decay = 1 - i / bufferSize;
      data[i] =
        (Math.random() * 2 - 1) *
        decay *
        decay;
    }

    const noise =
      audioContext.createBufferSource();

    noise.buffer = buffer;

    const gain =
      audioContext.createGain();

    gain.gain.setValueAtTime(0.45, now);

    gain.gain.exponentialRampToValueAtTime(
      0.001,
      now + 0.18
    );

    noise.connect(gain);
    gain.connect(audioContext.destination);

    noise.start(now);
    noise.stop(now + 0.2);

  } catch (error) {
    console.warn("Goal sound failed:", error);
  }
}

document.addEventListener(
  "pointerdown",
  prepareAudio,
  { once: true }
);

goalOverlay.addEventListener("click", () => {
  if (goalOverlay.classList.contains("show")) {
    hideGoalCelebration();
  }
});


async function requestWakeLock() {
  if (!("wakeLock" in navigator)) {
    console.warn("Screen Wake Lock API is not supported.");
    return;
  }

  try {
    if (wakeLock && !wakeLock.released) {
      return;
    }

    wakeLock = await navigator.wakeLock.request("screen");

    wakeLock.addEventListener("release", () => {
      console.log("Screen Wake Lock released.");
    });

    console.log("Screen Wake Lock enabled.");
  } catch (error) {
    console.warn("Screen Wake Lock request failed:", error);
  }
}

async function releaseWakeLock() {
  try {
    if (wakeLock && !wakeLock.released) {
      await wakeLock.release();
    }
  } catch (error) {
    console.warn("Screen Wake Lock release failed:", error);
  } finally {
    wakeLock = null;
  }
}

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible") {
    await requestWakeLock();
  }
  renderArrow();
});

window.addEventListener("load", () => {
  setTimeout(() => {
    map.invalidateSize(true);
    startLocationTracking();
    requestWakeLock();
  }, 100);
});

window.addEventListener("resize", () => {
  map.invalidateSize(false);
});

window.addEventListener("orientationchange", () => {
  setTimeout(() => map.invalidateSize(true), 250);
});

window.addEventListener("pageshow", event => {
  if (event.persisted) {
    startLocationTracking();
    requestWakeLock();
  }
});

window.addEventListener("pagehide", () => {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  releaseWakeLock();
});

updateButtons();
