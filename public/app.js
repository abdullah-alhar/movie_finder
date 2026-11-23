import { $, icon, esc, movieUrl, card, section, choice, json, skeletonGrid, toast } from './ui.js';
import { showDetail } from './detail.js';
import { initPlayer, renderContinueWatching } from './player.js';

const main   = $('#main');
const params = new URLSearchParams(location.search);
const q      = (params.get('q') || '').trim();
const source = params.get('source') || '';
const sort   = params.get('sort') || 'latest';
const isDetail   = location.pathname.startsWith('/movie/');
const isSeries   = location.pathname === '/series';
const isDiscover = (location.pathname === '/' || location.pathname === '') && !q && !params.has('sort') && !params.has('page');

// Mark active nav
const isSearch = location.pathname === '/search';
const navId = isSearch ? 'search' : isSeries ? 'series' : isDiscover ? 'discover' : 'browse';
const navEl = $('#' + navId + '-nav');
if (navEl) navEl.setAttribute('aria-current', 'page');

// ─── Theme ───────────────────────────────────────────────────────────────────
function applyTheme(value) {
  document.documentElement.dataset.theme = value;
  const btn = $('#theme');
  if (!btn) return;
  const isLight = value === 'light';
  btn.querySelector('svg')?.remove();
  btn.insertAdjacentHTML('afterbegin', isLight
    ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14a8.5 8.5 0 0 1-10-11A9 9 0 1 0 20 14Z"/></svg>'
    : '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>');
  btn.setAttribute('aria-label', 'Switch to ' + (isLight ? 'dark' : 'light') + ' mode');
}

let savedTheme;
try { savedTheme = localStorage.getItem('aftershow-theme') ?? localStorage.getItem('afterframe-theme'); } catch {}
applyTheme(savedTheme === 'light' ? 'light' : 'dark');
$('#theme')?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem('aftershow-theme',next); } catch {}
});

// ─── Search ───────────────────────────────────────────────────────────────────
const query       = $('#query');
const suggestions = $('#suggestions');
query.value = q;

if (isSeries) {
  query.form.action = '/series';
  query.placeholder = 'Search series…';
  query.setAttribute('aria-label', 'Search series');
}
if (source) {
  const hidden = document.createElement('input');
  hidden.type = 'hidden'; hidden.name = 'source'; hidden.value = source;
  query.form.append(hidden);
}

let searchTimer, searchAbort;
function closeSearch() {
  clearTimeout(searchTimer);
  searchAbort?.abort();
  suggestions.hidden = true;
  query.setAttribute('aria-expanded', 'false');
}

query.addEventListener('input', () => {
  closeSearch();
  const value = query.value.trim();
  if (value.length < 2) return;
  searchTimer = setTimeout(async () => {
    const controller = new AbortController();
    searchAbort = controller;
    try {
      const data = await json(
        '/api/suggestions?' + new URLSearchParams({ q: value, source, category: isSeries ? 'series' : '' }),
        controller.signal
      );
      if (query.value.trim() !== value || controller.signal.aborted) return;
      suggestions.replaceChildren(
        ...data.items.slice(0, 7).map((item) => {
          const link = document.createElement('a');
          link.href = movieUrl(item);
          link.textContent = [item.title, item.year].filter(Boolean).join(' · ');
          return link;
        })
      );
      const all = document.createElement('button');
      all.type = 'submit';
      all.textContent = isSeries ? 'Search all series' : 'Search all listings →';
      suggestions.append(all);
      suggestions.hidden = false;
      query.setAttribute('aria-expanded', 'true');
    } catch {}
  }, 320);
});

document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) {
    e.preventDefault(); query.focus();
  }
  if (e.key === 'Escape') closeSearch();
});

query.form.addEventListener('keydown', (e) => {
  if (suggestions.hidden || !['ArrowDown','ArrowUp'].includes(e.key)) return;
  e.preventDefault();
  const targets = [query, ...suggestions.querySelectorAll('a,button')];
  targets[(targets.indexOf(document.activeElement) + (e.key === 'ArrowDown' ? 1 : -1) + targets.length) % targets.length]?.focus();
});

document.addEventListener('click', (e) => {
  if (!query.form.contains(e.target)) closeSearch();
});

// ─── Hero Slideshow Component ────────────────────────────────────────────────
function buildHeroSlideshow(items) {
  const featured = items.slice(0, 6);
  if (!featured.length) return null;

  const heroSection = document.createElement('div');
  heroSection.className = 'section hero-section-wrap';

  const carousel = document.createElement('div');
  carousel.className = 'hero-carousel';

  const slidesWrap = document.createElement('div');
  slidesWrap.className = 'hero-slides-track';

  featured.forEach((item, idx) => {
    const slide = document.createElement('div');
    slide.inert = idx !== 0;
    slide.className = 'hero-slide' + (idx === 0 ? ' active' : '');
    slide.dataset.index = idx;

    const initialArt = item.image || item.poster || '';
    const isTv = item.kind === 'tv';

    slide.innerHTML = `
      <div class="hero-bg-holder">
        ${initialArt ? `<img class="hero-bg-img" src="${esc(initialArt)}" alt="" loading="${idx === 0 ? 'eager' : 'lazy'}" ${idx === 0 ? 'fetchpriority="high"' : ''}>` : ''}
        <div class="hero-gradient-overlay"></div>
      </div>
      <div class="hero-content">
        <div class="hero-badges">
          <span class="hero-badge-tag">🔥 FEATURED</span>
          <span class="hero-badge-kind">${isTv ? 'SERIES' : 'MOVIE'}</span>
          ${item.quality ? `<span class="hero-badge-quality">${esc(item.quality)}</span>` : ''}
        </div>
        <h1 class="hero-title">${esc(item.title)}</h1>
        <div class="hero-meta">
          ${item.year ? `<span class="hero-year">${esc(item.year)}</span><span class="dot">·</span>` : ''}
          <span class="hero-rating" style="display:none"></span>
          <span class="hero-kind-label">${isTv ? 'Series' : 'Feature Film'}</span>
        </div>
        <p class="hero-desc">Discover ${esc(item.title)} on AfterShow.</p>
        <div class="hero-actions">
          <a href="${esc(movieUrl(item))}${item.provider === 'Custom' ? '' : '#watch'}" class="primary hero-play-btn">${icon('play')} Watch now</a>
          <a href="${esc(movieUrl(item))}" class="secondary hero-detail-btn">Details</a>
        </div>
      </div>
    `;

    // Fetch live metadata (backdrop, real rating, real plot synopsis)
    if (item.title) {
      json('/poster-artwork?' + new URLSearchParams({
        title: item.title,
        year: item.year || '',
        kind: item.kind || 'movie'
      })).then(artData => {
        if (!artData) return;
        // 1. High-res backdrop or poster
        const bgUrl = artData.backdrop || artData.image;
        if (bgUrl && /^https:\/\//.test(bgUrl)) {
          let img = slide.querySelector('.hero-bg-img');
          if (!img) {
            img = document.createElement('img');
            img.className = 'hero-bg-img';
            img.alt = '';
            slide.querySelector('.hero-bg-holder').prepend(img);
          }
          img.src = bgUrl;
        }

        // 2. Real IMDb / TMDB rating
        const ratingEl = slide.querySelector('.hero-rating');
        if (ratingEl && artData.rating) {
          const score = Number(artData.rating).toFixed(1);
          ratingEl.textContent = `★ ${score}`;
          ratingEl.style.display = 'inline-flex';
          ratingEl.title = `${artData.source || 'TMDB'} Rating ${score}/10`;
          if (!ratingEl.nextElementSibling || !ratingEl.nextElementSibling.classList.contains('dot')) {
            const dot = document.createElement('span');
            dot.className = 'dot';
            dot.textContent = '·';
            ratingEl.after(dot);
          }
        }

        // 3. Real story overview / synopsis
        const descEl = slide.querySelector('.hero-desc');
        if (descEl && artData.overview) {
          descEl.textContent = artData.overview;
        }

        // 4. Genres if available
        const kindEl = slide.querySelector('.hero-kind-label');
        if (kindEl && artData.genres?.length) {
          kindEl.textContent = artData.genres.slice(0, 2).join(' · ');
        }
      }).catch(() => {});
    }

    slidesWrap.appendChild(slide);
  });

  const navWrap = document.createElement('div');
  navWrap.className = 'hero-nav-controls';
  navWrap.innerHTML = `
    <button type="button" class="hero-nav-arrow hero-prev" aria-label="Previous featured title">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m15 18-6-6 6-6"/></svg>
    </button>
    <button type="button" class="hero-nav-arrow hero-next" aria-label="Next featured title">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m9 18 6-6-6-6"/></svg>
    </button>
  `;

  carousel.appendChild(slidesWrap);
  carousel.appendChild(navWrap);
  heroSection.appendChild(carousel);

  let current = 0;
  let autoTimer = null;

  function goToSlide(n) {
    const slides = slidesWrap.querySelectorAll('.hero-slide');
    if (!slides.length) return;

    slides[current].classList.remove('active');
    slides[current].inert = true;

    current = (n + slides.length) % slides.length;

    slides[current].classList.add('active');
    slides[current].inert = false;
  }

  function startAuto() {
    stopAuto();
    if (featured.length < 2 || heroSection.matches(':focus-within') || heroSection.matches(':hover') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    autoTimer = setInterval(() => goToSlide(current + 1), 6000);
  }

  function stopAuto() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
  }

  navWrap.querySelector('.hero-prev').onclick = () => {
    goToSlide(current - 1);
    startAuto();
  };
  navWrap.querySelector('.hero-next').onclick = () => {
    goToSlide(current + 1);
    startAuto();
  };

  heroSection.addEventListener('mouseenter', stopAuto);
  heroSection.addEventListener('mouseleave', startAuto);
  heroSection.addEventListener('focusin', stopAuto);
  heroSection.addEventListener('focusout', () => queueMicrotask(startAuto));

  startAuto();

  return heroSection;
}

// ─── Page routing ─────────────────────────────────────────────────────────────
async function loadPage() {
  if (isDetail) {
    await showDetail(main);
    initPlayer();
    return;
  }

  // Show skeleton while loading
  const skeletonSection = document.createElement('div');
  skeletonSection.className = 'section';
  skeletonSection.append(skeletonGrid(20));
  main.append(skeletonSection);

  const page = Number(params.get('page') || 1);
  const scan = Number(params.get('scan') || 1);

  try {
    const data = await json('/api/catalogue?' + new URLSearchParams({
      q, source, page: String(page), scan: String(scan),
      sort, category: isSeries ? 'series' : '',
    }));

    main.innerHTML = '';

    // Hero Slideshow on discover page
    if (isDiscover && data.items?.length) {
      const heroSlideshow = buildHeroSlideshow(data.items);
      if (heroSlideshow) main.append(heroSlideshow);
    }

    // ── Continue Watching row (localStorage) — positioned under Featured banner
    if (isDiscover) renderContinueWatching(main);

    // Filter pills bar on Discover, Movies, and Series pages
    const showFilterPills = !q && (isDiscover || location.pathname === '/movies' || location.pathname === '/series');
    if (showFilterPills) {
      const activeFilter = params.get('filter') || (source === 'moviezda' ? 'tamil' : source === 'isaidub' ? 'dubbed' : (isSeries || params.get('category') === 'series') ? 'series' : 'all');
      const filterWrap = document.createElement('div');
      filterWrap.className = 'section filter-section';
      filterWrap.innerHTML = `
        <div class="discover-filter-bar">
          <div class="filter-pills">
            <button type="button" class="filter-pill ${activeFilter === 'all' ? 'active' : ''}" data-filter="all">All</button>
            <button type="button" class="filter-pill ${activeFilter === 'tamil' ? 'active' : ''}" data-filter="tamil">Tamil Movies</button>
            <button type="button" class="filter-pill ${activeFilter === 'dubbed' ? 'active' : ''}" data-filter="dubbed">Dubbed Movies</button>
            <button type="button" class="filter-pill ${activeFilter === 'series' ? 'active' : ''}" data-filter="series">Series</button>
          </div>
        </div>
      `;
      filterWrap.querySelectorAll('.filter-pill').forEach(btn => {
        btn.onclick = () => {
          const f = btn.dataset.filter;
          if (f === 'all') {
            location.href = isDiscover ? '/' : '/movies';
          } else if (f === 'tamil') {
            location.href = '/movies?source=moviezda&filter=tamil';
          } else if (f === 'dubbed') {
            location.href = '/movies?source=isaidub&filter=dubbed';
          } else if (f === 'series') {
            location.href = '/series';
          }
        };
      });
      main.append(filterWrap);
    }

    // Grid section
    if (data.items?.length) {
      let title = isDiscover ? 'Latest releases' : q ? `Results for "${q}"` : isSeries ? 'Series' : 'All movies';
      if (params.get('filter') === 'tamil' || source === 'moviezda') title = 'Tamil Movies';
      else if (params.get('filter') === 'dubbed' || source === 'isaidub') title = 'Dubbed Movies';
      else if (params.get('filter') === 'series' || params.get('category') === 'series') title = 'Web Series';

      const sec   = section(title, data.items, { count: data.total });
      // Stagger-animate cards
      sec.querySelectorAll('.card').forEach((c, i) => {
        c.style.animationDelay = `${Math.min(i * 0.04, 0.5)}s`;
        c.classList.add('card-enter');
      });
      main.append(sec);

      // Pagination
      if (data.pages > 1) {
        const pag   = document.createElement('div');
        pag.className = 'section';
        const inner = document.createElement('div');
        inner.className = 'pagination';

        const prev = document.createElement('button');
        prev.innerHTML = icon('left');
        prev.disabled  = page <= 1;
        prev.setAttribute('aria-label', 'Previous page');
        prev.onclick   = () => goPage(page - 1);

        const info = document.createElement('span');
        info.className   = 'page-info';
        info.textContent = `Page ${page} of ${data.pages}`;

        const next = document.createElement('button');
        next.innerHTML = icon('right');
        next.disabled  = page >= data.pages;
        next.setAttribute('aria-label', 'Next page');
        next.onclick   = () => goPage(page + 1);

        inner.append(prev, info, next);
        pag.append(inner);
        main.append(pag);
      }
    } else {
      const empty = document.createElement('div');
      empty.className = 'section';
      empty.innerHTML = `<div class="empty">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <h2>${q ? 'No results found' : 'Nothing here yet'}</h2>
        <p>${q ? `No films matched "${esc(q)}"` : 'Check back soon for new titles.'}</p>
      </div>`;
      main.append(empty);
    }
  } catch (err) {
    main.innerHTML = '';
    const errSec = document.createElement('div');
    errSec.className = 'section';
    errSec.innerHTML = `<div class="empty"><h2>Something went wrong</h2><p>Could not load the catalogue. Please try again.</p><br><button class="secondary" onclick="location.reload()">Retry</button></div>`;
    main.append(errSec);
  }
}

function goPage(p) {
  const u = new URLSearchParams(location.search);
  u.set('page', String(p));
  location.href = location.pathname + '?' + u;
}

loadPage();
