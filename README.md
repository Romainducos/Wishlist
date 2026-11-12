# Wishlist

A personal wishlist app with cloud sync across devices.

## Features

- **Multiple lists** — create as many wishlists as you need, all visible at once
- **Cloud sync** — data saved to Supabase, accessible from any device
- **Per-item fields** — name, price, quantity, URL, image, note, priority (★), and purchased status
- **Auto price** — paste a product link: name, price and image are fetched from the page (`api/scrape.js`); ↻ refreshes one item or a whole list and shows price drops
- **List / grid view** — table for editing, cards with large images for browsing
- **Themes** — Auto, Clair, Sombre, Océan, Forêt, Nord, Sunset, Lavande, Sakura
- **Drag & drop** — reorder items within a list or move them between lists
- **Progress tracking** — total cost, amount saved, estimated time to goal based on monthly savings
- **Offline support** — localStorage cache for instant load, syncs when back online

## Stack

- Vanilla HTML / CSS / JS — no framework
- [Supabase](https://supabase.com) — auth + PostgreSQL database
- [SortableJS](https://sortablejs.github.io/Sortable/) — drag & drop
- [Vercel](https://vercel.com) — hosting + one serverless function (`api/scrape.js`, no dependency)

## Database setup (Supabase)

Run this in the Supabase SQL editor:

```sql
create table wishlists (
  user_id    uuid references auth.users primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table wishlists enable row level security;

create policy "manage_own" on wishlists
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

## Local development

```bash
node dev-server.js
```

Then open `http://localhost:4173` (real account) or `http://localhost:4173/?demo`
(no account, data kept in localStorage, localhost only).

`dev-server.js` serves the static files and mounts `api/scrape.js`, which `npx serve` cannot do.
Locally the scraper skips the Supabase token check; in production it requires a logged-in user.

Some shops (Amazon, Fnac, Decathlon, Lego…) block server-side requests from time to time:
the app then shows an error and the price is typed by hand.

## Deployment

The app auto-deploys to Vercel on every push to `main`.
