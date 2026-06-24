# Wishlist

A personal wishlist app with cloud sync across devices.

## Features

- **Multiple lists** — create as many wishlists as you need, all visible at once
- **Cloud sync** — data saved to Supabase, accessible from any device
- **Per-item fields** — name, price, quantity, URL, note, priority (★), and purchased status
- **Drag & drop** — reorder items within a list or move them between lists
- **Progress tracking** — total cost, amount saved, estimated time to goal based on monthly savings
- **Offline support** — localStorage cache for instant load, syncs when back online

## Stack

- Vanilla HTML / CSS / JS — no framework
- [Supabase](https://supabase.com) — auth + PostgreSQL database
- [SortableJS](https://sortablejs.github.io/Sortable/) — drag & drop
- [Vercel](https://vercel.com) — hosting

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
npx serve .
```

Then open `http://localhost:3000`.

## Deployment

The app auto-deploys to Vercel on every push to `main`.
