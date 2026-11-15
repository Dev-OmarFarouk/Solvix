/* Explore by Worlds and the flight between two machines.
 *
 * The globe is the archive's own three.js sphere with NASA's Moon and Mars
 * maps (js/globe-viewer.js); if WebGL is unavailable it falls back to the same
 * map drawn pixel by pixel into a small buffer. The flight between machines is
 * 2D: an SVG rocket on a curve between two projected points.
 */
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var DEG = Math.PI / 180;

  /* How each world introduces itself. */
  var WORLDS = {
    Moon: {
      label: 'The Moon',
      blurb: 'Three machines on one small world: two lunar modules and the robots that proved the ground was safe to stand on.'
    },
    Mars: {
      label: 'Mars',
      blurb: 'Four machines spread across a whole planet, from a polar plain in the north down to a crater near the equator.'
    },
    'Asteroid belt': {
      label: 'Asteroid belt',
      blurb: 'Two travellers between the planets: the first spacecraft to orbit and land on an asteroid, and the first to circle two worlds beyond Earth.'
    }
  };

  /* One entry per machine, in the order the mission pages are written. */
  var VEHICLES = [
    { id: 'eagle', name: 'Eagle', world: 'Moon', lat: 0.67, lon: 23.47, model: 'lm', group: 0, where: 'Sea of Tranquility' },
    { id: 'intrepid', name: 'Intrepid', world: 'Moon', lat: -3.01, lon: -23.42, model: 'lm', group: 1, where: 'Ocean of Storms' },
    { id: 'surveyor', name: 'Surveyor Landers', world: 'Moon', lat: -2.94, lon: -23.44, model: 'surveyor', group: 2, where: 'Oceanus Procellarum' },
    { id: 'viking', name: 'Viking 1 & 2', world: 'Mars', lat: 22.27, lon: -47.95, model: 'viking', group: 3, where: 'Chryse · Utopia' },
    { id: 'sojourner', name: 'Sojourner', world: 'Mars', lat: 19.13, lon: -33.22, model: 'sojourner', group: 4, where: 'Ares Vallis' },
    { id: 'spirit-opportunity', name: 'Spirit & Opportunity', world: 'Mars', lat: -14.57, lon: 175.47, model: 'mer', group: 5, where: 'Gusev · Meridiani' },
    { id: 'phoenix-insight', name: 'Phoenix & InSight', world: 'Mars', lat: 68.22, lon: -125.75, model: 'phoenix', group: 6, where: 'Vastitas Borealis · Elysium' },
    { id: 'near', name: 'NEAR Shoemaker', world: 'Asteroid belt', lat: 21.4, lon: -47.6, model: 'near', group: 7, where: '433 Eros' },
    { id: 'dawn', name: 'Dawn', world: 'Asteroid belt', lat: -11.8, lon: 62.9, model: 'dawn', group: 8, where: 'Vesta & Ceres' }
  ];

  /* ------------------------------------------------------------------ */
  /* Textures                                                           */
  /* ------------------------------------------------------------------ */

  var maps = {};
  var mapLoading = {};

  function loadMap(world, done) {
    if (maps[world]) { done(maps[world]); return; }
    if (mapLoading[world]) { mapLoading[world].push(done); return; }
    mapLoading[world] = [done];
    var file = world === 'Mars' ? 'assets/mars-globe.jpg'
      : (world === 'Asteroid belt' ? 'textures/ceres-color.jpg' : 'assets/moon-globe.jpg');
    var img = new Image();
    img.onload = function () {
      // Sample from a fixed-size buffer so the per-pixel loop stays cheap.
      var w = 1024, h = 512;
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      maps[world] = { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
      mapLoading[world].forEach(function (fn) { fn(maps[world]); });
      mapLoading[world] = null;
    };
    img.onerror = function () {
      mapLoading[world].forEach(function (fn) { fn(null); });
      mapLoading[world] = null;
    };
    img.src = file;
  }

  /* ------------------------------------------------------------------ */
  /* The globe                                                          */
  /* ------------------------------------------------------------------ */

  var BUFFER = 208;

  function FlatGlobe(canvas, options) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.options = options || {};
    this.world = this.options.world || 'Moon';
    this.rotation = this.options.rotation || 0;
    this.spin = this.options.spin === undefined ? 0.0016 : this.options.spin;
    this.dragging = false;
    this.lastX = 0;
    this.map = null;
    this.frame = 0;
    this.buffer = document.createElement('canvas');
    this.buffer.width = BUFFER;
    this.buffer.height = BUFFER;
    this.bufCtx = this.buffer.getContext('2d');
    this.pixels = this.bufCtx.createImageData(BUFFER, BUFFER);
    this.last = 0;
    this.onFrame = this.options.onFrame || null;
    this.dead = false;
    this.bind();
    var self = this;
    this.reload(function () { self.start(); });
  }

  FlatGlobe.prototype.bind = function () {
    var self = this;
    var canvas = this.canvas;
    canvas.addEventListener('pointerdown', function (e) {
      self.dragging = true;
      self.lastX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!self.dragging) return;
      self.rotation += (e.clientX - self.lastX) * 0.007;
      self.lastX = e.clientX;
      self.draw();
    });
    var stop = function () { self.dragging = false; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    canvas.addEventListener('pointerleave', stop);
  };

  FlatGlobe.prototype.setWorld = function (world) {
    if (this.world === world) return;
    this.world = world;
    var self = this;
    this.reload(function () { self.draw(); });
  };

  FlatGlobe.prototype.reload = function (done) {
    var self = this;
    this.map = null;
    loadMap(this.world, function (map) {
      self.map = map;
      if (done) done();
    });
  };

  FlatGlobe.prototype.start = function () {
    if (this.dead || this.frame) return;
    var self = this;
    var loop = function (time) {
      self.frame = requestAnimationFrame(loop);
      // 30 frames a second is plenty for a turning globe and leaves the main
      // thread free for the rocket and the page around it.
      if (time - self.last < 30) return;
      self.last = time;
      if (!self.dragging && self.spin) self.rotation += self.spin;
      self.draw();
    };
    this.frame = requestAnimationFrame(loop);
  };

  FlatGlobe.prototype.stop = function () {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  };

  /** Retire it: a map that finishes loading late must not start drawing again. */
  FlatGlobe.prototype.destroy = function () {
    this.dead = true;
    this.stop();
  };

  FlatGlobe.prototype.size = function () {
    var box = this.canvas.getBoundingClientRect();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(1, Math.round(box.width * dpr));
    var h = Math.max(1, Math.round(box.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return { w: box.width, h: box.height, dpr: dpr };
  };

  FlatGlobe.prototype.draw = function () {
    var size = this.size();
    // Nothing to draw into while the page is hidden.
    if (size.w < 8 || size.h < 8) return;
    if (this.world === 'Asteroid belt') {
      this.drawRocks(size);
      if (this.onFrame) this.onFrame(this);
      return;
    }
    var ctx = this.ctx;
    var dpr = size.dpr;
    var R = Math.min(size.w, size.h) * 0.47;
    var cx = size.w / 2;
    var cy = size.h / 2;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    // The glow that sits behind the disc.
    var halo = ctx.createRadialGradient(cx, cy, R * 0.86, cx, cy, R * 1.22);
    halo.addColorStop(0, this.world === 'Mars' ? 'rgba(255,140,80,0.20)' : (this.world === 'Asteroid belt' ? 'rgba(220,190,150,0.18)' : 'rgba(120,210,255,0.20)'));
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.24, 0, TAU);
    ctx.fill();

    // Shadow side of the sphere.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();
    ctx.fillStyle = this.world === 'Mars' ? '#2a1109' : (this.world === 'Asteroid belt' ? '#1a1612' : '#0a1320');
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.restore();

    if (this.map) {
      this.paintSphere(cx, cy, R);
      ctx.drawImage(this.buffer, cx - R, cy - R, R * 2, R * 2);
    }

    // Limb darkening and a thin lit edge.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();
    var limb = ctx.createRadialGradient(cx - R * 0.18, cy - R * 0.22, R * 0.25, cx, cy, R);
    limb.addColorStop(0, 'rgba(255,255,255,0.10)');
    limb.addColorStop(0.62, 'rgba(0,0,0,0)');
    limb.addColorStop(1, 'rgba(2,8,18,0.82)');
    ctx.fillStyle = limb;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, R - 0.5, 0, TAU);
    ctx.strokeStyle = this.world === 'Mars' ? 'rgba(255,150,90,0.35)' : (this.world === 'Asteroid belt' ? 'rgba(210,180,140,0.32)' : 'rgba(140,220,255,0.38)');
    ctx.lineWidth = 1.2;
    ctx.stroke();

    if (this.onFrame) this.onFrame(this);
  };

  /* Two asteroids, side by side, for the browsers without WebGL. */
  var rockCache = {};
  function rockFor(seed) {
    if (!rockCache[seed]) {
      var rock = document.createElement('canvas');
      tpPaintRock(rock, 320, seed);
      rockCache[seed] = rock;
    }
    return rockCache[seed];
  }

  /** Where the two rocks sit in the stage, in CSS pixels: the same pair as the
   *  3D stage, Eros long and low on the left, Vesta round on the right. */
  function flatRockRects(w, h) {
    return [
      { cx: w * 0.285, cy: h * 0.5, rw: w * 0.4, rh: h * 0.205, seed: 'eros-433' },
      { cx: w * 0.745, cy: h * 0.5, rw: w * 0.27, rh: h * 0.235, seed: 'vesta-4' }
    ];
  }

  FlatGlobe.prototype.drawRocks = function (size) {
    var ctx = this.ctx;
    var dpr = size.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    var rects = flatRockRects(size.w, size.h);
    var calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var t = calm ? 0 : performance.now() / 1000;
    for (var i = 0; i < rects.length; i += 1) {
      var r = rects[i];
      var bob = calm ? 0 : Math.sin(t * 0.52 + i * 1.9) * size.h * 0.008;
      var rock = rockFor(r.seed);
      // The glow each rock sits in, warm and low, like the 3D stage.
      var glow = ctx.createRadialGradient(r.cx, r.cy + bob, r.rw * 0.1, r.cx, r.cy + bob, r.rw * 0.62);
      glow.addColorStop(0, 'rgba(220,190,150,0.14)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(r.cx, r.cy + bob, r.rw * 0.64, 0, TAU);
      ctx.fill();
      ctx.drawImage(rock, r.cx - r.rw / 2, r.cy - r.rh / 2 + bob, r.rw, r.rh);
    }
  };

  /** Orthographic projection of the map into a small RGBA buffer. */
  FlatGlobe.prototype.paintSphere = function (cx, cy, R) {
    var data = this.pixels.data;
    var map = this.map;
    var src = map.data;
    var mw = map.width;
    var mh = map.height;
    var cos = Math.cos(this.rotation);
    var sin = Math.sin(this.rotation);
    var n = BUFFER;
    var half = n / 2;
    // Light from the upper left, matching the page's sun.
    var lx = -0.52, ly = 0.46, lz = 0.72;
    var ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
    lx /= ll; ly /= ll; lz /= ll;

    for (var py = 0; py < n; py += 1) {
      var ny = (half - py - 0.5) / half;
      for (var px = 0; px < n; px += 1) {
        var nx = (px + 0.5 - half) / half;
        var i = (py * n + px) * 4;
        var r2 = nx * nx + ny * ny;
        if (r2 >= 1) { data[i + 3] = 0; continue; }
        var nz = Math.sqrt(1 - r2);
        var rx = nx * cos - nz * sin;
        var rz = nx * sin + nz * cos;
        var u = Math.atan2(rx, rz) / TAU + 0.5;
        var v = 0.5 - Math.asin(ny) / Math.PI;
        var tx = (u * mw) | 0;
        var ty = (v * mh) | 0;
        if (tx < 0) tx = 0; else if (tx >= mw) tx = mw - 1;
        if (ty < 0) ty = 0; else if (ty >= mh) ty = mh - 1;
        var s = (ty * mw + tx) * 4;
        var diff = nx * lx + ny * ly + nz * lz;
        var shade = 0.22 + 1.06 * (diff > 0 ? diff : 0);
        var edge = 0.55 + 0.45 * nz;
        var k = shade * edge;
        if (k > 1.35) k = 1.35;
        data[i] = Math.min(255, src[s] * k);
        data[i + 1] = Math.min(255, src[s + 1] * k);
        data[i + 2] = Math.min(255, src[s + 2] * k);
        data[i + 3] = 255;
      }
    }
    this.bufCtx.putImageData(this.pixels, 0, 0);
  };

  /** Where a coordinate sits on the visible disc, in CSS pixels. */
  FlatGlobe.prototype.project = function (lat, lon, id) {
    var box = this.canvas.getBoundingClientRect();
    if (this.world === 'Asteroid belt') {
      var rects = flatRockRects(box.width, box.height);
      var rock = rects[id === 'dawn' ? 1 : 0] || rects[0];
      var u = Math.max(-1, Math.min(1, lon / 95)) * 0.72;
      // Under the face turned toward the reader, like the 3D stage, so the tag
      // hangs below the rock instead of sitting on top of it.
      return {
        x: rock.cx + u * rock.rw * 0.3,
        y: rock.cy + rock.rh * 0.44,
        z: 0.82,
        r: rock.rw / 2
      };
    }
    var R = Math.min(box.width, box.height) * 0.47;
    var phi = lat * DEG;
    var lam = lon * DEG + this.rotation;
    var x = Math.cos(phi) * Math.sin(lam);
    var z = Math.cos(phi) * Math.cos(lam);
    var y = Math.sin(phi);
    return {
      x: box.width / 2 + x * R,
      y: box.height / 2 - y * R,
      z: z,
      r: R
    };
  };

  /* The names above the two rocks, measured in stage pixels. */
  FlatGlobe.prototype.asteroidAnchor = function (index) {
    var box = this.canvas.getBoundingClientRect();
    var rects = flatRockRects(box.width, box.height);
    var rock = rects[index];
    if (!rock) return { x: box.width / 2, y: box.height / 2, r: 10, visible: false };
    return {
      x: rock.cx,
      y: rock.cy - rock.rh * 0.52,
      r: rock.rw / 2,
      visible: this.world === 'Asteroid belt'
    };
  };

  /* ------------------------------------------------------------------ */
  /* The Explore by Worlds page                                         */
  /* ------------------------------------------------------------------ */

  var stage = null;
  var pointsLayer = null;
  var globe = null;
  var activeWorld = 'Moon';
  var worldShift = null;
  var onPick = null;
  var pointButtons = [];
  // The two asteroid names float above the rocks in the belt view.
  var asteroidLabels = [];
  // Where each label sits is decided once per world, so the globe can move
  // underneath without the names hopping from side to side.
  var layoutLocked = false;
  var worldsVisible = false;

  /**
   * The globe on the page: the real three.js sphere with NASA's maps when the
   * browser can render it, and the hand-drawn map otherwise.
   */
  function createGlobe() {
    if (!stage) return;
    var old = document.getElementById('globe');
    if (!old) return;
    var canvas = document.createElement('canvas');
    canvas.id = 'globe';
    canvas.setAttribute('aria-label', 'A turning globe with the machines on it');
    old.parentNode.replaceChild(canvas, old);

    if (globe) {
      try {
        globe.stop();
        if (globe.destroy) globe.destroy();
        if (globe.dispose) globe.dispose();
      } catch (error) { /* keep going with the new one */ }
      globe = null;
    }

    var Ctor = window.SolvixGlobe;
    if (Ctor) {
      try {
        globe = new Ctor(canvas, { world: activeWorld, onFrame: placePoints });
      } catch (error) {
        console.warn('The 3D globe could not start; drawing the map instead.', error);
        globe = null;
      }
    }
    if (!globe) globe = new FlatGlobe(canvas, { world: activeWorld, onFrame: placePoints });

    if (worldsVisible) { if (globe.resize) globe.resize(); globe.start(); globe.draw(); }
  }

  function buildPoints() {
    if (!pointsLayer) return;
    pointsLayer.innerHTML = '';
    pointButtons = [];
    layoutLocked = false;
    VEHICLES.filter(function (v) { return v.world === activeWorld; }).forEach(function (v) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'g-point';
      button.innerHTML =
        '<span class="g-dot"></span><span class="g-tag"><b>' + v.name + '</b><i>' + v.where + '</i></span>';
      // Hold the globe still while a point is under the cursor, so a slow turn
      // never moves the target out from under the click.
      button.addEventListener('pointerenter', function () {
        if (globe) { globe.held = globe.spin; globe.spin = 0; }
      });
      button.addEventListener('pointerleave', function () {
        if (globe && globe.held !== null) { globe.spin = globe.held; globe.held = null; }
      });
      button.addEventListener('click', function () {
        if (onPick) onPick(v.group);
      });
      // Two machines that landed on almost the same spot (Apollo 12 came down
      // beside Surveyor 3) keep their dots on the real coordinates, and one
      // label slides down so both names stay readable.
      var tag = button.querySelector('.g-tag');
      pointsLayer.appendChild(button);
      pointButtons.push({ el: button, tag: tag, stacked: false, vehicle: v });
    });
    // Machines sharing a landing site (Apollo 12 came down beside Surveyor 3)
    // both keep a short label, so each name stays beside its own dot.
    pointButtons.forEach(function (a, ai) {
      a.stacked = pointButtons.some(function (b, bi) {
        return bi !== ai && Math.abs(a.vehicle.lat - b.vehicle.lat) + Math.abs(a.vehicle.lon - b.vehicle.lon) < 2;
      });
      a.el.classList.toggle('is-stacked', a.stacked);
    });
    // Each asteroid carries its own name, so the belt no longer needs a
    // single heading to speak for both of them.
    asteroidLabels = [];
    if (activeWorld === 'Asteroid belt') {
      [['Eros', 'near'], ['Vesta', 'dawn']].forEach(function (pair) {
        var name = document.createElement('div');
        name.className = 'g-asteroid-name';
        name.textContent = pair[0];
        name.setAttribute('aria-hidden', 'true');
        pointsLayer.appendChild(name);
        asteroidLabels.push(name);
      });
    }
    // Place them now, so a globe that is not animating never leaves them in the corner.
    if (globe && worldsVisible) placePoints();
  }

  var DOT = 13, GAP = 9, PAD = 6;

  function boxesOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  var resizing = false;

  function placePoints() {
    if (!globe || !pointsLayer) return;
    var stage = pointsLayer.getBoundingClientRect();
    if (stage.width < 8 || stage.height < 8) return;

    // A resize can be missed while the page is hidden: catch it by comparing
    // the drawing buffer with the space the globe actually has.
    var canvas = document.getElementById('globe');
    if (canvas && globe.resize && !resizing) {
      var ratio = Math.min(2, window.devicePixelRatio || 1);
      if (Math.abs(canvas.width / ratio - stage.width) > 1.5) {
        resizing = true;
        globe.resize();
        resizing = false;
      }
    }

    // The asteroid names sit just above their rocks, in the stage's own pixels.
    if (asteroidLabels.length && globe.asteroidAnchor) {
      for (var li = 0; li < asteroidLabels.length; li += 1) {
        var anchor = globe.asteroidAnchor(li);
        var labelEl = asteroidLabels[li];
        if (!anchor || !anchor.visible) { labelEl.style.opacity = '0'; continue; }
        labelEl.style.left = anchor.x.toFixed(1) + 'px';
        labelEl.style.top = (anchor.y - 12).toFixed(1) + 'px';
        labelEl.style.opacity = String(0.6 + 0.4 * Math.min(1, anchor.r / 90));
      }
    }

    var items = [];
    var i;
    for (i = 0; i < pointButtons.length; i += 1) {
      var entry = pointButtons[i];
      var p = globe.project(entry.vehicle.lat, entry.vehicle.lon, entry.vehicle.id);
      var visible = p.z > 0.12;
      var strength = Math.max(0, Math.min(1, (p.z - 0.12) / 0.4));
      if (visible) {
        if (!entry.w) {
          entry.w = entry.tag.offsetWidth;
          entry.h = entry.tag.offsetHeight;
        }
        // The label hangs on the inside of the globe, and the two thresholds
        // keep it from flicking back and forth as the globe turns.
        if (entry.side === undefined) entry.side = p.x > stage.width * 0.5;
        else if (!entry.side && p.x > stage.width * 0.62) entry.side = true;
        else if (entry.side && p.x < stage.width * 0.4) entry.side = false;
      }
      items.push({ entry: entry, p: p, visible: visible, strength: strength });
    }

    // Two machines can share a landing site (Apollo 12 came down right beside
    // Surveyor 3), which would leave them on the same pixel: fan them apart so
    // each one keeps its own dot to touch. That decision is kept for the whole
    // visit, so a turning globe never makes the pair jump.
    for (i = 0; i < items.length; i += 1) {
      var fan = items[i].entry.fan;
      if (!fan) continue;
      items[i].dx = fan.dx;
      items[i].dy = fan.dy;
      items[i].flipSide = fan.flip;
      items[i].labelShift = fan.shift;
    }
    if (!layoutLocked) {
      for (i = 0; i < items.length; i += 1) {
        if (!items[i].visible || items[i].entry.fan) continue;
        for (var j = 0; j < i; j += 1) {
          if (!items[j].visible) continue;
          var gapX = (items[i].p.x + (items[i].dx || 0)) - (items[j].p.x + (items[j].dx || 0));
          var gapY = (items[i].p.y + (items[i].dy || 0)) - (items[j].p.y + (items[j].dy || 0));
          if (Math.sqrt(gapX * gapX + gapY * gapY) < 17) {
            items[i].dx = (items[i].dx || 0) + 15;
            items[i].dy = (items[i].dy || 0) - 17;
            // Their labels would lie over each other: send this one the other way.
            var otherLeft = items[j].flipSide ? !items[j].entry.side : !!items[j].entry.side;
            items[i].flipSide = (!!items[i].entry.side) === otherLeft;
            // Their names stack around the two dots instead of one running away.
            var apart = items[i].p.y >= items[j].p.y ? 1 : -1;
            items[i].labelShift = apart * 15;
            items[j].labelShift = -apart * 15;
          }
        }
      }
      for (i = 0; i < items.length; i += 1) {
        if (items[i].entry.fan) continue;
        items[i].entry.fan = {
          dx: items[i].dx || 0,
          dy: items[i].dy || 0,
          flip: items[i].flipSide,
          shift: items[i].labelShift || 0
        };
      }
      layoutLocked = true;
    }

    var placed = [];
    for (i = 0; i < items.length; i += 1) {
      var item = items[i];
      var e = item.entry;
      if (!item.visible) {
        e.el.style.opacity = '0';
        e.el.classList.add('is-behind');
        continue;
      }

      var px = item.p.x + (item.dx || 0);
      var py = item.p.y + (item.dy || 0);
      var tagW = e.w || 0;
      var tagH = e.h || 0;
      var rowH = Math.max(DOT, tagH);
      // Room on each side of the dot, and which side the label leans to.
      var spaceLeft = px - DOT / 2 - GAP;
      var spaceRight = stage.width - (px + DOT / 2 + GAP);
      // Every name sits to the right of its dot.
      var preferLeft = false;
      var left = preferLeft;

      // The name sits beside its dot, stays inside the stage and steps clear of
      // every label and dot already placed this frame.
      var centred = py - tagH / 2;
      var baseTop = centred + (item.labelShift || 0);
      var own = { x: px - DOT / 2, y: py - DOT / 2, w: DOT, h: DOT };
      var rect = null;
      if (e.lock) {
        // A label that has found its place keeps it: only the dot keeps moving.
        left = false;
        rect = {
          x: left ? spaceLeft - tagW : px + DOT / 2 + GAP,
          y: centred + e.lock.dy,
          w: tagW,
          h: tagH
        };
      } else {

        var step = tagH + PAD;
        var order = [0, 1, -1, 2, -2, 3, -3];
        // Try each side: the nearest free slot, and the one that stays on the globe.
        var best = null;
        for (var side = 0; side < 2; side += 1) {
          var onLeft = side === 0 ? preferLeft : !preferLeft;
          var room = onLeft ? spaceLeft : spaceRight;
          var x = onLeft ? spaceLeft - tagW : px + DOT / 2 + GAP;
          for (var k = 0; k < order.length; k += 1) {
            var top = baseTop + order[k] * step;
            if (top < PAD || top + tagH > stage.height - PAD) continue;
            var cand = { x: x, y: top, w: tagW, h: tagH, left: onLeft };
            var clear = !boxesOverlap(cand, own);
            for (var q = 0; clear && q < placed.length; q += 1) if (boxesOverlap(cand, placed[q])) clear = false;
            if (!clear) continue;
            var score = Math.abs(order[k] * step) + (room < tagW - 26 ? 400 : 0) + (side === 0 ? 0 : 20);
            if (!best || score < best.score) best = { score: score, rect: cand, shift: order[k] * step };
            break;
          }
        }
        if (best) { rect = best.rect; left = rect.left; }
        else { rect = { x: left ? spaceLeft - tagW : px + DOT / 2 + GAP, y: Math.max(PAD, Math.min(stage.height - tagH - PAD, baseTop)), w: tagW, h: tagH }; }
        e.lock = { left: left, dy: rect.y - centred };
      }
      placed.push(rect, own);

      // With the label on the left the row is laid out in reverse, so the dot
      // sits at the row's right end: shift the whole row back by the label.
      e.el.classList.toggle('is-left', left);
      var rowX = left ? px - DOT / 2 - GAP - tagW : px - DOT / 2;
      e.el.style.transform =
        'translate(' + rowX.toFixed(1) + 'px,' + (py - rowH / 2).toFixed(1) + 'px)';
      e.el.style.opacity = String(0.35 + 0.65 * item.strength);
      e.el.classList.remove('is-behind');

      var dy = rect.y - centred;
      e.tag.style.transform = Math.abs(dy) < 0.5 ? '' : 'translateY(' + Math.round(dy) + 'px)';
    }
  }

  function setWorld(world) {
    var label = document.getElementById('worlds-name');
    var blurb = document.getElementById('worlds-blurb');
    var calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    function paint() {
      if (globe) globe.setWorld(world);
      buildPoints();
      var words = WORLDS[world] || WORLDS.Moon;
      if (label) label.textContent = words.label;
      if (blurb) blurb.textContent = words.blurb;
      if (stage) stage.setAttribute('data-world', world);
      var section = document.getElementById('worlds');
      if (section) section.classList.toggle('is-belt', world === 'Asteroid belt');
      document.querySelectorAll('#worlds .world-tabs button').forEach(function (b) {
        b.classList.toggle('on', b.dataset.w === world);
      });
    }

    var moving = world !== activeWorld;
    activeWorld = world;

    if (!moving || !stage || calm) { paint(); return; }

    // A quick turn: the planet whirls out of focus, the new world takes over
    // while it is blurred, and everything settles back in.
    clearTimeout(worldShift && worldShift.swap);
    clearTimeout(worldShift && worldShift.end);
    stage.setAttribute('data-to', world);
    stage.classList.add('is-shifting');
    if (label) label.classList.add('is-swapping');
    worldShift = {
      swap: setTimeout(function () {
        paint();
        if (label) label.classList.remove('is-swapping');
      }, 250),
      end: setTimeout(function () {
        stage.classList.remove('is-shifting');
        document.querySelectorAll('#worlds .world-tabs button').forEach(function (b) {
          b.classList.toggle('on', b.dataset.w === world);
        });
        worldShift = null;
      }, 430)
    };
  }


  function initWorlds(pick) {
    onPick = pick;
    stage = document.getElementById('globe-stage');
    pointsLayer = document.getElementById('globe-points');
    if (!stage || !document.getElementById('globe')) return;
    createGlobe();
    buildPoints();
    document.querySelectorAll('#worlds .world-tabs button').forEach(function (b) {
      b.addEventListener('click', function () { setWorld(b.dataset.w); });
    });
    // The 3D globe arrives with its module: swap it in over the drawn one.
    window.addEventListener('solvix:globe-ready', createGlobe);
    // Label sizes change with the viewport, so measure them again.
    window.addEventListener('resize', function () {
      pointButtons.forEach(function (e) { e.w = 0; e.h = 0; });
      placePoints();
    });
  }

  function showWorlds() {
    worldsVisible = true;
    if (!globe) return;
    if (globe.resize) globe.resize();
    globe.start();
    globe.draw();
  }

  function hideWorlds() {
    worldsVisible = false;
    if (globe) globe.stop();
  }

    /* ------------------------------------------------------------------ */
  /* The hop between two machines                                       */
  /* ------------------------------------------------------------------ */
  /* A true orthographic view of the world, painted from the same map the
     globe uses, so both machines sit on the real ground. The flight is the
     great circle between them and one clock drives the whole thing. */

  function tpSph(lat, lon) {
    var p = (lat * Math.PI) / 180;
    var l = (lon * Math.PI) / 180;
    return [Math.cos(p) * Math.cos(l), Math.sin(p), Math.cos(p) * Math.sin(l)];
  }
  function tpDot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function tpCross3(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function tpNorm3(a) {
    var n = Math.sqrt(tpDot3(a, a)) || 1;
    return [a[0] / n, a[1] / n, a[2] / n];
  }
  /** The camera that looks straight at (lat0, lon0): screen x, screen y, depth. */
  function tpCamera(lat0, lon0) {
    var e = tpNorm3(tpSph(lat0, lon0));
    var up = Math.abs(e[1]) > 0.9995 ? [0, 0, 1] : [0, 1, 0];
    var r = tpNorm3(tpCross3(up, e));
    var u = tpCross3(e, r);
    return { e: e, r: r, u: u };
  }
  function tpProject(cam, p, lift, size) {
    var k = lift === undefined ? 1 : lift;
    var x = tpDot3(p, cam.r) * k;
    var y = tpDot3(p, cam.u) * k;
    var z = tpDot3(p, cam.e) * k;
    return { x: size / 2 + (x * size) / 2, y: size / 2 - (y * size) / 2, z: z };
  }
  /** Points along the great circle from a to b. */
  function tpSlerp(a, b, t) {
    var d = Math.max(-1, Math.min(1, tpDot3(a, b)));
    var w = Math.acos(d);
    if (w < 1e-5) return [a[0], a[1], a[2]];
    var s = Math.sin(w);
    var k1 = Math.sin((1 - t) * w) / s;
    var k2 = Math.sin(t * w) / s;
    return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
  }
  /** A point distDeg away from (lat, lon) on the given bearing. */
  function tpOffsetPoint(lat, lon, distDeg, bearingDeg) {
    var p1 = (lat * Math.PI) / 180;
    var l1 = (lon * Math.PI) / 180;
    var d = (distDeg * Math.PI) / 180;
    var br = (bearingDeg * Math.PI) / 180;
    var p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(br));
    var l2 = l1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return tpSph((p2 * 180) / Math.PI, ((((l2 * 180) / Math.PI + 540) % 360) - 180));
  }
  function tpMidpoint(a, b) {
    var m = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    if (Math.sqrt(tpDot3(m, m)) < 0.02) return tpNorm3(tpCross3(a, [0, 1, 0]));
    return tpNorm3(m);
  }
  function tpToLatLon(p) {
    return {
      lat: (Math.asin(Math.max(-1, Math.min(1, p[1]))) * 180) / Math.PI,
      lon: (Math.atan2(p[2], p[0]) * 180) / Math.PI
    };
  }

  /** Paint the sphere around `cam` from the world map, pixel by pixel. */
  /** An asteroid: a potato silhouette, craters, and one sun from the upper left. */
  function tpPaintRock(canvas, size, seed) {
    if (!canvas || size < 16) return false;
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    var str = String(seed || 'rock');
    var st = 7;
    for (var q = 0; q < str.length; q += 1) st = (st * 31 + str.charCodeAt(q)) % 100000;
    var rnd = function () { st = (st * 9301 + 49297) % 233280; return st / 233280; };
    var cx = size / 2, cy = size / 2, R = size * 0.455;
    var k1 = 0.055 + rnd() * 0.05, k2 = 0.03 + rnd() * 0.045;
    var p1 = rnd() * 6.283, p2 = rnd() * 6.283;
    var N = 84, pts = [], i, a, r;
    for (i = 0; i < N; i += 1) {
      a = (i / N) * Math.PI * 2;
      r = R * (1 + k1 * Math.sin(3 * a + p1) + k2 * Math.sin(5 * a + p2));
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.94]);
    }
    ctx.beginPath();
    for (i = 0; i < pts.length; i += 1) {
      if (i) ctx.lineTo(pts[i][0], pts[i][1]); else ctx.moveTo(pts[i][0], pts[i][1]);
    }
    ctx.closePath();
    ctx.save();
    ctx.clip();
    var g = ctx.createRadialGradient(cx - R * 0.42, cy - R * 0.46, R * 0.08, cx, cy, R * 1.12);
    g.addColorStop(0, '#ece0ca');
    g.addColorStop(0.42, '#b8a78c');
    g.addColorStop(0.76, '#6d5d4c');
    g.addColorStop(1, '#30271e');
    ctx.fillStyle = g;
    ctx.fill();
    for (i = 0; i < 24; i += 1) {
      var ca = rnd() * 6.283, cr2 = Math.sqrt(rnd()) * R * 0.88;
      var x = cx + Math.cos(ca) * cr2, y = cy + Math.sin(ca) * cr2 * 0.94;
      var rad = R * (0.03 + rnd() * 0.1);
      var shade = ctx.createRadialGradient(x - rad * 0.4, y - rad * 0.4, rad * 0.08, x, y, rad);
      shade.addColorStop(0, 'rgba(18,13,9,.62)');
      shade.addColorStop(0.62, 'rgba(58,47,37,.34)');
      shade.addColorStop(1, 'rgba(236,226,206,.18)');
      ctx.beginPath();
      ctx.ellipse(x, y, rad, rad * 0.82, rnd() * 3, 0, 6.283);
      ctx.fillStyle = shade;
      ctx.fill();
    }
    for (i = 0; i < 46; i += 1) {
      var bx = cx + (rnd() - 0.5) * R * 1.9, by = cy + (rnd() - 0.5) * R * 1.8;
      ctx.globalAlpha = 0.05 + rnd() * 0.1;
      ctx.fillStyle = rnd() > 0.5 ? '#fff4e2' : '#241c15';
      ctx.beginPath();
      ctx.arc(bx, by, R * (0.008 + rnd() * 0.03), 0, 6.283);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // The night side of the same sun everything else on the page uses.
    var limb = ctx.createRadialGradient(cx - R * 0.18, cy - R * 0.2, R * 0.35, cx, cy, R * 1.1);
    limb.addColorStop(0, 'rgba(0,0,0,0)');
    limb.addColorStop(0.72, 'rgba(3,7,14,.12)');
    limb.addColorStop(1, 'rgba(2,5,12,.72)');
    ctx.fillStyle = limb;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
    return true;
  }

  /** Where a point on the sphere lands inside one canvas element, in stage px. */
  function projectOn(el, cam, p) {
    var r = el.getBoundingClientRect();
    var stage = document.getElementById('tp-stage');
    var st = stage ? stage.getBoundingClientRect() : { left: 0, top: 0 };
    var q = tpProject(cam, p, 1, r.width);
    return { x: q.x + (r.left - st.left), y: q.y + (r.top - st.top), z: q.z };
  }

  function tpPaintPlanet(canvas, map, cam, size) {
    if (!canvas || !map || size < 8) return false;
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    var img = ctx.createImageData(size, size);
    var out = img.data;
    var src = map.data;
    var mw = map.width;
    var mh = map.height;
    var half = size / 2;
    var inv = 1 / half;
    var er = cam.r;
    var eu = cam.u;
    var ee = cam.e;
    // Light from the upper left, the same sun as the rest of the page.
    var lx = -0.5, ly = 0.44, lz = 0.74;
    var ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
    lx /= ll; ly /= ll; lz /= ll;
    for (var py = 0; py < size; py += 1) {
      var ny = (half - py - 0.5) * inv;
      var ny2 = ny * ny;
      for (var px = 0; px < size; px += 1) {
        var nx = (px + 0.5 - half) * inv;
        var r2 = nx * nx + ny2;
        if (r2 >= 1) continue;
        var z = Math.sqrt(1 - r2);
        var wy = er[1] * nx + eu[1] * ny + ee[1] * z;
        var lat = (Math.asin(wy > 1 ? 1 : wy < -1 ? -1 : wy) * 180) / Math.PI;
        var wx = er[0] * nx + eu[0] * ny + ee[0] * z;
        var wz = er[2] * nx + eu[2] * ny + ee[2] * z;
        var lon = (Math.atan2(wz, wx) * 180) / Math.PI;
        var tx = Math.floor(((lon + 180) / 360) * mw) % mw;
        if (tx < 0) tx += mw;
        var ty = Math.floor(((90 - lat) / 180) * mh);
        if (ty < 0) ty = 0; else if (ty >= mh) ty = mh - 1;
        var si = (ty * mw + tx) * 4;
        var diff = nx * lx + ny * ly + z * lz;
        if (diff < 0) diff = 0;
        var shade = (0.24 + 0.92 * diff) * (0.5 + 0.5 * z);
        var o = (py * size + px) * 4;
        out[o] = src[si] * shade;
        out[o + 1] = src[si + 1] * shade;
        out[o + 2] = src[si + 2] * shade;
        out[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return true;
  }

  function transfer(from, to, done) {
    var overlay = document.getElementById('transfer');
    if (!overlay) { if (done) done(); return; }

    var stageEl = document.getElementById('tp-stage');
    var canvas = document.getElementById('tp-planet');
    var ghost = document.getElementById('tp-path-ghost');
    var lit = document.getElementById('tp-path');
    var dotFrom = document.getElementById('tp-from');
    var dotTo = document.getElementById('tp-to');
    var ship = document.getElementById('tp-ship');
    var routeEl = document.getElementById('transfer-route');
    var placeEl = document.getElementById('transfer-place');
    var barEl = document.getElementById('transfer-bar');
    var pctEl = document.getElementById('transfer-percent');
    var distEl = document.getElementById('transfer-distance');
    var worldEl = document.getElementById('transfer-travel');
    var fromCanvas = document.getElementById('tp-planet-from');

    // An asteroid is a body we can draw too, so no hop ends in open sky.
    var toAsteroid = to.world === 'Asteroid belt';
    var fromAsteroid = from.world === 'Asteroid belt';
    var astr = toAsteroid || fromAsteroid;
    var space = false;
    var destWorld = toAsteroid ? null : to.world;
    var sameWorld = !astr && from.world === to.world;
    var inter = !sameWorld;
    var RADIUS = to.world === 'Mars' ? 3389.5 : 1737.4;

    var size = 0;
    var pathLength = 0;
    var distanceKm = 0;
    var finished = false;
    var raf = 0;
    var guard = 0;
    var startedAt = 0;
    var DURATION = inter ? 2800 : 2100;

    worldEl.textContent = space ? 'Deep space'
      : inter ? (from.world === to.world ? from.world : from.world + ' \u2192 ' + to.world)
        : (to.world === 'Mars' ? 'Mars' : 'The Moon');
    placeEl.textContent = inter ? (from.where || '') + '  \u2192  ' + (to.where || '') : (to.where || '');
    if (dotFrom) dotFrom.querySelector('b').textContent = from.name;
    if (dotTo) dotTo.querySelector('b').textContent = to.name;

    overlay.classList.remove('out', 'is-arrived', 'is-cruise');
    overlay.classList.toggle('is-space', space);
    overlay.classList.toggle('is-inter', inter);
    overlay.classList.toggle('is-rock-from', fromAsteroid);
    overlay.classList.toggle('is-rock-to', toAsteroid);
    if (fromCanvas) { fromCanvas.style.opacity = '0'; fromCanvas.style.transform = ''; }
    overlay.setAttribute('data-world', destWorld || '');
    overlay.classList.add('on');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-flying');
    if (barEl) barEl.style.transform = 'scaleX(0)';
    if (pctEl) pctEl.textContent = '0%';
    if (distEl) distEl.textContent = inter ? (astr ? 'Interplanetary' : '\u2248 0M km') : sameWorld ? '' : 'Interplanetary';
    if (routeEl) routeEl.innerHTML = from.name + ' <em>&rarr;</em> <b>' + to.name + '</b>';
    if (dotTo) dotTo.classList.remove('is-arrived', 'is-live');
    if (dotFrom) dotFrom.classList.remove('is-arrived', 'is-live');

    function finish() {
      if (finished) return;
      finished = true;
      window.clearTimeout(guard);
      cancelAnimationFrame(raf);
      overlay.classList.add('out');
      overlay.classList.remove('is-cruise');
      window.setTimeout(function () {
        overlay.classList.remove('on', 'out');
        overlay.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('is-flying');
        if (ship) ship.style.opacity = '0';
        if (done) done();
      }, 320);
    }
    // A throttled tab must never trap the reader in here.
    guard = window.setTimeout(finish, DURATION + 1700);

    function build() {
      if (space) {
        // Nothing to draw: this hop leaves the maps behind.
        if (ghost) ghost.setAttribute('d', '');
        if (lit) lit.setAttribute('d', '');
        pathLength = 0;
        size = 0;
        return;
      }
      if (!stageEl || !canvas) return;
      size = Math.round(stageEl.getBoundingClientRect().width) || 520;
      var pTo = to.lat === null || to.lon === null ? null : tpSph(to.lat, to.lon);
      var pFrom = from.lat === null || from.lon === null ? null : tpSph(from.lat, from.lon);
      if (!pTo && !toAsteroid) return;

      var cam;
      if (sameWorld && pFrom) {
        var mid = tpToLatLon(tpMidpoint(pFrom, pTo));
        cam = tpCamera(mid.lat, mid.lon);
      } else {
        cam = toAsteroid ? null : tpCamera(to.lat, to.lon);
      }

      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var res = Math.min(Math.round(size * dpr), 760);
      if (toAsteroid) {
        var cr0 = canvas.getBoundingClientRect();
        tpPaintRock(canvas, Math.min(Math.round(cr0.width * dpr), 760), to.id || to.name);
      } else {
        tpPaintPlanet(canvas, destWorld ? maps[destWorld] : null, cam, res);
      }

      if (inter) {
        // Two bodies, one screen: the one we leave on the upper left, the one we
        // fly to on the lower right. A world is painted from its map, an
        // asteroid is drawn as the rock it is, so neither hop starts in the dark.
        var sr = stageEl.getBoundingClientRect();
        var fr = fromCanvas ? fromCanvas.getBoundingClientRect() : null;
        var frW = fr ? fr.width : size * 0.31;
        if (fromCanvas) {
          var frRes = Math.min(Math.round(frW * dpr), 460);
          if (fromAsteroid) tpPaintRock(fromCanvas, frRes, from.id || from.name);
          else if (maps[from.world]) tpPaintPlanet(fromCanvas, maps[from.world], tpCamera(from.lat, from.lon), frRes);
        }
        var cx0 = fr ? fr.left - sr.left + fr.width / 2 : size * 0.16;
        var cy0 = fr ? fr.top - sr.top + fr.height / 2 : size * 0.2;

        if (toAsteroid) {
          var cr = canvas.getBoundingClientRect();
          var dcx = cr.left - sr.left + cr.width / 2;
          var dcy = cr.top - sr.top + cr.height / 2;
          var back = Math.atan2(cy0 - dcy, cx0 - dcx);
          B = { x: dcx + Math.cos(back) * cr.width * 0.24, y: dcy + Math.sin(back) * cr.height * 0.24, z: 1 };
        } else {
          B = projectOn(canvas, cam, pTo);
        }

        var dir = Math.atan2(B.y - cy0, B.x - cx0);
        A = { x: cx0 + Math.cos(dir) * frW * 0.42, y: cy0 + Math.sin(dir) * frW * 0.42, z: 1 };
        var L = Math.sqrt((B.x - A.x) * (B.x - A.x) + (B.y - A.y) * (B.y - A.y)) || 1;
        var ctrlX = (A.x + B.x) / 2;
        var ctrlY = Math.min(A.y, B.y) - L * 0.26;
        var hop = 'M' + A.x.toFixed(1) + ' ' + A.y.toFixed(1) +
          ' Q' + ctrlX.toFixed(1) + ' ' + ctrlY.toFixed(1) + ' ' + B.x.toFixed(1) + ' ' + B.y.toFixed(1);
        if (ghost) ghost.setAttribute('d', hop);
        if (lit) {
          lit.setAttribute('d', hop);
          try { pathLength = lit.getTotalLength() || 0; } catch (e) { pathLength = 0; }
          if (!pathLength) pathLength = L;
          lit.style.strokeDasharray = pathLength;
          lit.style.strokeDashoffset = pathLength;
        }
        if (dotFrom) {
          dotFrom.style.transform = 'translate(' + A.x.toFixed(1) + 'px,' + A.y.toFixed(1) + 'px)';
          dotFrom.classList.toggle('is-flipped', A.x > size * 0.55);
        }
        if (dotTo) {
          dotTo.style.transform = 'translate(' + B.x.toFixed(1) + 'px,' + B.y.toFixed(1) + 'px)';
          dotTo.classList.toggle('is-flipped', B.x > size * 0.74);
        }
        return;
      }

      // The flight: ground to ground on one world, in from deep space otherwise.
      var a = sameWorld && pFrom ? pFrom : tpOffsetPoint(to.lat, to.lon, 58, 312);
      var b = pTo;
      distanceKm = sameWorld && pFrom
        ? Math.round(Math.acos(Math.max(-1, Math.min(1, tpDot3(pFrom, pTo)))) * RADIUS)
        : 0;

      var A = tpProject(cam, a, 1, size);
      var B = tpProject(cam, b, 1, size);

      if (dotFrom) {
        dotFrom.style.transform = 'translate(' + A.x.toFixed(1) + 'px,' + A.y.toFixed(1) + 'px)';
        dotFrom.classList.toggle('is-flipped', A.x > size * 0.7);
      }
      if (dotTo) {
        dotTo.style.transform = 'translate(' + B.x.toFixed(1) + 'px,' + B.y.toFixed(1) + 'px)';
        dotTo.classList.toggle('is-flipped', B.x > size * 0.7);
      }

      var d = '';
      var N = 180;
      for (var i = 0; i <= N; i += 1) {
        var t = i / N;
        var p = tpSlerp(a, b, t);
        var lift = 1 + 0.035 * Math.sin(Math.PI * t);
        var q = tpProject(cam, p, lift, size);
        if (q.z <= 0) continue;
        d += (d ? ' L' : 'M') + q.x.toFixed(1) + ' ' + q.y.toFixed(1);
      }
      if (ghost) ghost.setAttribute('d', d);
      if (lit) {
        lit.setAttribute('d', d);
        try { pathLength = lit.getTotalLength() || 0; } catch (e) { pathLength = 0; }
        if (!pathLength) pathLength = Math.abs(B.x - A.x) + Math.abs(B.y - A.y);
        lit.style.strokeDasharray = pathLength;
        lit.style.strokeDashoffset = pathLength;
      }
    }

    function ease(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }

    function frame(now) {
      if (!startedAt) startedAt = now;
      var t = Math.min(1, (now - startedAt) / DURATION);
      var run = Math.max(0, Math.min(1, (t - 0.08) / 0.78));
      var p = ease(run);

      if (lit && pathLength) lit.style.strokeDashoffset = (pathLength * (1 - p)).toFixed(1);
      if (barEl) barEl.style.transform = 'scaleX(' + p.toFixed(3) + ')';
      if (pctEl) pctEl.textContent = Math.round(p * 100) + '%';
      if (distEl && sameWorld) distEl.textContent = Math.round(distanceKm * p).toLocaleString('en-US') + ' km';
      if (inter) {
        if (distEl && !astr) distEl.textContent = '\u2248 ' + Math.round(225 * p) + 'M km';
        if (fromCanvas) {
          fromCanvas.style.opacity = (Math.min(1, run * 5) * (0.92 - 0.42 * p)).toFixed(3);
          fromCanvas.style.transform = 'scale(' + (1 - 0.14 * p).toFixed(3) + ')' +
            (fromAsteroid ? ' rotate(' + (-7 * p).toFixed(2) + 'deg)' : '');
        }
        overlay.classList.toggle('is-cruise', p > 0.1 && p < 0.92);
      }

      if (ship && pathLength > 0) {
        try {
          var at = lit.getPointAtLength(pathLength * p);
          var ahead = lit.getPointAtLength(Math.min(pathLength, pathLength * p + 3));
          var ang = (Math.atan2(ahead.y - at.y, ahead.x - at.x) * 180) / Math.PI;
          ship.style.transform = 'translate(' + at.x.toFixed(1) + 'px,' + at.y.toFixed(1) + 'px) rotate(' + ang.toFixed(1) + 'deg)';
          ship.style.opacity = run > 0.02 && run < 0.99 ? '1' : '0';
        } catch (e) { }
      }

      if (run > 0.985 && dotTo && !dotTo.classList.contains('is-arrived')) {
        dotTo.classList.add('is-arrived', 'is-live');
        overlay.classList.add('is-arrived');
        if (ship) ship.style.opacity = '0';
      }
      if (t >= 1) { finish(); return; }
      raf = requestAnimationFrame(frame);
    }

    function start() {
      build();
      if (dotFrom) dotFrom.classList.add('is-live');
      raf = requestAnimationFrame(frame);
    }

    if (space) { start(); return; }
    if (inter) {
      // One map per world on screen; an asteroid needs none.
      var need = [];
      if (!fromAsteroid) need.push(from.world);
      if (!toAsteroid) need.push(to.world);
      var step = 0;
      var nextMap = function () {
        if (step >= need.length) { start(); return; }
        loadMap(need[step++], nextMap);
      };
      nextMap();
      return;
    }
    loadMap(destWorld, start);
  }

  window.SolvixExplore = {
    vehicles: VEHICLES,
    init: initWorlds,
    show: showWorlds,
    hide: hideWorlds,
    setWorld: setWorld,
    transfer: transfer
  };
})();
