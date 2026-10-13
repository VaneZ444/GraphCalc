import { h, clear } from '../util/dom.js';
import { MODULES, getModule } from '../modules/index.js';

export function createModulePanel(app, { titleHost, controlsHost, outputHost }) {
  let builtForTab = null;

  function rebuildControls() {
    const module = app.activeModule;
    builtForTab = module.id;

    titleHost.textContent = module.label;
    clear(controlsHost);

    if (module.buildControls) {
      controlsHost.append(module.buildControls(app.moduleContext()));
    }
  }

  function renderSummary(result) {
    const summary = result?.summary || [];
    if (!summary.length) return null;

    return h('div', { style: { marginBottom: '10px' } },
      ...summary.map(item =>
        h('div', { class: 'stat' },
          h('span', {}, item.label),
          h('b', {}, String(item.value)))));
  }

  function renderOutput() {
    const module = app.activeModule;
    clear(outputHost);

    const summary = renderSummary(app.result);
    if (summary) outputHost.append(summary);

    if (module.renderOutput && app.result) {
      outputHost.append(module.renderOutput(app.result, app.moduleContext()));
    }
  }

  function onTabChange() {
    rebuildControls();
    renderOutput();
  }

  app.on('tab', onTabChange);
  app.on('change', renderOutput);

  rebuildControls();
  renderOutput();
}