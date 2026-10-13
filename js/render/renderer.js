/**
 * Universal renderer interface.
 *
 * Any renderer (SVG, Canvas, WebGL…) must implement these methods so the rest
 * of the application stays completely agnostic about the drawing technology.
 *
 *   mount(host)   → attach the rendering surface to a DOM host element
 *   render(model) → draw a view model (called on every state change)
 *   destroy()     → detach and release resources
 *   on(handlers)  → register interaction callbacks
 *
 * Interaction callbacks the renderer may emit:
 *   onNodePointerDown(nodeId, point, event) → return false to suppress dragging
 *   onEdgePointerDown(edgeId, point, event)
 *   onBackgroundPointerDown(point, event)
 *   onNodeMove(nodeId, point)               → during a drag
 *   onPointerUp()
 *
 * View model shape consumed by `render`:
 * {
 *   graph:      Graph,
 *   edgeStates: Map<edgeId, { active, value, error }>,
 *   view: {
 *     nodes: Map<nodeId, string[]>,   // CSS class tokens
 *     edges: Map<edgeId, string[]>,
 *   },
 *   tool: 'select' | 'node' | 'edge' | 'erase',
 * }
 */
export class Renderer {
  handlers = {};

  mount() {
    throw new Error('Renderer.mount() is not implemented');
  }

  render() {
    throw new Error('Renderer.render() is not implemented');
  }

  destroy() {
    throw new Error('Renderer.destroy() is not implemented');
  }

  on(handlers) {
    Object.assign(this.handlers, handlers || {});
    return this;
  }
}