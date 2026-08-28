// Bouchons DOM / Canvas pour faire tourner le jeu SANS navigateur.
//
// Objectif : exécuter la SIMULATION, pas le rendu. Tout ce qui dessine est
// donc un no-op — mais un no-op qui ne plante pas, car buildSprites() et
// consorts s'exécutent quand même au démarrage d'une partie. getImageData
// doit en particulier rendre un tampon de la bonne taille : le pipeline de
// détourage le parcourt.
//
// Aucune tentative de fidélité graphique ici. Si un test venait à dépendre
// de ce qui est réellement dessiné, ce n'est plus un test de simulation et
// il n'a pas sa place dans ce harnais.

'use strict';

function ctx2d(canvas) {
  const noop = () => {};
  return {
    canvas,
    // état
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
    font: '10px sans-serif', textAlign: 'left', textBaseline: 'alphabetic',
    globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
    lineCap: 'butt', lineJoin: 'miter', shadowBlur: 0, shadowColor: '#000',
    filter: 'none',
    // dessin
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    setTransform: noop, resetTransform: noop, transform: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    arc: noop, arcTo: noop, ellipse: noop, rect: noop, roundRect: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop,
    fill: noop, stroke: noop, clip: noop,
    fillRect: noop, strokeRect: noop, clearRect: noop,
    fillText: noop, strokeText: noop,
    drawImage: noop, setLineDash: noop, getLineDash: () => [],
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => null,
    measureText: (t) => ({ width: (t ? String(t).length : 0) * 6 }),
    // pixels — la seule partie qui doit rendre quelque chose de cohérent
    getImageData: (x, y, w, h) => ({
      width: w, height: h,
      data: new Uint8ClampedArray(Math.max(0, w * h * 4)),
    }),
    putImageData: noop,
    createImageData: (w, h) => ({
      width: w, height: h,
      data: new Uint8ClampedArray(Math.max(0, w * h * 4)),
    }),
  };
}

function mkCanvas(w = 300, h = 150) {
  const c = {
    width: w, height: h,
    style: {},
    getContext: () => c._ctx,
    toDataURL: () => 'data:,',
    addEventListener: () => {},
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: c.width, height: c.height, right: c.width, bottom: c.height }),
  };
  c._ctx = ctx2d(c);
  return c;
}

// Élément générique : tout getElementById inconnu en renvoie un. Il accepte
// n'importe quelle propriété et n'importe quel appel courant sans broncher.
function mkEl(tag = 'div', id = '') {
  const el = {
    tagName: String(tag).toUpperCase(),
    id,
    className: '',
    innerHTML: '', textContent: '', value: '', title: '', checked: false,
    style: new Proxy({}, { get: (t, k) => t[k] ?? '', set: (t, k, v) => (t[k] = v, true) }),
    dataset: {},
    children: [],
    childNodes: [],
    offsetWidth: 100, offsetHeight: 40, scrollTop: 0, scrollHeight: 100,
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); },
      contains(c) { return this._s.has(c); },
    },
    appendChild(n) { this.children.push(n); this.childNodes.push(n); return n; },
    removeChild(n) { this.children = this.children.filter((x) => x !== n); return n; },
    insertBefore(n) { this.children.unshift(n); return n; },
    replaceChildren() { this.children = []; },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    focus() {}, blur() {}, click() {}, remove() {}, scrollIntoView() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 40, right: 100, bottom: 40 }),
    closest: () => null,
    contains: () => false,
  };
  return el;
}

function installer(sandbox) {
  const cache = new Map();
  const doc = {
    documentElement: mkEl('html'),
    head: mkEl('head'),
    body: Object.assign(mkEl('body'), { addEventListener() {} }),
    createElement(tag) {
      return String(tag).toLowerCase() === 'canvas' ? mkCanvas() : mkEl(tag);
    },
    createElementNS(_, tag) { return this.createElement(tag); },
    createTextNode: (t) => ({ nodeType: 3, textContent: t }),
    getElementById(id) {
      if (!cache.has(id)) {
        // 'c' et 'mm' sont les deux <canvas> du jeu — ils DOIVENT rendre un
        // canvas, le reste du code appelle getContext dessus immédiatement.
        cache.set(id, id === 'c' || id === 'mm' ? mkCanvas(1280, 720) : mkEl('div', id));
      }
      return cache.get(id);
    },
    querySelector: (s) => doc.getElementById('__q_' + s),
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    fonts: { ready: Promise.resolve(), load: () => Promise.resolve() },
    hidden: false, visibilityState: 'visible',
  };

  const storage = (() => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
      clear: () => m.clear(),
      key: (i) => [...m.keys()][i] ?? null,
      get length() { return m.size; },
    };
  })();

  // Image : ne se charge JAMAIS. Les illustrations restent donc absentes et
  // le jeu garde son rendu procédural — exactement le repli prévu par
  // withIllustration/onerror. Le harnais teste la simulation, pas les
  // planches.
  class ImageStub {
    constructor() { this.width = 0; this.height = 0; this.onload = null; this.onerror = null; }
    set src(_) { /* silence : ni onload ni onerror */ }
    get src() { return ''; }
  }

  Object.assign(sandbox, {
    document: doc,
    navigator: { userAgent: 'node', vibrate: () => {}, share: undefined, clipboard: undefined, maxTouchPoints: 0 },
    location: { href: 'http://localhost/', hash: '', search: '', protocol: 'http:', reload() {} },
    localStorage: storage,
    sessionStorage: storage,
    Image: ImageStub,
    HTMLCanvasElement: function () {},
    OffscreenCanvas: function (w, h) { return mkCanvas(w, h); },
    requestAnimationFrame: () => 0,   // la boucle de rendu ne tourne jamais
    cancelAnimationFrame: () => {},
    setTimeout: (fn, ms, ...a) => setTimeout(fn, ms, ...a),
    clearTimeout: (h) => clearTimeout(h),
    setInterval: () => 0,             // pas d'auto-sauvegarde ni de pouls réseau
    clearInterval: () => {},
    performance: { now: () => Number(process.hrtime.bigint() / 1000n) / 1000 },
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    // Pas d'AudioContext : SFX.init() teste explicitement sa présence et
    // renonce sans bruit (« pas d'audio disponible : le jeu tourne quand
    // même »), après quoi sfx() sort immédiatement sur `!SFX.ctx`. Bien plus
    // sûr que de bouchonner l'arbre des nœuds audio — la première tentative
    // le faisait et plantait sur `f.Q.value`, un paramètre oublié parmi la
    // dizaine que le jeu touche.
    AudioContext: undefined,
    alert() {}, confirm: () => false, prompt: () => null,
    fetch: () => Promise.reject(new Error('réseau désactivé dans le harnais')),
    WebSocket: function () { throw new Error('réseau désactivé dans le harnais'); },
    RTCPeerConnection: function () { throw new Error('réseau désactivé dans le harnais'); },
  });
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  return sandbox;
}

module.exports = { installer, mkCanvas, mkEl };
