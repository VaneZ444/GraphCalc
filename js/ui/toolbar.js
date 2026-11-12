// js/ui/toolbar.js

import { h } from '../util/dom.js';

const TOOLS = [
  { id: 'select', label: 'Select' },
  { id: 'node', label: 'Add node' },
  { id: 'edge', label: 'Add link' },
  { id: 'erase', label: 'Erase' },
];

const HINTS = {
  select: 'Drag nodes to reposition. Shift-click a node to make it the start node.',
  node: 'Click empty space to create a node.',
  edge: 'Click two nodes in sequence to connect them.',
  erase: 'Click a node or a link to delete it.',
};

export function createToolbar(app, host) {
  const buttons = TOOLS.map(tool =>
    h('button', {
      class: 'tool',
      'data-tool': tool.id,
      onclick: () => app.setTool(tool.id),
    }, tool.label));

  const hint = h('p', { class: 'hint' }, HINTS[app.tool]);

  const sync = () => {
    for (const button of buttons) {
      button.classList.toggle('is-active', button.dataset.tool === app.tool);
    }
    hint.textContent = HINTS[app.tool];
  };

  app.on('tool', sync);
  sync();

  /* --- Node radius slider ------------------------------------------- */

  const radiusValue  = h('span', { class: 'field-value' }, String(app.nodeRadius));
  const radiusLabel  = h('label', { class: 'field-label' }, 'Node radius ', radiusValue);
  const radiusSlider = h('input', {
    type: 'range',
    min: 8,
    max: 32,
    step: 1,
    value: app.nodeRadius,
    oninput: event => {
      const v = parseInt(event.target.value, 10);
      radiusValue.textContent = String(v);
      app.setNodeRadius(v);
    },
  });

  host.append(
    h('div', { class: 'tool-group' }, ...buttons),
    hint,
    h('div', { class: 'stack', style: { marginTop: '14px' } },
      radiusLabel,
      radiusSlider,
    ),
  );

  return host;
}