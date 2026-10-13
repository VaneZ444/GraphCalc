import { App } from './core/app.js';
import { createRenderer } from './render/index.js';
import { createTabs } from './ui/tabs.js';
import { createToolbar } from './ui/toolbar.js';
import { createInspector } from './ui/inspector.js';
import { createTimeline } from './ui/timeline.js';
import { createModulePanel } from './ui/modulePanel.js';
import { attachGraphController } from './ui/graphController.js';
import { createGeneratorDialog } from './ui/generatorDialog.js';
import { generateRandomGraph } from './generators/randomGraph.js';

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
  app.graph.clear();
  app.selection = null;
  app.startNodeId = null;
  app.pendingFrom = null;
  app.emit('selection', null);
  app.afterGraphMutation();
});

/* --------------------------------------------------------- render pipeline */

app.on('change', () => {
  renderer.render(app.renderModel());
  updateStageMeta();
});

function updateStageMeta() {
  const nodes = app.graph.nodes.length;
  const edges = app.graph.edges.length;
  const active = [...app.edgeStates.values()].filter(s => s.active).length;

  document.getElementById('stage-meta').textContent =
    `${nodes} nodes · ${edges} links · ${active} active · t = ${app.t.toFixed(2)}`;
}

/* ----------------------------------------------------------- animation loop */

let previous = performance.now();

function frame(now) {
  const dt = Math.min(0.1, (now - previous) / 1000);
  previous = now;

  app.advance(dt);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

/* --------------------------------------------------------------- bootstrap */

generateRandomGraph(app.graph, {
  nodeCount: 11,
  edgeProbability: 0.24,
  layout: 'circle',
  seed: 7,
  conditions: true,
});

app.recompute();