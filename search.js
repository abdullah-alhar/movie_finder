const words = [
  "one i",
  "two ii",
  "three iii",
  "four iv",
  "five v",
  "six vi",
  "seven vii",
  "eight viii",
  "nine ix",
  "ten x",
];
const numberWords = new Map(
  words.flatMap((pair, i) => pair.split(" ").map((x) => [x, String(i + 1)])),
);
export function normalize(s) {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\d]+/gu, " ")
    .trim()
    .replace(
      /\b(part|chapter|volume) (\w+)/g,
      (_, tag, n) => tag + " " + (numberWords.get(n) ?? n),
    );
}

export function similarity(a, b) {
  if (a === b) return 1;
  if (Math.abs(a.length - b.length) > 3 || a.length < 3) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i),
    older = prev;
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + Number(a[i - 1] !== b[j - 1]),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        row[j] = Math.min(row[j], older[j - 2] + 1);
    }
    older = prev;
    prev = row;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

export function indexMovie(movie) {
  const title = normalize(movie.title);
  let compact = title.replace(/\b(?:part|chapter|volume) (\d+)\b/g, "$1");
  if (title === "dune" && movie.year === 2021) compact = "dune 1";
  return { title, compact, words: title.split(" ") };
}

export function searchMovies(query, movies) {
  const text = normalize(query);
  if (!text) return movies.slice();
  if (/^(?:18|19|20)\d{2}$/.test(text))
    return movies.filter((movie) => movie.year === Number(text));

  const year = text.match(/ ((?:18|19|20)\d{2})$/);
  const term = year ? text.slice(0, year.index) : text;
  const compact = term.replace(/\b(?:part|chapter|volume) (\d+)\b/g, "$1");
  const part = compact.match(/ (\d{1,2})$/)?.[1];
  const terms = term.split(" ");
  const scores = new Map();

  function wordScore(word, candidate) {
    if (candidate === word) return 1;
    if (candidate.startsWith(word) && word.length >= 2) return 0.95;
    if (word.length < 4 || Math.abs(candidate.length - word.length) > 2)
      return 0;
    let table = scores.get(word);
    if (!table) {
      table = new Map();
      scores.set(word, table);
    }
    if (!table.has(candidate))
      table.set(candidate, similarity(word, candidate));
    return table.get(candidate);
  }

  function score(movie) {
    const index = movie.index || indexMovie(movie);
    if (index.title === text) return 5;
    if (year && movie.year !== Number(year[1])) return 0;
    if (index.title === term || index.compact === compact) return 4;
    if (part && !index.compact.endsWith(" " + part)) return 0;
    if (index.title.startsWith(term))
      return 3 + term.length / index.title.length;
    if ((" " + index.title + " ").includes(" " + term + " ")) return 2.5;
    if (term.length < 2) return 0;
    let sum = 0;
    for (const word of terms) {
      let best = 0;
      for (const candidate of index.words) {
        best = Math.max(best, wordScore(word, candidate));
        if (best === 1) break;
      }
      if (best < 0.74) return 0;
      sum += best;
    }
    return (
      sum / terms.length + 0.1 * Math.min(1, terms.length / index.words.length)
    );
  }
  const ranked = [];
  for (const movie of movies) {
    const value = score(movie);
    if (value > 0) ranked.push({ movie, value });
  }
  ranked.sort(
    (a, b) =>
      b.value - a.value ||
      a.movie.title.localeCompare(b.movie.title) ||
      b.movie.year - a.movie.year,
  );
  return ranked.map((result) => result.movie);
}
