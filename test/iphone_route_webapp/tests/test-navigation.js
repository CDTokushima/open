const assert = require('node:assert/strict');
const C = require('../nav-core.js');
function near(x, y, e=1) { assert.ok(Math.abs(x-y) <= e, `${x} not near ${y}`); }
// スマホ上端が北向きのとき、目的ルートが北・東・南・西を示す
assert.equal(C.getArrow(0, 0), 'up');
assert.equal(C.getArrow(90, 0), 'right');
assert.equal(C.getArrow(180, 0), 'down');
assert.equal(C.getArrow(270, 0), 'left');
assert.equal(C.getArrow(90, 90), 'up');
assert.equal(C.getArrow(270, 90), 'down');
assert.equal(C.getArrow(0, 90), 'left');
assert.equal(C.getArrow(180, 90), 'right');
assert.equal(C.getArrow(46, 0, 'up'), 'up'); // チャタリング防止
assert.equal(C.getArrow(70, 0, 'up'), 'right');
const route = [[34.0, 134.0], [34.001,134.0], [34.001,134.001]];
const p=C.projectOnRoute(34.0005, 134.0001, route);
near(p.distanceM, 9.2, 0.4);
near(p.alongM, 55.6, 0.5);
assert.equal(C.getArrow(C.routeBearing(34.00045,134.0,route,[]).bearing,0), 'up');
const turns=C.extractTurns({ legs:[{ steps:[
  {maneuver:{type:'depart',location:[134,34],bearing_after:0}},
  {maneuver:{type:'turn',modifier:'right',location:[134,34.001],bearing_before:0,bearing_after:90}},
  {maneuver:{type:'arrive',location:[134.001,34.001],bearing_before:90}}
]}]},route);
assert.equal(turns.length,1);
near(turns[0].alongM,111.2,0.5);
assert.equal(C.getArrow(C.routeBearing(34.0008,134.0,route,turns).bearing,0), 'right');
const gps=C.estimateMotion(
  {lat:34,lon:134,accuracy:3,time:1000},
  {lat:34.0001,lon:134,accuracy:3,time:6000});
assert.ok(gps.speed>1.2 && gps.speed<3);
near(gps.heading,0,1);
assert.equal(C.estimateMotion(
  {lat:34,lon:134,accuracy:5,time:1000},
  {lat:34.00001,lon:134,accuracy:5,time:6000}).speed,0);
console.log('OK: 4-way arrows, orientation, hysteresis, route projection, upcoming turn, GPS fallback');
