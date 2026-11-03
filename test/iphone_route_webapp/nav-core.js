/* 自転車ナビで使う純粋な計算関数。ブラウザとNodeの双方で利用可能。 */
(function (root) {
  'use strict';
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  function norm360(a) { return ((a % 360) + 360) % 360; }
  function angleDiff(to, from) { return ((to - from + 540) % 360) - 180; }

  function distanceM(lat1, lon1, lat2, lon2) {
    const p1 = toRad(lat1), p2 = toRad(lat2);
    const dp = toRad(lat2 - lat1), dl = toRad(lon2 - lon1);
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function bearing(a, b) { // [lat, lon] の2点
    const p1 = toRad(a[0]), p2 = toRad(b[0]);
    const dl = toRad(b[1] - a[1]);
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return norm360(toDeg(Math.atan2(y, x)));
  }

  // ルートの全線分に対する最短距離と、始点からの進捗距離を得る。
  function projectOnRoute(lat, lon, points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    const kLat = 111195, kLon = 111195 * Math.cos(toRad(lat));
    let accumulated = 0, best = null;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const ax = (a[1] - lon) * kLon, ay = (a[0] - lat) * kLat;
      const bx = (b[1] - lon) * kLon, by = (b[0] - lat) * kLat;
      const dx = bx - ax, dy = by - ay;
      const length2 = dx * dx + dy * dy;
      const t = length2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2)) : 0;
      const x = ax + t * dx, y = ay + t * dy;
      const d = Math.hypot(x, y);
      const segmentM = distanceM(a[0], a[1], b[0], b[1]);
      if (!best || d < best.distanceM) {
        best = { distanceM: d, alongM: accumulated + t * segmentM,
          nearest: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
          segmentIndex: i };
      }
      accumulated += segmentM;
    }
    return best;
  }

  // ルート始点からの距離sにおける点を補間。
  function pointAtDistance(points, s) {
    if (!points.length) return null;
    if (points.length === 1) return points[0];
    let used = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const n = distanceM(a[0], a[1], b[0], b[1]);
      if (used + n >= s && n > 0) {
        const t = Math.max(0, Math.min(1, (s - used) / n));
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      }
      used += n;
    }
    return points[points.length - 1];
  }

  // OSRMのStepManeuverから、地点と曲がった後の方位を取り出す。
  function extractTurns(route, points) {
    const items = [];
    for (const leg of route.legs || []) {
      for (const step of leg.steps || []) {
        const m = step.maneuver;
        if (!m || !Array.isArray(m.location) || m.type === 'depart' || m.type === 'arrive') continue;
        if (!Number.isFinite(m.bearing_after)) continue;
        const p = projectOnRoute(m.location[1], m.location[0], points);
        if (!p) continue;
        const delta = Number.isFinite(m.bearing_before) ?
          Math.abs(angleDiff(m.bearing_after, m.bearing_before)) : 0;
        const isUturn = m.modifier === 'uturn';
        // 道なりの名称変更や非常に小さな角度の変化は案内しない。
        if (!isUturn && delta < 35) continue;
        items.push({ alongM: p.alongM, afterBearing: norm360(m.bearing_after),
          angle: delta, type: m.type, modifier: m.modifier || '' });
      }
    }
    return items.sort((a, b) => a.alongM - b.alongM);
  }

  // 今いるルートの25m前方、または近い交差点の曲がった後の方向を選ぶ。
  function routeBearing(lat, lon, points, turns, speed = 0) {
    const projection = projectOnRoute(lat, lon, points);
    if (!projection) return null;
    const lookTurnM = Math.max(30, Math.min(45, (speed || 0) * 5));
    const next = (turns || []).find(t =>
      t.alongM >= projection.alongM - 5 &&
      t.alongM - projection.alongM <= lookTurnM
    );
    if (next) return { bearing: next.afterBearing, mode: 'turn',
      distanceToTurnM: Math.max(0, next.alongM - projection.alongM),
      offRouteM: projection.distanceM };
    const ahead = pointAtDistance(points, projection.alongM + Math.max(20, Math.min(40, (speed || 0) * 4)));
    if (!ahead) return null;
    const from = projection.nearest;
    const dir = distanceM(from[0], from[1], ahead[0], ahead[1]) > 0.3 ?
      bearing(from, ahead) : bearing(points[points.length - 2], points[points.length - 1]);
    return { bearing: dir, mode: 'path', distanceToTurnM: null,
      offRouteM: projection.distanceM };
  }

  const centers = { up: 0, right: 90, down: 180, left: 270 };
  function getArrow(desiredBearing, phoneHeading, previous = null) {
    if (!Number.isFinite(desiredBearing) || !Number.isFinite(phoneHeading)) return null;
    const angle = norm360(desiredBearing - phoneHeading);
    // 境界付近で矢印が左右に点滅しないよう約10度のヒステリシスを付ける。
    if (previous && centers[previous] !== undefined &&
        Math.abs(angleDiff(angle, centers[previous])) < 55) return previous;
    if (angle < 45 || angle >= 315) return 'up';
    if (angle < 135) return 'right';
    if (angle < 225) return 'down';
    return 'left';
  }

  // 速度未提供時は2地点から速度・進行方位を推定。GPSのブレは閾値で抑制。
  function estimateMotion(previous, latest) {
    if (!previous || !latest) return { speed: null, heading: null };
    const elapsed = (latest.time - previous.time) / 1000;
    if (!(elapsed >= 1 && elapsed <= 25) ||
        previous.accuracy > 30 || latest.accuracy > 30) return { speed: null, heading: null };
    const d = distanceM(previous.lat, previous.lon, latest.lat, latest.lon);
    const noise = Math.max(10, (previous.accuracy + latest.accuracy) * 0.9);
    if (d <= noise) return { speed: 0, heading: null };
    return { speed: d / elapsed, heading: bearing([previous.lat, previous.lon], [latest.lat, latest.lon]) };
  }

  const API = { norm360, angleDiff, distanceM, bearing, projectOnRoute, pointAtDistance,
    extractTurns, routeBearing, getArrow, estimateMotion };
  root.NaviCore = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
