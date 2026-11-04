// Zaisma Pro's guild seal (npm run guild-seal): the source of the images and videos in brand/. After Baltic guild seals, flat and facing front: the real Z on an anvil, a forged iron sun behind it, hammer and tongs in
// a Gothic quatrefoil, oak in the corners, one line of words round the rim. Every shade is a line.
window.zSeal = (function () {
  var uid = 0, TAU = Math.PI * 2;
  var n2 = function (n) { return Math.round(n * 100) / 100; };
  var polar = function (rad, t) { return [n2(Math.cos(t) * rad), n2(Math.sin(t) * rad)]; };
  var each = function (n, fn) { var out = ""; for (var i = 0; i < n; i++) out += fn(i, i / n * TAU); return out; };
  var at = function (x, y, rot, s, body) { return '<g transform="translate(' + n2(x) + " " + n2(y) + ") rotate(" + n2(rot || 0) + ") scale(" + (s || 1) + ')">' + body + "</g>"; };
  var line = function (x1, y1, x2, y2, w, c) { return '<path d="M' + n2(x1) + " " + n2(y1) + "L" + n2(x2) + " " + n2(y2) + '" stroke="' + (c || "var(--a)") + '" stroke-width="' + w + '" stroke-linecap="round" fill="none"/>'; };
  var ring = function (rad, w, c, cls) { return '<circle' + (cls ? ' class="' + cls + '"' : '') + ' transform="rotate(-90)" r="' + rad + '" fill="none" stroke="' + (c || "var(--a)") + '" stroke-width="' + w + '"/>'; };
  var dot = function (x, y, rad, c) { return '<circle cx="' + n2(x) + '" cy="' + n2(y) + '" r="' + rad + '" fill="' + (c || "var(--a)") + '"/>'; };

  // Julius's Z, its three shards unchanged (scripts/brand.mjs).
  var Z_SHARDS = [[[1884.08, 3033.91], [4187.01, 3033.91], [4286.71, 3778.62], [0, 3778.62]], [[415.6, 3484.54], [2523.65, 1440.22], [3772.16, 945.05], [1949.08, 2877.19]], [[835.12, 1305.06], [899.94, 721.38], [4047.84, 721.38], [2575.7, 1305.06]]];
  function realZ(width, shards, halo) {
    var s = width / 4286.71;
    return (shards || Z_SHARDS).map(function (shard, i) { var points = shard.map(function (p) { return n2((p[0] - 2143.35) * s) + "," + n2((p[1] - 2250) * s); }).join(" "); return '<g class="z-shard" data-i="' + i + '">' + (halo ? '<polygon points="' + points + '" fill="var(--c)" stroke="var(--c)" stroke-width="' + halo + '" stroke-linejoin="round"/>' : "") + '<polygon points="' + points + '" fill="var(--a)"/></g>'; }).join("");
  }

  function rosette(s, c) { return each(5, function (i, t) { var p = polar(s * .55, t - Math.PI / 2); return dot(p[0], p[1], s * .42, c); }) + dot(0, 0, s * .28, "var(--c)"); }

  // An oak leaf, lobed down both edges, its veins cut in.
  function oakLeaf(l) {
    var lobes = 4, side = function (s) { var d = ""; for (var i = 0; i < lobes; i++) { var a = l * (i + .05) / lobes, b = l * (i + 1) / lobes, w = l * .3 * Math.sin(Math.PI * (i + .75) / (lobes + .6)); d += "Q" + n2((a + b) / 2 + l * .05) + " " + n2(s * w * 1.5) + " " + n2(b - l * .02) + " " + n2(s * w * .42); } return d; };
    var up = side(-1), veins = "";
    for (var i = 0; i < lobes; i++) { var x = l * (i + .35) / lobes, w = l * .24 * Math.sin(Math.PI * (i + .75) / (lobes + .6)); veins += line(x, 0, x + l * .1, -w, .9, "var(--c)") + line(x, 0, x + l * .1, w, .9, "var(--c)"); }
    var down = ""; for (var j = lobes - 1; j >= 0; j--) { var a = l * (j + .05) / lobes, b = l * j / lobes, w2 = l * .3 * Math.sin(Math.PI * (j + .75) / (lobes + .6)); down += "Q" + n2((a + l / lobes + b) / 2 + l * .02) + " " + n2(w2 * 1.5) + " " + n2(j ? b - l * .02 : 0) + " " + n2(j ? l * .3 * Math.sin(Math.PI * (j - .25) / (lobes + .6)) * .42 : 0); }
    return '<path d="M0 0' + up + down + 'Z" fill="var(--a)" stroke="var(--c)" stroke-width="1.3"/>' + line(0, 0, l * .92, 0, 1.2, "var(--c)") + veins;
  }
  function acorn(s) {
    var cup = ""; for (var i = 0; i < 5; i++) cup += line(-9 + i * 4.5, -3, -7 + i * 3.5, 6, .8, "var(--c)");
    return at(0, 0, 0, s, '<path d="M-9 4C-9 20 -3 27 0 30C3 27 9 20 9 4Z" fill="var(--a)" stroke="var(--c)" stroke-width="1.3"/>' + line(-3, 11, -2, 21, .9, "var(--c)") + '<path d="M-11 5C-11 -4 11 -4 11 5Z" fill="var(--a)" stroke="var(--c)" stroke-width="1.3"/>' + cup + line(0, -3, 0, -9, 2));
  }
  // One corner's oak: a sprig along the circle, leaves spreading, two acorns hanging toward the centre.
  function oakCorner() {
    var grow = function (x, y, rot, s, l, order) { return at(x, y, rot, s, '<g class="s-leaf" data-order="' + order + '">' + oakLeaf(l) + "</g>"); };
    var nut = function (x) { return at(x, 4, 0, .9, '<g class="s-acorn">' + acorn(1) + "</g>"); };
    return '<path class="s-stem" d="M0 -6L46 -6" stroke="var(--a)" stroke-width="2.4" stroke-linecap="round" fill="none"/><path class="s-stem" d="M0 -6L-46 -6" stroke="var(--a)" stroke-width="2.4" stroke-linecap="round" fill="none"/>' +
      grow(-8, -12, 244, .8, 46, 0) + grow(8, -12, -64, .8, 46, 0) + grow(-14, -8, 196, 1, 54, 1) + grow(14, -8, -16, 1, 54, 1) + grow(-30, -4, 150, .62, 44, 2) + grow(30, -4, 30, .62, 44, 2) + nut(-11) + nut(11);
  }

  // The sun smiths forged for the top of a cross: a disc, straight rays and rays that wave like a grass snake, with no cross.
  function sun() {
    var rays = "", N = 28;
    for (var i = 0; i < N; i++) {
      var t = i / N * TAU, fromTop = Math.cos(t), l = 104 + 74 * fromTop * fromTop + (fromTop > 0 ? 20 : 0), body = "";
      if (i % 2) {
        var d = "M-4.500 118", b = "";
        for (var k = 1; k <= 6; k++) { var y = 118 + (l * .92) * k / 6, sw = (k % 2 ? 5 : -5) * (1 - k / 8); d += "Q" + n2(sw * 2) + " " + n2(y - l * .08) + " " + n2(-(4.5 * (1 - k / 6.5)) + sw * .3) + " " + n2(y); b = "L" + n2(4.5 * (1 - k / 6.5) + sw * .3) + " " + n2(y) + b; }
        body = '<path d="' + d + b + 'L4.500 118Z" fill="var(--a)" stroke="var(--c)" stroke-width="1"/>';
      } else body = '<path d="M-6.500 116L0 ' + n2(118 + l) + 'L6.500 116Z" fill="var(--a)" stroke="var(--c)" stroke-width="1"/>' + line(0, 122, 0, 112 + l * .8, .9, "var(--c)");
      rays += '<g transform="rotate(' + n2(t * 180 / Math.PI + 180) + ')"><g class="s-ray' + (i % 2 ? " is-wavy" : "") + '">' + body + "</g></g>";
    }
    var discCuts = each(72, function (i, t) { var a = polar(106, t - Math.PI / 2), b = polar(i % 2 ? 114 : 117, t - Math.PI / 2); return '<g class="s-cut">' + line(a[0], a[1], b[0], b[1], .9, "var(--c)") + "</g>"; });
    return '<g class="rays">' + rays + "</g>" + '<circle class="s-discback" r="104" fill="var(--d)"/>' + ring(112, 16, "var(--a)", "s-disc") + discCuts + ring(120, 1.6, "var(--c)") + ring(104, 1.6, "var(--c)") + ring(100, 1.2, "var(--a)", "s-disc") + each(36, function (i, t) { var p = polar(94, t - Math.PI / 2); return '<g class="s-sundot">' + dot(p[0], p[1], 1.6) + "</g>"; });
  }

  function anvil() {
    var id = "a" + (uid++), shape = "M-168 -6C-136 -14 -100 -24 -78 -26L132 -26L132 24L80 24C48 32 36 52 36 74L36 98L86 138L86 160L-86 160L-86 138L-36 98L-36 74C-36 48 -54 26 -92 20C-120 14 -146 6 -168 -6Z", shade = "";
    for (var i = 0; i < 70; i++) { var x = -190 + i * 5; shade += line(x, 170, x + 48, 88 + (i % 2) * 9, 1.1, "var(--c)"); }
    for (var k = 0; k < 44; k++) { var u = -84 + k * 5; shade += line(u, 24, u + 11, 5, 1, "var(--c)"); }
    for (var h = 0; h < 12; h++) shade += line(-160 + h * 7, 1 + h * .4, -150 + h * 7, -9 - h * .6, .9, "var(--c)");
    return '<clipPath id="' + id + '"><path d="' + shape + '"/></clipPath><path class="s-fill" d="' + shape + '" fill="var(--a)" stroke="var(--c)" stroke-width="4"/><path class="s-line" d="' + shape + '" fill="none" stroke="var(--a)" stroke-width="2"/><g class="s-cuts" clip-path="url(#' + id + ')">' + shade + "</g>" +
      '<g class="s-detail">' + line(-78, -18, 130, -18, 1.6, "var(--c)") + '<rect x="104" y="-23" width="12" height="9" fill="var(--c)"/>' + dot(84, -18.5, 3, "var(--c)") + line(-86, 148, 86, 148, 1.6, "var(--c)") + line(-36, 88, 36, 88, 1.3, "var(--c)") + "</g>";
  }

  // The block an anvil stands on: its end grain and its bands.
  function block() {
    var grain = ""; for (var i = 0; i < 12; i++) grain += line(-74 + i * 13.4, 4, -74 + i * 13.4 + (i % 3) - 1, 46, .9, "var(--c)");
    return '<path d="M-84 0H84L92 50H-92Z" fill="var(--a)" stroke="var(--c)" stroke-width="3"/>' + grain + line(-86, 14, 86, 14, 3, "var(--c)") + line(-90, 38, 90, 38, 3, "var(--c)");
  }

  function hammer(len) {
    var top = -len, wrap = "", grain = "", cut = "";
    for (var i = 0; i < 14; i++) { var y = -8 - i * 6.5; wrap += line(-11, y, 11, y - 4.5, 1.6, "var(--c)"); }
    for (var g = 0; g < 4; g++) grain += line(-6 + g * 4, -110, -6 + g * 4, top + 72, .9, "var(--c)");
    for (var j = 0; j < 26; j++) { var x = -88 + j * 6.6; cut += line(x, top + 2, x, top + 16 + 5 * Math.sin(j * 1.7), 1, "var(--c)"); cut += line(x, top + 40, x, top + 52, 1, "var(--c)"); }
    return '<g class="s-handle"><rect x="-11" y="' + (top + 40) + '" width="22" height="' + (len - 40) + '" fill="var(--a)" stroke="var(--c)" stroke-width="2.6"/>' + wrap + grain +
      '<path d="M-15 2H15L11 -7H-11Z" fill="var(--a)" stroke="var(--c)" stroke-width="2"/></g><g class="s-head">' +
      '<path d="M-92 ' + (top - 2) + "H58L98 " + (top + 16) + "V" + (top + 34) + "L58 " + (top + 52) + "H-92L-104 " + (top + 42) + "V" + (top + 8) + 'Z" fill="var(--a)" stroke="var(--c)" stroke-width="3"/>' + cut +
      line(-74, top - 2, -74, top + 52, 2.2, "var(--c)") + line(38, top - 2, 38, top + 52, 2.2, "var(--c)") +
      '<rect x="-18" y="' + (top + 52) + '" width="36" height="14" fill="var(--a)" stroke="var(--c)" stroke-width="2.2"/>' + dot(-9, top + 59, 2, "var(--c)") + dot(9, top + 59, 2, "var(--c)") + "</g>";
  }

  // A smith's tongs, jaws up: two reins crossing at a rivet, each ending in a ring.
  function tongs() {
    var arm = function (s) {
      var d = "M" + 16 * s + " 214C" + 15 * s + " 150 " + 6 * s + " 100 " + -7 * s + " 68C" + -28 * s + " 44 " + -40 * s + " 26 " + -26 * s + " 4L" + -10 * s + " 0";
      return '<path d="' + d + '" fill="none" stroke="var(--c)" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/><path d="' + d + '" fill="none" stroke="var(--a)" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/>' + line(16 * s, 200, 8 * s, 110, 1, "var(--c)") + line(-22 * s, 42, -30 * s, 20, 1, "var(--c)");
    };
    var ticks = ""; for (var i = 0; i < 8; i++) { ticks += line(9 + i * .9, 126 + i * 10, 22 + i * .2, 124 + i * 10, 1, "var(--c)") + line(-9 - i * .9, 126 + i * 10, -22 - i * .2, 124 + i * 10, 1, "var(--c)"); }
    var bow = function (s) { return '<circle cx="' + 16 * s + '" cy="226" r="11" fill="var(--d)" stroke="var(--a)" stroke-width="5"/>'; };
    return '<g class="s-arm" data-side="1">' + arm(1) + bow(1) + '</g><g class="s-arm" data-side="-1">' + arm(-1) + bow(-1) + '</g><g class="s-armcuts">' + ticks + '</g><g class="s-rivet"><circle cx="0" cy="79" r="13" fill="var(--a)" stroke="var(--c)" stroke-width="2.4"/>' + dot(0, 79, 4.5, "var(--c)") + "</g>";
  }

  // The quatrefoil's four arcs, their circles a distance out from the centre.
  function foil(d, R) { var t = n2((d + Math.sqrt(2 * R * R - d * d)) / 2); return "M" + t + " " + -t + "A" + R + " " + R + " 0 0 1 " + t + " " + t + "A" + R + " " + R + " 0 0 1 " + -t + " " + t + "A" + R + " " + R + " 0 0 1 " + -t + " " + -t + "A" + R + " " + R + " 0 0 1 " + t + " " + -t + "Z"; }
  function foilBeads(d, R, count, rad) { var out = ""; [[d, 0], [0, d], [-d, 0], [0, -d]].forEach(function (c, q) { var mid = q * Math.PI / 2; for (var i = 0; i < count; i++) { var a = mid - 1.36 + 2.72 * (i + .5) / count; out += '<g class="s-bead">' + dot(c[0] + Math.cos(a) * R, c[1] + Math.sin(a) * R, rad) + "</g>"; } }); return out; }

  function rim() {
    var from = -Math.PI / 2, pearls = each(120, function (i, t) { var p = polar(471, t + from); return '<g class="s-pearl">' + dot(p[0], p[1], 5) + dot(p[0] - 1.3, p[1] - 1.3, 1.2, "var(--c)") + "</g>"; });
    var chunk = function (cls, count, fn) { var out = "", open = false; for (var i = 0; i < count; i++) { if (i % 12 === 0) { out += (open ? "</g>" : "") + '<g class="' + cls + '">'; open = true; } out += fn(i, i / count * TAU); } return out + "</g>"; };
    var outerTicks = chunk("s-tick-out", 720, function (i, t) { var a = polar(453, t + from), b = polar(i % 2 ? 448 : 445, t + from); return line(a[0], a[1], b[0], b[1], .7, "var(--b)"); });
    var innerTicks = chunk("s-tick-in", 720, function (i, t) { var a = polar(356, t + from), b = polar(i % 2 ? 361 : 364, t + from); return line(a[0], a[1], b[0], b[1], .7, "var(--b)"); });
    var teeth = each(180, function (i, t) { var a = polar(338, t + from), b = polar(349, t + from); return '<g class="s-tooth">' + line(a[0], a[1], b[0], b[1], 2) + "</g>"; });
    return '<circle class="s-face" r="494" fill="var(--d)"/><g class="s-rim">' + ring(494, 3, null, "s-r0") + ring(486, 1.4, null, "s-r1") + pearls + ring(457, 3.4, null, "s-r2") + ring(453, 1, null, "s-r3") + outerTicks + innerTicks + ring(356, 1, null, "s-r4") + ring(352, 4.5, null, "s-r5") + teeth + ring(336, 1.8, null, "s-r6") + ring(331, 1, null, "s-r7") + "</g>";
  }

  // English, in a face anyone can read, the top line and the bottom line both upright.
  function legend() {
    var top = "w" + (uid++), foot = "w" + (uid++), chars = function (words) { return words.split("").map(function (ch) { return '<tspan class="s-char">' + (ch === " " ? "&#160;" : ch) + "</tspan>"; }).join(""); }, mark = function (x) { return at(x, 0, 0, 1, '<g class="s-mark">' + each(8, function (i, t) { var a = polar(7, t), b = polar(i % 2 ? 15 : 24, t); return line(a[0], a[1], b[0], b[1], i % 2 ? 2 : 3); }) + rosette(9) + "</g>"); };
    return '<path id="' + top + '" d="M-378 0A378 378 0 0 1 378 0" fill="none"/><path id="' + foot + '" d="M-430 0A430 430 0 0 0 430 0" fill="none"/>' +
      '<text font-family="IM Fell English SC, Georgia, serif" font-size="74" fill="var(--a)" letter-spacing="10" text-anchor="middle"><textPath href="#' + top + '" startOffset="50%">' + chars("The Zaisma Guild") + "</textPath></text>" +
      '<text font-family="IM Fell English SC, Georgia, serif" font-size="66" fill="var(--a)" letter-spacing="10" text-anchor="middle"><textPath href="#' + foot + '" startOffset="50%">' + chars("of Game Makers") + "</textPath></text>" + mark(-404) + mark(404);
  }

  function heart() {
    var id = "f" + (uid++), outline = foil(140, 165), diaper = "";
    for (var y = -310; y <= 310; y += 24) for (var x = -310; x <= 310; x += 24) { var ox = x + ((y + 310) / 24 % 2 ? 12 : 0); diaper += '<path d="M' + ox + " " + (y - 12) + "L" + (ox + 12) + " " + y + "L" + ox + " " + (y + 12) + "L" + (ox - 12) + " " + y + 'Z" fill="none" stroke="var(--b)" stroke-width=".8"/>' + at(ox, y, 0, 1, rosette(2.6, "var(--b)")); }
    var corners = [45, 135, 225, 315].map(function (deg) { var t = deg * Math.PI / 180, p = polar(279, t); return at(p[0], p[1], deg + 90, 1, oakCorner()); }).join("");
    return {
      base: '<clipPath id="' + id + '"><path d="' + outline + '"/></clipPath><path class="s-fieldback" d="' + outline + '" fill="var(--d)"/><g clip-path="url(#' + id + ')"><g class="s-diaper">' + diaper + "</g></g>" + foilBeads(140, 151, 22, 1.9) + '<path class="s-frame" d="' + outline + '" fill="none" stroke="var(--a)" stroke-width="9"/><path class="s-framecut" d="' + outline + '" fill="none" stroke="var(--c)" stroke-width="1.6"/><path class="s-frame" d="' + foil(140, 157) + '" fill="none" stroke="var(--a)" stroke-width="1.4"/>',
      oak: corners,
      sun: '<g class="s-sun">' + at(0, -48, 0, 1, sun()) + "</g>",
      top: '<g class="s-tongs" style="transform-origin:218px 104px">' + at(218, -122, 0, 1, tongs()) + '</g><g class="s-block" style="transform-origin:0px 246px">' + at(0, 196, 0, 1, block()) + '</g><g class="s-anvil">' + at(0, 64, 0, .82, anvil()) + "</g>" + at(0, -48, 0, 1, realZ(232, null, 7)) + '<g class="s-hammer" style="transform-origin:-218px 112px">' + at(-218, 112, 0, .55, hammer(400)) + "</g>"
    };
  }

  function full() {
    var h = heart(), layer = function (name, body) { return '<svg class="seal-' + name + '" viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g transform="translate(500 500)">' + body + "</g></svg>"; };
    return '<div class="seal-stack" role="img" aria-label="The Zaisma guild seal">' + layer("base", rim() + legend() + h.base) + layer("oak", h.oak) + layer("sun", h.sun) + layer("top", h.top) + "</div>";
  }

  return full;
})();
