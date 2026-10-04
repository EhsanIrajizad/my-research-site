# Irajizad Lab website

A static lab website (plain HTML, CSS and JavaScript with no build step) whose publication list is pulled from PubMed and refreshed every week.

| Page | File | What it shows |
| --- | --- | --- |
| Home | `index.html` | Hero, publication stats, research areas, latest papers |
| Research | `research.html` | Four research themes, each with selected papers |
| Publications | `publications.html` | Full searchable and filterable list, with abstracts, PubMed/DOI/PMC links, citation and BibTeX copy |
| People | `people.html` | Lab lead bio, frequent co-authors (computed from PubMed), join-the-lab section |

The site supports light and dark mode, mobile layouts and printing. Filters on the publications page are stored in the URL, so links like `publications.html?topic=Lung&lead=1` can be shared.

## Viewing locally

Open `index.html` in a browser. Because the publication data loads as a script (`assets/js/publications-data.js`), it also works from `file://`. You can also serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Publications from PubMed

- **Query and author:** set in `data/pubmed-config.json` (default `Irajizad E[Author]`). The `author` entry decides which name is highlighted and how first- or senior-author papers are detected. To leave out a paper that belongs to a different person with the same name, add its PMID to `exclude_pmids`.
- **Update by hand:** run `python3 scripts/update_publications.py`. It uses only the standard library and writes `data/publications.json` and `assets/js/publications-data.js`.
- **Automatic updates:** `.github/workflows/update-publications.yml` runs every Monday and commits only when the list has actually changed. You can also start it from the Actions tab. The optional repository secret `NCBI_API_KEY` raises NCBI's rate limit.
- **Topic tags** (Lung, Pancreatic, Statistical methods, …) are assigned automatically from titles and keywords by the `TOPICS` patterns in the script. Edit those patterns to change the categories.

## Deploying

The site is ready for GitHub Pages: go to **Settings → Pages → Deploy from a branch**, then pick the default branch and the `/ (root)` folder. The `.nojekyll` file makes Pages serve the files as they are. Any other static host also works.

## Customising

- **Photo:** save it as `assets/img/pi.jpg` and follow the comment in `people.html`.
- **Lab members:** there is a commented card template in `people.html`.
- **Contact email:** none has been added yet. Add one to the "Join the lab" section in `people.html` and to the footer.
- **Colours and fonts:** the CSS custom properties at the top of `assets/css/style.css` control them, with matching dark-mode values.
- **Header and footer:** these are repeated in each HTML page, so edit all four pages when you change them.
