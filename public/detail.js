import { icon, esc, safeImage, json, section, choice, toast } from "./ui.js";
const episodeMetadata = new Map();
function episodePicker(episodes, selected, choose, item, selectedSeason) {
  const container = document.createElement("div");
  container.className = "series-episodes-wrap";
  const head = document.createElement("div");
  head.className = "series-episodes-head";
  head.innerHTML = `
    <h3 class="series-season-title">Episodes <span class="ep-count-badge">${episodes.length} available</span></h3>
    <div class="series-nav-arrows">
      <button type="button" class="ep-arrow ep-prev" aria-label="Previous episode previews">${icon("left")}</button>
      <button type="button" class="ep-arrow ep-next" aria-label="Next episode previews">${icon("right")}</button>
    </div>`;
  container.append(head);
  if (!episodes.length) {
    head.querySelector(".series-nav-arrows").remove();
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No episodes could be loaded for this season.";
    container.append(empty);
    return container;
  }

  const track = document.createElement("div");
  track.className = "series-carousel";
  track.dataset.season = String(selectedSeason);
  track.setAttribute("role", "group");
  track.setAttribute("aria-label", "Episode previews");
  const art = safeImage(item.backdrop || item.image || item.poster);

  function makeCard(ep, playable = true) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ep-card";
    btn.dataset.ep = String(ep);
    if (playable) btn.setAttribute("aria-pressed", String(ep === selected));
    btn.disabled = !playable;
    const label = ep < 0 ? "Other episodes" : `Episode ${ep}`;
    btn.setAttribute("aria-label", playable ? label : `${label}, unavailable`);
    btn.innerHTML = `
      <span class="ep-card-thumb">
        ${art ? `<img src="${esc(art)}" alt="" loading="lazy">` : `<span class="ep-thumb-fallback">${icon("tv")}</span>`}
        ${playable ? `<span class="ep-card-play" aria-hidden="true">${icon("play")}</span>` : ''}
        <span class="ep-badge-e" aria-hidden="true">${ep < 0 ? "Other" : `E${ep}`}</span>
      </span>
      <span class="ep-card-meta">
        <span class="ep-card-title">${label}</span>
        <span class="ep-card-info"${playable ? ' hidden' : ''}>${playable ? '' : 'Not available'}</span>
      </span>`;
    if (playable) btn.onclick = () => choose(ep);
    return btn;
  }
  track.append(...episodes.map(ep => makeCard(ep)));
  const positive = episodes.filter(ep => ep > 0);
  const latest = positive[0];
  const earliest = positive.at(-1);
  const countLabel = head.querySelector('.ep-count-badge');
  if (latest - earliest + 1 > positive.length)
    countLabel.textContent = `Through E${latest} · ${episodes.length} playable`;

  container.append(track);
  const move = direction => {
    track.scrollBy({
      left: direction * Math.max(205, track.clientWidth * 0.85),
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  };
  head.querySelector(".ep-prev").onclick = () => move(-1);
  head.querySelector(".ep-next").onclick = () => move(1);

  if (selectedSeason < 0) return container;
  const basePath = location.pathname.replace(/\/(watch|downloads)\/?$/, "").replace(/\/$/, "");
  const metadataUrl = basePath + '/season/' + selectedSeason;
  if (!episodeMetadata.has(metadataUrl)) {
    if (episodeMetadata.size >= 24) episodeMetadata.delete(episodeMetadata.keys().next().value);
    episodeMetadata.set(metadataUrl, json(metadataUrl).catch(() => {
      episodeMetadata.delete(metadataUrl);
      return null;
    }));
  }
  episodeMetadata.get(metadataUrl).then(data => {
    if (!data?.episodes?.length) return;
    const epMap = new Map(data.episodes.map(e => [e.episode, e]));
    const playable = new Set(episodes);
    const missing = [...epMap.keys()].filter(n =>
      Number.isInteger(n) && n >= earliest && n <= latest && !playable.has(n)
    ).sort((a, b) => b - a);
    if (missing.length) {
      const cards = [...track.children];
      let position = 0;
      for (const ep of missing) {
        while (position < cards.length && Number(cards[position].dataset.ep) > ep) position++;
        track.insertBefore(makeCard(ep, false), cards[position] || null);
      }
      countLabel.textContent = `${episodes.length + missing.length} episodes · ${episodes.length} playable`;
    }
    track.querySelectorAll('.ep-card').forEach(card => {
      const n = Number(card.dataset.ep);
      const details = epMap.get(n);
      if (!details) return;
      if (details.title) {
        card.querySelector('.ep-card-title').textContent = details.title;
        card.setAttribute('aria-label', `Episode ${n}: ${details.title}${card.disabled ? ', unavailable' : ''}`);
      }
      if (!card.disabled && Number.isFinite(details.rating) && details.rating > 0) {
        const rating = card.querySelector('.ep-card-info');
        rating.textContent = `★ ${details.rating}`;
        rating.hidden = false;
      }
      const image = safeImage(details.image);
      if (!image) return;
      const holder = card.querySelector('.ep-card-thumb');
      let img = holder.querySelector('img');
      if (!img) {
        img = document.createElement('img');
        img.loading = 'lazy';
        img.alt = '';
        holder.querySelector('.ep-thumb-fallback')?.replaceWith(img);
      }
      img.src = image;
    });
  });
  return container;
}

export async function showDetail(main) {
  const base = location.pathname
    .replace(/\/(watch|downloads)\/?$/, "")
    .replace(/\/$/, "");
  main.innerHTML = '<p class="notice" role="status">Opening film…</p>';
  let item;
  try {
    item = await json(base + "/info");
  } catch {
    main.innerHTML =
      '<div class="empty"><h1>Film link unavailable</h1><p>Search the catalogue to find this film again.</p><a class="primary" href="/movies">Browse films</a></div>';
    return;
  }
  item = { ...item, url: base, image: safeImage(item.image || item.poster) };
  document.title = item.title + " · AfterShow";
  main.innerHTML =
    '<a class="back" href="/movies"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="m15 18-6-6 6-6"/></svg> <span>Browse films</span></a><section class="detail-header"><div class="detail-cover"><span>' +
    esc(item.title) +
    '</span></div><div class="detail-copy"><p class="eyebrow">FILM DETAILS</p><h1>' +
    esc(item.title) +
    '</h1><div class="detail-tags"><div class="detail-meta" id="facts" aria-label="Title metadata"></div><span id="release-quality" class="detail-chip" hidden></span><p class="rating"></p></div><p id="overview"></p><p class="muted" id="cast"></p><div class="actions"><a class="primary" href="#watch">' +
    icon("play") +
    'Watch</a><a class="secondary" href="#downloads">Download</a><button class="secondary share">' +
    icon("share") +
    'Share</button><a class="secondary trailer" target="_blank" rel="noopener noreferrer">Trailer</a></div></div></section><div class="media-hub"><section class="selection-picker" aria-label="Media selection" hidden><div class="selection-top"><div class="season-control"></div><p class="selection-title" role="status"></p></div><div class="selection-controls"></div></section><section class="media collection" id="watch"><h2>Watch movie</h2><div class="player-shell"><div class="player-top"><p class="episode-status" role="status" hidden></p></div><div class="video-wrap"><video controls playsinline preload="none" aria-label="Movie player"></video></div><div class="transport" aria-label="Playback controls"><button type="button" class="previous" hidden>Previous</button><button type="button" class="rewind">−10 s</button><button type="button" class="forward">+10 s</button><button type="button" class="next" hidden>Next</button><button type="button" class="expand" hidden>Fullscreen</button></div></div><p class="player-state notice" role="status"></p><div class="actions media-actions"></div></section><section class="downloads collection" id="downloads"><div class="downloads-header"><div><h2>Downloads</h2><p class="downloads-intro">Choose a quality that fits your device and connection.</p></div><span class="download-count" hidden></span></div><p class="download-selection muted"></p><ul aria-label="Available download versions"></ul><div class="download-recovery" role="status"></div></section></div>';
  const find = (sel) => main.querySelector(sel),
    video = find("video"),
    status = find(".player-state");
  function renderFacts(values) {
    const chips = values.filter(Boolean).map((value) => {
      const chip = document.createElement("span");
      chip.className = "detail-chip";
      chip.textContent = String(value);
      return chip;
    });
    find("#facts").replaceChildren(...chips);
  }
  renderFacts([item.year, item.kind === "tv" ? "Series" : "Movie"]);
  function addSource(container) {
    if (!/^https:\/\//.test(item.sourceUrl || "") || container.querySelector(".source-link")) return;
    const link = document.createElement("a");
    link.className = "textbtn source-link";
    link.href = item.sourceUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open original source";
    container.append(link);
  }
  function cover(src) {
    if (!safeImage(src)) return;
    const image = new Image();
    image.alt = "";
    image.onload = () => {
      find(".detail-cover").replaceChildren(image);
      item.image = src;
    };
    image.src = src;
  }
  cover(item.image);
  if (item.image) video.poster = item.image;
  if (item.kind === "tv") {
    document.querySelector('.site-tab[aria-current="page"]')?.removeAttribute('aria-current');
    document.querySelector('#series-nav')?.setAttribute('aria-current', 'page');
    find(".back").href = "/series";
    find(".back span").textContent = "Browse series";
    find(".eyebrow").textContent = "SERIES DETAILS";
    find("#watch h2").textContent = "Watch series";
    video.setAttribute("aria-label", "Episode player");
  }
  find(".share").onclick = async () => {
    try {
      const url = location.origin + base;
      if (navigator.share) await navigator.share({ title: item.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast("Link copied");
      }
    } catch (e) {
      if (e.name !== "AbortError") toast("Copy the address from your browser.");
    }
  };
  const trailer = find(".trailer");
  trailer.href =
    "https://www.youtube.com/results?" +
    new URLSearchParams({
      search_query: item.title + " " + item.year + " official trailer",
    });
  json(base + "/trailer")
    .then(({ video }) => {
      if (/^[\w-]{11}$/.test(video))
        trailer.href = "https://www.youtube.com/watch?v=" + video;
    })
    .catch(() => { });
  async function metadata() {
    try {
      const data = await json(base + "/metadata");
      renderFacts([
        item.year,
        ...(data.genres || []),
        data.runtime ? data.runtime + " min" : "",
      ]);
      find("#overview").textContent =
        data.overview || "Story information is unavailable for this title.";
      find("#cast").textContent = data.cast?.length
        ? "Cast · " + data.cast.join(", ")
        : "";
      if (data.image) cover(data.image);
      else if (!item.image) {
        json(
          "/poster-artwork?" +
          new URLSearchParams({
            title: item.title,
            year: item.year || "",
            kind: item.kind || "movie",
          }),
        )
          .then((data) => cover(data.image))
          .catch(() => { });
      }
      if (safeImage(data.backdrop)) video.poster = data.backdrop;
      if (data.rating) {
        find(".rating").innerHTML =
          `<span class="rating-badge"><span class="star">★</span> ${Number(data.rating).toFixed(1)} <span class="rating-source">${data.source || 'TMDB'}</span></span>`;
      }
      if (data.recommendations?.length) {
        const recommendations = section("More like this", data.recommendations);
        recommendations.classList.add("detail-recommendations");
        main.append(recommendations);
      }
    } catch {
      find("#overview").textContent = "Movie information could not be loaded. ";
      const retry = document.createElement("button");
      retry.className = "textbtn";
      retry.textContent = "Try again";
      retry.onclick = metadata;
      find("#overview").append(retry);
      addSource(find("#overview"));
    }
  }
  metadata();
  json(base + "/rating")
    .then(({ rating }) => {
      if (rating?.score) {
        find(".rating").innerHTML =
          `<span class="rating-badge"><span class="star">★</span> ${Number(rating.score).toFixed(1)} <span class="rating-source">${rating.source || 'IMDb'}</span></span>`;
      }
    })
    .catch(() => { });
  const seasonYears = new Map(item.seasons?.map(({ number, year }) => [number, year]));
  let selectedSeason = item.seasons?.at(-1)?.number;
  let selectedEpisode, selectedOption, selectedPart;
  let sequence = [];
  const picker = find(".selection-picker");
  const shell = find(".player-shell");
  const expand = find(".expand");
  if (shell.requestFullscreen && document.fullscreenEnabled) {
    expand.hidden = false;
    expand.onclick = async () => {
      try {
        if (document.fullscreenElement === shell) await document.exitFullscreen();
        else await shell.requestFullscreen();
      } catch { toast("Fullscreen is unavailable."); }
    };
    document.addEventListener("fullscreenchange", () => {
      expand.textContent = document.fullscreenElement === shell ? "Exit fullscreen" : "Fullscreen";
    });
  }
  function seek(seconds) {
    if (Number.isFinite(video.duration))
      video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
  }
  find(".rewind").onclick = () => seek(-10);
  find(".forward").onclick = () => seek(10);
  function partNumber(option) {
    const tag = (option.title || option.label || "").match(/\b(?:part|pt|cd|disc)[ ._-]*(\d+)\b/ig)?.at(-1);
    return tag ? Number(tag.match(/\d+/)[0]) : null;
  }
  function selectMedia(season, episode, part, resume = !video.paused) {
    resetPlayer();
    selectedSeason = season;
    selectedEpisode = episode;
    selectedPart = part;
    render();
    if (resume) playSelected();
  }
  async function playSelected() {
    const target = selectedOption?.watch;
    if (!target) return;
    const currentSrc = video.getAttribute("src") || video.src || "";
    if (!currentSrc.endsWith(target)) {
      video.src = target;
      video.load();
    }
    try {
      status.textContent = "Opening video…";
      await video.play();
    } catch (error) {
      if (error.name !== "AbortError") playbackFailed();
    }
  }
  const episodeStatus = find(".episode-status");
  function showEpisode(state) {
    const option = selectedOption;
    episodeStatus.hidden = !option || (option.season == null && option.episode == null && selectedPart == null);
    if (episodeStatus.hidden) return;
    const name = selectedPart != null ? "Part " + selectedPart : [
      option.season != null && "Season " + option.season,
      option.episode != null ? "Episode " + option.episode : "Other",
    ].filter(Boolean).join(" · ");
    episodeStatus.textContent = state + " · " + name;
    video.setAttribute("aria-label", item.title + " · " + name);
  }
  function prepareOption(option) {
    selectedOption = option;
    const target = option?.watch;
    if (target && /^\/watch\/[\w.-]+$/.test(target)) {
      const currentSrc = video.getAttribute("src") || video.src || "";
      if (!currentSrc.endsWith(target)) video.src = target;
    } else if (video.hasAttribute("src")) resetPlayer();
    showEpisode("Selected");
  }
  const currentMedia = () => !!selectedOption && video.getAttribute("src") === selectedOption.watch;
  video.addEventListener("play", () => {
    video.dataset.started = "true";
    if (currentMedia()) showEpisode("Loading");
    find(".player-quality-prompt")?.classList.add("hidden");
    find(".video-big-play")?.classList.add("hidden");
  });
  video.addEventListener("waiting", () => { if (currentMedia() && !video.paused) showEpisode("Buffering"); });
  video.addEventListener("pause", () => {
    if (currentMedia() && video.currentTime > 0 && !video.ended && !video.error) showEpisode("Paused");
  });
  video.addEventListener("ended", () => { if (currentMedia()) showEpisode("Finished"); });
  function playbackFailed() {
    showEpisode("Playback unavailable");
    addSource(find(".media-actions"));
    status.textContent =
      "This video could not be played. Try another quality or open the source.";
  }
  video.addEventListener("error", playbackFailed);
  video.addEventListener("playing", () => {
    if (!currentMedia()) return;
    showEpisode("Now playing");
    status.textContent = "";
    if (!partial) find(".media-actions .source-link")?.remove();
  });
  let all = [],
    partial = false;
  function resetPlayer() {
    if (!partial) find(".media-actions .source-link")?.remove();
    status.textContent = "";
    video.pause();
    video.removeAttribute("src");
    delete video.dataset.started;
    video.load();
  }
  function render() {
    const previousList = find(".series-carousel");
    const previousSeason = previousList?.dataset.season;
    const scrollLeft = previousList?.scrollLeft || 0;
    const actions = find(".media-actions"),
      list = find(".downloads ul");
    actions.replaceChildren();
    list.replaceChildren();
    const selection = find(".selection-controls");
    const seasonControl = find(".season-control");
    selection.replaceChildren();
    seasonControl.replaceChildren();
    const series = seasonYears.size > 0 || all.some((o) => o.season != null || o.episode != null);
    let matches = all;
    if (series) {
      const distinct = (values) => [...new Set(values)].sort((a, b) => a - b);
      const seasons = distinct([...seasonYears.keys(), ...all.map((o) => o.season ?? -1)]);
      if (!seasons.includes(selectedSeason)) selectedSeason = seasons[0];
      const formatSeason = v => v < 0 ? "Other episodes" : seasonYears.has(v)
        ? `Season ${v} (${seasonYears.get(v)})` : `Season ${v}`;
      if (seasons.length > 1) {
        const select = document.createElement("select");
        select.className = "season-select";
        select.setAttribute("aria-label", "Choose season");
        select.replaceChildren(...seasons.map(v => new Option(formatSeason(v), v, false, v === selectedSeason)));
        select.onchange = () => {
          selectMedia(Number(select.value), undefined, undefined, false);
          find(".season-select")?.focus({ preventScroll: true });
        };
        seasonControl.append(select);
      } else {
        seasonControl.textContent = formatSeason(selectedSeason);
      }
      matches = all.filter((o) => (o.season ?? -1) === selectedSeason);
      const episodes = distinct(matches.map((o) => o.episode ?? -1)).reverse();
      if (!episodes.includes(selectedEpisode)) selectedEpisode = episodes[0];
      selection.append(episodePicker(episodes, selectedEpisode, (episode) => {
        if (episode === selectedEpisode) return;
        selectMedia(selectedSeason, episode, undefined);
        picker.querySelector('.series-carousel [aria-pressed="true"]')?.focus({ preventScroll: true });
      }, item, selectedSeason));
      const episodeList = find(".series-carousel");
      if (episodeList && previousSeason === episodeList.dataset.season) episodeList.scrollLeft = scrollLeft;
      matches = matches.filter((o) => (o.episode ?? -1) === selectedEpisode);
    }
    const parts = [...new Set(all.map(partNumber).filter(n => n != null))].sort((a, b) => a - b);
    const multipart = !series && parts.length > 1;
    if (multipart) {
      if (!parts.includes(selectedPart) && !(selectedPart === null && all.some(o => partNumber(o) === null))) selectedPart = parts[0];
      const choices = all.some(o => partNumber(o) === null) ? [...parts, null] : parts;
      selection.append(choice("Part", choices, selectedPart,
        part => selectMedia(undefined, undefined, part), n => n == null ? "Other versions" : String(n)));
      matches = all.filter(o => partNumber(o) === selectedPart);
    } else selectedPart = undefined;
    const preferred = selectedOption?.resolution;
    const initial = Math.max(0, matches.findIndex(o => o.resolution === preferred));
    prepareOption(matches[initial]);
    sequence = series ? [...new Map(all.filter(o => o.episode != null).map(o =>
      [[o.season ?? -1, o.episode].join("/"), [o.season ?? -1, o.episode, undefined]])).values()]
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]) : parts.map(n => [undefined, undefined, n]);
    const position = sequence.findIndex(([s, e, p]) => s === selectedSeason && e === selectedEpisode && p === selectedPart);
    for (const [selector, step, name] of [[".previous", -1, "Previous"], [".next", 1, "Next"]]) {
      const button = find(selector);
      const dest = position >= 0 ? sequence[position + step] : undefined;
      button.hidden = sequence.length < 2;
      button.disabled = !dest;
      button.textContent = name + (series ? " episode" : " part");
      button.onclick = () => { if (dest) selectMedia(...dest, !video.paused || video.ended); };
    }
    const label = (o) =>
      [o.label, o.edition, o.size].filter(Boolean).join(" · ");
    if (matches.length > 1) {
      const activeIdx = matches.indexOf(selectedOption) >= 0 ? matches.indexOf(selectedOption) : initial;
      const doSwitch = (i) => {
        const time = video.currentTime;
        const wasPlaying = !video.paused;
        const opt = matches[i];
        if (!opt?.watch) return;
        selectedOption = opt;
        video.src = opt.watch;
        video.load();
        let readyDone = false;
        const onReady = () => {
          if (readyDone) return;
          readyDone = true;
          if (time > 0 && Number.isFinite(video.duration)) {
            video.currentTime = Math.min(time, video.duration);
          }
          if (wasPlaying) {
            video.play().catch(() => {});
          }
        };
        video.addEventListener("loadedmetadata", onReady, { once: true });
        video.addEventListener("canplay", onReady, { once: true });
        setTimeout(onReady, 400);
        window.__movieQualities?.forEach((q, idx) => { q.active = (idx === i); });
        window.dispatchEvent(new CustomEvent('af:qualities-updated'));
      };

      window.__movieQualities = matches.map((m, i) => {
        let name = m.resolution ? m.resolution + "p" : "";
        if (!name) {
          const matchRes = (m.label || "").match(/\b(1080|720|480|360|240)p?\b/i);
          name = matchRes ? matchRes[1] + "p" : (m.label || m.edition || "HD").split("·")[0].trim();
        }
        return {
          index: i,
          name: name,
          size: m.size || "",
          edition: m.edition || "",
          active: i === activeIdx,
          select: () => doSwitch(i),
        };
      });
      window.dispatchEvent(new CustomEvent('af:qualities-updated'));
    } else {
      window.__movieQualities = [];
      window.dispatchEvent(new CustomEvent('af:qualities-updated'));
    }
    picker.hidden = !series && !multipart;
    const selectedLabel = series ? [
      selectedSeason >= 0 && "Season " + selectedSeason,
      selectedEpisode >= 0 ? "Episode " + selectedEpisode : "Other episodes",
    ].filter(Boolean).join(" · ") : selectedPart != null ? "Part " + selectedPart : "Other versions";
    find(".download-selection").textContent = series || multipart ? selectedLabel : "";
    picker.querySelector(".selection-title").textContent = series
      ? selectedEpisode >= 0 ? `Episode ${selectedEpisode} selected` : ""
      : selectedLabel;
    const watchLink = find('.actions .primary[href="#watch"]');
    watchLink.onclick = null;
    if (matches.length) {
      // In-Player Quality Popup Overlay inside video-wrap (Asks quality before playback starts)
      let promptOverlay = find(".player-quality-prompt");
      if (!promptOverlay) {
        promptOverlay = document.createElement("div");
        promptOverlay.className = "player-quality-prompt hidden";
        find(".video-wrap")?.append(promptOverlay);
      } else {
        promptOverlay.classList.add("hidden");
      }

      // Big play button overlay on video
      let bigPlay = find(".video-big-play");
      if (!bigPlay) {
        bigPlay = document.createElement("button");
        bigPlay.type = "button";
        bigPlay.className = "video-big-play";
        bigPlay.setAttribute("aria-label", "Play video");
        bigPlay.innerHTML = `<svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>`;
        find(".video-wrap")?.append(bigPlay);
      }
      bigPlay.classList.remove("hidden");

      if (matches.length > 1) {
        promptOverlay.innerHTML = `
          <div class="pqp-card">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
              <div>
                <h3 class="pqp-title" style="margin-bottom:3px">Select Quality to Play</h3>
                <p class="pqp-subtitle" style="margin-bottom:0">Choose stream resolution to begin</p>
              </div>
              <button type="button" class="pqp-close" aria-label="Close" style="background:none;border:none;color:var(--muted);font-size:24px;cursor:pointer;padding:0 4px;line-height:1">×</button>
            </div>
            <div class="pqp-options"></div>
          </div>
        `;
        promptOverlay.querySelector(".pqp-close").onclick = (e) => {
          e.stopPropagation();
          promptOverlay.classList.add("hidden");
        };

        const optContainer = promptOverlay.querySelector(".pqp-options");
        matches.forEach((opt, idx) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "pqp-btn" + (opt === selectedOption ? " active" : "");
          let res = opt.resolution ? opt.resolution + "p" : "";
          if (!res) {
            const mRes = (opt.label || "").match(/\b(1080|720|480|360|240)p?\b/i);
            res = mRes ? mRes[1] + "p" : (opt.label || opt.edition || "HD").split("·")[0].trim();
          }
          btn.innerHTML = `
            <div>
              <span class="pqp-res">${esc(res)}</span>
              <span style="font-size:12px;color:var(--muted);margin-left:6px">${esc(opt.edition || "")}</span>
            </div>
            <span class="pqp-meta">${esc(opt.size || "HD")}</span>
          `;
          btn.onclick = () => {
            promptOverlay.classList.add("hidden");
            bigPlay.classList.add("hidden");
            resetPlayer();
            prepareOption(matches[idx]);
            playSelected();
            window.__movieQualities?.forEach((q, qidx) => { q.active = (qidx === idx); });
            window.dispatchEvent(new CustomEvent('af:qualities-updated'));
          };
          optContainer.append(btn);
        });
      } else {
        promptOverlay.classList.add("hidden");
      }

      function showQualityPicker() {
        find("#watch")?.scrollIntoView({
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
          block: "start",
        });
        if (matches.length > 1 && promptOverlay) {
          promptOverlay.classList.remove("hidden");
        } else {
          bigPlay?.classList.add("hidden");
          playSelected();
        }
      }

      bigPlay.onclick = () => showQualityPicker();
      watchLink.onclick = (e) => {
        e.preventDefault();
        showQualityPicker();
      };
      const resolutionValue = (option) => Number(
        String(option.resolution || option.label || "").match(/2160|1440|1080|720|540|480|360|240/)?.[0] || 0
      );
      const sizeValue = (option) => {
        const match = String(option.size || "").match(/([\d.]+)\s*(GB|MB|KB)/i);
        if (!match) return null;
        const amount = Number(match[1]);
        return match[2].toLowerCase() === "gb" ? amount * 1024 : match[2].toLowerCase() === "kb" ? amount / 1024 : amount;
      };
      const resolutions = matches.map(resolutionValue).filter(Boolean);
      const sizes = matches.map(sizeValue).filter((value) => value != null);
      const bestResolution = resolutions.length ? Math.max(...resolutions) : 0;
      const largestSize = sizes.length ? Math.max(...sizes) : 0;
      const smallestSize = sizes.length ? Math.min(...sizes) : 0;
      for (const o of matches) {
        if (!/^\/download\/[\w.-]+$/.test(o.download || "")) continue;
        const li = document.createElement("li"),
          top = document.createElement("div"),
          quality = document.createElement("span"),
          highlight = document.createElement("span"),
          details = document.createElement("div"),
          edition = document.createElement("span"),
          size = document.createElement("span"),
          meter = document.createElement("div"),
          meterFill = document.createElement("span"),
          link = document.createElement("a"),
          rawQuality = String(o.label || ""),
          qualityMatch = rawQuality.match(/\b(?:2160p|1440p|1080p|720p|480p|360p|4k|uhd|hd|sd)\b/i),
          optionSize = sizeValue(o),
          optionResolution = resolutionValue(o);
        li.className = "download-option";
        top.className = "download-option-top";
        quality.className = "download-quality";
        quality.textContent = qualityMatch?.[0] || (rawQuality.length > 22 ? "Other quality" : rawQuality || "Available quality");
        highlight.className = "download-highlight";
        if (optionResolution && optionResolution === bestResolution) highlight.textContent = "Best quality";
        else if (!bestResolution && optionSize != null && optionSize === largestSize) highlight.textContent = "Best quality";
        else if (optionSize != null && optionSize === smallestSize && smallestSize !== largestSize) highlight.textContent = "Smallest";
        highlight.hidden = !highlight.textContent;
        top.append(quality, highlight);
        details.className = "download-option-details";
        edition.className = "download-edition";
        edition.textContent = o.edition || (rawQuality.length > 22 ? rawQuality : "Original release");
        size.className = "download-size";
        size.textContent = o.size || "File size unavailable";
        details.append(edition, size);
        meter.className = "download-size-meter";
        meter.setAttribute("aria-hidden", "true");
        meterFill.style.width = optionSize != null && largestSize ? `${Math.max(8, optionSize / largestSize * 100)}%` : "0%";
        meter.append(meterFill);
        meter.hidden = optionSize == null || !largestSize;
        link.setAttribute("aria-label", ["Download", (series || multipart) && selectedLabel, label(o)].filter(Boolean).join(" · "));
        link.href = o.download;
        link.className = "download-action";
        link.innerHTML = `${icon("download")}<span>Download</span>`;
        li.append(top, details, meter, link);
        list.append(li);
      }
      const downloadCount = find(".download-count");
      if (list.children.length) {
        downloadCount.textContent = `${list.children.length} ${list.children.length === 1 ? "version" : "versions"}`;
        downloadCount.hidden = false;
      } else {
        downloadCount.hidden = true;
      }
    } else {
      find(".video-big-play")?.classList.add("hidden");
      find(".player-quality-prompt")?.classList.add("hidden");
    }
    status.textContent = partial
      ? (series ? "Some episodes or qualities couldn’t be loaded. Try checking again." : "Some versions could not be checked.")
      : matches.length
        ? ""
        : "No playable versions are currently listed.";
    const recovery = find(".download-recovery");
    recovery.replaceChildren();
    if (partial || !list.children.length) {
      recovery.textContent = list.children.length ? "Some files could not be checked. " : "No downloads are available. ";
      const retry = document.createElement("button");
      retry.className = "secondary";
      retry.textContent = "Check again";
      retry.onclick = loadOptions;
      recovery.append(retry);
      addSource(recovery);
    }
    if (partial || !matches.length) {
      const retry = document.createElement("button");
      retry.className = "secondary";
      retry.textContent = "Check again";
      retry.onclick = loadOptions;
      actions.append(retry);
    }
    if (partial || !matches.length) addSource(actions);
  }
  async function loadOptions() {
    const actions = find(".media-actions");
    actions.replaceChildren();
    status.textContent = "Checking available versions…";
    find(".download-recovery").textContent = "Checking available files…";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const result = await json(base + "/options", controller.signal);
      clearTimeout(timer);
      const options = result.options || [];
      all = result.unavailable
        ? [...new Map([...all, ...options].map(option => [option.watch, option])).values()]
        : options;
      const editions = [
        ...new Set(all.map((option) => option.edition).filter(Boolean)),
      ];
      const releaseQuality = find("#release-quality");
      releaseQuality.textContent = editions.join(" / ") || result.quality || "Unlisted";
      releaseQuality.hidden = false;
      partial = Boolean(result.unavailable);
    } catch {
      clearTimeout(timer);
      partial = true;
    }
    render();
  }
  loadOptions();
  const sectionId = location.hash.slice(1) || location.pathname.split("/").filter(Boolean).at(-1);
  if (sectionId === "watch" || sectionId === "downloads") find("#" + sectionId).scrollIntoView();
}
