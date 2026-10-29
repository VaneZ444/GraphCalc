// js/ui/inspector.js

import { h, clear } from '../util/dom.js';
import { fmt } from '../util/format.js';

const QUICK_INSERTS = ['t', '^', '>', '<', '1', '\\sin(', ')', '\\cdot'];

export function createInspector(app, host) {
  let lastKey = null;

  const selectionKey = () => app.selection
    ? `${app.selection.kind}:${app.selection.id}`
    : 'none';

  function rebuild() {
    clear(host);
    const selection = app.selection;

    if (!selection) {
      host.append(h('p', { class: 'hint' },
        'Select a node or a link on the canvas. ',
        h('br'),
        'Write a formula on a link to switch it on and off as time moves.'));
      return;
    }
    if (selection.kind === 'node') rebuildNode(selection.id);
    else rebuildEdge(selection.id);
  }

  /* ---------------------------------------------------------------- node */

  function rebuildNode(nodeId) {
    const node = app.graph.node(nodeId);
    if (!node) return;

    const labelInput = h('input', {
      class: 'field mono',
      value: node.label,
      oninput: event => {
        node.label = event.target.value;
        if (app.isEditingSource) app.afterSourceMutation();
        else app.recompute();
      },
    });

    const row = [h('button', {
      class: 'btn btn-danger',
      onclick: () => {
        app.graph.removeNode(node.id);
        if (app.isEditingSource) app.afterSourceMutation();
        else app.afterGraphMutation();
      },
    }, 'Delete')];

    if (!app.isEditingSource) {
      row.unshift(h('button', {
        class: `btn${app.startNodeId === node.id ? ' is-on' : ''}`,
        onclick: () => app.setStartNode(node.id),
      }, app.startNodeId === node.id ? 'Start node' : 'Set as start'));
    }

    host.append(
      h('div', { class: 'inspector-title' }, 'Node ', h('strong', {}, `#${node.id}`)),
      h('label', { class: 'field-label' }, 'Label'),
      labelInput,
      h('div', { class: 'row', style: { marginTop: '10px' } }, ...row),
      h('p', { class: 'hint', style: { marginTop: '10px' } },
        `position  x=${node.x}  y=${node.y}`),
    );
  }

  /* ---------------------------------------------------------------- edge */

  function rebuildEdge(edgeId) {
    const edge = app.graph.edge(edgeId);
    if (!edge) return;

    const from = app.graph.node(edge.from);
    const to = app.graph.node(edge.to);

    const input = h('input', {
      class: 'field mono',
      placeholder: 'e.g. t^2 - 4 > 0',
      value: edge.condition || '',
    });

    const preview = h('div', { class: 'tex-preview' });
    const liveRow = h('div', { class: 'live-value' },
      h('span', { class: 'label' }, 'Current value'),
      h('span', { class: 'value' }, '—'));

    const renderPreview = () => renderLatex(preview, input.value);

    const refreshLive = () => {
      const state = app.currentEdgeStates.get(edge.id);
      const valueEl = liveRow.querySelector('.value');
      liveRow.classList.toggle('is-on', !!state?.active);
      liveRow.classList.toggle('is-off', !state?.active);

      if (!edge.condition?.trim()) valueEl.textContent = 'always on';
      else if (state?.error) valueEl.textContent = 'error';
      else if (state?.active) valueEl.textContent = `on · ${fmt(state.value)}`;
      else valueEl.textContent = `off · ${fmt(state.value)}`;
    };

    input.addEventListener('input', () => {
      edge.condition = input.value;
      renderPreview();
      if (app.isEditingSource) app.afterSourceMutation();
      else app.recompute();
    });

    const chips = QUICK_INSERTS.map(snippet =>
      h('button', {
        class: 'chip',
        type: 'button',
        onclick: () => {
          insertAtCursor(input, snippet);
          edge.condition = input.value;
          renderPreview();
          if (app.isEditingSource) app.afterSourceMutation();
          else app.recompute();
          input.focus();
        },
      }, snippet));

    host.append(
      h('div', { class: 'inspector-title' },
        'Link ',
        h('strong', {}, `${from?.label ?? '?'} — ${to?.label ?? '?'}`)),
      h('label', { class: 'field-label' }, 'Condition / weight (LaTeX)'),
      input,
      h('div', { class: 'chip-row' }, ...chips),
      preview,
      liveRow,
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', {
          class: 'btn btn-danger',
          onclick: () => {
            app.graph.removeEdge(edge.id);
            if (app.isEditingSource) app.afterSourceMutation();
            else app.afterGraphMutation();
          },
        }, 'Delete link')),
    );

    renderPreview();
    refreshLive();
  }

  /* ---------------------------------------------------------------- sync */

  function sync() {
    const key = selectionKey();

    if (key !== lastKey) {
      lastKey = key;
      rebuild();
      return;
    }

    if (app.selection?.kind === 'edge') {
      const liveRow = host.querySelector('.live-value');
      const edge = app.graph.edge(app.selection.id);
      if (liveRow && edge) {
        const state = app.currentEdgeStates.get(edge.id);
        const valueEl = liveRow.querySelector('.value');
        liveRow.classList.toggle('is-on', !!state?.active);
        liveRow.classList.toggle('is-off', !state?.active);

        if (!edge.condition?.trim()) valueEl.textContent = 'always on';
        else if (state?.error) valueEl.textContent = 'error';
        else if (state?.active) valueEl.textContent = `on · ${fmt(state.value)}`;
        else valueEl.textContent = `off · ${fmt(state.value)}`;
      }
    }
  }

  app.on('change', sync);
  app.on('selection', () => { lastKey = null; sync(); });

  rebuild();
  lastKey = selectionKey();
}

/* --------------------------------------------------------------- helpers */

function renderLatex(container, source) {
  const text = (source || '').trim();
  container.classList.remove('is-error');

  if (!text) {
    container.innerHTML = '<span class="placeholder">empty — link is always active</span>';
    return;
  }
  if (!window.katex) { container.textContent = text; return; }

  try {
    window.katex.render(text, container, { throwOnError: true, displayMode: false });
  } catch (err) {
    container.classList.add('is-error');
    container.textContent = err.message;
  }
}

function insertAtCursor(input, snippet) {
  const start = input.selectionStart ?? input.value.length;
  const end   = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + snippet + input.value.slice(end);
  const caret = start + snippet.length;
  input.setSelectionRange(caret, caret);
}