// js/render/svgRenderer.js

import { Renderer } from './renderer.js';
import { CANVAS } from '../config.js';
import { s } from '../util/dom.js';
import { fmt } from '../util/format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export class SVGRenderer extends Renderer {
  constructor() {
    super();
    this.svg = null;
    this.edgeLayer = null;
    this.nodeLayer = null;
    this.edgeElements = new Map();
    this.nodeElements = new Map();
    this.drag = null;
    this.panState = null;
    this.model = null;

    this._viewport = { x: 0, y: 0, w: CANVAS.width, h: CANVAS.height };
  }

  /* ------------------------------------------------------------- lifecycle */

  mount(host) {
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    this.svg.setAttribute('class', 'graph-svg');

    this.edgeLayer = s('g', { class: 'layer-edges' });
    this.nodeLayer = s('g', { class: 'layer-nodes' });
    this.svg.append(this.edgeLayer, this.nodeLayer);

    host.appendChild(this.svg);
    this._applyViewport();
    this.#bindEvents();
  }

  destroy() {
    this.svg?.remove();
    this.edgeElements.clear();
    this.nodeElements.clear();
  }

  /* --------------------------------------------------------------- drawing */

  render(model) {
    this.model = model;
    this.svg.dataset.tool = model.tool;

    this.#renderEdges(model);
    this.#renderNodes(model);
  }

  #renderEdges(model) {
    const { graph, edgeStates, view } = model;
    const alive = new Set();

    for (const edge of graph.edges) {
      const a = graph.node(edge.from);
      const b = graph.node(edge.to);
      if (!a || !b) continue;

      alive.add(edge.id);

      let group = this.edgeElements.get(edge.id);
      if (!group) {
        group = this.#createEdgeGroup(edge.id);
        this.edgeElements.set(edge.id, group);
        this.edgeLayer.appendChild(group);
      }

      const tokens = view.edges.get(edge.id) || [];
      const state  = edgeStates.get(edge.id) || { active: false, value: NaN };

      const { line, hit, label } = group._parts;

      line.setAttribute('x1', a.x);
      line.setAttribute('y1', a.y);
      line.setAttribute('x2', b.x);
      line.setAttribute('y2', b.y);
      line.setAttribute('class', `edge ${tokens.join(' ')}`.trim());

      hit.setAttribute('x1', a.x);
      hit.setAttribute('y1', a.y);
      hit.setAttribute('x2', b.x);
      hit.setAttribute('y2', b.y);

      const source = (edge.condition || '').trim();
      if (source) {
        label.setAttribute('x', (a.x + b.x) / 2);
        label.setAttribute('y', (a.y + b.y) / 2 - 9);
        label.setAttribute('class', `edge-label${state.active ? '' : ' is-off'}`);
        label.textContent = state.active ? fmt(state.value) : 'off';
        label.style.display = '';
      } else {
        label.style.display = 'none';
      }
    }

    for (const [id, group] of this.edgeElements) {
      if (!alive.has(id)) {
        group.remove();
        this.edgeElements.delete(id);
      }
    }
  }

  #renderNodes(model) {
    const { graph, view } = model;
    const alive = new Set();

    for (const node of graph.nodes) {
      alive.add(node.id);

      let group = this.nodeElements.get(node.id);
      if (!group) {
        group = this.#createNodeGroup(node.id);
        this.nodeElements.set(node.id, group);
        this.nodeLayer.appendChild(group);
      }

      const tokens = view.nodes.get(node.id) || [];
      const { hit, body, label } = group._parts;

      group.setAttribute('class', `node ${tokens.join(' ')}`.trim());

      for (const el of [hit, body]) {
        el.setAttribute('cx', node.x);
        el.setAttribute('cy', node.y);
      }
      label.setAttribute('x', node.x);
      label.setAttribute('y', node.y);
      label.textContent = node.label;
    }

    for (const [id, group] of this.nodeElements) {
      if (!alive.has(id)) {
        group.remove();
        this.nodeElements.delete(id);
      }
    }
  }

  #createEdgeGroup(edgeId) {
    const line  = s('line', { class: 'edge' });
    const hit   = s('line', { class: 'edge-hit' });
    const label = s('text', { class: 'edge-label' });

    const group = s('g', { 'data-edge': edgeId, class: 'edge-group' }, line, hit, label);
    group._parts = { line, hit, label };
    return group;
  }

  #createNodeGroup(nodeId) {
    const hit   = s('circle', { class: 'node-hit', r: CANVAS.nodeRadius + 8 });
    const body  = s('circle', { class: 'node-body', r: CANVAS.nodeRadius });
    const label = s('text', { class: 'node-label' });

    const group = s('g', { 'data-node': nodeId, class: 'node' }, hit, body, label);
    group._parts = { hit, body, label };
    return group;
  }

  /* -------------------------------------------------------------- viewport */

  _applyViewport() {
    const v = this._viewport;
    this.svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  }

  zoomAt(graphX, graphY, factor) {
    const v = this._viewport;
    const newW = v.w / factor;
    const newH = v.h / factor;
    const ratioX = (graphX - v.x) / v.w;
    const ratioY = (graphY - v.y) / v.h;
    this._viewport = {
      x: graphX - ratioX * newW,
      y: graphY - ratioY * newH,
      w: newW,
      h: newH,
    };
    this._applyViewport();
  }

  zoomBy(factor) {
    const v = this._viewport;
    this.zoomAt(v.x + v.w / 2, v.y + v.h / 2, factor);
  }

  fitToContent(padding = 60) {
    const nodes = this.model?.graph?.nodes || [];
    if (nodes.length === 0) {
      this.resetView();
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }

    const w = Math.max(maxX - minX + padding * 2, 200);
    const h = Math.max(maxY - minY + padding * 2, 200);

    this._viewport = {
      x: minX - padding,
      y: minY - padding,
      w,
      h,
    };
    this._applyViewport();
  }

  resetView() {
    this._viewport = { x: 0, y: 0, w: CANVAS.width, h: CANVAS.height };
    this._applyViewport();
  }

  /* ---------------------------------------------------------- interaction */

  #bindEvents() {
    this.svg.addEventListener('pointerdown', event => this.#onPointerDown(event));
    this.svg.addEventListener('pointermove', event => this.#onPointerMove(event));
    this.svg.addEventListener('pointerup',    ()      => this.#onPointerUp());
    this.svg.addEventListener('pointercancel',()      => this.#onPointerUp());
    this.svg.addEventListener('dblclick',    event => this.#onDoubleClick(event));

    this.svg.addEventListener('wheel', event => {
      event.preventDefault();
      const p = this.#toLocal(event);
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      this.zoomAt(p.x, p.y, factor);
    }, { passive: false });
  }

  #toLocal(event) {
    const point = this.svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(this.svg.getScreenCTM().inverse());
  }

  #toLocalWithCTM(event, ctm) {
    const point = this.svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(ctm.inverse());
  }

  #onPointerDown(event) {
    // Right-click: ignore entirely — let the native context menu appear.
    if (event.button === 2) return;

    // Middle button, or Alt+left — start a pan. Bypasses the handlers.
    const wantsPan = event.button === 1 || (event.button === 0 && event.altKey);
    if (wantsPan) {
      event.preventDefault();
      this.panState = {
        ctm: this.svg.getScreenCTM(),
        graphCoordA: this.#toLocal(event),
        viewport: { ...this._viewport },
      };
      this.svg.classList.add('is-dragging');
      this.svg.setPointerCapture(event.pointerId);
      return;
    }

    const point = this.#toLocal(event);
    const nodeEl = event.target.closest('[data-node]');
    const edgeEl = event.target.closest('[data-edge]');

    if (nodeEl) {
      const nodeId = Number(nodeEl.dataset.node);
      const node = this.model.graph.node(nodeId);
      if (!node) return;

      const allowDrag = this.handlers.onNodePointerDown?.(nodeId, point, event) !== false;
      if (allowDrag) {
        // CRITICAL — without preventDefault() the browser treats the
        // pointerdown as the beginning of a text-selection gesture,
        // fires pointercancel partway through the drag, and highlights
        // text across the SVG instead of moving the node.
        event.preventDefault();
        this.drag = { id: nodeId, offsetX: point.x - node.x, offsetY: point.y - node.y };
        this.svg.classList.add('is-dragging');
        this.svg.setPointerCapture(event.pointerId);
      }
      return;
    }

    if (edgeEl) {
      this.handlers.onEdgePointerDown?.(Number(edgeEl.dataset.edge), point, event);
      return;
    }

    this.handlers.onBackgroundPointerDown?.(point, event);
  }

  #onPointerMove(event) {
    if (this.panState) {
      const { ctm, graphCoordA: A, viewport: V } = this.panState;
      const B = this.#toLocalWithCTM(event, ctm);
      this._viewport = {
        x: V.x + A.x - B.x,
        y: V.y + A.y - B.y,
        w: V.w,
        h: V.h,
      };
      this._applyViewport();
      return;
    }

    if (!this.drag) return;
    const point = this.#toLocal(event);
    this.handlers.onNodeMove?.(this.drag.id, {
      x: point.x - this.drag.offsetX,
      y: point.y - this.drag.offsetY,
    });
  }

  #onPointerUp() {
    if (this.panState) {
      this.panState = null;
      this.svg.classList.remove('is-dragging');
      return;
    }
    if (!this.drag) return;
    this.drag = null;
    this.svg.classList.remove('is-dragging');
    this.handlers.onPointerUp?.();
  }

  #onDoubleClick(event) {
    if (event.target.closest('[data-node]') || event.target.closest('[data-edge]')) return;
    this.handlers.onBackgroundDoubleClick?.(this.#toLocal(event), event);
  }
}