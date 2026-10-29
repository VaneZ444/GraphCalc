// js/render/renderer.js
//
// Universal renderer interface. Renderers may optionally implement the
// viewport controls (fitToContent / resetView / zoomBy). The app never calls
// them directly — they're wired to the on-screen viewport buttons and to the
// auto-fit-on-phase-change in main.js.

export class Renderer {
  handlers = {};

  mount()   { throw new Error('Renderer.mount() is not implemented'); }
  render()  { throw new Error('Renderer.render() is not implemented'); }
  destroy() { throw new Error('Renderer.destroy() is not implemented'); }

  on(handlers) {
    Object.assign(this.handlers, handlers || {});
    return this;
  }

  /* Optional viewport API — no-op stubs for renderers without pan/zoom. */
  fitToContent() {}
  resetView() {}
  zoomBy() {}
}