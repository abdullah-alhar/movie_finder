import { icon, esc, safeImage, json, section, choice, toast } from "./ui.js";
function episodePicker(episodes, selected, choose) {
  const field = document.createElement("fieldset");
  field.className = "episodes";
  const legend = document.createElement("legend");
  legend.textContent = "Episodes";
  field.append(legend);
  const label = (value) => value < 0 ? "Other" : String(value);
  for (let start = 0; start < episodes.length; start += 20) {
    const group = episodes.slice(start, start + 20);
    const grid = document.createElement("div");
    grid.className = "episode-grid";
    for (const episode of group) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label(episode);
      button.setAttribute("aria-label", "Episode " + label(episode));
      button.setAttribute("aria-pressed", String(episode === selected));
      button.onclick = () => choose(episode);
      grid.append(button);
    }
    if (episodes.length <= 20) {
      field.append(grid);
      break;
    }
    const range = document.createElement("div");
    range.className = "episode-range";
    const summary = document.createElement("p");
    summary.textContent = group.length === 1 ? label(group[0]) : label(group[0]) + "–" + label(group.at(-1));
    range.append(summary, grid);
    field.append(range);
  }
  return field;
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
  document.title = item.title + " · Afterframe";
  main.innerHTML =
    '<a class="back" href="/movies">Browse films</a><section class="detail-header"><div class="detail-cover"><span>' +
    esc(item.title) +
    '</span></div><div class="detail-copy"><p class="eyebrow">FILM DETAILS</p><h1>' +
    esc(item.title) +
    '</h1><p class="muted" id="facts">' +
    esc([item.year, item.provider].filter(Boolean).join(" · ")) +
    '</p><p id="release-quality" class="muted"></p><p id="overview"></p><p class="muted" id="cast"></p><p class="rating"></p><div class="actions"><a class="primary" href="#watch">' +
    icon("play") +
    'Watch</a><a class="secondary" href="#downloads">Download</a><button class="secondary share">' +
    icon("share") +
    'Share</button><a class="secondary trailer" target="_blank" rel="noopener noreferrer">Trailer</a></div></div></section><div class="media-hub"><section class="selection-picker" aria-label="Media selection" hidden><p class="selection-title"></p><div class="selection-controls"></div></section><section class="media collection" id="watch"><h2>Watch movie</h2><div class="player-shell"><div class="player-top"><p class="episode-status" role="status" hidden></p><details class="player-settings" hidden><summary>Player settings</summary><div class="media-controls"></div></details></div><div class="video-wrap"><video controls playsinline preload="none" aria-label="Movie player"></video></div><div class="transport" aria-label="Playback controls"><button type="button" class="previous" hidden>Previous</button><button type="button" class="rewind">−10 s</button><button type="button" class="forward">+10 s</button><button type="button" class="next" hidden>Next</button><button type="button" class="expand" hidden>Fullscreen</button></div></div><p class="player-state notice" role="status"></p><div class="actions media-actions"></div></section><section class="downloads collection" id="downloads"><h2>Downloads</h2><p class="download-selection muted"></p><ul></ul><div class="download-recovery" role="status"></div></section></div>';
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
        item.provider,
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
      if (data.rating)
        find(".rating").append(
          document.createTextNode(
            "TMDB " + Number(data.rating).toFixed(1) + " / 10 ",
          ),
        );
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
      if (rating?.score)
        find(".rating").append(
          document.createTextNode(
            " IMDb " + Number(rating.score).toFixed(1) + " / 10",
          ),
        );
    })
    .catch(() => {});
  let selectedSeason, selectedEpisode, selectedOption, selectedPart;
  let sequence = [];
  const settings = find(".player-settings");
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
    if (!target || video.getAttribute("src") !== target) return;
    try {
      status.textContent = "Opening video…";
      await video.play();
    } catch (error) {
      if (error.name !== "AbortError" && video.getAttribute("src") === target) playbackFailed();
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
      if (video.getAttribute("src") !== target) video.src = target;
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
    const controls = find(".media-controls"),
      actions = find(".media-actions"),
      list = find(".downloads ul");
    controls.replaceChildren();
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
          picker.querySelector('.episode-grid [aria-pressed="true"]').focus({ preventScroll: true });
        }),
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
    if (matches.length > 1)
      controls.append(
        choice(
          "Quality",
          matches.map((_, i) => i),
          initial,
          (i) => {
            const resume = !video.paused;
            const time = video.currentTime;
            resetPlayer();
            prepareOption(matches[i]);
            if (time > 0) {
              const target = matches[i].watch;
              video.addEventListener("loadedmetadata", () => {
                if (video.getAttribute("src") === target && Number.isFinite(video.duration))
                  video.currentTime = Math.min(time, video.duration);
              }, { once: true });
            }
            if (resume) playSelected();
          },
          (i) => label(matches[i]),
        ),
      );
    picker.hidden = !series && !multipart;
    const selectedLabel = series ? [
      selectedSeason >= 0 && "Season " + selectedSeason,
      selectedEpisode >= 0 ? "Episode " + selectedEpisode : "Other episodes",
    ].filter(Boolean).join(" · ") : selectedPart != null ? "Part " + selectedPart : "Other versions";
    find(".download-selection").textContent = series || multipart ? selectedLabel : "";
    picker.querySelector(".selection-title").textContent = selectedLabel;
    settings.hidden = !matches.length;
    settings.querySelector("summary").textContent = "Playback settings";
    if (matches.length) {
      controls.append(choice("Speed", [0.5, 0.75, 1, 1.25, 1.5, 2], video.defaultPlaybackRate,
        rate => { video.defaultPlaybackRate = rate; video.playbackRate = rate; }, rate => rate + "×"));
      const play = document.createElement("button");
      play.className = "primary";
      play.innerHTML = icon("play") + (selectedOption.episode != null ? "Play episode " + selectedOption.episode : "Play");
      actions.append(play);
      play.onclick = playSelected;
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
    try {
      const result = await json(base + "/options");
      all = result.options || [];
      const editions = [
        ...new Set(all.map((option) => option.edition).filter(Boolean)),
      ];
      find("#release-quality").textContent =
        "Release quality · " +
        (editions.join(" / ") || result.quality || "Unlisted");
      partial = Boolean(result.unavailable);
    } catch {
      all = [];
      partial = true;
    }
    render();
  }
  loadOptions();
  const sectionId = location.hash.slice(1) || location.pathname.split("/").filter(Boolean).at(-1);
  if (sectionId === "watch" || sectionId === "downloads") find("#" + sectionId).scrollIntoView();
}
