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

    const quals = window.__movieQualities || [];
    const activeQ = quals.find(q => q.active) || quals[0];

    // Ensure CSS styles for custom quality items inside the shadow root
    if (!sr.querySelector('#af-gear-quality-style')) {
      const style = document.createElement('style');
      style.id = 'af-gear-quality-style';
      style.textContent = `
        .af-qi-box {
          display: flex;
          flex-direction: column;
          padding: 4px 0;
          max-height: 240px;
          overflow-y: auto;
        }
        .af-qi-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 16px;
          font-size: 14px;
          color: rgba(255, 255, 255, 0.85);
          background: none;
          border: none;
          cursor: pointer;
          width: 100%;
          text-align: left;
          font-family: inherit;
          transition: background 0.12s;
          border-radius: 6px;
        }
        .af-qi-item:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
        }
        .af-qi-item.active {
          color: #fff;
          font-weight: 600;
        }
        .af-qi-check {
          color: var(--media-primary-color, #ff6b3d);
          font-size: 16px;
          font-weight: 700;
        }
      `;
      sr.appendChild(style);
    }

    // 1. Try to find the built-in Video.js 10 Quality menu item
    const qualityText = sr.querySelector('media-text[token="menu.quality"]');
    let qualityItem = qualityText?.closest('media-menu-item');
    let qualityContent = null;

    if (qualityItem) {
      const contentId = qualityItem.getAttribute('commandfor');
      if (contentId) {
        try {
          qualityContent = sr.querySelector(`[id="${contentId}"]`);
        } catch {
          qualityContent = null;
        }
      }
      if (!qualityContent) {
        qualityContent = sr.querySelector('media-menu-content media-quality-radio-group')?.closest('media-menu-content') || null;
      }
    }

    // 2. If built-in item not found, create one next to Speed item using native commandfor
    if (!qualityItem) {
      const speedText = sr.querySelector('media-text[token="menu.speed"]');
      const speedItem = speedText?.closest('media-menu-item') || sr.querySelector('media-menu-item[commandfor]');
      if (!speedItem) return;

      const menuPopup = speedItem.closest('media-menu') || speedItem.parentNode;
      const topContent = speedItem.closest('media-menu-content') || speedItem.parentNode;

      qualityItem = topContent.querySelector('.af-custom-quality-trigger');
      if (!qualityItem) {
        qualityItem = document.createElement('media-menu-item');
        qualityItem.className = 'media-menu-trigger-item af-custom-quality-trigger';
        qualityItem.setAttribute('commandfor', 'af-quality-content');
        qualityItem.innerHTML = `
          <media-icon name="switches" class="media-menu-trigger-item-icon">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </media-icon>
          <media-text>Quality</media-text>
          <span class="media-menu-hint">
            <span class="af-quality-label"></span>
            <media-icon name="chevron" class="media-menu-forward-chevron">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m9 18 6-6-6-6"/></svg>
            </media-icon>
          </span>
        `;
        topContent.insertBefore(qualityItem, speedItem);
      }

      qualityContent = menuPopup.querySelector('#af-quality-content');
      if (!qualityContent) {
        qualityContent = document.createElement('media-menu-content');
        qualityContent.className = 'media-menu-content';
        qualityContent.id = 'af-quality-content';
        qualityContent.innerHTML = `
          <media-menu-item class="media-menu-back-item">
            <media-icon name="chevron" class="media-menu-back-chevron">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m15 18-6-6 6-6"/></svg>
            </media-icon>
            <media-text>Quality</media-text>
          </media-menu-item>
          <media-menu-separator class="media-menu-separator"></media-menu-separator>
        `;
        menuPopup.appendChild(qualityContent);
      }
    }

    if (!qualityItem || !qualityContent) return;

    // Show/hide Quality item depending on whether options are available
    if (quals.length <= 1) {
      qualityItem.style.display = 'none';
      qualityItem.setAttribute('hidden', '');
      return;
    }

    qualityItem.style.display = 'flex';
    qualityItem.removeAttribute('hidden');

    // Prevent Video.js 10 from re-hiding the Quality item
    if (!qualityItem._afObserved) {
      qualityItem._afObserved = true;
      const obs = new MutationObserver(() => {
        const qList = window.__movieQualities || [];
        if (qList.length > 1 && qualityItem.hasAttribute('hidden')) {
          qualityItem.removeAttribute('hidden');
          qualityItem.style.display = 'flex';
        }
      });
      obs.observe(qualityItem, { attributes: true, attributeFilter: ['hidden', 'style'] });
    }

    // Hide Video.js 10's built-in "Auto" label on the trigger, and display our real resolution
    const defaultVal = qualityItem.querySelector('[data-part="value"]');
    if (defaultVal) defaultVal.style.display = 'none';

    let customVal = qualityItem.querySelector('.af-quality-label');
    if (!customVal) {
      customVal = document.createElement('span');
      customVal.className = 'af-quality-label';
      customVal.style.cssText = 'font-size:13px;color:rgba(255,255,255,0.6);margin-right:4px;';
      const hintWrap = qualityItem.querySelector('.media-menu-hint') || qualityItem;
      hintWrap.prepend(customVal);
    }
    customVal.textContent = activeQ ? activeQ.name : '';

    // Hide Video.js 10's native <media-quality-radio-group> so "Auto" is not rendered
    const nativeRadioGroup = qualityContent.querySelector('media-quality-radio-group');
    if (nativeRadioGroup) {
      nativeRadioGroup.style.display = 'none';
    }

    // Populate options inside qualityContent
    let optBox = qualityContent.querySelector('.af-qi-box');
    if (!optBox) {
      optBox = document.createElement('div');
      optBox.className = 'af-qi-box';
      // Append right after separator or at the end
      const sep = qualityContent.querySelector('media-menu-separator');
      if (sep && sep.nextSibling) {
        qualityContent.insertBefore(optBox, sep.nextSibling);
      } else {
        qualityContent.appendChild(optBox);
      }
    }
    optBox.innerHTML = '';

    quals.forEach(q => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'af-qi-item' + (q.active ? ' active' : '');
      btn.innerHTML = `
        <span class="af-qi-name">${esc(q.name)}</span>
        <span class="af-qi-check" style="${q.active ? '' : 'visibility:hidden'}">✓</span>
      `;
      btn.onclick = (e) => {
        e.stopPropagation();
        if (!q.active) {
          const curTime = video.currentTime;
          const wasPlay = !video.paused;
          video.dataset.pendingResume = String(curTime);
          video.dataset.pendingPlay   = String(wasPlay);
          q.select();
        }
        // Update label immediately
        if (customVal) customVal.textContent = q.name;
        // Go back to main menu
        try {
          const backBtn = qualityContent.querySelector('.media-menu-back-item');
          if (backBtn) {
            backBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          }
        } catch {}
      };
      optBox.appendChild(btn);
    });
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
