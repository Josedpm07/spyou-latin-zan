// TioAnime v0.1.0 — tioanime.com (anime sub español / latino)
// STATUS: PARTIALLY UNVERIFIED. The live site could not be fetched when this
// was written (WebFetch not allowlisted, direct HTTPS blocked by the proxy),
// so no selector below was checked against live HTML. Everything here comes
// from the URL/regex patterns of the Nuvio scraper (pluggin-latino/tioanime.js):
// Chain: POST /api/search (value=<q>, JSON [{title,slug}]) and
//        /directorio?q=<q> (<article class="anime"> ... <h3>)
//     -> /anime/<slug>
//     -> /ver/<slug>-<N> ("var videos = [...]" array containing embed URLs)
//     -> MP4Upload embed -> direct mp4 (same resolver as animejl.js).
// getEpisodes is NOT implemented: the episode list markup of /anime/<slug>
// was never seen, so it throws instead of guessing.
// Only MP4Upload is resolved (plain HTTP). Skipped: hosts needing JS
// challenges, Altcha, ciphers or a browser.

var BASE = 'https://tioanime.com';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function getInfo() {
  return { name: 'TioAnime', lang: 'es', baseUrl: BASE,
           logo: BASE + '/favicon.ico', type: 'anime', version: '0.1.0' };
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

function _stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function _absUrl(href) {
  href = String(href || '');
  if (/^https?:\/\//i.test(href)) return href;
  if (href.charAt(0) === '/') return BASE + href;
  return BASE + '/' + href;
}

function _slugOf(url) {
  var m = /\/anime\/([^\/\?#]+)/.exec(url || '');
  return m ? m[1] : null;
}

// <article class="anime"> cards (pattern taken from the Nuvio scraper)
function _parseCards(html) {
  var out = [];
  var seen = {};
  var re = /<article class=["']anime["']>[\s\S]*?href=["']([^"']+)["'][\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/g;
  var m;
  while ((m = re.exec(html || '')) !== null) {
    var href = _absUrl(m[1]);
    var slug = _slugOf(href);
    if (!slug || seen[slug]) continue;
    seen[slug] = true;
    out.push({ id: 'tioanime:' + slug, title: _stripTags(m[2]), url: href,
               type: 'anime', cover: null });
  }
  return out;
}

function getHome(opts) {
  return _getText(BASE + '/directorio').then(function (t) {
    var items = _parseCards(t);
    return items.length ? [{ title: 'Directorio', items: items }] : [];
  });
}

function search(query, page, opts) {
  var q = query || '';
  var api = fetch(BASE + '/api/search', {
    method: 'POST',
    headers: { 'User-Agent': UA,
               'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
               'X-Requested-With': 'XMLHttpRequest', Referer: BASE + '/' },
    body: 'value=' + encodeURIComponent(q)
  }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function (j) {
    var out = [];
    var arr = Object.prototype.toString.call(j) === '[object Array]' ? j : [];
    for (var i = 0; i < arr.length; i++) {
      if (!arr[i] || !arr[i].slug) continue;
      out.push({ id: 'tioanime:' + arr[i].slug, title: String(arr[i].title || arr[i].slug),
                 url: BASE + '/anime/' + arr[i].slug, type: 'anime', cover: null });
    }
    return out;
  }).then(null, function () { return []; });
  return _withTimeout(api, 20000, 'search api').then(function (list) {
    if (list.length) return list;
    return _getText(BASE + '/directorio?q=' + encodeURIComponent(q).replace(/%20/g, '+'))
      .then(function (t) { return _parseCards(t); });
  });
}

function getDetail(url, opts) {
  var slug = _slugOf(url);
  if (!slug) return Promise.reject(new Error('bad detail url'));
  return _getText(BASE + '/anime/' + slug).then(function (t) {
    var tm = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(t);
    var cm = /<meta property=["']og:image["'] content=["']([^"']+)["']/.exec(t);
    var dm = /<meta property=["']og:description["'] content=["']([^"']*)["']/.exec(t);
    return { id: 'tioanime:' + slug, title: tm ? _stripTags(tm[1]) : slug,
             url: BASE + '/anime/' + slug, type: 'anime',
             cover: cm ? _absUrl(cm[1]) : null, description: dm ? dm[1] : '' };
  });
}

function getEpisodes(url, opts) {
  return Promise.reject(new Error(
    'TioAnime getEpisodes not implemented: episode list markup of /anime/<slug> was not verified against live HTML'));
}

function getVideoSources(episodeUrl) {
  return _getText(episodeUrl, { Referer: BASE + '/' }).then(function (t) {
    var block = (/var videos = (\[[\s\S]*?\]);/.exec(t) || [])[1] || '';
    var urls = block.replace(/\\\//g, '/').match(/https?:\/\/[^"'\s\]]+/g) || [];
    var kind = /latino/i.test(t) ? 'dub' : 'sub';
    var embeds = [];
    for (var i = 0; i < urls.length; i++) {
      if (/mp4upload\.com\/embed-/i.test(urls[i]) && embeds.indexOf(urls[i]) === -1) embeds.push(urls[i]);
    }
    if (!embeds.length) throw new Error('no MP4Upload server on this episode page');
    var chain = Promise.resolve([]);
    embeds.forEach(function (embedUrl) {
      chain = chain.then(function (acc) {
        return _getText(embedUrl, { Referer: episodeUrl }).then(function (et) {
          var sm = /src:\s*"(https:\/\/[^"]*mp4upload[^"]+\/video\.mp4)"/.exec(et);
          if (sm) {
            acc.push({ url: sm[1], label: '[MP4Upload] ' + (kind === 'dub' ? 'Latino' : 'Sub Español'),
                       container: 'mp4', kind: kind,
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
