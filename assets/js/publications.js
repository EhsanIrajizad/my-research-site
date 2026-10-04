/* Publications page: search, filters, grouping by year. Filters sync to the URL. */
(function () {
  "use strict";
  const { h, renderPub, role, toast, copyText, bibtex } = window.Lab;
  const data = window.PUBLICATIONS;
  const listEl = document.getElementById("pub-results");
  if (!data || !listEl) return;

  const pubs = data.publications;
  const state = { q: "", year: "", topics: new Set(), kind: "", lead: false };

  /* ---------- Read state from URL ---------- */
  const params = new URLSearchParams(location.search);
  state.q = params.get("q") || "";
  state.year = params.get("year") || "";
  state.kind = params.get("type") || "";
  state.lead = params.get("lead") === "1";
  (params.get("topic") || "").split(",").filter(Boolean).forEach((t) => state.topics.add(t));

  function writeUrl() {
    const p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (state.year) p.set("year", state.year);
    if (state.topics.size) p.set("topic", [...state.topics].join(","));
    if (state.kind) p.set("type", state.kind);
    if (state.lead) p.set("lead", "1");
    const qs = p.toString();
    history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }

  /* ---------- Filtering ---------- */
  const haystack = new Map(pubs.map((p) => [p.pmid, [
    p.title, p.authors.join(" "), p.journal, p.journalAbbr, p.keywords.join(" "), p.abstract, p.pmid, p.doi,
  ].join(" ").toLowerCase()]));

  function matches(p, skip) {
    if (skip !== "year" && state.year && String(p.year) !== state.year) return false;
    if (skip !== "kind" && state.kind && p.kind !== state.kind) return false;
    if (skip !== "lead" && state.lead && !role(p)) return false;
    if (skip !== "topics" && state.topics.size && ![...state.topics].every((t) => p.topics.includes(t))) return false;
    if (state.q) {
      const text = haystack.get(p.pmid);
      if (!state.q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => text.includes(w))) return false;
    }
    return true;
  }

  /* ---------- Chip groups ---------- */
  function countBy(list, fn) {
    const m = new Map();
    list.forEach((p) => [].concat(fn(p)).forEach((k) => m.set(k, (m.get(k) || 0) + 1)));
    return m;
  }

  const years = [...new Set(pubs.map((p) => String(p.year)))].sort().reverse();
  const topicOrder = [...new Set(pubs.flatMap((p) => p.topics))];
  const kinds = ["Article", "Review", "Preprint", "Letter", "Commentary"].filter((k) => pubs.some((p) => p.kind === k));

  function chip(label, count, pressed, onClick) {
    return h("button", { type: "button", class: "chip", "aria-pressed": String(pressed), onclick: onClick },
      label, count != null ? h("span", { class: "count" }, count) : null);
  }

  function renderFilters() {
    const yearCounts = countBy(pubs.filter((p) => matches(p, "year")), (p) => String(p.year));
    document.getElementById("filter-years").replaceChildren(
      chip("All", null, !state.year, () => { state.year = ""; update(); }),
      ...years.map((y) => chip(y, yearCounts.get(y) || 0, state.year === y, () => { state.year = state.year === y ? "" : y; update(); })));

    const topicCounts = countBy(pubs.filter((p) => matches(p, "topics")), (p) => p.topics);
    document.getElementById("filter-topics").replaceChildren(
      ...topicOrder.map((t) => chip(t, topicCounts.get(t) || 0, state.topics.has(t), () => {
        state.topics.has(t) ? state.topics.delete(t) : state.topics.add(t);
        update();
      })));

    const kindCounts = countBy(pubs.filter((p) => matches(p, "kind")), (p) => p.kind);
    document.getElementById("filter-kinds").replaceChildren(
      chip("All", null, !state.kind, () => { state.kind = ""; update(); }),
      ...kinds.map((k) => chip(k === "Article" ? "Research articles" : k + "s", kindCounts.get(k) || 0, state.kind === k,
        () => { state.kind = state.kind === k ? "" : k; update(); })));
  }

  /* ---------- Results ---------- */
  let current = [];
  function renderResults() {
    current = pubs.filter((p) => matches(p));
    const filtered = state.q || state.year || state.topics.size || state.kind || state.lead;
    document.getElementById("result-count").textContent = current.length;
    document.getElementById("result-total").textContent = pubs.length;
    document.getElementById("clear-filters").hidden = !filtered;

    if (!current.length) {
      listEl.replaceChildren(h("div", { class: "empty" },
        h("p", {}, "No publications match these filters."),
        h("button", { type: "button", class: "link-btn", onclick: clearAll }, "Clear all filters")));
      return;
    }
    const groups = new Map();
    current.forEach((p) => {
      if (!groups.has(p.year)) groups.set(p.year, []);
      groups.get(p.year).push(p);
    });
    listEl.replaceChildren(...[...groups].map(([year, items]) => h("section", { class: "year-group", id: `y${year}`, "aria-label": String(year) },
      h("h2", { class: "year-heading" }, String(year), h("span", {}, `${items.length} ${items.length === 1 ? "paper" : "papers"}`)),
      h("ul", { class: "pub-list" }, items.map((p) => renderPub(p, { showTopics: true }))))));
  }

  function update() {
    writeUrl();
    renderFilters();
    renderResults();
  }

  function clearAll() {
    state.q = ""; state.year = ""; state.kind = ""; state.lead = false; state.topics.clear();
    searchInput.value = ""; leadInput.checked = false;
    update();
  }

  /* ---------- Wire up controls ---------- */
  const searchInput = document.getElementById("pub-search");
  const leadInput = document.getElementById("filter-lead");
  searchInput.value = state.q;
  leadInput.checked = state.lead;

  let debounce;
  searchInput.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { state.q = searchInput.value.trim(); update(); }, 120);
  });
  leadInput.addEventListener("change", () => { state.lead = leadInput.checked; update(); });
  document.getElementById("clear-filters").addEventListener("click", clearAll);
  document.getElementById("export-bib").addEventListener("click", () => {
    copyText(current.map(bibtex).join("\n\n")).then(() => toast(`${current.length} BibTeX entries copied`));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement.tagName !== "INPUT") { e.preventDefault(); searchInput.focus(); }
  });

  /* ---------- Summary stats ---------- */
  const lead = pubs.filter((p) => role(p)).length;
  const journals = new Set(pubs.filter((p) => p.kind !== "Preprint").map((p) => p.journal.toLowerCase())).size;
  document.getElementById("stat-total").textContent = pubs.length;
  document.getElementById("stat-lead").textContent = lead;
  document.getElementById("stat-journals").textContent = journals;
  document.getElementById("stat-open").textContent = pubs.filter((p) => p.pmcid).length;

  update();
})();
