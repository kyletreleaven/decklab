# Importing a Moxfield binder or collection

Moxfield blocks automated requests — every `moxfield.com` and `api2.moxfield.com`
URL returns `403` from Cloudflare to anything that isn't a real browser, including
the public page itself. DeckLab therefore cannot fetch a binder by URL the way it
can with Archidekt.

What does work: your browser is already allowed to view the page. This procedure
has you export what your own browser received, then converts it offline.

If it is **your** collection, skip all of this — Moxfield's own export gives you a
CSV that DeckLab imports directly (**Import → Open file**). The steps below are
for binders you can view but do not own.

---

## 1. Find the binder id

Open the binder and read it out of the address bar:

```
https://moxfield.com/binders/qZUIEbR7IEuZE6N3-c7swA
                             ^^^^^^^^^^^^^^^^^^^^^^ the id
```

Ignore any `?page=` or `?internal=` on the end. Those drive the page's own
filtering and paging, not the data request.

## 2. Clear any filters

If the URL carries an `internal=` blob, the view is **filtered** and you will only
export what matches. That blob is base64 — for example
`eyJ0eXBlTGluZSI6ImxlZ2VuZGFyeSJ9` decodes to `{"typeLine":"legendary"}`, i.e.
legendary cards only.

Either clear the filters in the UI first, or leave the snippet's `q=` empty as it
is below, which asks for everything regardless of what the page is showing.

## 3. Dump the binder

Open DevTools (`⌘⌥I`) → **Console**, paste this, and set `BINDER` to your id:

```js
const BINDER = "qZUIEbR7IEuZE6N3-c7swA";   // <- change this
const PAGE_SIZE = 100;                     // 50 is the UI default
const all = [];

for (let page = 1; page <= 500; page++) {
  const url = `https://api2.moxfield.com/v1/trade-binders/${BINDER}/search`
    + `?pageNumber=${page}&pageSize=${PAGE_SIZE}`
    + `&sortColumn=cardName&sortType=cardName&sortDirection=ascending`
    + `&playStyle=paperDollars&pricingProvider=cardkingdom&q=`;   // q empty = everything

  const res = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) { console.warn("stopped at page", page, res.status); break; }

  const body = await res.json();
  const rows = body.data ?? body.results ?? body.items ?? [];
  if (!rows.length) break;

  all.push(...rows);
  console.log(`page ${page}: +${rows.length} (total ${all.length})`);
  if (rows.length < PAGE_SIZE) break;
  await new Promise(r => setTimeout(r, 300));   // be polite
}

const a = document.createElement("a");
a.href = URL.createObjectURL(new Blob([JSON.stringify(all)], { type: "application/json" }));
a.download = "moxfield-binder.json";
a.click();
```

It pages until the results run out and downloads `moxfield-binder.json`.

Run it **on the binder page itself** — it relies on that page's own session and
origin. Pasting it into a blank tab will fail CORS.

### If it stops early

- **`403`** — the session lapsed. Reload the binder page and rerun.
- **`400`** — `pageSize=100` was rejected. Drop it back to `50`.
- **Zero rows on page 1** — the endpoint shape has changed. Open DevTools →
  **Network** → filter **Fetch/XHR** → reload, and find the request that returns
  the card list. Its URL replaces the one above.

## 4. Convert it

```bash
python3 scripts/moxfield_binder_to_csv.py data/moxfield-binder.json -o data/binder.csv
```

Standard library only — no packages to install. It prints a summary to stderr:

```
1021 entries · 1536 cards · 1021 unique printings
```

Options:

| Flag | Effect |
| --- | --- |
| `--format text` | Arena-style text instead of CSV |
| `--game all` | keep MTGO/Arena entries too (default: paper only) |
| `--skip-proxies` | drop entries flagged as proxies |
| `-o FILE` | write to a file instead of stdout |

## 5. Import

In DeckLab: **Collections → pick or create one → Import → Open file →**
`data/binder.csv`.

You will get a preview with matched and unmatched counts before anything is
written. Unmatched lines are skipped rather than blocking the import.

---

## Notes

- **Printings are preserved.** The dump carries `card.scryfall_id`, and the CSV
  keeps set code and collector number, so cards resolve to the exact printing
  rather than an arbitrary one.
- **Condition and finish carry over.** `nearMint` → `NM`, `lightlyPlayed` → `LP`,
  and so on; `foil`/`etched` are preserved, `glossy` is treated as foil.
- **Large binders take a while on first import.** Cards resolve against Scryfall
  in batches of 75 with ~100ms spacing, so ~1,000 cards is a minute or two. After
  that they are cached locally and re-imports are instant.
- **This breaks when Moxfield changes their API.** It is an internal endpoint with
  no compatibility guarantee. If the snippet stops working, step 3's "If it stops
  early" notes are the recovery path.
- **Dumps are gitignored.** `data/` holds someone else's collection data; keep it
  out of version control.
