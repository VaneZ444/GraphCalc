// js/main.js

import { App } from './core/app.js';
import { createRenderer } from './render/index.js';
import { createTabs } from './ui/tabs.js';
import { createToolbar } from './ui/toolbar.js';
import { createInspector } from './ui/inspector.js';
import { createTimeline } from './ui/timeline.js';
import { createModulePanel } from './ui/modulePanel.js';
import { createSourcePanel } from './ui/sourcePanel.js';
import { createTextPanel } from './ui/textPanel.js';
import { attachGraphController } from './ui/graphController.js';
import { createGeneratorDialog } from './ui/generatorDialog.js';
import { generateGraphSet } from './generators/randomGraph.js';

/* ------------------------------------------------------------------ setup */

const app = new App();

const renderer = createRenderer('svg');
renderer.mount(document.getElementById('canvas-host'));
attachGraphController(app, renderer);

createTabs(app, document.getElementById('tabs'));
createSourcePanel(app, document.getElementById('sources-body'));
createTextPanel(app, document.getElementById('text-body'));
createToolbar(app, document.getElementById('tools-body'));
createInspector(app, document.getElementById('inspector-body'));
createTimeline(app, document.getElementById('timeline'));
createModulePanel(app, {
  titleHost: document.getElementById('module-title'),
  controlsHost: document.getElementById('module-controls'),
  outputHost: document.getElementById('module-output'),
});
createGeneratorDialog(app);

document.getElementById('btn-clear').addEventListener('click', () => {
  app.clearAll();
});

/* ------------------------------------------------------ viewport controls */

document.getElementById('vp-zoom-in') .addEventListener('click', () => renderer.zoomBy(1.25));
document.getElementById('vp-zoom-out').addEventListener('click', () => renderer.zoomBy(1 / 1.25));
document.getElementById('vp-fit')      .addEventListener('click', () => renderer.fitToContent());
document.getElementById('vp-reset')    .addEventListener('click', () => renderer.resetView());

/* --------------------------------------------------------- render pipeline */

let lastPhase = null;
let lastSourceIdx = null;

app.on('change', () => {
  const model = app.renderModel();
  const phase = model.phase;
  const sourceIdx = app.editingSourceIndex;

  renderer.render(model);

  // Auto-fit whenever the visible target changes: entering/leaving a source
  // editor, switching between sources, or crossing the formulation tick.
  if (phase !== lastPhase || sourceIdx !== lastSourceIdx) {
    renderer.fitToContent();
    lastPhase = phase;
    lastSourceIdx = sourceIdx;
  }

  updateStageMeta();
});

app.on('transport', () => updateStageMeta());

function updateStageMeta() {
  const meta = document.getElementById('stage-meta');

  if (app.isEditingSource) {
    const g = app.graph;
    const active = [...app.currentEdgeStates.values()].filter(s => s.active).length;
    meta.textContent =
      `Editing source #${app.editingSourceIndex + 1} · ` +
      `${g.nodes.length} node${g.nodes.length === 1 ? '' : 's'} · ` +
      `${g.edges.length} link${g.edges.length === 1 ? '' : 's'} · ` +
      `${active} active · t = ${app.t.toFixed(2)}`;
    return;
  }

  if (!app.isFormulated) {
    const n = app.graphSet.size;
    meta.textContent =
      `Formulating: ${n} source graph${n === 1 ? '' : 's'} · ` +
      `drag to t ≥ 1 to merge, or click a source in the sidebar to edit · t = ${app.t.toFixed(2)}`;
    return;
  }

  const nodes  = app.unifiedGraph.nodes.length;
  const edges  = app.unifiedGraph.edges.length;
  const active = [...app.edgeStates.values()].filter(s => s.active).length;
  const components = app.components.length;
  meta.textContent =
    `${components} component${components === 1 ? '' : 's'} · ` +
    `${nodes} node${nodes === 1 ? '' : 's'} · ` +
    `${edges} link${edges === 1 ? '' : 's'} · ` +
    `${active} active · t = ${app.t.toFixed(2)}`;
}

/* ---------------------------------------------------------- animation loop */

let previous = performance.now();

function frame(now) {
  const dt = Math.min(0.1, (now - previous) / 1000);
  previous = now;
  app.advance(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* --------------------------------------------------------------- bootstrap */

app.setGraphSet(generateGraphSet({
  count: 6,
  nodesPerGraph: 4,
  edgeProbability: 0.5,
  namePoolSize: 8,
  seed: 7,
  conditions: true,
}));

app.setTime(2);