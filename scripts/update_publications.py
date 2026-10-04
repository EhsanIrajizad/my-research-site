#!/usr/bin/env python3
"""Refresh the lab's publication list from PubMed (NCBI E-utilities).

Usage:
    python3 scripts/update_publications.py
    python3 scripts/update_publications.py --query "Irajizad E[Author]"

Writes two files with identical content:
    data/publications.json            machine-readable copy
    assets/js/publications-data.js    loaded by the site (works from file:// too)

Standard library only, so it runs anywhere, including GitHub Actions.
Set NCBI_API_KEY in the environment to raise the rate limit (optional).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "data" / "pubmed-config.json"
JSON_OUT = ROOT / "data" / "publications.json"
JS_OUT = ROOT / "assets" / "js" / "publications-data.js"

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}

# Topic tags shown as filters on the publications page. Matched against the
# title and author keywords (case-insensitive); MeSH terms are too broad and
# add noise. Order is display order.
TOPICS = [
    ("Lung", r"\blung|nsclc|thoracic|smok"),
    ("Pancreatic", r"pancrea|ipmn|\bpdac\b|ca19-9|duodenopancreatic"),
    ("Ovarian", r"ovar"),
    ("Breast", r"breast"),
    ("Prostate", r"prostat"),
    ("Hematologic", r"leuk|lymphoma|car[ -]?t|graft-versus-host|hematopoietic"),
    ("Neuroendocrine", r"neuroendocrine|men1|men type 1|multiple endocrine"),
    ("Metabolomics", r"metabol|polyamin|sphingolipid|sulfatide|lipid|spermi|uremic toxin|kynurenin"),
    ("Proteomics", r"prote(in|om)|surfaceome|neoantigen|autoantibod|immunoglobulin"),
    ("Biophysics", r"mechan|biophys|clathrin|mitochondrial fission|vesicle adhesion"),
    ("Statistical methods", r"sensitivity maxim|optimize the sensitivity|feature selection|\bauc|\bmetric|bayesian|"
                            r"mediation|meta-analytic|uncertainty|rank-based|sojourn|"
                            r"neural network|artificial intelligence|digital twin|surrogate"),
    ("Screening & risk", r"screening|risk assess|risk stratif|early detection|earlier detection|"
                         r"lead[- ]time|mortality benefit|risk of"),
]


def classify_topics(text: str) -> list[str]:
    # Trial names such as "Prostate, Lung, Colorectal, and Ovarian (PLCO)"
    # would otherwise tag every organ they mention.
    text = re.sub(r"prostate, lung, colorectal,? and ovarian", "plco", text.lower())
    return [name for name, pattern in TOPICS if re.search(pattern, text)]


def http_get(url: str, params: dict, retries: int = 4) -> bytes:
    if os.environ.get("NCBI_API_KEY"):
        params = {**params, "api_key": os.environ["NCBI_API_KEY"]}
    params = {**params, "tool": "lab-website", "email": os.environ.get("NCBI_EMAIL", "")}
    full = f"{url}?{urllib.parse.urlencode(params)}"
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(full, timeout=60) as resp:
                return resp.read()
        except Exception as exc:  # network hiccups / 429s
            if attempt == retries - 1:
                raise
            wait = 2 ** (attempt + 1)
            print(f"  request failed ({exc}); retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError("unreachable")


def search_pmids(query: str) -> list[str]:
    raw = http_get(f"{EUTILS}/esearch.fcgi", {
        "db": "pubmed", "term": query, "retmax": 1000, "retmode": "json", "sort": "pub_date",
    })
    return json.loads(raw)["esearchresult"]["idlist"]


def text_of(el) -> str:
    """Flatten an element including inline markup like <i> and <sup>."""
    return re.sub(r"\s+", " ", "".join(el.itertext())).strip() if el is not None else ""


def parse_date(article) -> tuple[int, int, int]:
    """Best available (year, month, day); month/day are 0 when unknown."""
    for path in ("Journal/JournalIssue/PubDate", "ArticleDate"):
        node = article.find(path)
        if node is None:
            continue
        year = node.findtext("Year")
        if not year and node.findtext("MedlineDate"):
            match = re.search(r"\d{4}", node.findtext("MedlineDate"))
            year = match.group(0) if match else None
        if year:
            return int(year), month_number(node.findtext("Month")), int(node.findtext("Day") or 0)
    return 0, 0, 0


def month_number(value: str | None) -> int:
    if not value:
        return 0
    if value.isdigit():
        return int(value)
    return MONTHS.get(value[:3].lower(), 0)


def fetch_records(pmids: list[str]) -> list[dict]:
    records = []
    for start in range(0, len(pmids), 100):
        batch = pmids[start:start + 100]
        root = ET.fromstring(http_get(f"{EUTILS}/efetch.fcgi", {
            "db": "pubmed", "id": ",".join(batch), "retmode": "xml",
        }))
        for node in root.findall("PubmedArticle"):
            records.append(parse_article(node))
        time.sleep(0.4)
    return records


def parse_article(node) -> dict:
    citation = node.find("MedlineCitation")
    article = citation.find("Article")
    journal = article.find("Journal")
    ids = {i.get("IdType"): (i.text or "").strip()
           for i in node.findall("PubmedData/ArticleIdList/ArticleId")}
    authors = []
    for a in article.findall("AuthorList/Author"):
        if a.findtext("CollectiveName"):
            authors.append({"last": a.findtext("CollectiveName"), "initials": ""})
        elif a.findtext("LastName"):
            authors.append({"last": a.findtext("LastName"), "initials": a.findtext("Initials") or ""})
    abstract = " ".join(
        (f"{p.get('Label').title()}: " if p.get("Label") else "") + text_of(p)
        for p in article.findall("Abstract/AbstractText"))
    year, month, day = parse_date(article)
    return build_record(
        pmid=citation.findtext("PMID"),
        pmcid=ids.get("pmc", ""),
        doi=ids.get("doi", ""),
        title=text_of(article.find("ArticleTitle")),
        authors=authors,
        journal=text_of(journal.find("Title")),
        journal_abbr=journal.findtext("ISOAbbreviation") or "",
        year=year, month=month, day=day,
        volume=journal.findtext("JournalIssue/Volume") or "",
        issue=journal.findtext("JournalIssue/Issue") or "",
        pages=article.findtext("Pagination/MedlinePgn") or article.findtext("ELocationID") or "",
        types=[t.text for t in article.findall("PublicationTypeList/PublicationType") if t.text],
        keywords=[text_of(k) for k in citation.findall("KeywordList/Keyword")],
        mesh=[text_of(m.find("DescriptorName")) for m in citation.findall("MeshHeadingList/MeshHeading")],
        abstract=abstract,
    )


def build_record(*, pmid, pmcid, doi, title, authors, journal, journal_abbr, year, month, day,
                 volume, issue, pages, types, keywords, mesh, abstract) -> dict:
    """Normalise one article into the shape the website expects."""
    types = list(dict.fromkeys(types))
    is_preprint = "Preprint" in types or journal_abbr.lower() in {"biorxiv", "medrxiv", "arxiv"}
    if is_preprint:
        kind = "Preprint"
    elif "Review" in types or "Systematic Review" in types:
        kind = "Review"
    elif "Letter" in types:
        kind = "Letter"
    elif {"Comment", "Editorial"} & set(types):
        kind = "Commentary"
    else:
        kind = "Article"
    return {
        "pmid": pmid,
        "pmcid": pmcid,
        "doi": doi,
        "title": title.rstrip(),
        "authors": [f"{a['last']} {a['initials']}".strip() for a in authors],
        "journal": journal,
        "journalAbbr": journal_abbr or journal,
        "year": year,
        "date": f"{year:04d}-{month:02d}-{day:02d}",
        "volume": volume,
        "issue": issue,
        "pages": pages,
        "kind": kind,
        "topics": classify_topics(" ".join([title, *keywords])),
        "keywords": keywords,
        "abstract": abstract,
    }


def write_outputs(records: list[dict], query: str, author: dict) -> None:
    records.sort(key=lambda r: (r["date"], r["pmid"]), reverse=True)
    payload = {
        "query": query,
        "author": author,
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "count": len(records),
        "publications": records,
    }
    JSON_OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    JS_OUT.write_text(
        "// Generated by scripts/update_publications.py from PubMed. Do not edit by hand.\n"
        f"window.PUBLICATIONS = {json.dumps(payload, ensure_ascii=False)};\n",
        encoding="utf-8")
    print(f"Wrote {len(records)} publications to {JSON_OUT.relative_to(ROOT)} "
          f"and {JS_OUT.relative_to(ROOT)}")


def main() -> int:
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--query", default=config["query"], help="PubMed search query")
    args = parser.parse_args()

    print(f"Searching PubMed: {args.query}")
    pmids = search_pmids(args.query)
    exclude = set(config.get("exclude_pmids", []))
    pmids = [p for p in pmids if p not in exclude]
    print(f"  {len(pmids)} PMIDs")
    if not pmids:
        print("No results; leaving existing files untouched.", file=sys.stderr)
        return 1
    write_outputs(fetch_records(pmids), args.query, config["author"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
