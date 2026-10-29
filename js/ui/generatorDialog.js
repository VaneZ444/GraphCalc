// js/ui/generatorDialog.js

import { generateGraphSet } from '../generators/randomGraph.js';

export function createGeneratorDialog(app) {
  const dialog = document.getElementById('generator-dialog');

  const countInput      = dialog.querySelector('#gen-count');
  const countValue      = dialog.querySelector('#gen-count-value');
  const nodesInput      = dialog.querySelector('#gen-nodes');
  const nodesValue      = dialog.querySelector('#gen-nodes-value');
  const densityInput    = dialog.querySelector('#gen-density');
  const densityValue    = dialog.querySelector('#gen-density-value');
  const namesInput      = dialog.querySelector('#gen-names');
  const namesValue      = dialog.querySelector('#gen-names-value');
  const seedInput       = dialog.querySelector('#gen-seed');
  const conditionsInput = dialog.querySelector('#gen-conditions');

  const bind = (input, out, fmt = v => v) => {
    const upd = () => { out.textContent = fmt(input.value); };
    input.addEventListener('input', upd);
    upd();
  };

  bind(countInput, countValue);
  bind(nodesInput, nodesValue);
  bind(densityInput, densityValue, v => Number(v).toFixed(2));
  bind(namesInput, namesValue);

  dialog.querySelector('#gen-confirm').addEventListener('click', ev => {
    ev.preventDefault();

    const set = generateGraphSet({
      count:           Number(countInput.value),
      nodesPerGraph:   Number(nodesInput.value),
      edgeProbability: Number(densityInput.value),
      namePoolSize:    Number(namesInput.value),
      seed:            Number(seedInput.value) || 1,
      conditions:      conditionsInput.checked,
    });

    app.setGraphSet(set);
    dialog.close();
  });

  document.getElementById('btn-generate')
    .addEventListener('click', () => dialog.showModal());
}