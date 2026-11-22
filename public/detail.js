import { icon, esc, safeImage, json, section, choice, toast } from "./ui.js";
function episodePicker(episodes, selected, choose, item = {}, selectedSeason = 1) {
  const container = document.createElement("div");
  container.className = "series-episodes-wrap";

  const head = document.createElement("div");
  head.className = "series-episodes-head";
  head.innerHTML = `
    <div class="series-season-title">
      <span class="season-badge">SEASON</span>
      <span class="season-num">${selectedSeason >= 0 ? selectedSeason : 1}</span>
      <span class="ep-count-badge">${episodes.length} Episodes</span>
    </div>
    <div class="series-nav-arrows">
      <button type="button" class="ep-arrow ep-prev" aria-label="Previous episodes">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <button type="button" class="ep-arrow ep-next" aria-label="Next episodes">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m9 18 6-6-6-6"/></svg>
      </button>
    </div>
  `;
  container.append(head);

  const grid = document.createElement("div");
  grid.className = "episode-grid series-carousel";

  const art = item.backdrop || item.image || item.poster || "";

  for (const ep of episodes) {
    const isSelected = ep === selected;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ep-card" + (isSelected ? " active" : "");
    btn.dataset.ep = String(ep);
    btn.setAttribute("aria-label", "Episode " + (ep < 0 ? "Other" : ep));
    btn.setAttribute("aria-pressed", String(isSelected));

    const epNum = ep < 0 ? "Special" : `E${ep}`;
    const epTitle = ep < 0 ? "Special Episode" : `${ep}. Episode ${ep}`;

    btn.innerHTML = `
      <div class="ep-card-thumb">
        ${art ? `<img src="${esc(art)}" alt="" loading="lazy">` : `<div class="ep-thumb-fallback">${icon("tv")}</div>`}
        <div class="ep-card-play">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="m8 5 11 7-11 7z"/></svg>
        </div>
        <span class="ep-badge-e">${esc(epNum)}</span>
        <span class="ep-badge-hd">HD</span>
      </div>
      <div class="ep-card-meta">
        <p class="ep-card-title">${esc(epTitle)}</p>
        <p class="ep-card-info">
          ${item.rating ? `<span class="ep-star">★</span> ${Number(item.rating).toFixed(1)} <span class="ep-dot">·</span> ` : ''}${item.year || "Series"}
        </p>
      </div>
    `;

    btn.onclick = () => {
      choose(ep);
    };

    grid.append(btn);
  }

  container.append(grid);

  // Fetch real episode-level TMDB metadata (unique rating & screenshot per episode)
  const sNum = selectedSeason >= 0 ? selectedSeason : 1;
  const basePath = location.pathname.replace(/\/(watch|downloads)\/?$/, "").replace(/\/$/, "");
  json(basePath + '/season/' + sNum).then(data => {
    if (!data?.episodes?.length) return;
    const epMap = new Map(data.episodes.map(e => [e.episode, e]));
    grid.querySelectorAll('.ep-card').forEach(cardEl => {
      const epNum = Number(cardEl.dataset.ep);
      const epInfo = epMap.get(epNum);
      if (!epInfo) return;
      if (epInfo.title) {
        const titleEl = cardEl.querySelector('.ep-card-title');
        if (titleEl) titleEl.textContent = `${epNum}. ${epInfo.title}`;
      }
      if (epInfo.rating) {
        const infoEl = cardEl.querySelector('.ep-card-info');
        if (infoEl) {
          infoEl.innerHTML = `<span class="ep-star">★</span> ${epInfo.rating} <span class="ep-dot">·</span> E${epNum}`;
        }
      }
      if (epInfo.image) {
        const thumbHolder = cardEl.querySelector('.ep-card-thumb');
        let img = thumbHolder.querySelector('img');
        if (!img) {
          img = document.createElement('img');
          img.loading = 'lazy';
          thumbHolder.prepend(img);
          thumbHolder.querySelector('.ep-thumb-fallback')?.remove();
        }
        img.src = epInfo.image;
      }
    });
  }).catch(() => {});

  const prevBtn = head.querySelector(".ep-prev");
  const nextBtn = head.querySelector(".ep-next");
  if (prevBtn && nextBtn) {
    prevBtn.onclick = () => grid.scrollBy({ left: -360, behavior: "smooth" });
    nextBtn.onclick = () => grid.scrollBy({ left: 360, behavior: "smooth" });
  }

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
    '<a class="back" href="/movies"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="m15 18-6-6 6-6"/></svg> Browse films</a><section class="detail-header"><div class="detail-cover"><span>' +
    esc(item.title) +
    '</span></div><div class="detail-copy"><p class="eyebrow">FILM DETAILS</p><h1>' +
    esc(item.title) +
    '</h1><p class="muted" id="facts">' +
    esc([item.year, item.kind === "tv" ? "Series" : "Movie"].filter(Boolean).join(" · ")) +
    '</p><p id="release-quality" class="muted"></p><p id="overview"></p><p class="muted" id="cast"></p><p class="rating"></p><div class="actions"><a class="primary" href="#watch">' +
    icon("play") +
    'Watch</a><a class="secondary" href="#downloads">Download</a><button class="secondary share">' +
    icon("share") +
    'Share</button><a class="secondary trailer" target="_blank" rel="noopener noreferrer">Trailer</a></div></div></section><div class="media-hub"><section class="selection-picker" aria-label="Media selection" hidden><p class="selection-title"></p><div class="selection-controls"></div></section><section class="media collection" id="watch"><h2>Watch movie</h2><div class="player-shell"><div class="player-top"><p class="episode-status" role="status" hidden></p></div><div class="video-wrap"><video controls playsinline preload="none" aria-label="Movie player"></video></div><div class="transport" aria-label="Playback controls"><button type="button" class="previous" hidden>Previous</button><button type="button" class="rewind">−10 s</button><button type="button" class="forward">+10 s</button><button type="button" class="next" hidden>Next</button><button type="button" class="expand" hidden>Fullscreen</button></div></div><p class="player-state notice" role="status"></p><div class="actions media-actions"></div></section><section class="downloads collection" id="downloads"><h2>Downloads</h2><p class="download-selection muted"></p><ul></ul><div class="download-recovery" role="status"></div></section></div>';
  const find = (sel) => main.querySelector(sel),
    video = find("video"),
    status = find(".player-state");
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
    find(".back").href = "/series";
    find(".back").textContent = "Browse series";
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
    .catch(() => {});
  async function metadata() {
    try {
      const data = await json(base + "/metadata");
      find("#facts").textContent = [
        item.year,
        ...(data.genres || []),
        data.runtime ? data.runtime + " min" : "",
      ]
        .filter(Boolean)
        .join(" · ");
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
          .catch(() => {});
      }
      if (safeImage(data.backdrop)) video.poster = data.backdrop;
      if (data.rating) {
        find(".rating").innerHTML =
          `<span class="rating-badge"><span class="star">★</span> ${Number(data.rating).toFixed(1)} <span class="rating-source">${data.source || 'TMDB'}</span></span>`;
      }
      if (data.recommendations?.length)
        main.append(section("More like this", data.recommendations));
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
    .catch(() => {});
  let selectedSeason, selectedEpisode, selectedOption, selectedPart;
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
  video.addEventListener("play", () => { if (currentMedia()) showEpisode("Loading"); });
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
    video.load();
  }
  function render() {
    const actions = find(".media-actions"),
      list = find(".downloads ul");
    actions.replaceChildren();
    list.replaceChildren();
    const selection = find(".selection-controls");
    selection.replaceChildren();
    const series = all.some((o) => o.season != null || o.episode != null);
    let matches = all;
    if (series) {
      const distinct = (values) => [...new Set(values)].sort((a, b) => a - b);
      const seasons = distinct(all.map((o) => o.season ?? -1));
      if (!seasons.includes(selectedSeason)) selectedSeason = seasons[0];
      selection.append(
        choice(
          "Season",
          seasons,
          selectedSeason,
          (v) => {
            selectMedia(v, undefined, undefined);
          },
          (v) => (v < 0 ? "Other" : String(v)),
        ),
      );
      matches = all.filter((o) => (o.season ?? -1) === selectedSeason);
      const episodes = distinct(matches.map((o) => o.episode ?? -1));
      if (!episodes.includes(selectedEpisode)) selectedEpisode = episodes[0];
      selection.append(
        episodePicker(episodes, selectedEpisode, (episode) => {
          if (episode === selectedEpisode) return;
          selectMedia(selectedSeason, episode, undefined);
          picker.querySelector('.episode-grid [aria-pressed="true"]')?.focus({ preventScroll: true });
        }, item, selectedSeason),
      );
      matches = matches.filter((o) => (o.episode ?? -1) === selectedEpisode);
    }
    const parts = [...new Set(all.map(partNumber).filter(n => n != null))].sort((a,b) => a-b);
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
      [[o.season ?? -1,o.episode].join("/"), [o.season ?? -1,o.episode,undefined]])).values()]
      .sort((a,b) => a[0]-b[0] || a[1]-b[1]) : parts.map(n => [undefined,undefined,n]);
    const position = sequence.findIndex(([s,e,p]) => s === selectedSeason && e === selectedEpisode && p === selectedPart);
    for (const [selector, step, name] of [[".previous",-1,"Previous"],[".next",1,"Next"]]) {
      const button = find(selector);
      const dest = position >= 0 ? sequence[position+step] : undefined;
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
    picker.querySelector(".selection-title").textContent = selectedLabel;
    if (matches.length) {
      const play = document.createElement("button");
      play.className = "primary";
      play.innerHTML = icon("play") + (selectedOption.episode != null ? "Play episode " + selectedOption.episode : "Play");
      actions.append(play);

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

      video.addEventListener("play", () => {
        promptOverlay?.classList.add("hidden");
        bigPlay?.classList.add("hidden");
      });

      function showQualityPicker() {
        if (matches.length > 1 && promptOverlay) {
          promptOverlay.classList.remove("hidden");
          find("#watch")?.scrollIntoView({ behavior: 'smooth' });
        } else {
          bigPlay?.classList.add("hidden");
          playSelected();
        }
      }

      bigPlay.onclick = () => showQualityPicker();
      play.onclick = () => showQualityPicker();
      const watchLink = find('.actions .primary[href="#watch"]');
      if (watchLink) {
        watchLink.onclick = (e) => {
          e.preventDefault();
          showQualityPicker();
        };
      }
      for (const o of matches) {
        if (!/^\/download\/[\w.-]+$/.test(o.download || "")) continue;
        const li = document.createElement("li"),
          name = document.createElement("span"),
          link = document.createElement("a");
        name.textContent = label(o);
        link.setAttribute("aria-label", ["Download", (series || multipart) && selectedLabel, label(o)].filter(Boolean).join(" · "));
        link.href = o.download;
        link.className = "secondary";
        link.textContent = "Download";
        li.append(name, link);
        list.append(li);
      }
    }
    status.textContent = partial
      ? "Some versions could not be checked."
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
      all = result.options || [];
      const editions = [
        ...new Set(all.map((option) => option.edition).filter(Boolean)),
      ];
      find("#release-quality").textContent =
        "Release quality · " +
        (editions.join(" / ") || result.quality || "Unlisted");
      partial = Boolean(result.unavailable);
    } catch {
      clearTimeout(timer);
      all = [];
      partial = true;
    }
    render();
  }
  loadOptions();
  const sectionId = location.hash.slice(1) || location.pathname.split("/").filter(Boolean).at(-1);
  if (sectionId === "watch" || sectionId === "downloads") find("#" + sectionId).scrollIntoView();
}
