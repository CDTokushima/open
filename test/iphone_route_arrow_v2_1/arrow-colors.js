/* v2.1: 矢印の配色だけを管理する。GPSやルーティングには介入しない。 */
(() => {
  'use strict';

  const STORAGE_KEY = 'iphone-route-arrow-color-v1';
  const PALETTES = {
    black: { fill: '#111111', stroke: '#000000' },
    blue: { fill: '#0057b8', stroke: '#003b7a' }
  };
  const root = document.documentElement;
  const buttons = Array.from(document.querySelectorAll('[data-arrow-color]'));

  function setArrowColor(name) {
    const selected = Object.prototype.hasOwnProperty.call(PALETTES, name) ? name : 'black';
    root.style.setProperty('--nav-arrow-fill', PALETTES[selected].fill);
    root.style.setProperty('--nav-arrow-stroke', PALETTES[selected].stroke);
    buttons.forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.arrowColor === selected));
    });
    return selected;
  }

  let saved = 'black';
  try {
    saved = localStorage.getItem(STORAGE_KEY) || 'black';
  } catch (_) {
    // iOSプライベートモードなど、保存が利用できない場合も通常動作する。
  }
  setArrowColor(saved);

  buttons.forEach(button => {
    button.addEventListener('click', () => {
      const selected = setArrowColor(button.dataset.arrowColor);
      try {
        localStorage.setItem(STORAGE_KEY, selected);
      } catch (_) {
        // 保存不可の場合はこの画面内だけで色を反映する。
      }
    });
  });
})();
