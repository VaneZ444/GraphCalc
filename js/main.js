// js/main.js
//
// Application bootstrap and render pipeline.

import { App } from './core/app.js';
import { createRenderer } from './render/index.js';
import { createTabs } from './ui/tabs.js';
import { createToolbar } from './ui/toolbar.js';
import { createInspector } from './ui/inspector.js';
import { createTimeline } from './ui/timeline.js';
import { createModulePanel } from './ui/modulePanel.js';
import { attachGraphController } from './ui/graphController.js';
import { createGeneratorDialog } from './ui/generatorDialog.js';
import { generateGraphSet } from './generators/randomGraph.js';

/* ------------------------------------------------------------------ setup */

const app = new App();

const renderer = createRenderer('svg');
renderer.mount(document.getElementById('canvas-host'));
attachGraphController(app, renderer);

createTabs(app, document.getElementById('tabs'));
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

/* --------------------------------------------------------- render pipeline */

app.on('change', () => {
  renderer.render(app.renderModel());
  updateStageMeta();
});

app.on('transport', () => {
  updateStageMeta();
});

function updateStageMeta() {
  const meta = document.getElementById('stage-meta');

  if (!app.isFormulated) {
    const n = app.graphSet.size;
    meta.textContent =
      `Formulating: ${n} source graph${n === 1 ? '' : 's'} · ` +
      `drag the playhead to t ≥ 1 to merge · t = ${app.t.toFixed(2)}`;
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

// 6 source graphs over a small shared name pool — most of them merge.
// Starting at t = 2 drops the user straight into the merged view; scrub back
// toward t = 0 to see the raw source graphs on the grid.
app.setGraphSet(generateGraphSet({
  count: 6,
  nodesPerGraph: 4,
  edgeProbability: 0.5,
  namePoolSize: 8,
  seed: 7,
  conditions: true,
}));

app.setTime(2);