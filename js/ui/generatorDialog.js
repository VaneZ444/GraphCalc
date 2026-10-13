import { h } from '../util/dom.js';
import { generateRandomGraph } from '../generators/randomGraph.js';

export function createGeneratorDialog(app) {
  const dialog = document.getElementById('generator-dialog');

  const nodesInput = dialog.querySelector('#gen-nodes');
  const nodesValue = dialog.querySelector('#gen-nodes-value');
  const densityInput = dialog.querySelector('#gen-density');
  const densityValue = dialog.querySelector('#gen-density-value');
  const layoutInput = dialog.querySelector('#gen-layout');
  const seedInput = dialog.querySelector('#gen-seed');
  const conditionsInput = dialog.querySelector('#gen-conditions');

  nodesInput.addEventListener('input', () => {
    nodesValue.textContent = nodesInput.value;
  });

  densityInput.addEventListener('input', () => {
    densityValue.textContent = Number(densityInput.value).toFixed(2);
  });

  dialog.querySelector('#gen-confirm').addEventListener('click', event => {
    event.preventDefault();

    generateRandomGraph(app.graph, {
      nodeCount: Number(nodesInput.value),
      edgeProbability: Number(densityInput.value),
      layout: layoutInput.value,
      seed: Number(seedInput.value) || 1,
      conditions: conditionsInput.checked,
    });

    app.selection = null;
    app.startNodeId = null;
    app.pendingFrom = null;
    app.emit('selection', null);
    app.afterGraphMutation();

    dialog.close();
  });

  document.getElementById('btn-generate').addEventListener('click', () => {
    dialog.showModal();
  });
}