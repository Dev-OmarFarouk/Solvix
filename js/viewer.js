/* The machine viewer, taken from the archive's detail page: the same lighting,
 * the same ground under the hardware, the same drag to turn it around. */
import { DetailScene } from './detail-viewer.js';

let scene = null;
let host = null;

function unmount() {
  if (window.SolvixDual) window.SolvixDual.detach();
  if (scene) {
    try {
      scene.dispose();
    } catch (error) {
      console.warn('Could not close the 3D view', error);
    }
    scene = null;
  }
  if (host) host.innerHTML = '';
}

function mount(model, world, onReady) {
  host = document.getElementById('machine-host');
  if (!host) return;
  unmount();

  const canvas = document.createElement('canvas');
  canvas.className = 'machine-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Interactive 3D model of the machine');
  host.appendChild(canvas);

  const zone = document.getElementById('machine-zone');

  try {
    scene = new DetailScene(canvas, model, {
      zone,
      world,
      onReady: () => {
        if (onReady) onReady();
      },
    });
    window.SolvixViewer.instance = scene;
    if (window.SolvixDual) window.SolvixDual.attach(scene, model);
  } catch (error) {
    console.error('The 3D view failed to start', error);
    const note = document.createElement('p');
    note.className = 'machine-fallback';
    note.textContent = 'This browser could not open the 3D view. The pages below still work.';
    host.appendChild(note);
    if (onReady) onReady();
  }
}

// The live scene is exposed so the page can add a second machine, a label or a
// marker to the same world instead of opening a second renderer.
window.SolvixViewer = { mount, unmount };
window.dispatchEvent(new Event('solvix:viewer-ready'));
