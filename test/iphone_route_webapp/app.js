const DEFAULT_CENTER = [34.0703, 134.5548];
const DEFAULT_ZOOM = 13;
const OSRM_BASE_URL = "https://routing.openstreetmap.de/routed-bike";

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
let destinationMarker = null;
let routeLine = null;

const locationButton = document.getElementById("locationButton");
const routeButton = document.getElementById("routeButton");
const appleMapsButton = document.getElementById("appleMapsButton");
const clearButton = document.getElementById("clearButton");

const statusText = document.getElementById("status");
const currentLocationText = document.getElementById("currentLocation");
const destinationText = document.getElementById("destination");
const distanceText = document.getElementById("distance");
const durationText = document.getElementById("duration");

function getCurrentLocation() {
  if (!navigator.geolocation) {
    setStatus("このブラウザは位置情報取得に対応していません。");
    return;
  }

  setStatus("現在地を取得しています...");

  navigator.geolocation.getCurrentPosition(
    position => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;

      currentPosition = { lat, lon };

      if (currentMarker) map.removeLayer(currentMarker);

      currentMarker = L.marker([lat, lon])
        .addTo(map)
        .bindPopup("現在地")
        .openPopup();

      map.setView([lat, lon], 16);
      map.invalidateSize(false);

      currentLocationText.textContent =
        `${lat.toFixed(6)}, ${lon.toFixed(6)}`;

      setStatus("現在地を取得しました。地図上で目的地をタップしてください。");
      updateButtons();
    },
    error => {
      if (error.code === 1) {
        setStatus("位置情報の利用が許可されていません。Safariの設定を確認してください。");
      } else if (error.code === 2) {
        setStatus("現在地を取得できませんでした。");
      } else if (error.code === 3) {
        setStatus("位置情報取得がタイムアウトしました。");
      } else {
        setStatus("位置情報取得中にエラーが発生しました。");
      }
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 5000
    }
  );
}

locationButton.addEventListener("click", getCurrentLocation);

// ページを表示したらすぐ現在地を取得する
window.addEventListener("load", () => {
  setTimeout(() => {
    map.invalidateSize(true);
    getCurrentLocation();
  }, 100);
});

map.on("click", event => {
  const { lat, lng } = event.latlng;

  destinationPosition = { lat, lon: lng };

  if (destinationMarker) map.removeLayer(destinationMarker);

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

  setStatus(
    currentPosition
      ? "目的地を設定しました。「ルートを検索」を押してください。"
      : "目的地を設定しました。先に現在地を取得してください。"
  );

  updateButtons();
});

routeButton.addEventListener("click", async () => {
  if (!currentPosition || !destinationPosition) {
    setStatus("現在地と目的地の両方を設定してください。");
    return;
  }

  setStatus("自転車ルートを検索しています...");

  const start = `${currentPosition.lon},${currentPosition.lat}`;
  const goal = `${destinationPosition.lon},${destinationPosition.lat}`;

  // routing.openstreetmap.de の自転車向けOSRMプロファイルを使用
  const url =
    `${OSRM_BASE_URL}/route/v1/driving/${start};${goal}` +
    `?overview=full&geometries=geojson&steps=true`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      setStatus("ルートが見つかりませんでした。");
      return;
    }

    const route = data.routes[0];
    const coordinates = route.geometry.coordinates.map(
      coord => [coord[1], coord[0]]
    );

    if (routeLine) map.removeLayer(routeLine);

    routeLine = L.polyline(coordinates, {
      weight: 6,
      opacity: 0.85
    }).addTo(map);

    map.fitBounds(routeLine.getBounds(), {
      padding: [30, 30]
    });

    distanceText.textContent = formatDistance(route.distance);
    durationText.textContent = formatDuration(route.duration);
    setStatus("自転車ルートを表示しました。");

  } catch (error) {
    console.error(error);
    setStatus("ルート検索に失敗しました。");
  }
});

appleMapsButton.addEventListener("click", () => {
  if (!destinationPosition) return;

  const destination =
    `${destinationPosition.lat},${destinationPosition.lon}`;

  const appleMapsUrl =
    `https://maps.apple.com/?daddr=${encodeURIComponent(destination)}&dirflg=w`;

  window.location.href = appleMapsUrl;
});

clearButton.addEventListener("click", () => {
  destinationPosition = null;

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
      ? "地図上で目的地をタップしてください。"
      : "現在地を取得してください。"
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
  return meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toFixed(2)} km`;
}

function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `約${minutes}分`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return `約${hours}時間${restMinutes}分`;
}

updateButtons();
