# Plan : Wishlist v2 (images, thèmes, prix auto)

## Objectif
Passer d'un tableau texte à un site plus complet : image par article, thèmes de couleur,
vue grille, et récupération automatique du prix / du nom / de l'image depuis le lien.

## Contrainte technique
Un navigateur ne peut pas lire la page d'un autre site (CORS). Il faut donc un bout de
code **côté serveur** qui va chercher la page et en extrait les infos. Le site est déjà
hébergé sur Vercel : un fichier dans `api/` devient une fonction serverless, sans rien
installer ni configurer.

## Étapes

### 1. Scraper : `api/scrape.js`
- `GET /api/scrape?url=…` renvoie `{ title, price, currency, image, site, guess }`.
- Sources lues, dans l'ordre : JSON-LD `Product` (le plus fiable), balises
  `og:` / `product:price:amount`, sélecteurs Amazon, microdata `itemprop="price"`,
  puis en dernier recours un `"price": …` trouvé dans la page (`guess: true`).
- Garde-fous : http(s) seulement, refus des IP privées (anti-SSRF), redirections
  suivies à la main et revérifiées, timeout 8 s, 2 Mo max, jeton Supabase exigé
  (sinon n'importe qui se sert de l'endpoint comme proxy).
- Zéro dépendance (fetch natif de Node), donc pas de `package.json`.

### 2. Dev local : `dev-server.js`
- `npx serve` ne sait pas exécuter `api/`. Petit serveur Node qui sert les fichiers
  statiques + monte `api/scrape.js` (sans vérif du jeton en local).
- `http://localhost:4173/?demo` : mode démo sans compte (localStorage seul),
  uniquement sur localhost.

### 3. Modèle de données
- Article : `image`, `imageAuto`, `prevPrice`, `priceCheckedAt`.
- État : `settings: { theme, view }` (synchronisé avec le reste dans Supabase).
- `migrate()` complète les anciennes données, rien à faire côté base.

### 4. Prix auto dans l'interface
- Coller un lien remplit nom, prix et image si ces champs sont vides.
- Bouton ↻ par article, et ↻ par liste (« actualiser tous les prix »).
- Si le prix a bougé : badge ↓ / ↑ avec l'écart, l'ancien prix reste en mémoire.

### 5. Images
- Miniature dans la vue liste, clic = agrandir.
- Champ « URL de l'image » dans le détail de l'article (···) pour la mettre à la main.

### 6. Vue grille
- Bascule liste / grille à côté de la recherche. Cartes avec grande image.
- Les listes partagées s'ouvrent en grille, en lecture seule.

### 7. Thèmes
- Auto, Clair, Sombre, Océan, Forêt, Nord, Sunset, Lavande, Sakura.
- Variables CSS par `data-theme`, appliqué avant le premier rendu (pas de flash).

### 8. Service worker
- Passage en « réseau d'abord, cache en secours » : plus besoin de bumper la version
  du cache à chaque déploiement, et `/api/` n'est jamais mis en cache.

## Limites connues
- Amazon, Fnac, Leboncoin et quelques autres bloquent souvent les serveurs (anti-bot).
  Dans ce cas : message d'erreur et saisie manuelle, comme avant.
- Les images sont des liens vers le site marchand : si le marchand change l'URL,
  l'image disparaît (↻ la récupère à nouveau).
