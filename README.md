# VUE Auto Parts

Static website for VUE Auto Parts, a Zimbabwean auto parts retail and distribution shop focused on Honda Fit, Toyota Corolla, Toyota Wish, Toyota Probox, tyres, engine oils, and universal parts.

The public inventory search reads only the `Master-Inventory-&-Location` Google Sheets tab through a CSV feed. Other internal tabs are not used by the website.

## Local preview

Open `index.html` in a browser, or run a tiny local server:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## GitHub Pages

The `.github/workflows/pages.yml` workflow deploys the static site from the repository root whenever changes are pushed to `main`.
