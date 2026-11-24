import { esc, safeImage } from "./ui.js";
/**
 * AFTERFRAME — Player + Continue Watching + In-Player Quality Controls
 * Uses Video.js 10 (CDN) for the player UI.
 * Hooks into the <video> element detail.js creates inside .video-wrap
 */

/* ─── Continue Watching Store ─────────────────────────────────────────────── */
const CW_KEY = 'af-cw-v2';
const CW_MAX = 24;

export const CW = {
  load() {
    try { return JSON.parse(localStorage.getItem(CW_KEY) || '[]'); }
    catch { return []; }
  },
  save(items) {
    try { localStorage.setItem(CW_KEY, JSON.stringify(items.slice(0, CW_MAX))); }
    catch {}
  },
  upsert(entry) {
    const all = CW.load().filter(i => i.id !== entry.id);
    all.unshift(entry);
    CW.save(all);
  },
  remove(id) { CW.save(CW.load().filter(i => i.id !== id)); },
  get(id)    { return CW.load().find(i => i.id === id) || null; },
};

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
    : `${m}:${String(sec).padStart(2,'0')}`;
}

/* ─── Init Video.js 10 player + in-player quality ─────────────────────────── */
export function initPlayer() {
  const videoWrap = document.querySelector('.video-wrap');
  const video     = videoWrap?.querySelector('video');
  if (!video || video.dataset.vjs10) return;
  video.dataset.vjs10 = '1';

  /* Wait for Video.js 10 custom elements to be defined */
  const tryWrap = () => {
    if (!customElements.get('video-player') || !customElements.get('video-skin')) {
      return setTimeout(tryWrap, 80);
    }
    doWrap(video, videoWrap);
  };
  tryWrap();
}

function doWrap(video, videoWrap) {
  /* Remove native controls — Video.js 10 provides its own */
  video.removeAttribute('controls');

  /* Build Video.js 10 wrapper around the existing <video> element */
  const skin   = document.createElement('video-skin');
  skin.style.cssText = 'display:block;width:100%;aspect-ratio:16/9;position:relative;';

  const player = document.createElement('video-player');
  player.style.cssText = 'display:block;width:100%;position:relative;';

  /* Move video element inside Video.js wrappers */
  videoWrap.insertBefore(player, video);
  player.appendChild(skin);
  skin.appendChild(video);
  const skinStyle = document.createElement('style');
  skinStyle.textContent = 'media-container.video-skin, media-poster { background: transparent !important; }';
  skin.shadowRoot?.append(skinStyle);

  /* ── In-Player Quality Selector ─────────────────────────────────────── */
  const reinjectQuality = setupInPlayerQuality(video, skin);

  // Re-inject quality gear after every play event (Video.js may re-render shadow DOM)
  video.addEventListener('play', () => setTimeout(reinjectQuality, 200));
  video.addEventListener('play', () => setTimeout(reinjectQuality, 800));

  /* ── Continue watching: save progress ───────────────────────────────── */
  const movieId = location.pathname;
  let saveInterval;

  function getEntry() {
    const pct = video.duration ? Math.round(video.currentTime / video.duration * 100) : 0;
    return {
      id:          movieId,
      title:       document.title.replace(' · AfterShow', '').trim(),
      poster:      video.poster || null,
      url:         location.pathname,
      currentTime: Math.floor(video.currentTime),
      duration:    Math.floor(video.duration) || 0,
      percent:     pct,
      status:      video.ended ? 'finished' : 'watching',
      updatedAt:   Date.now(),
    };
  }

  video.addEventListener('play', () => {
    clearInterval(saveInterval);
    saveInterval = setInterval(() => {
      if (video.currentTime > 5) CW.upsert(getEntry());
    }, 5000);
  });

  video.addEventListener('pause', () => {
    clearInterval(saveInterval);
    if (video.currentTime > 5) CW.upsert(getEntry());
  });

  video.addEventListener('ended', () => {
    clearInterval(saveInterval);
    CW.upsert(getEntry());
  });

  window.addEventListener('beforeunload', () => {
    if (video.currentTime > 5) CW.upsert(getEntry());
  });

  /* Resume from saved position on initial load */
  video.addEventListener('loadedmetadata', () => {
    const saved = CW.get(movieId);
    if (saved?.currentTime > 10 && saved.percent < 93 && !video.dataset.pendingResume) {
      video.currentTime = saved.currentTime;
    }
  }, { once: true });
}

/* ─── In-Player Quality Switcher — Native Video.js 10 Menu Integration ──── */
function setupInPlayerQuality(video, skin) {
  const EMPTY_QUALITIES = [];
  const observedGears = new WeakSet();
  const captureAction = (element, activate) => {
    const handle = event => {
      if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      activate();
    };
    element.addEventListener('click', handle, true);
    element.addEventListener('keydown', handle, true);
  };

  // Seamless resume when src changes due to quality switch
  video.addEventListener('loadstart', () => {
    const resumeTime = parseFloat(video.dataset.pendingResume || '0');
    const resumePlay = video.dataset.pendingPlay === 'true';
    if (resumeTime > 0) {
      const applySeek = () => {
        if (Number.isFinite(video.duration) && video.duration > 0) {
          video.currentTime = Math.min(resumeTime, video.duration);
          delete video.dataset.pendingResume;
          delete video.dataset.pendingPlay;
          if (resumePlay) video.play().catch(() => {});
          video.removeEventListener('loadedmetadata', applySeek);
          video.removeEventListener('canplay', applySeek);
        }
      };
      video.addEventListener('loadedmetadata', applySeek);
      video.addEventListener('canplay', applySeek);
      setTimeout(applySeek, 250);
      setTimeout(applySeek, 700);
    }
  });

  function renderQualityMenu() {
    const sr = skin.shadowRoot;
    if (!sr) return;

    const quals = window.__movieQualities || EMPTY_QUALITIES;
    const activeQ = quals.find(q => q.active) || quals[0];

    // Swap the visible menu rows without closing or replacing the popover.
    if (!sr.querySelector('#af-gear-quality-style')) {
      const style = document.createElement('style');
      style.id = 'af-gear-quality-style';
      style.textContent = `
        media-menu-item:has(> media-text[token="menu.quality"]),
        media-menu-content:has(> media-quality-radio-group),
        media-menu-content.af-quality-open > :not(.af-quality-view),
        .af-quality-view[hidden] {
          display: none !important;
        }
      `;
      sr.appendChild(style);
    }

    const nativeTrigger = sr.querySelector('media-menu-item[commandfor]:has(> media-text[token="menu.quality"])');
    const nativePanel = sr.getElementById(nativeTrigger?.getAttribute('commandfor') || '');
    const nativeBack = nativePanel?.querySelector('.media-menu-back-item');
    const nativeOption = nativePanel?.querySelector('media-quality-radio-group template')
      ?.content.querySelector('media-menu-radio-item');
    const menu = nativeTrigger?.closest('media-menu');
    if (!menu || !nativeBack || !nativeOption) return;
    const root = nativeTrigger.closest('media-menu-content');
    const gear = sr.querySelector('.video-controls-settings-button');
    let trigger = root.querySelector('.af-quality-trigger');
    let view = root.querySelector('.af-quality-view');
    if (!trigger || !view) {
      trigger = document.createElement('media-menu-item');
      trigger.className = 'media-menu-trigger-item af-quality-trigger';
      trigger.append(...[...nativeTrigger.childNodes].map(node => node.cloneNode(true)));
      trigger.querySelector('media-text').replaceWith(document.createTextNode('Quality'));
      view = document.createElement('div');
      view.className = 'af-quality-view';
      view.hidden = true;
      view.id = root.id + '-file-quality';
      trigger.setAttribute('aria-controls', view.id);
      trigger.setAttribute('aria-expanded', 'false');

      const back = nativeBack.cloneNode(true);
      back.querySelector('media-text').replaceWith(document.createTextNode('Quality'));
      back.setAttribute('aria-label', 'Back to settings');
      const divider = document.createElement('media-menu-separator');
      divider.className = 'media-menu-separator';
      const list = document.createElement('div');
      list.className = 'media-menu-radio-group af-quality-options';
      list.setAttribute('role', 'group');
      list.setAttribute('aria-label', 'Available qualities');
      view.append(back, divider, list);
      root.append(view);
      nativeTrigger.after(trigger);

      const resetView = (restoreFocus = false) => {
        if (view.hidden) return;
        root.classList.remove('af-quality-open');
        trigger.setAttribute('aria-expanded', 'false');
        if (restoreFocus && !trigger.hidden) trigger.focus({ preventScroll: true });
        view.hidden = true;
      };
      captureAction(trigger, () => {
        view.hidden = false;
        back.focus({ preventScroll: true });
        trigger.setAttribute('aria-expanded', 'true');
        root.classList.add('af-quality-open');
      });
      captureAction(back, () => resetView(true));
      view.addEventListener('keydown', e => {
        if (e.key !== 'Escape' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        e.stopPropagation();
        resetView(true);
      }, true);
      if (gear && !observedGears.has(gear)) {
        observedGears.add(gear);
        gear.addEventListener('click', () => setTimeout(renderQualityMenu, 0));
        new MutationObserver(() => {
          if (gear.getAttribute('aria-expanded') === 'false') resetView();
        }).observe(gear, { attributes: true, attributeFilter: ['aria-expanded'] });
      }
    }

    const hidden = quals.length <= 1;
    if (trigger.hidden !== hidden) trigger.hidden = hidden;
    const hint = trigger.querySelector('[data-part="value"]');
    const name = activeQ?.name || '';
    if (hint.textContent !== name) hint.textContent = name;
    const list = view.querySelector('.af-quality-options');
    if (list.qualities === quals) {
      Array.from(list.children).forEach((item, index) => {
        const checked = String(quals[index] === activeQ);
        if (item.getAttribute('aria-checked') !== checked) item.setAttribute('aria-checked', checked);
      });
      return;
    }
    list.qualities = quals;
    list.replaceChildren(...quals.map(q => {
      const item = document.createElement('media-menu-item');
      item.className = 'media-menu-radio-item';
      item.append(...[...nativeOption.childNodes].map(node => node.cloneNode(true)));
      item.setAttribute('aria-checked', String(q === activeQ));
      item.querySelector('[data-part="label"]').textContent = q.name;
      item.querySelector('[data-part="tier"]')?.remove();
      const badge = item.querySelector('[data-part="badge"]');
      const same = quals.filter(candidate => candidate.name === q.name);
      const detail = [q.edition, q.size].filter(Boolean).join(' · ');
      if (badge) {
        badge.hidden = same.length < 2;
        badge.textContent = detail || `Source ${same.indexOf(q) + 1}`;
      }
      captureAction(item, () => {
        if (item.getAttribute('aria-checked') === 'true') return;
        video.dataset.pendingResume = String(video.currentTime);
        video.dataset.pendingPlay = String(!video.paused);
        q.select();
      });
      return item;
    }));
    for (const item of list.children) item.setAttribute('role', 'menuitemradio');
  }

  // Initial and reactive updates
  setTimeout(renderQualityMenu, 200);
  setTimeout(renderQualityMenu, 600);
  setTimeout(renderQualityMenu, 1500);

  window.addEventListener('af:qualities-updated', renderQualityMenu);
  window.addEventListener('af:quality-changed', renderQualityMenu);

  return renderQualityMenu;
}

/* ─── Continue Watching row renderer ─────────────────────────────────────── */
const SVG_PLAY  = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="m5 3 14 9-14 9z"/></svg>`;
const SVG_CLOSE = `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`;

export function renderContinueWatching(container) {
  const items = CW.load();
  if (!items.length) return;

  const section = document.createElement('section');
  section.className = 'section cw-section';

  const head = document.createElement('div');
  head.className = 'section-head';
  head.innerHTML = `
    <h2 class="section-title">Continue Watching</h2>
    <span class="section-count">${items.length} title${items.length !== 1 ? 's' : ''}</span>`;
  section.append(head);

  const row = document.createElement('div');
  row.className = 'cw-row';

  items.forEach((item, idx) => {
    const a = document.createElement('a');
    a.className = 'cw-card';
    a.href = /^\/movie\/[\w.-]+(?:\/watch)?$/.test(item.url) ? item.url : '/';
    a.setAttribute('aria-label', `Continue watching ${esc(item.title)}`);
    a.style.animationDelay = `${idx * 0.05}s`;

    const statusClass = item.status === 'finished' ? 'finished' : 'watching';
    const statusText  = item.status === 'finished' ? '✓ Finished' : `${Math.min(100,Math.max(0,Number(item.percent)||0))}%`;

    a.innerHTML = `
      <div class="cw-thumb">
        ${item.poster
          ? `<img src="${esc(safeImage(item.poster))}" alt="" loading="lazy" decoding="async">`
          : `<div class="cw-thumb-placeholder">${SVG_PLAY}</div>`}
        <span class="cw-status-chip ${statusClass}">${statusText}</span>
        <div class="cw-progress-bar"><div class="cw-progress-fill" style="width:${Math.min(100,Math.max(0,Number(item.percent)||0))}%"></div></div>
        <button class="cw-remove" aria-label="Remove from continue watching">${SVG_CLOSE}</button>
        <div class="cw-play-icon">${SVG_PLAY}</div>
      </div>
      <div class="cw-card-info">
        <p class="cw-card-title">${esc(item.title)}</p>
        <p class="cw-card-sub">${fmtTime(item.currentTime)} of ${fmtTime(item.duration)}</p>
      </div>`;

    a.querySelector('.cw-remove').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      CW.remove(item.id);
      a.classList.add('cw-removing');
      setTimeout(() => { a.remove(); if (!row.children.length) section.remove(); }, 250);
    });

    row.append(a);
  });

  section.append(row);
  container.append(section);
}
