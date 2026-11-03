// SeriesMetro v0.1.0 — www3.seriesmetro.net (series latino / castellano)
// STATUS: PARTIALLY UNVERIFIED. The live site could not be fetched from the
// build environment (egress proxy refused www3.seriesmetro.net), so NO markup
// below was checked against live HTML. Selectors/URLs come from the working
// Nuvio scraper (droydr13/pluggin-latino/providers/seriesmetro.js), which
// shows a WordPress "Toroflix"-style theme:
// Chain: /?s=<q> (<article> cards: a.lnk-blk + .entry-title)
// -> /serie/<slug>/ (data-post id)
// -> POST /wp-admin/admin-ajax.php action=action_select_season&season=N&post=ID
//    (links like .../temporada-N-capitulo-M)
// -> episode page (#options-N iframes / ?trembed= -> host embed).
// Video step: NOT implemented. The host resolvers in the Nuvio file are mostly
// ciphers, Altcha/PoW challenges or JS-packed pages (Filemoon/Byse, Embed69,
// Xupalace, RPM/Vidstack...) that plain HTTP cannot handle; simple hosts
// (mp4upload, ok.ru, streamwish-style, yourupload) could be reused only after
// the embed list is verified on a live episode page. getVideoSources throws.

var BASE = 'https://www3.seriesmetro.net';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function getInfo() {
  return { name: 'SeriesMetro', lang: 'es', baseUrl: BASE,
           logo: BASE + '/favicon.ico', type: 'series', version: '0.1.0' };
}

function _withTimeout(promise, ms, label) {
  if (typeof setTimeout !== 'function' || typeof Promise === 'undefined' || !Promise.race) return promise;
  var t;
  var timeout = new Promise(function (_, reject) {
    t = setTimeout(function () { reject(new Error('timeout: ' + label)); }, ms);
  });
  return Promise.race([promise, timeout]).then(function (v) {
    try { if (typeof clearTimeout === 'function') clearTimeout(t); } catch (e) {}
    return v;
  }, function (e) {
    try { if (typeof clearTimeout === 'function') clearTimeout(t); } catch (e2) {}
    throw e;
  });
}

function _req(url, opts) {
  var h = { 'User-Agent': UA };
  var o = opts || {};
  if (o.headers) {
    for (var k in o.headers) {
      if (Object.prototype.hasOwnProperty.call(o.headers, k)) h[k] = o.headers[k];
    }
  }
  var init = { headers: h };
  if (o.method) init.method = o.method;
  if (o.body) init.body = o.body;
  var p = fetch(url, init).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.text();
  });
  return _withTimeout(p, 20000, (o.method || 'GET') + ' ' + url);
}

function _getText(url, headers) { return _req(url, { headers: headers }); }

function _stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}

function _absUrl(href) {
  href = String(href || '');
  if (/^https?:\/\//i.test(href)) return href;
  if (href.indexOf('//') === 0) return 'https:' + href;
  if (href.charAt(0) === '/') return BASE + href;
  return BASE + '/' + href;
}

function _slugOf(url) {
  var m = /\/serie\/([^\/\?#]+)/.exec(url || '');
  return m ? m[1] : null;
}

// <article> cards (UNVERIFIED markup, from the Nuvio scraper): link
// <a class="lnk-blk" href>, title in an element with class entry-title.
// Only /serie/ links are kept (movies live under /pelicula/).
function _parseCards(html) {
  var out = [];
  var seen = {};
  var parts = String(html || '').split(/<article/i);
  for (var i = 1; i < parts.length; i++) {
    var c = parts[i];
    var hm = /<a[^>]+class=["'][^"']*lnk-blk[^"']*["'][^>]*href=["']([^"']+)["']/i.exec(c) ||
             /<a[^>]+href=["']([^"']+)["'][^>]*class=["'][^"']*lnk-blk/i.exec(c);
    if (!hm) continue;
    var href = _absUrl(hm[1]);
    var slug = _slugOf(href);
    if (!slug || seen[slug]) continue;
    seen[slug] = true;
    var tm = /class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(c);
    var im = /<img[^>]+(?:data-src|src)=["']([^"']+)["']/i.exec(c);
    out.push({ id: 'seriesmetro:' + slug,
               title: tm ? _stripTags(tm[1]) : slug,
               url: BASE + '/serie/' + slug + '/', type: 'series',
               cover: im ? _absUrl(im[1]) : null });
  }
  return out;
}

function getHome(opts) {
  return _getText(BASE + '/').then(function (t) {
    var rows = [];
    var items = _parseCards(t);
    if (items.length) rows.push({ title: 'Series', items: items });
    return rows;
  });
}

function search(query, page, opts) {
  var u = BASE + '/?s=' + encodeURIComponent(query || '');
  return _getText(u).then(function (t) { return _parseCards(t); });
}

function getDetail(url, opts) {
  var slug = _slugOf(url);
  if (!slug) return Promise.reject(new Error('bad detail url'));
  return _getText(BASE + '/serie/' + slug + '/').then(function (t) {
    var tm = /<meta property=["']og:title["'] content=["']([^"']+)["']/i.exec(t) ||
             /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(t);
    var cm = /<meta property=["']og:image["'] content=["']([^"']+)["']/i.exec(t);
    var dm = /<meta property=["']og:description["'] content=["']([^"']*)["']/i.exec(t);
    return { id: 'seriesmetro:' + slug,
             title: tm ? _stripTags(tm[1]) : slug,
             url: BASE + '/serie/' + slug + '/', type: 'series',
             cover: cm ? cm[1] : null,
             description: dm ? _stripTags(dm[1]) : '' };
  });
}

// Episode links come from the theme's season AJAX (see header). Seasons are
// requested 1..30 sequentially until one returns no episode links.
function _season(pageUrl, post, season) {
  return _req(BASE + '/wp-admin/admin-ajax.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
               'X-Requested-With': 'XMLHttpRequest', Origin: BASE, Referer: pageUrl },
    body: 'action=action_select_season&season=' + season + '&post=' + post
  }).then(function (t) {
    var list = [];
    var seen = {};
    var re = /href=["']([^"']+)["']/gi;
    var m;
    while ((m = re.exec(t)) !== null) {
      var n = /temporada-(\d+)-capitulo-(\d+)/i.exec(m[1]) || /temporada\/(\d+)\/capitulo\/(\d+)/i.exec(m[1]);
      if (!n || parseInt(n[1], 10) !== season || seen[m[1]]) continue;
      seen[m[1]] = true;
      list.push({ season: season, ep: parseInt(n[2], 10), url: _absUrl(m[1]) });
    }
    list.sort(function (a, b) { return a.ep - b.ep; });
    return list;
  }, function () { return []; });
}

function getEpisodes(url, opts) {
  var slug = _slugOf(url);
  if (!slug) return Promise.reject(new Error('bad detail url'));
  var pageUrl = BASE + '/serie/' + slug + '/';
  return _getText(pageUrl).then(function (t) {
    var pm = /data-post=["'](\d+)["']/.exec(t);
    if (!pm) throw new Error('data-post not found on series page');
    var all = [];
    function next(s) {
      if (s > 30) return Promise.resolve(all);
      return _season(pageUrl, pm[1], s).then(function (list) {
        if (!list.length) return all;
        all = all.concat(list);
        return next(s + 1);
      });
    }
    return next(1);
  }).then(function (all) {
    if (!all.length) throw new Error('no episodes parsed');
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      out.push({ id: 'seriesmetro:' + slug + ':s' + e.season + 'e' + e.ep,
                 title: 'T' + e.season + ' E' + e.ep,
                 url: e.url,
                 number: i + 1,
                 thumbnail: null });
    }
    return out;
  });
}

function getVideoSources(episodeUrl) {
  return Promise.reject(new Error(
    'SeriesMetro: video resolution not implemented. The site could not be ' +
    'reached during development, so the embed list and host chain are unverified; ' +
    'known hosts mostly require JS challenges/ciphers that plain HTTP cannot solve.'));
}
