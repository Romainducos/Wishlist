// GET /api/scrape?url=https://…
// Va chercher une page produit et en extrait { title, price, currency, image, site }.
// Fonction serverless Vercel, CommonJS, sans dépendance.

const dns = require('node:dns').promises;
const net = require('node:net');

const SUPABASE_URL = 'https://rlifarrxzugydbfzmhyz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_azmlH82WQ5dKOZ0gmEv7YA_P3m8l3MZ';

const TIMEOUT_MS = 8000;
const MAX_BYTES  = 3_000_000;
const MAX_HOPS   = 5;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function httpErr(status, message) {
  return Object.assign(new Error(message), { status });
}

// ── Sécurité ──────────────────────────────────────────────────

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168);
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) {
    const tail = v.slice(7);
    return net.isIPv4(tail) ? isPrivateIp(tail) : true;
  }
  return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
}

// Refuse tout ce qui ne pointe pas vers une adresse publique (anti-SSRF).
async function assertPublic(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw httpErr(400, 'Lien invalide.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addrs;
  try {
    addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  } catch {
    throw httpErr(400, 'Site introuvable.');
  }
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw httpErr(400, 'Lien non autorisé.');
}

async function checkAuth(req) {
  const auth = req.headers.authorization || '';
  if (!/^Bearer .+/.test(auth)) throw httpErr(401, 'Connexion requise.');
  const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: SUPABASE_KEY, Authorization: auth },
    signal: AbortSignal.timeout(4000)
  });
  if (!res.ok) throw httpErr(401, 'Session expirée, reconnecte-toi.');
}

// ── Téléchargement ────────────────────────────────────────────

async function fetchHtml(startUrl) {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let url = new URL(startUrl);

  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: 'manual', signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.6'
      }
    });

    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      await res.body?.cancel();
      url = new URL(loc, url);
      continue;
    }
    if (res.status === 403 || res.status === 429 || res.status === 503)
      throw httpErr(502, 'Ce site bloque la récupération automatique.');
    if (!res.ok) throw httpErr(502, `Le site a répondu ${res.status}.`);

    const type = res.headers.get('content-type') || '';
    if (type && !/html|xml/i.test(type)) throw httpErr(415, "Ce lien n'est pas une page web.");

    const chunks = [];
    let total = 0;
    const reader = res.body.getReader();
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    reader.cancel().catch(() => {});

    const charset = (type.match(/charset=([\w-]+)/i) || [])[1] || 'utf-8';
    let decoder;
    try { decoder = new TextDecoder(charset); } catch { decoder = new TextDecoder('utf-8'); }
    return { html: decoder.decode(Buffer.concat(chunks)), finalUrl: url.href };
  }
  throw httpErr(502, 'Trop de redirections.');
}

// ── Extraction ────────────────────────────────────────────────

const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', euro: '€' };

function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function clean(s, max = 160) {
  const t = decodeEntities(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

// "1 299,99 €", "1,299.99", "12€99", 1299.9 → nombre, sinon null
function parsePrice(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null;

  let s = decodeEntities(String(v)).replace(/[\s  ]/g, '');
  const euroMid = s.match(/(\d+)€(\d{2})(?!\d)/);
  if (euroMid) return parseFloat(euroMid[1] + '.' + euroMid[2]);

  s = (s.match(/\d[\d.,]*/) || [''])[0].replace(/[.,]+$/, '');
  if (!s) return null;

  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    const dec = lastComma > lastDot ? ',' : '.';
    s = s.split(dec === ',' ? '.' : ',').join('').replace(dec, '.');
  } else if (lastComma > -1 || lastDot > -1) {
    const sep = lastComma > -1 ? ',' : '.';
    const parts = s.split(sep);
    // "1.299" ou "1,299,000" : séparateur de milliers ; "12,99" : décimales
    const thousands = parts.length > 2 || (parts[1].length === 3 && parts[0].length <= 3);
    s = thousands ? parts.join('') : parts.join('.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function parseMetas(html) {
  const metas = new Map();
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};
    const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let m;
    while ((m = re.exec(tag))) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
    const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    if (key && attrs.content && !metas.has(key)) metas.set(key, attrs.content);
  }
  return metas;
}

const PRODUCT_TYPES = /^(Product|ProductGroup|IndividualProduct|ProductModel|Book|VideoGame|Vehicle|Car)$/i;

function findProducts(html) {
  const found = [];
  const names = new Set();
  const walk = (node, depth, variant) => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) { node.forEach(n => walk(n, depth + 1, variant)); return; }
    if (typeof node !== 'object') return;
    const types = [].concat(node['@type'] || []).map(t => String(t).replace(/^.*[/:#]/, ''));
    if (types.some(t => PRODUCT_TYPES.test(t))) {
      found.push(node);
      if (!variant && typeof node.name === 'string') names.add(node.name);
    }
    walk(node['@graph'], depth + 1, variant);
    walk(node.mainEntity, depth + 1, variant);
    walk(node.hasVariant, depth + 1, true);
  };
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try { walk(JSON.parse(m[1].trim()), 0, false); } catch { /* JSON-LD cassé : on ignore */ }
  }
  // Plus de deux produits différents : c'est une page de catégorie, pas une fiche produit.
  return names.size > 2 ? [] : found;
}

function offerPrice(offers, depth = 0) {
  for (const o of [].concat(offers || [])) {
    if (!o || typeof o !== 'object') continue;
    const spec = [].concat(o.priceSpecification || [])[0] || {};
    for (const cand of [o.price, o.lowPrice, spec.price]) {
      const price = parsePrice(cand);
      if (price == null) continue;
      // Fourchette de prix (plusieurs vendeurs ou variantes) : on prend le plus bas, à vérifier.
      const range = cand === o.lowPrice && o.price == null && parsePrice(o.highPrice) !== price;
      return { price, currency: String(o.priceCurrency || spec.priceCurrency || ''), guess: range };
    }
    if (o.offers && depth < 3) {
      const nested = offerPrice(o.offers, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function pickImage(img) {
  const first = [].concat(img || [])[0];
  if (!first) return '';
  if (typeof first === 'string') return first;
  return String(first.url || first.contentUrl || '');
}

function extract(html, pageUrl) {
  const metas = parseMetas(html);
  const meta = (...keys) => { for (const k of keys) if (metas.get(k)) return metas.get(k); return ''; };
  const host = new URL(pageUrl).hostname.replace(/^www\./, '');
  const out = { title: '', price: null, currency: '', image: '', site: host, guess: false };
  let m;

  // 1. JSON-LD (schema.org Product) : la source la plus fiable
  for (const p of findProducts(html)) {
    if (!out.title && typeof p.name === 'string') out.title = p.name;
    if (!out.image) out.image = pickImage(p.image);
    if (out.price == null) {
      const o = offerPrice(p.offers);
      if (o) { out.price = o.price; out.currency = o.currency; out.guess = !!o.guess; }
    }
  }

  // 2. Balises meta (OpenGraph / product)
  if (out.price == null) {
    const p = parsePrice(meta('product:price:amount', 'og:price:amount', 'product:sale_price:amount', 'price'));
    if (p != null) {
      out.price = p;
      out.currency = meta('product:price:currency', 'og:price:currency', 'pricecurrency');
    }
  }
  if (!out.title) out.title = meta('og:title', 'twitter:title');
  if (!out.image) out.image = meta('og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src');

  // 3. Amazon (pas de JSON-LD ni d'OpenGraph)
  if (/(^|\.)amazon\./.test(host)) {
    if (/api-services-support@amazon|\/errors\/validateCaptcha/i.test(html))
      throw httpErr(502, 'Amazon bloque la récupération automatique.');
    if ((m = html.match(/id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i))) out.title = m[1];
    if (out.price == null) {
      // On ne lit que le bloc prix du produit : ailleurs dans la page, ce sont d'autres articles.
      const core = html.search(/id=["'](?:corePriceDisplay_desktop_feature_div|corePrice_feature_div|corePrice_desktop|apex_desktop)["']/);
      const zone = core > -1 ? html.slice(core, core + 8000) : '';
      m = zone.match(/"priceAmount"\s*:\s*([\d.]+)/) || zone.match(/class=["']a-offscreen["'][^>]*>([^<]+)</);
      const p = m && parsePrice(m[1]);
      if (p != null) { out.price = p; out.currency = /€|EUR/.test(m[1]) || /\.(fr|de|it|es|nl|com\.be)$/.test(host) ? 'EUR' : ''; }
    }
    if (!out.image && (m = html.match(/data-old-hires=["']([^"']+)["']/i) ||
                           html.match(/id=["']landingImage["'][^>]*\bsrc=["']([^"']+)["']/i))) out.image = m[1];
  }

  // 4. Microdata hors balise meta
  if (out.price == null) {
    m = html.match(/itemprop=["']price["'][^>]*\bcontent=["']([^"']+)["']/i) ||
        html.match(/\bcontent=["']([^"']+)["'][^>]*itemprop=["']price["']/i);
    const p = m && parsePrice(m[1]);
    if (p != null) {
      out.price = p;
      const cur = html.match(/itemprop=["']priceCurrency["'][^>]*\bcontent=["']([A-Za-z]{3})["']/i);
      if (cur) out.currency = cur[1];
    }
  }

  // 5. Dernier recours : un "price": … dans les données embarquées de la page
  if (out.price == null) {
    m = html.match(/"(?:price|salePrice|currentPrice|finalPrice)"\s*:\s*"?(\d{1,6}(?:[.,]\d{1,2})?)"?\s*[,}]/i);
    const p = m && parsePrice(m[1]);
    if (p != null && p > 0) { out.price = p; out.guess = true; }
  }

  if (!out.title && (m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i))) out.title = m[1];

  out.title = clean(out.title);
  out.currency = String(out.currency || '').toUpperCase().slice(0, 3);
  if (out.image) {
    try {
      const img = new URL(decodeEntities(out.image).trim(), pageUrl);
      out.image = /^https?:$/.test(img.protocol) ? img.href : '';
    } catch { out.image = ''; }
  }
  return out;
}

// ── Handler ───────────────────────────────────────────────────

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') throw httpErr(405, 'Méthode non autorisée.');
    const target = new URL(req.url, 'http://localhost').searchParams.get('url') || '';
    let url;
    try { url = new URL(target.trim()); } catch { throw httpErr(400, 'Lien invalide.'); }

    if (process.env.SCRAPE_NO_AUTH !== '1') await checkAuth(req);

    const { html, finalUrl } = await fetchHtml(url.href);
    const data = extract(html, finalUrl);
    if (!data.title && data.price == null && !data.image)
      throw httpErr(422, 'Rien trouvé sur cette page.');
    send(res, 200, data);
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError')
      return send(res, 504, { error: 'Le site met trop de temps à répondre.' });
    if (e.status) return send(res, e.status, { error: e.message });
    console.error('scrape:', e);
    send(res, 502, { error: 'Impossible de lire cette page.' });
  }
};

module.exports.extract = extract;
module.exports.parsePrice = parsePrice;
