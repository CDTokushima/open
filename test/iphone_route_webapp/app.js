// -----------------------------
// 設定
// -----------------------------

// 初期表示位置。現在地取得前の仮表示です。
const DEFAULT_CENTER = [34.0703, 134.5548];
const DEFAULT_ZOOM = 13;

// OSRM の公開デモサーバーを使います。
// 学習・試作向けです。商用・大量アクセス用途では専用サービスを利用してください。
const OSRM_BASE_URL = "https://router.project-osrm.org";

// -----------------------------
// 地図初期化
// -----------------------------

const map = L.map("map").setView(DEFAULT_CENTER, DEFAULT_ZOOM);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

// -----------------------------
// 状態変数
// -----------------------------

let currentPosition = null;
let destinationPosition = null;

let currentMarker = null;
let destinationMarker = null;
let routeLine = null;

// -----------------------------
// DOM
// -----------------------------

const locationButton = document.getElementById("locationButton");
const routeButton = document.getElementById("routeButton");
const appleMapsButton = document.getElementById("appleMapsButton");
const clearButton = document.getElementById("clearButton");

const statusText = document.getElementById("status");
const currentLocationText = document.getElementById("currentLocation");
const destinationText = document.getElementById("destination");
const distanceText = document.getElementById("distance");
const durationText = document.getElementById("duration");

// -----------------------------
// 現在地取得
// -----------------------------

locationButton.addEventListener("click", () => {
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

      if (currentMarker) {
        map.removeLayer(currentMarker);
      }

      currentMarker = L.marker([lat, lon])
        .addTo(map)
        .bindPopup("現在地")
        .openPopup();

      map.setView([lat, lon], 16);

      currentLocationText.textContent =
        `${lat.toFixed(6)}, ${lon.toFixed(6)}`;

      setStatus("現在地を取得しました。地図上で目的地をタップしてください。");

      updateButtons();
    },
    error => {
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
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 5000
    }
  );
});

// -----------------------------
// 地図タップで目的地指定
// -----------------------------

map.on("click", event => {
  const { lat, lng } = event.latlng;

  destinationPosition = {
    lat: lat,
    lon: lng
  };

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

  if (currentPosition) {
    setStatus("目的地を設定しました。「徒歩ルートを検索」を押してください。");
  } else {
    setStatus("目的地を設定しました。先に現在地を取得してください。");
  }

  updateButtons();
});

// -----------------------------
// ルート検索
// -----------------------------

routeButton.addEventListener("click", async () => {
  if (!currentPosition || !destinationPosition) {
    setStatus("現在地と目的地の両方を設定してください。");
    return;
  }

  setStatus("ルートを検索しています...");

  const start =
    `${currentPosition.lon},${currentPosition.lat}`;

  const goal =
    `${destinationPosition.lon},${destinationPosition.lat}`;

  // OSRMでは profile に walking がないため、
  // 公開デモサーバーでは driving を利用しています。
  // 徒歩専用経路が必要な場合は OpenRouteService などに置き換えてください。
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
      setStatus("ルートが見つかりませんでした。");
      return;
    }

    const route = data.routes[0];

    const coordinates = route.geometry.coordinates.map(
      coord => [coord[1], coord[0]]
    );

    if (routeLine) {
      map.removeLayer(routeLine);
    }

    routeLine = L.polyline(coordinates, {
      weight: 6,
      opacity: 0.85
    }).addTo(map);

    map.fitBounds(routeLine.getBounds(), {
      padding: [30, 30]
    });

    distanceText.textContent = formatDistance(route.distance);
    durationText.textContent = formatDuration(route.duration);

    setStatus("ルートを表示しました。");

  } catch (error) {
    console.error(error);
    setStatus("ルート検索に失敗しました。ネットワーク接続を確認してください。");
  }
});

// -----------------------------
// Apple Maps を開く
// -----------------------------

appleMapsButton.addEventListener("click", () => {
  if (!destinationPosition) {
    setStatus("目的地を設定してください。");
    return;
  }

  const destination =
    `${destinationPosition.lat},${destinationPosition.lon}`;

  // dirflg=w : 徒歩
  // saddr を省略すると Apple Maps 側で現在地が使われます。
  const appleMapsUrl =
    `https://maps.apple.com/?daddr=${encodeURIComponent(destination)}&dirflg=w`;

  window.location.href = appleMapsUrl;
});

// -----------------------------
// クリア
// -----------------------------

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

// -----------------------------
// 補助関数
// -----------------------------

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

updateButtons();
