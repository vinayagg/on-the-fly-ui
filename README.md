# On the fly

**Prompt → metadata → working CRUD app. Saved apps run without AI.**

A local proof of concept for applications that take shape as you use them.
Objects, relationships, retrieval recipes, dashboards and layouts are data.
One fixed runtime renders and operates all of them. No per-app code, endpoints,
SQL schemas, templates or widgets are generated.

## Run locally

Requires Node.js 24+ and Python 3.9+. No Go toolchain, database service or sign-in.

```sh
npm ci --ignore-scripts
npm run setup
npm start
```

Open **http://127.0.0.1:8090**. Click **Explore sales example** to load optional
sample metadata and fictional records, with dates relative to today. The app
starts empty; the example is JSON, not a hardcoded business screen or simulated AI.
The same renderers handle new objects and screens from any valid metadata.

Setup downloads PocketBase 0.40.4, verifies its release checksum, and copies the
AMIS 6.13.0 SDK locally. After setup, browsing, editing and reopening saved apps
works without an internet connection. The default launcher binds to localhost.
PocketBase also exposes its own optional admin console; the demo never needs it.

## Connect a model

Copy `.env.example` to `.env`, set an OpenAI-compatible **chat completions** base
URL, model ID and optional API key, then restart `npm start`:

```dotenv
LLM_BASE_URL=http://127.0.0.1:11434/v1
LLM_MODEL=your-installed-model
LLM_API_KEY=
```

The base URL must end before `/chat/completions`. A local server or a hosted
compatible provider works. Model availability and JSON generation quality depend
on that provider. Credentials stay on the server and `.env` is ignored by Git.
Only the **Build with AI** action calls the model. It receives the prompt, the
metadata contract and existing metadata; database records are not sent.

The generated candidate is validated, saved atomically and displayed immediately.
Invalid outputs leave the active app unchanged. There is no hidden
model fallback during normal operation. The footer counts provider attempts since
the server started; even failed attempts count. A missing configuration is shown
explicitly, and example loading is not counted as AI generation.

Try these prompts:

1. “Create a CRM with companies, sales and opportunities. Sales have a name,
   amount, date and payment status. Opportunities have a name, amount, stage and
   expected close date. Link both to companies. Draw a dashboard with sales from
   the last 30 days, open opportunities, sales total, pipeline value and pipeline
   by stage.”
2. “Create an inventory app with products, suppliers, stock quantities and
   reorder levels. Link products and suppliers many-to-many. Show a products
   table, total product count and total stock quantity.”
3. “Put opportunities first, change recent sales to the last 7 days and make
   the tables full width. Preserve existing objects and data.”

Newly created apps have empty records until you add data through their forms.

## What is implemented

| Layer | Existing component | Small custom part |
| --- | --- | --- |
| Database and HTTP server | [PocketBase](https://github.com/pocketbase/pocketbase), MIT; embedded SQLite | Fixed collections and virtual-object API |
| Metadata validation | [Ajv](https://github.com/ajv-validator/ajv), MIT | Reference, type, uniqueness and relationship checks |
| UI, forms, tables and charts | [AMIS](https://github.com/baidu/amis), Apache-2.0 | Restricted metadata → built-in widget mapping |
| AI creation | Configurable compatible model endpoint | Prompt → JSON → validation → versioned save |

AMIS replaces HTMX in this implementation because it already supplies the schema
renderer and widgets. The model outputs our restricted JSON format, never raw
AMIS schemas, JavaScript adapters, URLs or HTML. Ajv compiles the **fixed contract**
inside the runtime; it does not generate application functionality from prompts.

The four application collections are created once:

- `definitions`: current workspace configuration and revision number.
- `records`: logical object ID and JSON field values.
- `links`: relationship ID and source/target record IDs.
- `revisions`: immutable snapshots of previous configurations.

PocketBase creates its own internal system tables too. Creating a new virtual
object never creates or alters a physical SQLite table.

Supported fields: text, numbers, dates, booleans and selections; required and
unique constraints. Links support one-to-many (one parent per target) and
many-to-many. Endpoints, duplicates and cardinality are checked transactionally;
deleting a record removes its links. Saved query references prevent deletion
until the query is changed.

Queries support field projection, search, sorting, pagination, equality,
inequality, substring and numeric/date range filters, relative dates, count,
sum, grouping, and one-hop related-record filtering. “Last N days” includes
today and excludes future dates, using UTC calendar days. Aggregate queries
process all matching records before presentation pagination.

Screens arrange existing **table**, **metric** and **bar chart** widgets on a
12-column grid. Object definitions generate CRUD forms and data views.
Relationship definitions generate link pickers and lists. Widgets and business
algorithms cannot be created by the model in this demo.

**Customize view** lets you reorder/resize widgets and edit their query JSON.
**Edit metadata** exposes all object, query and screen definitions, plus revision
history. Loading an old revision and saving creates a new revision. Changes that
invalidate existing records or links are rejected; there are no silent coercions,
destructive schema migrations or automatic data rewrites. Concurrent metadata
edits use a version check. Records use last-write-wins updates.

## Verification and size

```sh
npm test
npm run count
```

The integration test starts an isolated PocketBase and a **stub** compatible
model endpoint. It checks CRUD, validation, uniqueness under concurrent writes,
cardinality, linking, filters, projections, aggregates, metadata revisions and
stale-write rejection. It generates and saves a new virtual object and dashboard,
compares physical database schemas, restarts with the model disconnected, and
verifies saved views and data operations still work. It also checks the local
request boundary and rejection of executable metadata.

The stub verifies the adapter and lifecycle; it does not verify a real model's
output quality. Browser flows are additionally checked with Playwright.

The implementation is **701 source lines**, plus **154 lines of declarative JSON**
(the contract and sample data). Run the counter for the current checkout.
The line counter includes our application, HTML, CSS, tests and setup scripts,
including blank lines and comments. It reports JSON contract and example-data
lines separately. Dependency source, lockfiles and documentation are not custom
application code. No app code is hidden in metadata.

## Deliberate limits

This is a single-user local proof of concept: no deployment or authentication
flow. Generic collection APIs are locked; the public demo API only accepts local
hosts and same-origin browser writes. Keep the default localhost binding.

Queries and integrity checks scan records in memory, with a 5,000-record limit per
object; this is not a scale benchmark. Use indexed database queries when scaling.
There are no cross-object aggregate joins, computed formulas, currency rounding
rules, background jobs, generated backend code or generated widgets. Number
fields use ordinary JavaScript numbers, not an accounting money type. Use Refresh
to refresh all dashboard widgets after edits. Configuration history does not
version or back up record data. Back up `pb_data/` separately if the data matters.

Source is MIT; upstream dependencies retain their own licenses. Runtime files,
downloaded binaries, credentials and screenshots are excluded from the repository.
