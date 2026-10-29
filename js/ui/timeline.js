// js/ui/timeline.js
//
// Video-player style transport. Extended with a "formation phase" band:
// the first segment of the track (from tMin to MERGE_T) is tinted, and a
// vertical marker shows where the source graphs get formulated into the
// unified graph. Once the playhead crosses the marker, the marker turns green.

import { h } from '../util/dom.js';
import { TIMELINE } from '../config.js';

// Must match the MERGE_T constant used inside js/core/app.js.
const MERGE_T = 1;

const SPEEDS = [0.25, 0.5, 1, 2, 4];

export function createTimeline(app, host) {
  /* ------------------------------------------------------------- elements */

  const fill  = h('div', { class: 'tl-fill' });
  const head  = h('div', { class: 'tl-head' });

  const mergePercent =
    ((MERGE_T - TIMELINE.min) / (TIMELINE.max - TIMELINE.min)) * 100;

  const phaseZone = h('div', {
    class: 'tl-phase-zone',
    style: { width: `${mergePercent}%` },
    title: 'Formulation phase — source graphs merge at t = 1',
  });

  const phaseMark = h('div', {
    class: 'tl-phase-mark',
    style: { left: `${mergePercent}%` },
    title: 'Formulation completes here (t = 1)',
  });

  const track = h('div', { class: 'tl-track' },
    phaseZone, fill, phaseMark, head);

  /* ------------------------------------------------------------- controls */

  const playButton    = h('button', { class: 'tl-btn tl-play', title: 'Play / Pause' }, '▶');
  const startButton   = h('button', { class: 'tl-btn', title: 'Jump to start' }, '⏮');
  const backButton    = h('button', { class: 'tl-btn', title: 'Step back' }, '⏪');
  const forwardButton = h('button', { class: 'tl-btn', title: 'Step forward' }, '⏩');
  const endButton     = h('button', { class: 'tl-btn', title: 'Jump to end' }, '⏭');
  const loopButton    = h('button', { class: 'tl-btn', title: 'Loop' }, '↻');

  const timeReadout = h('span', { class: 'tl-time' }, '0.00');
  const maxReadout  = h('span', {}, TIMELINE.max.toFixed(2));

  const speedSelect = h('select', { class: 'tl-speed', title: 'Playback speed' },
    ...SPEEDS.map(speed =>
      h('option', { value: speed, selected: speed === app.speed }, `${speed}×`)));

  /* ------------------------------------------------------------ behaviour */

  playButton.addEventListener('click', () => app.togglePlay());
  startButton.addEventListener('click', () => app.seekStart());
  endButton.addEventListener('click', () => app.seekEnd());
  backButton.addEventListener('click', () => app.stepBy(-TIMELINE.step));
  forwardButton.addEventListener('click', () => app.stepBy(TIMELINE.step));
  loopButton.addEventListener('click', () => app.setLoop(!app.loop));

  speedSelect.addEventListener('change', event => {
    app.setSpeed(parseFloat(event.target.value));
  });

  let seeking = false;

  const seekFromEvent = event => {
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    app.setTime(TIMELINE.min + ratio * (TIMELINE.max - TIMELINE.min));
  };

  track.addEventListener('pointerdown', event => {
    seeking = true;
    track.setPointerCapture(event.pointerId);
    app.pause();
    seekFromEvent(event);
  });

  track.addEventListener('pointermove', event => {
    if (seeking) seekFromEvent(event);
  });

  const stopSeeking = () => { seeking = false; };
  track.addEventListener('pointerup', stopSeeking);
  track.addEventListener('pointercancel', stopSeeking);

  /* ---------------------------------------------------------------- sync */

  function sync() {
    const ratio = app.progress;
    fill.style.width = `${(ratio * 100).toFixed(2)}%`;
    head.style.left = `${(ratio * 100).toFixed(2)}%`;
    timeReadout.textContent = app.t.toFixed(2);

    playButton.textContent = app.playing ? '❚❚' : '▶';
    playButton.classList.toggle('is-active', app.playing);
    loopButton.classList.toggle('is-active', app.loop);
    speedSelect.value = String(app.speed);

    // Marker turns green once the playhead crosses the formation tick.
    phaseMark.classList.toggle('is-passed', app.t >= MERGE_T);
  }

  app.on('change', sync);
  app.on('transport', sync);
  sync();

  /* ---------------------------------------------------------------- mount */

  host.append(
    h('div', { class: 'tl-controls' },
      startButton, backButton, playButton, forwardButton, endButton),
    track,
    h('div', { class: 'tl-readout' }, timeReadout, ' / ', maxReadout),
    speedSelect,
    loopButton,
  );
}