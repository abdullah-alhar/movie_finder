window.va = window.va || function () {
  (window.vaq = window.vaq || []).push(arguments);
};

window.va("beforeSend", (event) => {
  if (event.type !== "pageview") return null;
  const url = new URL(event.url, window.location.origin);
  // Keep search queries and signed media identifiers out of reports.
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/^\/movie\/[^/]+(?=\/|$)/i, "/movie/title");
  return { ...event, url: url.href };
});
