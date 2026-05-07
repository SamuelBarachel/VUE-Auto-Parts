# VUE Auto Parts

Static website for VUE Auto Parts, a Zimbabwean auto parts retail and distribution shop focused on Honda Fit, Toyota Corolla, Toyota Wish, Toyota Probox, tyres, engine oils, and universal parts.

The public inventory search reads only the `Master-Inventory-&-Location` Google Sheets tab through a CSV feed. Other internal tabs are not used by the website.

## Local preview

Run the same Node server Render uses:

```bash
npm start
```

Then visit `http://localhost:8080`.

## Render deployment

The AI helper needs a server so the Groq API key stays private. Deploy this repository on Render as a **Web Service**, not as a Static Site.

Use these Render settings:

```text
Runtime: Node
Branch: main
Root Directory: leave blank
Build Command: npm install
Start Command: npm start
```

Add these environment variables:

```text
GROQ_API_KEY=<your Groq key>
GROG_MODEL=<your Groq model>
```

The server also accepts `GROQ_MODEL` if you prefer the corrected spelling.
