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

  host.append(h('div', { class: 'tool-group' }, ...buttons), hint);
  return host;
}