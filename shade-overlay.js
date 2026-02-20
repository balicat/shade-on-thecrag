// Lost In Kalymnos — shade overlay for theCrag route & area pages
(function () {
  "use strict";

  const API_BASE = "https://lostinkalymnos.com";

  // Detect page type
  const routeMatch = location.href.match(/\/route\/(\d+)/);
  const areaMatch = location.href.match(/\/area\/(\d+)/);
  if (!routeMatch && !areaMatch) return;

  const today = formatDate(new Date());

  if (routeMatch) {
    bgFetch(API_BASE + "/api/lookup?theCragId=" + routeMatch[1])
      .then((data) => {
        const sunWindow = computeSunWindow(data.profile, today);
        injectRoutePanel(data.profile, sunWindow, data.slug, today);
      })
      .catch(() => {});
  } else {
    bgFetch(API_BASE + "/api/lookup?theCragAreaId=" + areaMatch[1])
      .then((data) => {
        const entries = data.routes.map((r) => ({
          routeEntry: { name: r.routeName, theCragId: r.theCragId, topoNum: r.topoNum },
          cragName: data.cragName,
          slug: r.slug,
          profile: r.profile,
          sunWindow: computeSunWindow(r.profile, today),
        }));
        injectAreaPanel(entries, parseInt(areaMatch[1], 10), today);
      })
      .catch(() => {});
  }

  // --- API helper via background service worker (bypasses CORS) ---

  function bgFetch(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "fetch", url }, (resp) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        if (!resp || !resp.ok) return reject(new Error(resp?.error || "fetch failed"));
        resolve(resp.data);
      });
    });
  }

  // --- Sun computation (ported from shade page) ---

  function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function interpolateTerrain(terrain, azimuth) {
    if (terrain.length === 0) return 0;
    if (azimuth <= terrain[0].az) return terrain[0].alt;
    if (azimuth >= terrain[terrain.length - 1].az)
      return terrain[terrain.length - 1].alt;
    for (let i = 0; i < terrain.length - 1; i++) {
      if (azimuth >= terrain[i].az && azimuth <= terrain[i + 1].az) {
        const t =
          (azimuth - terrain[i].az) / (terrain[i + 1].az - terrain[i].az);
        return terrain[i].alt + t * (terrain[i + 1].alt - terrain[i].alt);
      }
    }
    return 0;
  }

  function isInsideTerrainPolygon(capturePoints, az, alt) {
    const poly = [];
    if (capturePoints.length === 0) return false;
    poly.push({ az: capturePoints[0].az, alt: 0 });
    for (const pt of capturePoints) poly.push(pt);
    poly.push({ az: capturePoints[capturePoints.length - 1].az, alt: 0 });
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const ai = poly[i].az, bi = poly[i].alt;
      const aj = poly[j].az, bj = poly[j].alt;
      if ((bi > alt) !== (bj > alt)) {
        const crossAz = aj + ((alt - bj) / (bi - bj)) * (ai - aj);
        if (az < crossAz) inside = !inside;
      }
    }
    return inside;
  }

  function isCaveProfile(capturePoints) {
    if (capturePoints.length < 4) return false;
    let reversals = 0;
    for (let i = 2; i < capturePoints.length; i++) {
      const prevDir = capturePoints[i - 1].az - capturePoints[i - 2].az;
      const curDir = capturePoints[i].az - capturePoints[i - 1].az;
      if (prevDir * curDir < 0) reversals++;
    }
    return reversals >= 2;
  }

  function computeSunWindow(profile, dateStr) {
    const { lat, lon, terrain, capture_points } = profile;
    const cave = capture_points && isCaveProfile(capture_points);
    let sunrise = null, sunset = null, currentClear = null;
    let wasBlocked = true, prevDiff = 0, prevMinute = 0;
    const sunIntervals = [];
    const dayStartUTC = new Date(dateStr + "T00:00:00Z");

    for (let minute = 0; minute < 24 * 60; minute += 1) {
      const t = new Date(dayStartUTC.getTime() + minute * 60 * 1000);
      const pos = SunCalc.getPosition(t, lat, lon);
      const altDeg = (pos.altitude * 180) / Math.PI;

      if (altDeg <= 0) {
        if (!wasBlocked && currentClear) {
          sunIntervals.push({ start: currentClear, end: t });
          currentClear = null;
        }
        wasBlocked = true; prevDiff = 0; prevMinute = minute;
        continue;
      }

      let azDeg = (pos.azimuth * 180) / Math.PI + 180;
      if (azDeg < 0) azDeg += 360;
      if (azDeg >= 360) azDeg -= 360;
      if (!sunrise) sunrise = t;
      sunset = t;

      const blocked = cave
        ? isInsideTerrainPolygon(capture_points, azDeg, altDeg)
        : altDeg < interpolateTerrain(terrain, azDeg);
      const diff = cave ? (blocked ? -1 : 1) : altDeg - interpolateTerrain(terrain, azDeg);

      if (!blocked && wasBlocked) {
        const denom = diff - prevDiff;
        const frac = denom !== 0 ? -prevDiff / denom : 0.5;
        const crossMs = (prevMinute + frac * (minute - prevMinute)) * 60 * 1000;
        currentClear = new Date(dayStartUTC.getTime() + crossMs);
      } else if (blocked && !wasBlocked) {
        const denom = diff - prevDiff;
        const frac = denom !== 0 ? -prevDiff / denom : 0.5;
        const crossMs = (prevMinute + frac * (minute - prevMinute)) * 60 * 1000;
        if (currentClear) {
          sunIntervals.push({ start: currentClear, end: new Date(dayStartUTC.getTime() + crossMs) });
          currentClear = null;
        }
      }
      wasBlocked = blocked; prevDiff = diff; prevMinute = minute;
    }
    if (currentClear && sunset) sunIntervals.push({ start: currentClear, end: sunset });

    let sunMinutes = 0;
    for (const iv of sunIntervals) sunMinutes += (iv.end.getTime() - iv.start.getTime()) / (1000 * 60);
    return { sunrise, sunset, sunMinutes, sunIntervals };
  }

  // --- Shared bar-building helpers ---

  const BAR_START = 5, BAR_END = 21, BAR_HOURS = BAR_END - BAR_START;

  function getPos(d, tz) {
    const timeStr = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });
    const [hh, mm] = timeStr.split(":").map(Number);
    const h = hh + mm / 60;
    return Math.max(0, Math.min(100, ((h - BAR_START) / BAR_HOURS) * 100));
  }

  function fmtTime(d, tz) {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  }

  function createNowLabel(tz) {
    const nowPct = getPos(new Date(), tz);
    if (nowPct <= 0 || nowPct >= 100) return null;
    const row = document.createElement("div");
    row.style.cssText = "position:relative;height:14px;";
    const lbl = document.createElement("span");
    lbl.style.cssText = "position:absolute;font-size:10px;font-weight:600;color:#EF4444;transform:translateX(-50%);left:" + nowPct + "%;bottom:0;";
    lbl.textContent = "now";
    row.appendChild(lbl);
    return row;
  }

  function createBar(sunWindow, tz, height) {
    const bar = document.createElement("div");
    bar.style.cssText =
      "position:relative;height:" + (height || 24) + "px;background:#555;border-radius:6px;overflow:hidden;";

    // Daylight
    if (sunWindow.sunrise && sunWindow.sunset) {
      const dl = document.createElement("div");
      const sp = getPos(sunWindow.sunrise, tz), ep = getPos(sunWindow.sunset, tz);
      dl.style.cssText = "position:absolute;top:0;bottom:0;background:#A8D8EA;left:" + sp + "%;width:" + Math.max(ep - sp, 0.5) + "%;";
      bar.appendChild(dl);
    }

    // Sun intervals
    for (const iv of sunWindow.sunIntervals) {
      const seg = document.createElement("div");
      const sp = getPos(iv.start, tz), ep = getPos(iv.end, tz);
      seg.style.cssText = "position:absolute;top:0;bottom:0;border-radius:2px;background:linear-gradient(90deg,#FFD700,#FFA500);left:" + sp + "%;width:" + Math.max(ep - sp, 0.5) + "%;";
      bar.appendChild(seg);
    }

    // Gridlines
    for (let h = BAR_START; h <= BAR_END; h++) {
      const pct = ((h - BAR_START) / BAR_HOURS) * 100;
      const line = document.createElement("div");
      line.style.cssText = "position:absolute;top:0;bottom:0;width:1px;background:rgba(0,0,0,0.15);left:" + pct + "%;";
      bar.appendChild(line);
    }

    // Now line
    const nowPct = getPos(new Date(), tz);
    if (nowPct > 0 && nowPct < 100) {
      const nl = document.createElement("div");
      nl.style.cssText = "position:absolute;top:0;bottom:0;width:2px;background:#EF4444;transform:translateX(-1px);left:" + nowPct + "%;";
      bar.appendChild(nl);
    }

    return bar;
  }

  function createHourLabels() {
    const labels = document.createElement("div");
    labels.style.cssText = "position:relative;height:14px;";
    for (let h = BAR_START; h <= BAR_END; h += 1) {
      const pct = ((h - BAR_START) / BAR_HOURS) * 100;
      const lbl = document.createElement("span");
      lbl.style.cssText = "position:absolute;font-size:9px;color:#888;transform:translateX(-50%);left:" + pct + "%;";
      lbl.textContent = h;
      labels.appendChild(lbl);
    }
    return labels;
  }

  function createPanelShell(dateStr) {
    const panel = document.createElement("div");
    panel.id = "lik-shade-panel";
    panel.style.cssText =
      "background:#f7f8f9;border:1px solid #ddd;border-radius:12px;padding:16px;margin:16px 0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;";

    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;";

    const logo = document.createElement("span");
    logo.innerHTML =
      '<span style="font-size:14px;font-weight:700;color:#006B54;">Lost In Kalymnos</span>' +
      ' <span style="font-size:11px;color:#888;font-weight:normal;">Shade Calculator</span>';
    header.appendChild(logo);

    const dateLabel = document.createElement("span");
    dateLabel.style.cssText = "font-size:12px;color:#666;";
    const d = new Date(dateStr + "T12:00:00Z");
    dateLabel.textContent = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    header.appendChild(dateLabel);

    panel.appendChild(header);
    return panel;
  }

  // --- Route page panel ---

  function injectRoutePanel(profile, sunWindow, slug, dateStr) {
    const tz = profile.timezone;
    const panel = createPanelShell(dateStr);

    // Make header link to shade page
    const logoSpan = panel.querySelector("span");
    const logoLink = document.createElement("a");
    logoLink.href = API_BASE + "/shade?route=" + slug;
    logoLink.target = "_blank";
    logoLink.rel = "noopener noreferrer";
    logoLink.style.cssText = "text-decoration:none;";
    logoLink.innerHTML = logoSpan.innerHTML;
    logoSpan.replaceWith(logoLink);

    // Sun summary
    const sunTimes = document.createElement("div");
    sunTimes.style.cssText = "margin-bottom:8px;";
    if (sunWindow.sunIntervals.length > 0) {
      const parts = sunWindow.sunIntervals.map((iv) => fmtTime(iv.start, tz) + " – " + fmtTime(iv.end, tz));
      const sunLabel = document.createElement("div");
      sunLabel.style.cssText = "font-size:13px;color:#333;margin-bottom:4px;";
      sunLabel.innerHTML = '<span style="color:#E65100;font-weight:600;">Sun</span> ' +
        parts.join(' <span style="color:#aaa;">\u00b7</span> ');
      sunTimes.appendChild(sunLabel);

      const sunHrs = Math.floor(sunWindow.sunMinutes / 60);
      const sunMins = Math.round(sunWindow.sunMinutes % 60);
      const totalDaylight = sunWindow.sunrise && sunWindow.sunset
        ? (sunWindow.sunset.getTime() - sunWindow.sunrise.getTime()) / (1000 * 60) : 0;
      const shadeMins = Math.round(totalDaylight - sunWindow.sunMinutes);
      const stats = document.createElement("div");
      stats.style.cssText = "font-size:11px;color:#888;";
      stats.textContent = sunHrs + "h " + sunMins + "m sun \u00b7 " + Math.floor(shadeMins / 60) + "h " + (shadeMins % 60) + "m shade";
      sunTimes.appendChild(stats);
    } else {
      const noSun = document.createElement("div");
      noSun.style.cssText = "font-size:13px;color:#666;";
      noSun.textContent = "Full shade today";
      sunTimes.appendChild(noSun);
    }
    panel.appendChild(sunTimes);

    // Now label + bar + hour labels
    const nowLabel = createNowLabel(tz);
    if (nowLabel) panel.appendChild(nowLabel);
    panel.appendChild(createBar(sunWindow, tz, 24));
    panel.appendChild(createHourLabels());

    // Link
    const linkRow = document.createElement("div");
    linkRow.style.cssText = "text-align:right;margin-top:4px;";
    const link = document.createElement("a");
    link.href = API_BASE + "/shade?route=" + slug;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.style.cssText = "font-size:11px;color:#006B54;text-decoration:none;font-weight:600;";
    link.textContent = "View sky chart \u2192";
    link.addEventListener("mouseenter", () => (link.style.textDecoration = "underline"));
    link.addEventListener("mouseleave", () => (link.style.textDecoration = "none"));
    linkRow.appendChild(link);
    panel.appendChild(linkRow);

    insertIntoPage(panel);
  }

  // --- Area page panel ---

  function injectAreaPanel(entries, theCragAreaId, dateStr) {
    if (entries.length === 0) return;
    const tz = entries[0].profile.timezone;
    const cragName = entries[0].cragName;
    const panel = createPanelShell(dateStr);

    // Make header link to shade page crag view
    const cragSlug = cragName.toLowerCase().replace(/\s+/g, "-");
    const logoSpan = panel.querySelector("span");
    const logoLink = document.createElement("a");
    logoLink.href = API_BASE + "/shade?crag=" + cragSlug;
    logoLink.target = "_blank";
    logoLink.rel = "noopener noreferrer";
    logoLink.style.cssText = "text-decoration:none;";
    logoLink.innerHTML = logoSpan.innerHTML;
    logoSpan.replaceWith(logoLink);

    // Shade summary
    const firstStarts = [], lastEnds = [];
    let sunriseAll = null, sunsetAll = null;
    for (const e of entries) {
      if (e.sunWindow.sunrise && (!sunriseAll || e.sunWindow.sunrise < sunriseAll)) sunriseAll = e.sunWindow.sunrise;
      if (e.sunWindow.sunset && (!sunsetAll || e.sunWindow.sunset > sunsetAll)) sunsetAll = e.sunWindow.sunset;
      if (e.sunWindow.sunIntervals.length > 0) {
        firstStarts.push(e.sunWindow.sunIntervals[0].start);
        lastEnds.push(e.sunWindow.sunIntervals[e.sunWindow.sunIntervals.length - 1].end);
      }
    }

    const summaryDiv = document.createElement("div");
    summaryDiv.style.cssText = "font-size:12px;color:#555;margin-bottom:10px;";
    if (firstStarts.length > 0) {
      const maxStart = new Date(Math.max(...firstStarts.map((d) => d.getTime())));
      const minEnd = new Date(Math.min(...lastEnds.map((d) => d.getTime())));
      const allSunFromSunrise = sunriseAll && Math.abs(maxStart.getTime() - sunriseAll.getTime()) < 2 * 60 * 1000;
      const maxEnd = new Date(Math.max(...lastEnds.map((d) => d.getTime())));
      const sunUntilSunset = sunsetAll && Math.abs(maxEnd.getTime() - sunsetAll.getTime()) < 2 * 60 * 1000;
      const parts = [];
      if (!allSunFromSunrise) parts.push("Shade until " + fmtTime(maxStart, tz));
      if (sunUntilSunset && sunsetAll) {
        parts.push("sun until sunset at " + fmtTime(sunsetAll, tz));
      } else if (sunsetAll) {
        parts.push("shade from " + fmtTime(minEnd, tz) + " until sunset at " + fmtTime(sunsetAll, tz));
      }
      summaryDiv.textContent = entries.length + " route" + (entries.length !== 1 ? "s" : "") + " \u00b7 " + parts.join(" \u00b7 ");
    } else {
      summaryDiv.textContent = entries.length + " route" + (entries.length !== 1 ? "s" : "") + " \u00b7 No direct sun today";
    }
    panel.appendChild(summaryDiv);

    // Sort by topoNum/order
    entries.sort((a, b) => (a.routeEntry.topoNum ?? a.routeEntry.order ?? Infinity) - (b.routeEntry.topoNum ?? b.routeEntry.order ?? Infinity));

    // Now label above first bar
    const nowLabel = createNowLabel(tz);

    // Composite "best shade" bar
    if (entries.length > 1 && sunriseAll && sunsetAll) {
      const compositeLabel = document.createElement("div");
      compositeLabel.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;";
      compositeLabel.innerHTML =
        '<span style="font-size:11px;font-weight:600;color:#333;">Best shade</span>' +
        '<span style="font-size:10px;color:#aaa;">move between routes</span>';
      panel.appendChild(compositeLabel);

      if (nowLabel) panel.appendChild(nowLabel);

      const compositeSW = computeComposite(entries, sunriseAll, sunsetAll);
      panel.appendChild(createBar(compositeSW, tz, 20));

      const sep = document.createElement("div");
      sep.style.cssText = "border-bottom:1px solid #ddd;margin:8px 0 6px;";
      panel.appendChild(sep);
    }

    // Per-route bars
    let firstRoute = true;
    for (const e of entries) {
      const row = document.createElement("div");
      row.style.cssText = "margin-bottom:4px;";

      // Route name + sun times
      const nameRow = document.createElement("div");
      nameRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;";
      const nameSpan = document.createElement("a");
      nameSpan.href = "https://www.thecrag.com/route/" + e.routeEntry.theCragId;
      nameSpan.style.cssText = "font-size:12px;color:#333;text-decoration:none;font-weight:500;";
      nameSpan.textContent = e.routeEntry.name;
      nameSpan.addEventListener("mouseenter", () => (nameSpan.style.textDecoration = "underline"));
      nameSpan.addEventListener("mouseleave", () => (nameSpan.style.textDecoration = "none"));

      const timesSpan = document.createElement("span");
      timesSpan.style.cssText = "font-size:11px;color:#888;";
      if (e.sunWindow.sunIntervals.length > 0) {
        timesSpan.textContent = fmtTime(e.sunWindow.sunIntervals[0].start, tz) + " – " +
          fmtTime(e.sunWindow.sunIntervals[e.sunWindow.sunIntervals.length - 1].end, tz);
      } else {
        timesSpan.textContent = "no sun";
      }

      nameRow.appendChild(nameSpan);
      nameRow.appendChild(timesSpan);
      row.appendChild(nameRow);
      if (firstRoute && nowLabel && !nowLabel.parentNode) {
        row.insertBefore(nowLabel, null);
      }
      firstRoute = false;
      row.appendChild(createBar(e.sunWindow, tz, 18));
      panel.appendChild(row);
    }

    // Hour labels
    panel.appendChild(createHourLabels());

    // Link
    const linkRow = document.createElement("div");
    linkRow.style.cssText = "text-align:right;margin-top:4px;";
    const link = document.createElement("a");
    link.href = API_BASE + "/shade?crag=" + cragSlug;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.style.cssText = "font-size:11px;color:#006B54;text-decoration:none;font-weight:600;";
    link.textContent = "View all routes \u2192";
    link.addEventListener("mouseenter", () => (link.style.textDecoration = "underline"));
    link.addEventListener("mouseleave", () => (link.style.textDecoration = "none"));
    linkRow.appendChild(link);
    panel.appendChild(linkRow);

    insertIntoPage(panel);
  }

  // Compute composite sun window (intersection: sun only when ALL routes have sun)
  function computeComposite(entries, sunrise, sunset) {
    const dayStart = sunrise.getTime(), dayEnd = sunset.getTime();
    const step = 60 * 1000;
    const sunIntervals = [];
    let inSun = false, intervalStart = dayStart;

    for (let t = dayStart; t <= dayEnd; t += step) {
      let allHaveSun = true;
      for (const e of entries) {
        let hasSun = false;
        for (const iv of e.sunWindow.sunIntervals) {
          if (t >= iv.start.getTime() && t <= iv.end.getTime()) { hasSun = true; break; }
        }
        if (!hasSun) { allHaveSun = false; break; }
      }
      if (allHaveSun && !inSun) { intervalStart = t; inSun = true; }
      else if (!allHaveSun && inSun) {
        sunIntervals.push({ start: new Date(intervalStart), end: new Date(t) });
        inSun = false;
      }
    }
    if (inSun) sunIntervals.push({ start: new Date(intervalStart), end: new Date(dayEnd) });
    return { sunrise, sunset, sunMinutes: 0, sunIntervals };
  }

  // --- Page insertion ---

  function insertIntoPage(panel) {
    // Strategy 1: Insert before the tick/log-ascent section
    const tickSection = document.querySelector('[data-route-tick], .tick-panel, .log-ascent');
    if (tickSection) {
      const container = tickSection.closest(".container, .row, section, .panel, div") || tickSection.parentElement;
      if (container) {
        container.parentNode.insertBefore(panel, container);
        return;
      }
    }

    // Strategy 2: Insert after description areas
    const candidates = [".short-description", ".description", ".node-info", ".route-info", ".area-info"];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) {
        el.parentNode.insertBefore(panel, el.nextSibling);
        return;
      }
    }

    // Strategy 3: Insert after first <h1>
    const h1 = document.querySelector("h1");
    if (h1) {
      let target = h1;
      while (target.parentElement && target.parentElement.children.length === 1) {
        target = target.parentElement;
      }
      target.parentNode.insertBefore(panel, target.nextSibling);
      return;
    }

    // Last resort
    const main = document.querySelector("main, #content, .content, .container");
    if (main) main.insertBefore(panel, main.firstChild);
  }
})();
