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

/* ─── In-Player Quality Switcher — Submenu with Back button & Checkmark ──── */
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

  // Track injected state so we can reinject on shadow DOM changes
  let injected = false;
  let observer = null;
  let renderQualityGear = null; // hoisted ref, set after injectQuality runs

  function injectQuality() {
    const sr = skin.shadowRoot;
    if (!sr) {
      setTimeout(injectQuality, 100);
      return;
    }

    const speedText = sr.querySelector('media-menu-item media-text[token="menu.speed"]');
    const speedItem = speedText?.closest('media-menu-item') || sr.querySelector('media-menu-item[commandfor]');
    if (!speedItem) {
      setTimeout(injectQuality, 100);
      return;
    }

    // Watch for shadow DOM mutations so we can re-inject if Video.js re-renders after Play
    if (!observer) {
      observer = new MutationObserver(() => {
        const sr2 = skin.shadowRoot;
        if (!sr2) return;
        // If our trigger was removed from the shadow DOM, re-inject
        const anyMenu = sr2.querySelector('media-menu-content');
        if (anyMenu && !anyMenu.querySelector('.af-quality-trigger-item')) {
          injected = false;
          injectQuality();
        }
      });
      observer.observe(sr, { childList: true, subtree: true });
    }
    injected = true;

    // Styles for custom submenu & trigger matching native Video.js menu
    if (!sr.querySelector('#af-gear-quality-style')) {
      const style = document.createElement('style');
      style.id = 'af-gear-quality-style';
      style.textContent = `
        .af-quality-trigger-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          cursor: pointer;
          color: rgba(255, 255, 255, 0.85);
          font-size: 14px;
          font-family: inherit;
          transition: background 0.12s;
          border-radius: 6px;
        }
        .af-quality-trigger-item:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
        }
        .af-quality-trigger-left {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .af-quality-trigger-right {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          color: rgba(255, 255, 255, 0.5);
          font-size: 13px;
        }
        .af-quality-submenu {
          display: flex;
          flex-direction: column;
          padding: 4px 0;
        }
        .af-quality-back-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          font-size: 14px;
          font-weight: 600;
          color: #fff;
          background: none;
          border: none;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          cursor: pointer;
          text-align: left;
          width: 100%;
          font-family: inherit;
        }
        .af-quality-back-btn:hover {
          background: rgba(255, 255, 255, 0.08);
        }
        .af-quality-option {
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
        }
        .af-quality-option:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
        }
        .af-quality-option.active {
          color: #fff;
          font-weight: 600;
        }
        .af-quality-check {
          color: var(--media-primary-color, #ff6b3d);
          font-size: 16px;
          font-weight: 700;
        }
      `;
      sr.appendChild(style);
    }

    const menuPopup = speedItem.closest('media-menu') || speedItem.parentNode;
    const topContent = speedItem.closest('media-menu-content') || speedItem.parentNode;

    // Clean up any old quality row
    const oldRow = topContent.querySelector('.af-gear-quality-row');
    if (oldRow) oldRow.remove();

    // Build or get trigger item
    let trigger = topContent.querySelector('.af-quality-trigger-item');
    if (!trigger) {
      trigger = document.createElement('div');
      trigger.className = 'af-quality-trigger-item';
      topContent.insertBefore(trigger, speedItem);
    }

    // Build or get submenu container
    let submenu = menuPopup.querySelector('.af-quality-submenu');
    if (!submenu) {
      submenu = document.createElement('div');
      submenu.className = 'af-quality-submenu';
      submenu.style.display = 'none';
      menuPopup.appendChild(submenu);
    }

    function showSubmenu() {
      topContent.style.display = 'none';
      submenu.style.display = 'flex';
    }

    function showMainMenu() {
      submenu.style.display = 'none';
      topContent.style.display = '';
    }

    trigger.onclick = (e) => {
      e.stopPropagation();
      showSubmenu();
    };

    function renderQualityGearInner() {
      let quals = window.__movieQualities;
      if (!quals || quals.length <= 1) {
        trigger.style.display = 'none';
        showMainMenu();
        return;
      }
      trigger.style.display = 'flex';
      const activeQ = quals.find(q => q.active) || quals[0];

      // Update main menu trigger row (Quality  360p >)
      trigger.innerHTML = `
        <span class="af-quality-trigger-left">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          Quality
        </span>
        <span class="af-quality-trigger-right">
          <span>${activeQ ? activeQ.name : ''}</span>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m9 18 6-6-6-6"/></svg>
        </span>
      `;

      // Render submenu page (< Quality, options list with checkmarks)
      submenu.innerHTML = `
        <button type="button" class="af-quality-back-btn">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m15 18-6-6 6-6"/></svg>
          Quality
        </button>
        <div class="af-quality-options-list"></div>
      `;

      submenu.querySelector('.af-quality-back-btn').onclick = (e) => {
        e.stopPropagation();
        showMainMenu();
      };

      const optionsBox = submenu.querySelector('.af-quality-options-list');
      quals.forEach(q => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'af-quality-option' + (q.active ? ' active' : '');
        btn.innerHTML = `
          <span>${esc(q.name)}</span>
          <span class="af-quality-check" style="${q.active ? '' : 'visibility:hidden'}">✓</span>
        `;
        btn.onclick = (e) => {
          e.stopPropagation();
          if (q.active) {
            showMainMenu();
            return;
          }
          const curTime = video.currentTime;
          const wasPlay = !video.paused;
          video.dataset.pendingResume = String(curTime);
          video.dataset.pendingPlay   = String(wasPlay);
          q.select();
          showMainMenu();
        };
        optionsBox.appendChild(btn);
      });
    }

    renderQualityGear = renderQualityGearInner;
    renderQualityGearInner();
    window.addEventListener('af:qualities-updated', renderQualityGearInner);
    window.addEventListener('af:quality-changed', renderQualityGearInner);
    setTimeout(renderQualityGearInner, 400);
    setTimeout(renderQualityGearInner, 1200);
  }

  setTimeout(injectQuality, 250);

  // Return a reinject function so caller can trigger re-injection after Play
  return function reinjectQuality() {
    if (!injected) {
      injectQuality();
    } else {
      const sr = skin.shadowRoot;
      if (!sr) return;
      const anyMenu = sr.querySelector('media-menu-content');
      if (anyMenu && !anyMenu.querySelector('.af-quality-trigger-item')) {
        injected = false;
        injectQuality();
      } else if (renderQualityGear) {
        renderQualityGear();
      }
    }
  };
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
