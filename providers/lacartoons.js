// LACartoons v0.1.0 — lacartoons.com (caricaturas en español latino)
// Chain: /?Titulo=<q> -> /serie/<id> (seasons as <h4>Temporada N</h4> +
// links containing /capitulo/) -> episode page (iframes inside the
// "serie-video-informacion" block) -> MP4Upload embed -> direct mp4.
// STATUS: UNVERIFIED against live HTML. The authoring sandbox could not reach
// lacartoons.com (egress proxy 403 / URL not on allowlist), so every selector
// below is taken from the working Nuvio scraper (pluggin-latino/providers/
// lacartoons.js: ?Titulo= search, /serie/<n>, "nombre-serie", /capitulo/ links,
// "serie-video-informacion", <h4>Temporada N</h4>), not from fetched markup.
// Cover/description selectors are generic fallbacks (og: meta, img tags).
// Only MP4Upload (plain HTTP, same resolver as animejl.js) is implemented.
// Skipped: Filemoon/Luna (captcha + attestation), Doodstream, RPM-style hosts
// (JS-derived keys), AES/GCM payloads, abysscdn — they need JS, ciphers or
// browser challenges. getVideoSources throws a clear Error if no MP4Upload
// embed is found.

var BASE = 'https://lacartoons.com';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function getInfo() {
  return { name: 'LACartoons', lang: 'es', baseUrl: BASE,
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

function _getText(url, headers) {
  var h = { 'User-Agent': UA };
  if (headers) {
    for (var k in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, k)) h[k] = headers[k];
    }
  }
  var p = fetch(url, { headers: h }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.text();
  });
  return _withTimeout(p, 20000, 'GET ' + url);
}

function _decode(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function _stripTags(s) {
  return _decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function _absUrl(href) {
  href = _decode(href);
  if (/^https?:\/\//i.test(href)) return href;
  if (href.indexOf('//') === 0) return 'https:' + href;
  if (href.charAt(0) === '/') return BASE + href;
  return BASE + '/' + href;
}

function _serieId(url) {
  var m = /\/serie\/(\d+)/.exec(url || '');
  return m ? m[1] : null;
}

// Series cards: <a href=".../serie/N"> ... nombre-serie ...>Title<
function _parseCards(html) {
  var out = [];
  var seen = {};
  var re = /<a\s+[^>]*href=["']([^"']*\/serie\/\d+[^"']*)["'][^>]*>([\s\S]{0,600}?)<\/a>/gi;
  var m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var url = _absUrl(m[1]);
    var id = _serieId(url);
    if (!id || seen[id]) continue;
    var tm = /nombre-serie[^>]*>([^<]+)</i.exec(m[2]);
    if (!tm) continue;
    var im = /<img[^>]+(?:data-src|src)=["']([^"']+)["']/i.exec(m[2]);
    seen[id] = true;
    out.push({ id: 'lacartoons:' + id, title: _stripTags(tm[1]), url: url,
               type: 'series', cover: im ? _absUrl(im[1]) : null });
  }
  return out;
}

function getHome(opts) {
  return _getText(BASE + '/').then(function (t) {
    var items = _parseCards(t);
    var rows = [];
    if (items.length) rows.push({ title: 'Series', items: items });
    return rows;
  });
}

function search(query, page, opts) {
  var u = BASE + '/?Titulo=' + encodeURIComponent(query || '');
  return _getText(u).then(function (t) { return _parseCards(t); });
}

function getDetail(url, opts) {
  var id = _serieId(url);
  if (!id) return Promise.reject(new Error('bad detail url'));
  var serieUrl = BASE + '/serie/' + id;
  return _getText(serieUrl).then(function (t) {
    var hm = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(t) ||
             /<meta property=["']og:title["'] content=["']([^"']+)["']/i.exec(t);
    var cm = /<meta property=["']og:image["'] content=["']([^"']+)["']/i.exec(t);
    var dm = /<meta (?:property=["']og:description["']|name=["']description["']) content=["']([^"']*)["']/i.exec(t);
    return { id: 'lacartoons:' + id, title: hm ? _stripTags(hm[1]) : 'Serie ' + id,
             url: serieUrl, type: 'series',
             cover: cm ? _absUrl(cm[1]) : null,
             description: dm ? _decode(dm[1]) : '' };
  });
}

function getEpisodes(url, opts) {
  var id = _serieId(url);
  if (!id) return Promise.reject(new Error('bad detail url'));
  return _getText(BASE + '/serie/' + id).then(function (t) {
    var out = [];
    var counts = {};
    var season = 1;
    var re = /<h4[^>]*>([\s\S]*?)<\/h4>|<a\s+[^>]*href=["']([^"']*\/capitulo\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = re.exec(t)) !== null) {
      if (m[1] !== undefined) {
        var sm = /Temporada\s+(\d+)/i.exec(_stripTags(m[1]));
        if (sm) season = parseInt(sm[1], 10);
        continue;
      }
      var href = _decode(m[2]);
      var label = _stripTags(m[3]);
      var tq = /[?&]t=(\d+)/.exec(href);
      var s = tq ? parseInt(tq[1], 10) : season;
      counts[s] = (counts[s] || 0) + 1;
      var em = /Cap[ií]tulo\s*(\d+)/i.exec(label);
      var ep = em ? parseInt(em[1], 10) : counts[s];
      var n = out.length + 1;
      var capId = /\/capitulo\/(\d+)/.exec(href);
      out.push({ id: 'lacartoons:' + id + ':' + s + ':' + ep + (capId ? ':' + capId[1] : ''),
                 title: 'T' + s + ' E' + ep, url: _absUrl(href), number: n,
                 thumbnail: null });
    }
    if (!out.length) throw new Error('no episodes parsed');
    return out;
  });
}

function getVideoSources(episodeUrl) {
  return _getText(episodeUrl, { Referer: BASE + '/' }).then(function (t) {
    var i = t.indexOf('serie-video-informacion');
    var zone = i >= 0 ? t.slice(i) : t;
    var tags = zone.match(/<iframe\b[^>]*>/gi) || [];
    var embeds = [];
    var others = [];
    tags.forEach(function (tag) {
      var m = /\s(?:data-src|src)=["']([^"']+)["']/i.exec(tag);
      if (!m) return;
      var u = _absUrl(m[1]);
      if (/mp4upload\.com\/embed-/i.test(u)) {
        if (embeds.indexOf(u) === -1) embeds.push(u);
      } else if (others.indexOf(u) === -1) others.push(u);
    });
    if (!embeds.length) {
      throw new Error('no MP4Upload embed on this episode page (' + others.length +
        ' other host(s) need JS/captcha/cipher and are not supported)');
    }
    var chain = Promise.resolve([]);
    embeds.forEach(function (embedUrl) {
      chain = chain.then(function (acc) {
        return _getText(embedUrl, { Referer: episodeUrl }).then(function (et) {
          var sm = /src:\s*"(https:\/\/[^"]*mp4upload[^"]+\/video\.mp4)"/.exec(et);
          if (sm) {
            acc.push({ url: sm[1], label: '[MP4Upload] Latino',
                       container: 'mp4', kind: 'dub',
                       headers: { Referer: embedUrl, 'User-Agent': UA } });
          }
          return acc;
        }, function () { return acc; });
      });
    });
    return chain.then(function (acc) {
      if (!acc.length) throw new Error('MP4Upload embeds yielded no playable URL');
      return acc;
    });
  });
}
