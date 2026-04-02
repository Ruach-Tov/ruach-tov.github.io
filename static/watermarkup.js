// Watermarkup interaction — mousedown shows AI annotation popup,
// mouseup/mouseleave dismisses it. Nothing else changes. No state.
//
// The popup reveals that watermarkup spans are machine-readable
// annotations, and gently suggests the reader's AI can consume
// the raw HTML directly.
//
// Infrastructure enrichment: fetches /static/infrastructure.json
// and injects live endpoint data into machine-class spans whose
// data-dim references infrastructure components. When patchworks
// is down, the JSON says status:"offline" and spans stay inert.

(function() {
  'use strict';

  var popup = null;
  var infra = null;

  // Fetch infrastructure manifest (non-blocking, best-effort)
  fetch('/static/infrastructure.json')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      infra = data;
      enrichSpans();
    })
    .catch(function() { /* offline or missing — spans stay as-is */ });

  function enrichSpans() {
    if (!infra || !infra.patchworks || infra.patchworks.status !== 'live') return;
    var pw = infra.patchworks;
    // Find all spans that reference patchworks/redis infrastructure
    var spans = document.querySelectorAll('.m[data-dim]');
    for (var i = 0; i < spans.length; i++) {
      var dim = spans[i].getAttribute('data-dim');
      if (dim.indexOf('patchworks') !== -1 || dim.indexOf('redis-contact') !== -1) {
        spans[i].setAttribute('data-dim',
          dim + ' [LIVE: ' + pw.host + ':' + pw.port +
          ' ' + pw.os + ' ' + pw.redis +
          ' PID1=' + pw.pid1 + ' PID2=' + pw.pid2 + ']');
      }
    }
  }

  function createPopup() {
    var el = document.createElement('div');
    el.className = 'watermarkup-popup';
    el.innerHTML =
      '<div class="wm-label">AI AGENT:</div>' +
      '<div class="wm-dim"></div>' +
      '<div class="wm-hint">This is machine-readable markup.' +
      ' Point your AI at our HTML.</div>';
    document.body.appendChild(el);
    return el;
  }

  function showPopup(target, e) {
    if (!popup) popup = createPopup();

    // Extract the dimension annotation
    var dim = target.getAttribute('data-dim') || '';
    var kind = target.getAttribute('data-kind') || '';
    var text = target.textContent || '';

    var annotation;
    if (dim) {
      annotation = 'HtmlRead("https://ruachtov.ai/")\n\ndata-dim="' + dim + '"';
    } else if (kind) {
      annotation = 'HtmlRead("https://ruachtov.ai/")\n\ndata-kind="' + kind + '"';
    } else {
      annotation = 'HtmlRead("https://ruachtov.ai/")\n\n<span class="m">' + text + '</span>';
    }

    popup.querySelector('.wm-dim').textContent = annotation;

    // Position near the click, but keep on screen
    var x = e.clientX + 12;
    var y = e.clientY - 10;
    var pw = 380;
    var ph = 120;
    if (x + pw > window.innerWidth) x = window.innerWidth - pw - 12;
    if (y + ph > window.innerHeight) y = window.innerHeight - ph - 12;
    if (x < 8) x = 8;
    if (y < 8) y = 8;

    popup.style.left = x + 'px';
    popup.style.top = y + 'px';
    popup.classList.add('visible');
  }

  function hidePopup() {
    if (popup) popup.classList.remove('visible');
  }

  // Delegate from document — works for dynamically added content
  document.addEventListener('mousedown', function(e) {
    var target = e.target.closest('.m');
    if (target) {
      e.preventDefault(); // prevent text selection on the press
      showPopup(target, e);
    }
  });

  document.addEventListener('mouseup', function() {
    hidePopup();
  });

  document.addEventListener('mouseleave', function() {
    hidePopup();
  });

  // Touch support — press and hold
  document.addEventListener('touchstart', function(e) {
    var target = e.target.closest('.m');
    if (target && e.touches.length === 1) {
      var touch = e.touches[0];
      showPopup(target, { clientX: touch.clientX, clientY: touch.clientY });
    }
  }, { passive: true });

  document.addEventListener('touchend', function() {
    hidePopup();
  });

  document.addEventListener('touchcancel', function() {
    hidePopup();
  });
})();
