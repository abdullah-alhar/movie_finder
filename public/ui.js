export const $ = (selector) => document.querySelector(selector);

const shapes = {
  sun:    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon:   '<path d="M20 14a8.5 8.5 0 0 1-10-11A9 9 0 1 0 20 14Z"/>',
  save:   '<path d="M6 4h12v17l-6-4-6 4z"/>',
  play:   '<path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none"/>',
  film:   '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="m4 3 16-2 1 5-17 2zm4 0 3 4m3-5 3 4"/>',
  left:   '<path d="m14 5-7 7 7 7"/>',
  right:  '<path d="m9 5 7 7-7 7"/>',
  plus:   '<path d="M12 5v14M5 12h14"/>',
  check:  '<path d="m4 12 5 5L20 6"/>',
  search: '<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/>',
  share:  '<path d="M12 15V3m-4 4 4-4 4 4M5 12v8h14v-8"/>',
  grid:   '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  tv:     '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
};

export const icon = (name) =>
  `<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${shapes[name] || ''}</svg>`;

export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

export function safeImage(value) {
  return typeof value === 'string' &&
    (/^https:\/\//.test(value) || /^\/art\/[\w.-]+$/.test(value))
    ? value : '';
}

export const searchUrl = (item) =>
  '/search?' + new URLSearchParams({ q: [item.title, item.year].filter(Boolean).join(' ') });

export function movieUrl(item) {
  if (item.provider === "Custom" && /^https:\/\//.test(item.url)) return new URL(item.url).href;
  return /^\/movie\/[\w.-]+$/.test(item.url || '') ? item.url : searchUrl(item);
}

export async function json(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

let toastTimer;
export function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.hidden = true), 2600);
}

/** Render a skeleton loading grid */
export function skeletonGrid(count = 20) {
  const wrapper = document.createElement('div');
  wrapper.className = 'skeleton-grid';
  for (let i = 0; i < count; i++) {
    const card = document.createElement('div');
    card.className = 'skeleton-card';
    card.innerHTML = '<div class="skeleton-poster"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div>';
    wrapper.append(card);
  }
  return wrapper;
}

export function card(item, index = 6) {
  const node = document.createElement('article');
  node.className = 'card';
  const art = safeImage(item.image || item.poster);
  const kindLabel = item.kind === 'tv' ? 'Series' : 'Movie';
  const desc = [item.year, kindLabel].filter(Boolean).join(' · ');

  const link = document.createElement('a');
  link.className = 'card-link';
  link.href = movieUrl(item);

  link.innerHTML =
    '<div class="poster">' +
    '<span class="poster-name">' + esc(item.title) + '</span>' +
    (art ? `<img loading="${index < 4 ? 'eager' : 'lazy'}" fetchpriority="${index < 2 ? 'high' : 'auto'}" decoding="async" alt="" src="${esc(art)}">` : '') +
    '</div>' +
    '<h3>' + esc(item.title) + '</h3>' +
    '<p class="card-meta">' + esc(desc) + '</p>';

  node.append(link);

  const poster = link.querySelector('.poster');
  const image = poster.querySelector('img');
  const badge = document.createElement('span');

  badge.className = 'release-quality';
  if (item.quality) {
    badge.textContent = item.quality;
    if (/cam|predvd|ts|scr|tc/i.test(item.quality)) badge.classList.add('quality-cam');
    poster.append(badge);
  }

  if (/^\/movie\//.test(item.url || '')) {
    let active = false;
    let preview, artwork;
    const getPreview = () => preview ||= json(item.url + '/preview').catch(() => ({}));
    const getArtwork = () => artwork ||= json('/poster-artwork?' + new URLSearchParams({
      title: item.title, year: item.year || '', kind: item.kind || 'movie',
    }));

    async function loadPoster(lookup, key) {
      const src = safeImage((await lookup())[key]);
      if (!src || src === art) throw new Error('No alternate poster');
      const replacement = new Image();
      replacement.alt = '';
      replacement.decoding = 'async';
      replacement.fetchPriority = index < 2 ? 'high' : 'auto';
      replacement.src = src;
      await replacement.decode();
      return replacement;
    }

    async function updatePoster() {
      try {
        const previewPromise = getPreview();
        const artwork = loadPoster(getArtwork, 'image');
        const replacement = await artwork.catch(() => loadPoster(getPreview, 'poster'));
        if (node.isConnected) {
          const currentImg = poster.querySelector('img');
          if (currentImg && currentImg !== replacement) {
            currentImg.replaceWith(replacement);
          } else if (!currentImg) {
            poster.append(replacement);
          }
        }
        // Update quality badge with live scraped movie quality
        const prev = await previewPromise;
        if (prev?.quality) {
          badge.textContent = prev.quality;
          if (/cam|predvd|ts|scr|tc/i.test(prev.quality)) {
            badge.classList.add('quality-cam');
          } else {
            badge.classList.remove('quality-cam');
          }
          if (!badge.isConnected) poster.append(badge);
        }
      } catch { /* title stays visible */ }
    }

    if (image) image.onerror = () => { image.remove(); if (active) updatePoster(); };
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { active = true; if (!image || image.complete) updatePoster(); obs.disconnect(); }
      }
    }, { rootMargin: '200px' });
    obs.observe(node);
  }

  return node;
}

export function section(title, items, { href, count } = {}) {
  const wrap = document.createElement('section');
  wrap.className = 'section';

  const head = document.createElement('div');
  head.className = 'section-head';

  const h2 = document.createElement('h2');
  h2.className = 'section-title';
  h2.textContent = title;
  head.append(h2);

  if (count != null) {
    const c = document.createElement('span');
    c.className = 'section-count';
    c.textContent = count + ' titles';
    head.append(c);
  }

  if (href) {
    const more = document.createElement('a');
    more.className = 'section-more';
    more.href = href;
    more.textContent = 'See all →';
    head.append(more);
  }

  wrap.append(head);

  const grid = document.createElement('div');
  grid.className = 'grid';
  items.forEach((item, i) => grid.append(card(item, i)));
  wrap.append(grid);

  return wrap;
}

export function choice(label, values, initial, onChange, format = String) {
  const wrap = document.createElement('div');
  wrap.className = 'choice';
  const lbl = document.createElement('label');
  lbl.textContent = label;
  wrap.append(lbl);

  if (values.length <= 6) {
    const pillsWrap = document.createElement('div');
    pillsWrap.className = 'choice-pills';
    for (const v of values) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice-pill' + (v === initial ? ' active' : '');
      btn.textContent = format(v);
      btn.onclick = () => {
        pillsWrap.querySelectorAll('.choice-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        onChange(v);
      };
      pillsWrap.append(btn);
    }
    wrap.append(pillsWrap);
  } else {
    const sel = document.createElement('select');
    sel.className = 'custom-select';
    for (const v of values) {
      const opt = document.createElement('option');
      opt.value = String(v);
      opt.textContent = format(v);
      if (v === initial) opt.selected = true;
      sel.append(opt);
    }
    sel.onchange = () => onChange(values[sel.selectedIndex]);
    wrap.append(sel);
  }
  return wrap;
}
