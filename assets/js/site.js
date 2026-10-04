/* Shared behaviour for every page: theme, mobile nav, and publication rendering. */
(function () {
  "use strict";

  /* ---------- Theme ---------- */
  const root = document.documentElement;
  const storedTheme = (() => { try { return localStorage.getItem("theme"); } catch (e) { return null; } })();
  if (storedTheme === "light" || storedTheme === "dark") root.dataset.theme = storedTheme;

  function currentTheme() {
    if (root.dataset.theme) return root.dataset.theme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  document.addEventListener("DOMContentLoaded", () => {
    const themeBtn = document.querySelector(".theme-toggle");
    if (themeBtn) {
      themeBtn.addEventListener("click", () => {
        const next = currentTheme() === "dark" ? "light" : "dark";
        root.dataset.theme = next;
        try { localStorage.setItem("theme", next); } catch (e) { /* private mode */ }
      });
    }

    const menuBtn = document.querySelector(".menu-toggle");
    const links = document.getElementById("nav-links");
    if (menuBtn && links) {
      menuBtn.addEventListener("click", () => {
        const open = links.classList.toggle("open");
        menuBtn.setAttribute("aria-expanded", String(open));
      });
    }

    document.querySelectorAll("[data-year]").forEach((el) => { el.textContent = new Date().getFullYear(); });

    const data = window.PUBLICATIONS;
    if (data) {
      document.querySelectorAll("[data-pub-updated]").forEach((el) => { el.textContent = formatLongDate(data.updated); });
      document.querySelectorAll("[data-pub-count]").forEach((el) => { el.textContent = data.count; });
    }
  });

  /* ---------- Helpers ---------- */

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function formatLongDate(iso) {
    const [y, m, d] = (iso || "").split("-").map(Number);
    if (!y) return "";
    return `${d ? d + " " : ""}${m ? MONTHS[m - 1] + " " : ""}${y}`;
  }

  /** Tiny DOM builder: h("a", {href: "#"}, "text", childNode) */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const child of children.flat()) {
      if (child == null || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  function svgIcon(path) {
    const span = document.createElement("span");
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
    return span.firstChild;
  }
  const ICONS = {
    external: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    quote: '<path d="M7 7h4v4H7zM7 11c0 3-1 4-3 5M15 7h4v4h-4zM15 11c0 3-1 4-3 5"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  };

  let toastTimer;
  function toast(message) {
    let el = document.querySelector(".toast");
    if (!el) {
      el = h("div", { class: "toast", role: "status", "aria-live": "polite" });
      document.body.append(el);
    }
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = h("textarea", { style: "position:fixed;opacity:0" });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }

  /* ---------- Publication model ---------- */

  function selfName() {
    const a = (window.PUBLICATIONS && window.PUBLICATIONS.author) || { last: "", initials: "" };
    return `${a.last} ${a.initials}`.trim();
  }

  function authorIndex(pub) {
    const me = selfName().toLowerCase();
    return pub.authors.findIndex((a) => a.toLowerCase() === me);
  }

  /** "first", "senior", or "" for the site owner's position in the author list. */
  function role(pub) {
    const i = authorIndex(pub);
    if (i === 0) return "first";
    if (i > 0 && i === pub.authors.length - 1) return "senior";
    return "";
  }

  function venueText(pub) {
    if (pub.kind === "Preprint") return `${pub.journalAbbr} preprint, ${pub.year}`;
    let s = `${pub.year}`;
    if (pub.volume) s += `;${pub.volume}`;
    if (pub.issue) s += `(${pub.issue})`;
    if (pub.pages) s += `:${pub.pages}`;
    return s;
  }

  function vancouver(pub) {
    const authors = pub.authors.length > 6 ? pub.authors.slice(0, 6).join(", ") + ", et al" : pub.authors.join(", ");
    const title = pub.title.replace(/\.$/, "");
    const venue = pub.kind === "Preprint" ? `${pub.journalAbbr} [Preprint]. ${pub.year}` : `${pub.journalAbbr}. ${venueText(pub)}`;
    return `${authors}. ${title}. ${venue}.${pub.doi ? ` doi:${pub.doi}.` : ""} PMID: ${pub.pmid}.`;
  }

  function bibtex(pub) {
    const first = (pub.authors[0] || "anon").split(" ")[0].toLowerCase().replace(/[^a-z]/g, "");
    const word = (pub.title.match(/[A-Za-z]{4,}/) || ["paper"])[0].toLowerCase();
    const authors = pub.authors.map((a) => {
      const parts = a.split(" ");
      const initials = parts.length > 1 ? parts.pop() : "";
      return `${parts.join(" ")}, ${initials.split("").join(". ")}${initials ? "." : ""}`;
    }).join(" and ");
    const fields = [
      ["title", `{${pub.title.replace(/\.$/, "")}}`],
      ["author", `{${authors}}`],
      ["journal", `{${pub.journal}}`],
      ["year", `{${pub.year}}`],
      pub.volume && ["volume", `{${pub.volume}}`],
      pub.issue && ["number", `{${pub.issue}}`],
      pub.pages && ["pages", `{${pub.pages.replace("-", "--")}}`],
      pub.doi && ["doi", `{${pub.doi}}`],
      ["pmid", `{${pub.pmid}}`],
    ].filter(Boolean);
    const type = pub.kind === "Preprint" ? "misc" : "article";
    return `@${type}{${first}${pub.year}${word},\n${fields.map(([k, v]) => `  ${k} = ${v}`).join(",\n")}\n}`;
  }

  /** Author line that keeps the site owner visible even in long lists. */
  function authorLine(pub, expanded) {
    const p = h("p", { class: "pub-authors" });
    const me = authorIndex(pub);
    const n = pub.authors.length;
    const LIMIT = 10;
    let show;
    if (expanded || n <= LIMIT) {
      show = pub.authors.map((_, i) => i);
    } else {
      const set = new Set([0, 1, 2, 3, 4, 5, n - 1]);
      if (me >= 0) set.add(me);
      show = [...set].sort((a, b) => a - b);
    }
    show.forEach((idx, k) => {
      if (k > 0) p.append(show[k - 1] === idx - 1 ? ", " : ", … ");
      const name = pub.authors[idx];
      p.append(idx === me ? h("span", { class: "me" }, name) : name);
    });
    if (!expanded && n > LIMIT) {
      p.append(" ");
      p.append(h("button", {
        type: "button",
        "aria-label": `Show all ${n} authors`,
        onclick: () => p.replaceWith(authorLine(pub, true)),
      }, `(+${n - show.length} more)`));
    }
    return p;
  }

  function renderPub(pub, opts = {}) {
    const li = h("li", { class: "pub", id: `pmid-${pub.pmid}` });
    const pubmedUrl = `https://pubmed.ncbi.nlm.nih.gov/${pub.pmid}/`;
    const titleUrl = pub.doi ? `https://doi.org/${pub.doi}` : pubmedUrl;

    li.append(h("h3", { class: "pub-title" }, h("a", { href: titleUrl, target: "_blank", rel: "noopener" }, pub.title)));
    li.append(authorLine(pub, false));
    li.append(h("p", { class: "pub-venue" }, h("cite", {}, pub.journalAbbr),
      pub.kind === "Preprint" ? ` preprint · ${pub.year}` : `. ${venueText(pub)}`));

    const meta = h("div", { class: "pub-meta" });
    const r = role(pub);
    if (r === "first") meta.append(h("span", { class: "tag tag-role" }, "First author"));
    if (r === "senior") meta.append(h("span", { class: "tag tag-role" }, "Senior author"));
    if (pub.kind !== "Article") meta.append(h("span", { class: "tag tag-kind" }, pub.kind));
    if (opts.showTopics) pub.topics.slice(0, 3).forEach((t) => meta.append(h("span", { class: "tag" }, t)));

    const links = h("div", { class: "pub-links" });
    let abstractEl = null;
    if (pub.abstract && !opts.compact) {
      const id = `abs-${pub.pmid}`;
      const btn = h("button", { type: "button", "aria-expanded": "false", "aria-controls": id }, svgIcon(ICONS.chevron), "Abstract");
      abstractEl = h("div", { class: "pub-abstract", id, hidden: true },
        h("p", {}, pub.abstract),
        pub.keywords && pub.keywords.length ? h("p", { class: "kw" }, "Keywords: " + pub.keywords.join(" · ")) : null);
      btn.addEventListener("click", () => {
        const open = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", String(!open));
        btn.querySelector("svg").style.transform = open ? "" : "rotate(180deg)";
        abstractEl.hidden = open;
      });
      links.append(btn);
    }
    links.append(h("a", { href: pubmedUrl, target: "_blank", rel: "noopener" }, svgIcon(ICONS.external), "PubMed"));
    if (pub.doi) links.append(h("a", { href: `https://doi.org/${pub.doi}`, target: "_blank", rel: "noopener" }, svgIcon(ICONS.external), "DOI"));
    if (pub.pmcid) links.append(h("a", { href: `https://pmc.ncbi.nlm.nih.gov/articles/${pub.pmcid}/`, target: "_blank", rel: "noopener", title: "Free full text in PubMed Central" }, svgIcon(ICONS.unlock), "Full text"));
    if (!opts.compact) {
      links.append(h("button", {
        type: "button",
        onclick: () => copyText(vancouver(pub)).then(() => toast("Citation copied")),
      }, svgIcon(ICONS.quote), "Cite"));
      links.append(h("button", {
        type: "button",
        onclick: () => copyText(bibtex(pub)).then(() => toast("BibTeX copied")),
      }, svgIcon(ICONS.doc), "BibTeX"));
    }
    meta.append(links);
    li.append(meta);
    if (abstractEl) li.append(abstractEl);
    return li;
  }

  /** Fill every <ul data-pmids="1,2,3"> or <ul data-latest="4"> on the page. */
  function fillLists() {
    const data = window.PUBLICATIONS;
    if (!data) return;
    const byId = new Map(data.publications.map((p) => [p.pmid, p]));
    document.querySelectorAll("ul[data-pmids]").forEach((ul) => {
      const pubs = ul.dataset.pmids.split(",").map((s) => byId.get(s.trim())).filter(Boolean);
      ul.replaceChildren(...pubs.map((p) => renderPub(p, { compact: ul.hasAttribute("data-compact") })));
    });
    document.querySelectorAll("ul[data-latest]").forEach((ul) => {
      const n = Number(ul.dataset.latest) || 5;
      const pubs = data.publications.filter((p) => p.kind !== "Preprint").slice(0, n);
      ul.replaceChildren(...pubs.map((p) => renderPub(p, { compact: ul.hasAttribute("data-compact") })));
    });
  }
  document.addEventListener("DOMContentLoaded", fillLists);

  window.Lab = { h, renderPub, role, authorIndex, selfName, formatLongDate, bibtex, vancouver, copyText, toast };
})();
