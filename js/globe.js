/* The Moon and Mars on the Explore page: the archive's three.js globe. */
import { GlobeView } from './globe-viewer.js';

window.SolvixGlobe = GlobeView;
window.dispatchEvent(new Event('solvix:globe-ready'));
