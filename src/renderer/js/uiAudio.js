(function () {
  let ctx = null;
  let muted = false;

  try {
    muted = localStorage.getItem('ui-audio-muted') === '1';
  } catch (_) {}

  function getCtx() {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) { return null; }
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Synthesized "tactical" click: short noise burst + low thump
  function click({ freq = 600, dur = 0.04, gain = 0.05, type = 'square' } = {}) {
    if (muted) return;
    const c = getCtx();
    if (!c) return;

    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, c.currentTime + dur);
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    osc.connect(g).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + dur);
  }

  function navClick() { click({ freq: 480, dur: 0.05, gain: 0.04, type: 'square' }); }
  function btnClick() { click({ freq: 320, dur: 0.06, gain: 0.05, type: 'triangle' }); }
  function btnHover() { click({ freq: 1200, dur: 0.015, gain: 0.012, type: 'sine' }); }
  function dangerClick() { click({ freq: 180, dur: 0.09, gain: 0.06, type: 'sawtooth' }); }

  window.uiAudio = {
    click, navClick, btnClick, btnHover, dangerClick,
    mute() { muted = true; try { localStorage.setItem('ui-audio-muted', '1'); } catch (_) {} },
    unmute() { muted = false; try { localStorage.setItem('ui-audio-muted', '0'); } catch (_) {} },
    isMuted() { return muted; }
  };

  // Auto-wire common controls. Use capture phase + delegation so dynamic content works.
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('.nav-item');
    if (nav) { navClick(); return; }
    const danger = e.target.closest('.btn-danger');
    if (danger) { dangerClick(); return; }
    const btn = e.target.closest('.btn, .title-bar-button, .steamcmd-drawer-btn');
    if (btn) { btnClick(); }
  }, true);

  document.addEventListener('mouseover', (e) => {
    if (e.target.closest('.btn, .nav-item')) btnHover();
  }, true);
})();
