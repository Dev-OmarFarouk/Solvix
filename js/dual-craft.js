/* Two machines on one page.
 *
 * Viking 1 & 2, Spirit & Opportunity and Phoenix & InSight are pages about a
 * pair of craft built to the same design. Those pages show both: the archive
 * model the page loaded, plus a duplicate of that very same model standing
 * beside it, each under a name that stays on its craft while the camera turns.
 *
 * Nothing is modelled here and nothing in the page's own scene is moved: the
 * second craft is a clone of the loaded model, placed next to it every frame,
 * and the camera is simply pulled back far enough to hold both.
 *
 * The pair is centred: the two craft stand either side of the point the camera
 * orbits, at equal distances, and stay that way as it turns.
 *
 * The viewer shows a light stand-in while the model file downloads and swaps in
 * the archive model when it lands. The copy is therefore re-taken from the
 * model inside the render loop, so the two craft always share one geometry and
 * one set of materials.
 */
(function () {
  'use strict';

  var PAIRS = {
    viking: ['Viking 1', 'Viking 2'],
    mer: ['Spirit', 'Opportunity'],
    phoenix: ['Phoenix', 'InSight']
  };

  var SPACE = 0.24;   // daylight between the craft, in model widths
  var FRAME = 0.9;    // share of the stage width the pair may fill
  var LIFT = 0.12;    // label height above the model, in model heights

  var state = null;

  /* Cheap fingerprint of what the model is made of right now. */
  function signature(obj) {
    if (!obj) return '';
    var count = 0, first = '', verts = 0;
    obj.traverse(function (mesh) {
      if (!mesh.isMesh || !mesh.geometry) return;
      count += 1;
      if (!first) first = mesh.geometry.uuid;
      if (mesh.geometry.attributes && mesh.geometry.attributes.position) {
        verts += mesh.geometry.attributes.position.count;
      }
    });
    return count + ':' + verts + ':' + first;
  }

  function detach() {
    if (!state) return;
    cancelAnimationFrame(state.frame);
    clearTimeout(state.timer);
    clearInterval(state.watch);
    document.removeEventListener('visibilitychange', state.onVisible);
    if (state.contact) state.contact.visible = state.contactWasVisible;
    if (state.layer && state.layer.parentNode) state.layer.parentNode.removeChild(state.layer);
    if (state.twin && state.twin.parent) state.twin.parent.remove(state.twin);
    if (state.camera && state.axis) restoreCamera(state);
    state = null;
  }

  /* Put the camera back the way the page had it. */
  function restoreCamera(s) {
    var cam = s.camera, target = s.controls && s.controls.target;
    if (!target) return;
    var back = s.separation / 2;
    target.x += s.axis.x * back;
    target.y += s.axis.y * back;
    target.z += s.axis.z * back;
    cam.position.x += s.axis.x * back;
    cam.position.y += s.axis.y * back;
    cam.position.z += s.axis.z * back;
    var dir = cam.position.clone().sub(target).normalize().multiplyScalar(s.radius);
    cam.position.copy(target).add(dir);
    if (s.maxDistance !== undefined) s.controls.maxDistance = s.maxDistance;
  }

  /* World-space box of the hardware, from its own geometry. */
  function measure(obj) {
    var v = obj.position.clone();
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    obj.traverse(function (mesh) {
      if (!mesh.isMesh || !mesh.geometry) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      var bb = mesh.geometry.boundingBox;
      if (!bb) return;
      for (var xi = 0; xi < 2; xi += 1) {
        for (var yi = 0; yi < 2; yi += 1) {
          for (var zi = 0; zi < 2; zi += 1) {
            v.set(xi ? bb.max.x : bb.min.x, yi ? bb.max.y : bb.min.y, zi ? bb.max.z : bb.min.z);
            mesh.localToWorld(v);
            if (v.x < minX) minX = v.x;
            if (v.x > maxX) maxX = v.x;
            if (v.y < minY) minY = v.y;
            if (v.y > maxY) maxY = v.y;
            if (v.z < minZ) minZ = v.z;
            if (v.z > maxZ) maxZ = v.z;
          }
        }
      }
    });
    return { width: maxX - minX, height: maxY - minY, top: maxY, minX: minX, maxX: maxX, centerZ: (minZ + maxZ) / 2 };
  }

  function stageShare(scene, box) {
    var p = scene.camera.position.clone();
    var midY = box.top - box.height / 2;
    var edge = function (x) { p.set(x, midY, box.centerZ); p.project(scene.camera); return p.x; };
    var share = Math.abs(edge(box.maxX) - edge(box.minX)) / 2;
    return share > 0.05 ? share : 0.5;
  }

  function label(text) {
    var el = document.createElement('span');
    el.className = 'craft-label';
    var dot = document.createElement('i');
    dot.setAttribute('aria-hidden', 'true');
    el.appendChild(dot);
    el.appendChild(document.createTextNode(text));
    return el;
  }

  function cloneModel(scene) {
    var twin = scene.model.clone(true);
    twin.matrixAutoUpdate = false;
    twin.userData.solvixTwin = true;
    scene.scene.add(twin);
    return twin;
  }

  /* Slide the orbit point with the pair, so the middle of the stage always
     falls between the two craft. */
  function shiftCamera(scene, axis, amount) {
    var controls = scene.controls;
    var cam = scene.camera;
    cam.position.x += axis.x * amount;
    cam.position.y += axis.y * amount;
    cam.position.z += axis.z * amount;
    if (controls && controls.target) {
      controls.target.x += axis.x * amount;
      controls.target.y += axis.y * amount;
      controls.target.z += axis.z * amount;
    }
    cam.updateMatrixWorld(true);
  }

  function build(scene, names, key) {
    scene.scene.updateMatrixWorld(true);
    var box = measure(scene.model);
    if (!(box.width > 0) || !scene.camera) return false;

    var separation = box.width * (1 + SPACE);

    // The line the two craft stand on: across the view as the page first shows
    // it, fixed in the world, so the pair behaves like two machines parked
    // side by side on the ground.
    var axis = scene.camera.position.clone().setFromMatrixColumn(scene.camera.matrixWorld, 0);
    axis.y = 0;
    if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
    axis.normalize();

    // Pull back so two craft fit where one used to, then centre the pair.
    var cam = scene.camera;
    var controls = scene.controls;
    var target = (controls && controls.target) || cam.position.clone().set(0, 0, 0);
    var radius = cam.position.distanceTo(target);
    var factor = Math.max(1, stageShare(scene, box) * (2 + SPACE) / FRAME) * 1.1;
    var dir = cam.position.clone().sub(target).normalize();
    cam.position.copy(target).add(dir.multiplyScalar(radius * factor));
    cam.updateMatrixWorld(true);
    shiftCamera(scene, axis, -separation / 2);

    var twin = cloneModel(scene);

    // The soft disc under the hardware only fits one machine: with a pair on
    // the stage it would sit under the left-hand craft alone, so it goes.
    var contact = scene.contact || null;
    var contactWas = contact ? contact.visible : false;
    if (contact) contact.visible = false;

    var stage = document.querySelector('#mission .mis-stage') || scene.canvas.parentNode;
    var layer = document.createElement('div');
    layer.className = 'craft-labels';
    var labels = names.map(label);
    labels.forEach(function (el) { layer.appendChild(el); });
    stage.appendChild(layer);

    state = {
      scene: scene,
      key: key,
      twin: twin,
      layer: layer,
      frame: 0,
      timer: 0,
      watch: 0,
      camera: cam,
      controls: controls,
      radius: radius,
      maxDistance: controls ? controls.maxDistance : undefined,
      separation: separation,
      height: box.height,
      axis: axis,
      sig: signature(scene.model),
      contact: contact,
      contactWasVisible: contactWas,
      resync: null,
      onVisible: null
    };
    if (controls && controls.maxDistance !== undefined) {
      controls.maxDistance = Math.max(controls.maxDistance, radius * factor * 1.05);
    }

    var camPoint = cam.position.clone();
    var anchor = cam.position.clone();

    function place(offset, el) {
      var e = scene.model.matrixWorld.elements;
      anchor.set(e[12] + offset.x, e[13] + state.height / 2 + state.height * LIFT + offset.y, e[14] + offset.z);
      var v = camPoint.set(anchor.x, anchor.y, anchor.z).project(scene.camera);
      var rect = scene.canvas.getBoundingClientRect();
      var onStage = v.z <= 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
      el.style.opacity = onStage ? '1' : '0';
      el.style.transform = 'translate(-50%, -100%) translate(' +
        Math.round((v.x * 0.5 + 0.5) * rect.width) + 'px,' +
        Math.round((-v.y * 0.5 + 0.5) * rect.height) + 'px)';
    }

    /* Place the copy and its label against the current model. */
    function apply() {
      var m = scene.model.matrixWorld.elements;
      var off = {
        x: -state.axis.x * state.separation,
        y: -state.axis.y * state.separation,
        z: -state.axis.z * state.separation
      };
      var t = state.twin.matrix.elements;
      for (var k = 0; k < 16; k += 1) t[k] = m[k];
      t[12] += off.x; t[13] += off.y; t[14] += off.z;
      state.twin.matrixWorldNeedsUpdate = true;
      place({ x: 0, y: 0, z: 0 }, labels[0]);
      place(off, labels[1]);
    }

    /* Take the copy again whenever the viewer swaps the model underneath. */
    function refresh() {
      var sig = signature(scene.model);
      if (sig === state.sig) return;
      if (state.twin && state.twin.parent) state.twin.parent.remove(state.twin);
      state.twin = cloneModel(scene);
      state.sig = sig;
      var b = measure(scene.model);
      if (b.width > 0) {
        var next = b.width * (1 + SPACE);
        // Keep the pair centred on the same point if its size changed.
        shiftCamera(scene, state.axis, (state.separation - next) / 2);
        state.separation = next;
        state.height = b.height;
      }
      apply();
    }

    function loop() {
      if (!state || state.scene !== scene) return;
      refresh();
      apply();
      state.frame = requestAnimationFrame(loop);
    }

    state.resync = refresh;
    state.onVisible = function () {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', state.onVisible);

    loop();

    // A hidden tab freezes the render loop, so the swap is also watched on a
    // timer: the pair must never sit on the download stand-in.
    state.watch = setInterval(function () {
      if (!state || state.scene !== scene) return;
      refresh();
    }, 800);
    return true;
  }

  function attach(scene, key) {
    detach();
    var names = PAIRS[key];
    if (!names || !scene || !scene.model || !scene.scene || !scene.camera) return;
    if (scene.reduced) return;   // motion-sensitive visitors keep the plain view

    state = { scene: scene, key: key, twin: null, layer: null, frame: 0, timer: 0, watch: 0 };
    var ticket = state;

    // The model is often still on its way in; keep trying until it is there.
    function start() {
      if (state !== ticket) return;
      if (!scene.model || !scene.model.parent) {
        ticket.timer = setTimeout(start, 200);
        return;
      }
      build(scene, names, key);
    }
    start();
  }

  window.SolvixDual = {
    attach: attach,
    detach: detach,
    pairs: PAIRS,
    peek: function () { return state && state.twin ? state : null; },
    // Re-read the model now (used when the tab comes back to the foreground).
    resync: function () { if (state && state.resync) state.resync(); }
  };
})();
