// js/ui/sourcePanel.js
//
// Sidebar list of every source graph. Clicking one enters that graph's editor;
// clicking it again returns to the overview. Inline × deletes a source.

import { h, clear } from '../util/dom.js';

export function createSourcePanel(app, host) {
  function render() {
    clear(host);

    const set = app.graphSet;
    const editing = app.editingSourceIndex;

    if (set.size === 0) {
      host.append(
        h('p', { class: 'hint' }, 'No source graphs yet. Click "New graph set" to generate some, or add a blank one below.'),
        h('button', {
          class: 'btn',
          style: { width: '100%', marginTop: '8px' },
          onclick: () => app.addSource(),
        }, '+ New blank source'),
      );
      return;
    }

    const list = h('div', { class: 'source-list' });

    set.graphs.forEach((entry, index) => {
      const active = index === editing;
      list.append(
        h('div', {
          class: `source-item${active ? ' is-active' : ''}`,
          onclick: () => app.editSource(active ? null : index),
        },
          h('span', { class: 'source-index' }, `#${index + 1}`),
          h('span', { class: 'source-name' }, entry.name),
          h('span', { class: 'source-stats' },
            `${entry.graph.nodes.length}n / ${entry.graph.edges.length}e`),
          h('button', {
            class: 'source-delete',
            title: 'Delete this source graph',
            onclick: event => {
              event.stopPropagation();
              app.removeSource(index);
            },
          }, '×'),
        ),
      );
    });

    host.append(list);

    if (editing !== null) {
      host.append(
        h('button', {
          class: 'btn',
          style: { width: '100%', marginTop: '8px' },
          onclick: () => app.editSource(null),
        }, '← Done editing'),
      );
    }

    host.append(
      h('button', {
        class: 'btn',
        style: { width: '100%', marginTop: '6px' },
        onclick: () => app.addSource(),
      }, '+ New blank source'),
    );
  }

  app.on('change', render);
  render();
}