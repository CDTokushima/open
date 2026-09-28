const DEFAULT_CENTER = [34.0703, 134.5548];
const DEFAULT_ZOOM = 13;

// 自転車向け公開ルーティングサービス（OSRM互換）
const OSRM_BASE_URL = "https://routing.openstreetmap.de/routed-bike";

// ルートから何m外れたら自動再検索するか
const REROUTE_THRESHOLD_METERS = 30;

// GPSが頻繁に更新されてもAPIを連打しないための待ち時間
const REROUTE_COOLDOWN_MS = 15000;

// 目的地から何m以内で到着と判定するか
const GOAL_THRESHOLD_METERS = 20;

const map = L.map("map", {
  zoomControl: true
}).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  tileSize: 256,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

window.addEventListener("resize", () => {
  map.invalidateSize(false);
});

let currentPosition = null;
let destinationPosition = null;

let currentMarker = null;
let accuracyCircle = null;
let destinationMarker = null;
let routeLine = null;

// 現在表示しているルートの座標列 [[lat, lon], ...]
let currentRouteCoordinates = [];

let watchId = null;
let followCurrentPosition = true;
let firstLocationFix = true;

let rerouteInProgress = false;
let lastRerouteAt = 0;

let goalReached = false;
let goalTimer = null;
let audioContext = null;

const locationButton = document.getElementById("locationButton");
const routeButton = document.getElementById("routeButton");
const appleMapsButton = document.getElementById("appleMapsButton");
const followButton = document.getElementById("followButton");
const clearButton = document.getElementById("clearButton");

const statusText = document.getElementById("status");
const currentLocationText = document.getElementById("currentLocation");
const accuracyText = document.getElementById("accuracy");
const destinationText = document.getElementById("destination");
const distanceText = document.getElementById("distance");
const durationText = document.getElementById("duration");
const goalOverlay = document.getElementById("goalOverlay");
const confettiLayer = document.getElementById("confettiLayer");

const currentPositionIcon = L.divIcon({
  className: "",
  html: '<div class="current-position-dot"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9]
});

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
    map.panTo([lat, lon], {
      animate: true,
      duration: 0.4
    });
  }

  // 目的地から20m以内に入ったら一度だけゴール演出
  if (destinationPosition && !goalReached) {
    const distanceToGoal = haversineDistanceMeters(
      lat,
      lon,
      destinationPosition.lat,
      destinationPosition.lon
    );

    if (distanceToGoal <= GOAL_THRESHOLD_METERS) {
      goalReached = true;
      showGoalCelebration();
      setStatus(`ゴール！ 目的地まで約${Math.round(distanceToGoal)}mです。`);
      return;
    }
  }

  // ゴール後はルート逸脱による自動再検索を行わない
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

    // 30mを超えた場合のみ再検索
    if (distanceFromRoute > REROUTE_THRESHOLD_METERS) {
      const now = Date.now();

      if (now - lastRerouteAt >= REROUTE_COOLDOWN_MS) {
        setStatus(
          `ルートから約${Math.round(distanceFromRoute)}m外れました。自動再検索します...`
        );

        lastRerouteAt = now;
        await searchRoute(true);
        return;
      }
    }
  }

  if (destinationPosition) {
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
    setStatus("位置情報取得がタイムアウトしました。再試行します。");
  } else {
    setStatus("位置情報取得中にエラーが発生しました。");
  }
}

locationButton.addEventListener("click", () => {
  firstLocationFix = true;
  startLocationTracking();
});

followButton.addEventListener("click", () => {
  followCurrentPosition = !followCurrentPosition;

  followButton.textContent =
    `現在地を追従：${followCurrentPosition ? "ON" : "OFF"}`;

  if (followCurrentPosition && currentPosition) {
    map.panTo(
      [currentPosition.lat, currentPosition.lon],
      { animate: true, duration: 0.4 }
    );
  }
});

// 地図を手動で動かしたら自動追従をOFF
map.on("dragstart", () => {
  followCurrentPosition = false;
  followButton.textContent = "現在地を追従：OFF";
});

// 地図タップで目的地を指定
map.on("click", event => {
  const { lat, lng } = event.latlng;

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

  if (currentPosition) {
    setStatus("目的地を設定しました。「自転車ルートを検索」を押してください。");
  } else {
    setStatus("目的地を設定しました。現在地の取得を待っています。");
  }

  updateButtons();
});

// 手動ルート検索
routeButton.addEventListener("click", async () => {
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

  if (!isAutomatic) {
    setStatus("自転車ルートを検索しています...");
  }

  const start =
    `${currentPosition.lon},${currentPosition.lat}`;

  const goal =
    `${destinationPosition.lon},${destinationPosition.lat}`;

  const url =
    `${OSRM_BASE_URL}/route/v1/driving/${start};${goal}` +
    `?overview=full&geometries=geojson&steps=true`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      setStatus("自転車ルートが見つかりませんでした。");
      return;
    }

    const route = data.routes[0];

    const coordinates = route.geometry.coordinates.map(
      coord => [coord[1], coord[0]]
    );

    currentRouteCoordinates = coordinates;

    if (routeLine) {
      map.removeLayer(routeLine);
    }

    routeLine = L.polyline(coordinates, {
      weight: 6,
      opacity: 0.85
    }).addTo(map);

    distanceText.textContent = formatDistance(route.distance);
    durationText.textContent = formatDuration(route.duration);

    if (isAutomatic) {
      setStatus("ルートを自動再検索しました。現在地を追跡中です。");

      if (followCurrentPosition) {
        map.panTo(
          [currentPosition.lat, currentPosition.lon],
          { animate: true, duration: 0.4 }
        );
      }
    } else {
      map.fitBounds(routeLine.getBounds(), {
        padding: [30, 30]
      });

      followCurrentPosition = false;
      followButton.textContent = "現在地を追従：OFF";

      setStatus("自転車ルートを表示しました。現在地は引き続き更新されます。");
    }

  } catch (error) {
    console.error(error);
    setStatus(
      isAutomatic
        ? "自動再検索に失敗しました。現在地の追跡は継続します。"
        : "ルート検索に失敗しました。"
    );
  } finally {
    rerouteInProgress = false;
  }
}

// Apple Maps
appleMapsButton.addEventListener("click", () => {
  if (!destinationPosition) {
    setStatus("目的地を設定してください。");
    return;
  }

  const destination =
    `${destinationPosition.lat},${destinationPosition.lon}`;

  const appleMapsUrl =
    `https://maps.apple.com/?daddr=${encodeURIComponent(destination)}`;

  window.location.href = appleMapsUrl;
});

// 目的地・ルートだけクリア。GPS追跡は継続
clearButton.addEventListener("click", () => {
  destinationPosition = null;
  currentRouteCoordinates = [];
  goalReached = false;
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

function updateButtons() {
  routeButton.disabled = !(currentPosition && destinationPosition);
  appleMapsButton.disabled = !destinationPosition;
}

function setStatus(message) {
  statusText.textContent = message;
}

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

function showGoalCelebration() {
  if (!goalOverlay || !confettiLayer) return;

  goalOverlay.classList.add("show");
  goalOverlay.setAttribute("aria-hidden", "false");

  createConfetti();
  playGoalSound();

  if (goalTimer) {
    clearTimeout(goalTimer);
  }

  goalTimer = setTimeout(() => {
    hideGoalCelebration();
  }, 5000);
}

function hideGoalCelebration() {
  if (goalTimer) {
    clearTimeout(goalTimer);
    goalTimer = null;
  }

  if (goalOverlay) {
    goalOverlay.classList.remove("show");
    goalOverlay.setAttribute("aria-hidden", "true");
  }

  if (confettiLayer) {
    confettiLayer.innerHTML = "";
  }
}

function createConfetti() {
  if (!confettiLayer) return;

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
    piece.style.animationDelay = `${Math.random() * 0.18}s`;

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
  if (!audioContext) return;

  try {
    const now = audioContext.currentTime;
    const bufferSize = Math.floor(audioContext.sampleRate * 0.18);
    const buffer = audioContext.createBuffer(
      1,
      bufferSize,
      audioContext.sampleRate
    );

    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      const decay = 1 - i / bufferSize;
      data[i] = (Math.random() * 2 - 1) * decay * decay;
    }

    const noise = audioContext.createBufferSource();
    noise.buffer = buffer;

    const gain = audioContext.createGain();
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

// iPhone/Safariでは音声開始にユーザー操作が必要なため、最初のタップで準備
document.addEventListener(
  "pointerdown",
  prepareAudio,
  { once: true }
);

/*
 * 現在位置からルート折れ線までの最短距離を求める。
 *
 * lat, lon:
 *   現在位置の緯度・経度
 *
 * routeCoordinates:
 *   [[lat, lon], [lat, lon], ...] のルート座標列
 *
 * 戻り値:
 *   ルートまでの最短距離（m）
 *
 * 数十m程度の判定用途なので、現在位置を原点とした
 * 局所平面近似で各線分との距離を計算する。
 */
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

/*
 * 点Pから線分ABまでの距離をmで返す。
 */
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

  // 現在位置Pを原点 (0,0) とする
  const ax = (aLon - pLon) * metersPerDegreeLon;
  const ay = (aLat - pLat) * metersPerDegreeLat;

  const bx = (bLon - pLon) * metersPerDegreeLon;
  const by = (bLat - pLat) * metersPerDegreeLat;

  const abx = bx - ax;
  const aby = by - ay;

  const abLengthSquared =
    abx * abx + aby * aby;

  if (abLengthSquared === 0) {
    return Math.sqrt(ax * ax + ay * ay);
  }

  // P=(0,0) をABへ射影した位置 t
  let t =
    -(ax * abx + ay * aby) /
    abLengthSquared;

  t = Math.max(0, Math.min(1, t));

  const closestX = ax + t * abx;
  const closestY = ay + t * aby;

  return Math.sqrt(
    closestX * closestX +
    closestY * closestY
  );
}

// ページ表示直後にGPS追跡開始
window.addEventListener("load", () => {
  setTimeout(() => {
    map.invalidateSize(true);
    startLocationTracking();
  }, 100);
});

// ページ離脱時にwatch停止
window.addEventListener("pagehide", () => {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
});

updateButtons();
