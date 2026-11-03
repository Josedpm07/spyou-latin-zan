// CineCalidad v0.1.0 — cinecalidad.vg (peliculas y series, latino / castellano)
// STATUS: markup NOT verified against live HTML. The live site was not
// reachable from the authoring environment (WebFetch allowlist / proxy 403),
// so every selector below is taken from the Nuvio scraper
// (pluggin-latino/providers/cinecalidad.js), which targets the same site.
// Treat as best-effort until tested on a real network.
// Chain (as used by that scraper):
//   /?s=<q>  -> <article class="... item ..."> cards (a href, .in_title, img)
//   /pelicula/<slug>/            movie page
//   /ver-serie/<slug>/ | /serie/<slug>/  series page, <li> with .numerando
//        "S - E" and href .../episodio/<slug>-<S>x<E>/
//   page players: <li data-option="url|base64">, <a data-url="base64">,
//        data-src="base64" -> optional cinecalidad.* interstitial
//        (#btn_enlace href or <iframe>) -> embed host.
// Hosts resolved with plain HTTP: MP4Upload, YourUpload, OK.ru.
// Skipped (need packed-JS unpacking, JS challenges, Altcha, ciphers or a
// browser): StreamWish/VidHide family, Filemoon/Byse, Voe, Doodstream,
// Mixdrop, Vimeos, Embed69, Rpmvid, Nupload. If no resolvable host is on the
// page, getVideoSources throws a clear Error.

var BASE = 'https://www.cinecalidad.vg';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function getInfo() {
  return { name: 'CineCalidad', lang: 'es', baseUrl: BASE,
           logo: BASE + '/favicon.ico', type: 'movie', version: '0.1.0' };
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

function _entities(s) {
  return String(s || '').replace(/&#(\d+);/g, function (_, n) {
    return String.fromCharCode(parseInt(n, 10));
  }).replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function _absUrl(href, base) {
  href = String(href || '');
  base = base || BASE;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.indexOf('//') === 0) return 'https:' + href;
  if (href.charAt(0) === '/') return base.replace(/^(https?:\/\/[^\/]+).*$/, '$1') + href;
  return base.replace(/\/+$/, '') + '/' + href;
}

function _atob(s) {
  try {
    if (typeof atob === 'function') return atob(String(s || '').replace(/\s+/g, ''));
  } catch (e) {}
  return '';
}

function _typeOf(href) {
  if (/\/(?:ver-)?serie\//.test(href)) return 'series';
  if (/\/(?:ver-)?pelicula\//.test(href)) return 'movie';
  return null;
}

function _slugOf(url) {
  var m = /\/(?:ver-)?(?:pelicula|serie|episodio)\/([^\/\?#]+)/.exec(url || '');
  return m ? m[1] : null;
}

function _img(c) {
  var m = /<img[^>]+data-src=["']([^"']+)["']/.exec(c) ||
          /<img[^>]+src=["']([^"']+)["']/.exec(c);
  return m && !/^data:/.test(m[1]) ? _absUrl(m[1]) : null;
}

// <article class="... item ..."> cards (home + search share the markup)
function _parseCards(html) {
  var out = [];
  var seen = {};
  var parts = String(html || '').split(/<article[^>]*class=["'][^"']*\bitem\b/i);
  for (var i = 1; i < parts.length; i++) {
    var c = parts[i];
    var hm = /<a[^>]+href=["']([^"']+)["']/.exec(c);
    if (!hm) continue;
    var href = _absUrl(hm[1]);
    var type = _typeOf(href);
    if (!type) continue;
    var slug = _slugOf(href);
    if (!slug || seen[slug]) continue;
    seen[slug] = true;
    var tm = /class=["'][^"']*in_title[^"']*["'][^>]*>([\s\S]*?)<\/div>/.exec(c);
    var am = /<img[^>]+alt=["']([^"']+)["']/.exec(c);
    var title = tm ? _entities(_stripTags(tm[1])) : (am ? _entities(am[1]) : slug);
    out.push({ id: 'cinecalidad:' + slug, title: title, url: href,
               type: type, cover: _img(c) });
  }
  return out;
}

function getHome(opts) {
  return _getText(BASE + '/').then(function (t) {
    var items = _parseCards(t);
    var movies = [], series = [];
    for (var i = 0; i < items.length; i++) {
      (items[i].type === 'series' ? series : movies).push(items[i]);
    }
    var rows = [];
    if (movies.length) rows.push({ title: 'Películas', items: movies });
    if (series.length) rows.push({ title: 'Series', items: series });
    return rows;
  });
}

function search(query, page, opts) {
  var p = parseInt(page, 10) || 1;
  var q = encodeURIComponent(query || '');
  // WordPress search; page>1 uses the standard /page/N/ prefix (unverified)
  var u = p > 1 ? BASE + '/page/' + p + '/?s=' + q : BASE + '/?s=' + q;
  return _getText(u).then(function (t) { return _parseCards(t); });
}

function _meta(html, prop) {
  var m = new RegExp('<meta[^>]+property=["\']' + prop + '["\'][^>]+content=["\']([^"\']*)["\']', 'i').exec(html) ||
          new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]+property=["\']' + prop + '["\']', 'i').exec(html);
  return m ? _entities(m[1]) : '';
}

function _pageTitle(html, slug) {
  var h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html || '');
  var t = h1 ? _entities(_stripTags(h1[1])) : _meta(html, 'og:title');
  return t || slug;
}

function getDetail(url, opts) {
  var slug = _slugOf(url);
  if (!slug) return Promise.reject(new Error('bad detail url'));
  return _getText(url).then(function (t) {
    return { id: 'cinecalidad:' + slug, title: _pageTitle(t, slug), url: url,
             type: _typeOf(url) || 'movie',
             cover: _meta(t, 'og:image') || null,
             description: _meta(t, 'og:description') };
  });
}

function getEpisodes(url, opts) {
  var slug = _slugOf(url);
  if (!slug) return Promise.reject(new Error('bad detail url'));
  var type = _typeOf(url);
  return _getText(url).then(function (t) {
    var title = _pageTitle(t, slug);
    if (type !== 'series') {
      return [{ id: 'cinecalidad:' + slug, title: title, url: url,
                number: 1, thumbnail: _meta(t, 'og:image') || null }];
    }
    var eps = [];
    var seen = {};
    var lis = t.split(/<li[^>]*>/i);
    for (var i = 1; i < lis.length; i++) {
      var li = lis[i];
      var hm = /<a[^>]+href=["']([^"']*\/episodio\/[^"']+)["']/.exec(li);
      if (!hm) continue;
      var href = _absUrl(hm[1]);
      var s = 0, e = 0;
      var nm = /class=["'][^"']*numerando[^"']*["'][^>]*>([\s\S]*?)<\//.exec(li);
      if (nm) {
        var parts = _stripTags(nm[1]).replace(/[SE]/gi, '').split('-');
        s = parseInt(parts[0], 10);
        e = parseInt(parts[1], 10);
      }
      if (!(s > 0 && e > 0)) {
        var xm = /-(\d+)x(\d+)\/?$/.exec(href);
        if (xm) { s = parseInt(xm[1], 10); e = parseInt(xm[2], 10); }
      }
      if (!(s > 0 && e > 0) || seen[s + 'x' + e]) continue;
      seen[s + 'x' + e] = true;
      eps.push({ s: s, e: e, url: href, thumb: _img(li) });
    }
    if (!eps.length) throw new Error('no episodes parsed from series page');
    eps.sort(function (a, b) { return a.s - b.s || a.e - b.e; });
    var out = [];
    for (var j = 0; j < eps.length; j++) {
      out.push({ id: 'cinecalidad:' + slug + ':' + eps[j].s + 'x' + eps[j].e,
                 title: 'T' + eps[j].s + ' E' + eps[j].e,
                 url: eps[j].url, number: j + 1, thumbnail: eps[j].thumb });
    }
    return out;
  });
}

// ---- player links -------------------------------------------------------

var TRAILER = /youtube\.com|youtu\.be|youtube-nocookie/i;

function _audioOf(label) {
  var s = String(label || '');
  if (/castellano|espa[nñ]ol\s*(?:de\s*)?espa/i.test(s)) return 'Castellano';
  if (/sub/i.test(s)) return 'Sub Español';
  return 'Latino';
}

function _pageLinks(html) {
  var raw = [];
  var m;
  var po = /<li[^>]*data-option=["']([^"']+)["'][^>]*>([\s\S]*?)<\/li>/gi;
  while ((m = po.exec(html)) !== null) {
    if (/dooplay_player_option_trailer/i.test(m[0])) continue;
    var d = /^https?:/.test(m[1]) ? m[1] : _atob(m[1]);
    if (/^https?:/.test(d) && !TRAILER.test(d)) raw.push({ url: d, audio: _audioOf(_stripTags(m[2])) });
  }
  var pu = /<a\b[^>]*data-url=["']([A-Za-z0-9+\/=]{20,})["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = pu.exec(html)) !== null) {
    var d2 = _atob(m[1]);
    if (/^https?:/.test(d2) && !/mediafire/i.test(d2) && !TRAILER.test(d2)) {
      raw.push({ url: d2, audio: _audioOf(_stripTags(m[2])) });
    }
  }
  var ps = /data-src=["']([A-Za-z0-9+\/=]{20,})["']/g;
  while ((m = ps.exec(html)) !== null) {
    var d3 = _atob(m[1]);
    if (/^https?:/.test(d3) && !TRAILER.test(d3)) raw.push({ url: d3, audio: 'Latino' });
  }
  var uniq = [], seen = {};
  for (var i = 0; i < raw.length; i++) {
    if (!seen[raw[i].url]) { seen[raw[i].url] = true; uniq.push(raw[i]); }
  }
  return uniq;
}

// cinecalidad.* interstitial -> real embed URL
function _unwrap(url, referer) {
  if (!/cinecalidad\./i.test(url)) return Promise.resolve(url);
  return _getText(url, { Referer: referer }).then(function (h) {
    var m = /id=["']btn_enlace["'][^>]*>[\s\S]*?href=["']([^"']+)["']/i.exec(h) ||
            /<iframe[^>]+src=["']([^"']+)["']/i.exec(h);
    return m ? _absUrl(m[1], url) : '';
  }, function () { return ''; });
}

function _mk(url, label, kind, referer) {
  return { url: url, label: label, container: /\.m3u8/i.test(url) ? 'hls' : 'mp4',
           kind: kind, headers: { Referer: referer, 'User-Agent': UA } };
}

function _kindOf(audio) { return audio === 'Sub Español' ? 'sub' : 'dub'; }

function _resolveMp4upload(embed, audio, pageUrl) {
  var e = embed.replace(/mp4upload\.com\/(?!embed-)/, 'mp4upload.com/embed-');
  return _getText(e, { Referer: pageUrl }).then(function (t) {
    var m = /src:\s*"(https:\/\/[^"]*mp4upload[^"]+\/video\.mp4)"/.exec(t);
    return m ? [_mk(m[1], '[MP4Upload] ' + audio, _kindOf(audio), e)] : [];
  });
}

function _resolveYourupload(embed, audio, pageUrl) {
  var e = embed.replace('/watch/', '/embed/');
  return _getText(e, { Referer: pageUrl }).then(function (t) {
    var m = /file\s*:\s*['"]([^'"]+)['"]/.exec(t) ||
            /property=["']og:video["'][^>]+content=["']([^"']+)["']/i.exec(t);
    return m ? [_mk(_absUrl(m[1], e), '[YourUpload] ' + audio, _kindOf(audio),
                    'https://www.yourupload.com/')] : [];
  });
}

function _resolveOkru(embed, audio) {
  var im = /(?:videoembed|video)\/([\d-]+)/.exec(embed);
  if (!im) return Promise.resolve([]);
  return _getText('https://ok.ru/videoembed/' + im[1]).then(function (t) {
    var m = /data-options=(["'])(\{[\s\S]+?\})\1/.exec(t);
    if (!m) return [];
    var o = JSON.parse(_entities(m[2]));
    var fv = o.flashvars || {};
    var meta = fv.metadata ? (typeof fv.metadata === 'string' ? JSON.parse(fv.metadata) : fv.metadata) : null;
    if (!meta) return [];
    var order = { ultra: 7, quad: 6, full: 5, hd: 4, sd: 3, low: 2, lowest: 1, mobile: 0 };
    var best = null;
    var vs = meta.videos || [];
    for (var i = 0; i < vs.length; i++) {
      if (vs[i].url && order[vs[i].name] !== undefined &&
          (!best || order[vs[i].name] > order[best.name])) best = vs[i];
    }
    if (best) return [_mk(best.url, '[OK.ru] ' + audio + ' ' + best.name, _kindOf(audio), 'https://ok.ru/')];
    var hls = meta.hlsManifestUrl || meta.ondemandHls;
    return hls ? [_mk(hls, '[OK.ru] ' + audio, _kindOf(audio), 'https://ok.ru/')] : [];
  });
}

function _resolveEmbed(embed, audio, pageUrl) {
  if (/mp4upload/i.test(embed)) return _resolveMp4upload(embed, audio, pageUrl);
  if (/yourupload/i.test(embed)) return _resolveYourupload(embed, audio, pageUrl);
  if (/ok\.ru/i.test(embed)) return _resolveOkru(embed, audio);
  return Promise.resolve([]); // unsupported host (see header)
}

function getVideoSources(episodeUrl) {
  return _getText(episodeUrl).then(function (t) {
    var links = _pageLinks(t);
    if (!links.length) throw new Error('no player links found on page (markup may have changed)');
    var chain = Promise.resolve([]);
    links.forEach(function (l) {
      chain = chain.then(function (acc) {
        return _unwrap(l.url, episodeUrl).then(function (embed) {
          if (!embed) return acc;
          return _resolveEmbed(embed, l.audio, episodeUrl).then(function (r) {
            return acc.concat(r);
          }, function () { return acc; });
        });
      });
    });
    return chain.then(function (acc) {
      if (!acc.length) throw new Error('no supported host (MP4Upload/YourUpload/OK.ru) resolved with plain HTTP');
      return acc;
    });
  });
}
