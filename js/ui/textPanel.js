// js/ui/textPanel.js
//
// Sidebar textarea for the currently edited source graph. When no source is
// being edited, typing here and clicking "Create new source" adds a new source
// built from the text. When editing an existing source, "Apply to source"
// rebuilds that source in place, preserving existing node positions.

import { h, clear } from '../util/dom.js';
import { graphToText, textToGraph } from '../util/graphText.js';

export function createTextPanel(app, host) {
  let targetLabel = null;
  let textarea    = null;
  let applyButton = null;
  let reloadButton = null;

  let focused = false;
  let lastEditingIndex = null;

  function build() {
    clear(host);

    targetLabel = h('div', { class: 'text-panel-target' });

    textarea = h('textarea', {
      class: 'text-input',
      spellcheck: 'false',
      placeholder: 'A\nB\nA-B: t > 1\nB-C',
    });

    applyButton = h('button', {
      class: 'btn btn-primary grow',
      onclick: apply,
    });

    reloadButton = h('button', {
      class: 'btn',
      title: 'Reload the textarea from the current source graph',
      onclick: reload,
    }, 'Reload');

    const actions = h('div', { class: 'text-actions' }, applyButton, reloadButton);

    const format = h('div', { class: 'text-format' },
      'A              isolated node\n' +
      'A-B            edge\n' +
      'A-B: t > 1     edge with condition\n' +
      'one entry per line, or comma-separated');

    host.append(targetLabel, textarea, actions, format);

    textarea.addEventListener('focus', () => { focused = true; });
    textarea.addEventListener('blur',  () => { focused = false; });

    textarea.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        apply();
      }
    });
  }

  function syncLabels() {
    const editing = app.isEditingSource;
    const idx = app.editingSourceIndex;

    clear(targetLabel);
    targetLabel.append(h('span', {}, 'Target: '));
    targetLabel.append(
      editing
        ? h('strong', {}, `source #${idx + 1}`)
        : h('strong', {}, 'new source'),
    );

    applyButton.textContent = editing
      ? `Apply to source #${idx + 1}`
      : 'Create new source';
    reloadButton.style.display = editing ? '' : 'none';
  }

  function refresh() {
    const editing = app.isEditingSource;
    const idx = app.editingSourceIndex;

    syncLabels();

    // Pre-fill textarea from the current source when the target changes and
    // the user isn't currently typing in it.
    if (editing && idx !== lastEditingIndex && !focused) {
      const source = app.graphSet.graphs[idx];
      textarea.value = source ? graphToText(source.graph) : '';
    }
    if (!editing && lastEditingIndex !== null && !focused) {
      // Just left a source — clear so the user can type a fresh graph.
      textarea.value = '';
    }

    lastEditingIndex = editing ? idx : null;
  }

  function reload() {
    if (!app.isEditingSource) return;
    const source = app.graphSet.graphs[app.editingSourceIndex];
    if (source) textarea.value = graphToText(source.graph);
  }

  function apply() {
    const text = textarea.value;

    // Preserve positions of labels already present in the current source.
    let positions = null;
    if (app.isEditingSource) {
      positions = new Map();
      const source = app.graphSet.graphs[app.editingSourceIndex];
      if (source) {
        for (const node of source.graph.nodes) {
          positions.set(node.label, { x: node.x, y: node.y });
        }
      }
    }

    const newGraph = textToGraph(text, { preservePositions: positions });

    if (app.isEditingSource) {
      app.replaceSourceGraph(app.editingSourceIndex, newGraph);
    } else {
      app.addSourceFromGraph(newGraph);
    }

    // Refresh the textarea to match what actually got applied.
    setTimeout(() => {
      if (!focused) reload();
    }, 0);
  }

  app.on('change', refresh);
  app.on('selection', refresh);

  build();
  refresh();
}