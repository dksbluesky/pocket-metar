'use strict';

// ── Runway database (heading in degrees for each runway end) ──
const RUNWAY_DB = {
  RCTP: [{ id: '05L/R', hdg: 50 }, { id: '06L/R', hdg: 60 }, { id: '23L/R', hdg: 230 }, { id: '24L/R', hdg: 240 }],
  RCSS: [{ id: '10',    hdg: 100 }, { id: '28',   hdg: 280 }],
  RCKH: [{ id: '09',    hdg: 90  }, { id: '27',   hdg: 270 }],
  RCNN: [{ id: '18',    hdg: 180 }, { id: '36',   hdg: 360 }, { id: '04', hdg: 40 }, { id: '22', hdg: 220 }],
  RCBS: [{ id: '18',    hdg: 180 }, { id: '36',   hdg: 360 }],
  RCMQ: [{ id: '11',    hdg: 110 }, { id: '29',   hdg: 290 }, { id: '20', hdg: 200 }, { id: '02', hdg: 20 }],
  RCFG: [{ id: '20',    hdg: 200 }, { id: '02',   hdg: 20  }],
  RCYU: [{ id: '03',    hdg: 30  }, { id: '21',   hdg: 210 }, { id: '13', hdg: 130 }, { id: '31', hdg: 310 }],
  RCFN: [{ id: '10',    hdg: 100 }, { id: '28',   hdg: 280 }, { id: '02', hdg: 20  }, { id: '20', hdg: 200 }],
  RCGI: [{ id: '15',    hdg: 150 }, { id: '33',   hdg: 330 }],
  RCLY: [{ id: '13',    hdg: 130 }, { id: '31',   hdg: 310 }],
};

// ── Weather code decoder ──
const WX_CODES = {
  RA: '雨 Rain', DZ: '毛毛雨 Drizzle', SN: '雪 Snow', SG: '雪粒 Snow Grains',
  GR: '冰雹 Hail', GS: '霰 Graupel', PL: '冰珠 Ice Pellets',
  FG: '霧 Fog', BR: '薄霧 Mist', HZ: '靄 Haze', FU: '煙 Smoke',
  DU: '塵 Dust', SA: '沙 Sand', VA: '火山灰 Volcanic Ash',
  SQ: '颮 Squall', TS: '雷暴 Thunderstorm', DS: '塵暴 Duststorm',
  SS: '沙暴 Sandstorm', PO: '塵捲風 Dust Whirl',
  '-': '輕 Light', '+': '強 Heavy', VC: '附近 Vicinity',
  SH: '陣 Shower', FZ: '凍 Freezing', MI: '淺 Shallow',
  BC: '片狀 Patchy', DR: '低吹 Drifting', BL: '高吹 Blowing',
  PR: '部分 Partial',
};

const TREND_CODES = {
  NOSIG: '未來兩小時天氣無顯著變化 No Significant Change',
  BECMG: '天氣將逐漸改變 Weather Becoming',
  TEMPO: '天氣將短暫改變 Temporary Change',
};

// ── State ──
let currentIcao = '';
let refreshTimer = null;

// ── Entry points ──
function onAirportChange() {
  const sel = document.getElementById('airportSelect');
  const manualRow = document.getElementById('manualInputRow');
  if (sel.value === '__manual__') {
    manualRow.style.display = 'flex';
    document.getElementById('manualIcao').focus();
  } else {
    manualRow.style.display = 'none';
    if (sel.value) fetchMetar(sel.value);
  }
}

function fetchManual() {
  const val = document.getElementById('manualIcao').value.trim().toUpperCase();
  if (val.length < 2) return;
  fetchMetar(val);
}

document.getElementById('manualIcao').addEventListener('keydown', e => {
  if (e.key === 'Enter') fetchManual();
});

// ── Fetch METAR — tries multiple sources in order ──
async function fetchMetar(icao) {
  currentIcao = icao;
  clearTimeout(refreshTimer);
  showLoading(true);
  hideError();
  hideData();

  const noaaJson = `https://aviationweather.gov/api/data/metar?ids=${icao}&format=json&hours=2`;

  const sources = [
    // 1. NOAA JSON direct
    async () => {
      const res = await fetch(noaaJson);
      if (!res.ok) throw new Error(`NOAA ${res.status}`);
      const d = await res.json();
      if (!Array.isArray(d) || !d[0]?.rawOb) throw new Error('empty');
      return d[0].rawOb.replace(/^(METAR|SPECI)\s+/, '');
    },
    // 2. NOAA JSON via corsproxy.io
    async () => {
      const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(noaaJson)}`);
      if (!res.ok) throw new Error(`corsproxy ${res.status}`);
      const d = await res.json();
      if (!Array.isArray(d) || !d[0]?.rawOb) throw new Error('empty');
      return d[0].rawOb.replace(/^(METAR|SPECI)\s+/, '');
    },
    // 3. NOAA JSON via allorigins
    async () => {
      const res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(noaaJson)}`);
      if (!res.ok) throw new Error(`allorigins ${res.status}`);
      const d = await res.json();
      if (!Array.isArray(d) || !d[0]?.rawOb) throw new Error('empty');
      return d[0].rawOb.replace(/^(METAR|SPECI)\s+/, '');
    },
    // 4. VATSIM plain-text (browser-friendly, no key needed)
    async () => {
      const res = await fetch(`https://metar.vatsim.net/metar.php?id=${icao}`);
      if (!res.ok) throw new Error(`VATSIM ${res.status}`);
      const text = (await res.text()).trim().replace(/^(METAR|SPECI)\s+/, '');
      if (!text.startsWith(icao)) throw new Error('no VATSIM data');
      return text;
    },
  ];

  let raw = null;
  let lastErr = 'All sources failed';
  for (const src of sources) {
    try { raw = await src(); if (raw) break; }
    catch (e) { lastErr = e.message; }
  }

  if (!raw) {
    showError(`無法取得 ${icao} 的 METAR 資料。\n(${lastErr})`);
  } else {
    try {
      renderMetar(raw);
      const now = new Date();
      document.getElementById('updatedTime').textContent =
        `更新於 ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    } catch (e) {
      showError(`解析錯誤 Parse error: ${e.message}`);
    }
  }

  showLoading(false);
  refreshTimer = setTimeout(() => fetchMetar(currentIcao), 5 * 60 * 1000);
}

// ── METAR Parser ──
function parseMetar(raw) {
  const m = {};
  const tokens = raw.split(/\s+/);
  let i = 0;

  m.raw = raw;
  m.station = tokens[i++];

  // Date/time: DDHHMMZ
  if (/^\d{6}Z$/.test(tokens[i])) {
    const t = tokens[i++];
    const day = parseInt(t.slice(0, 2));
    const hh  = t.slice(2, 4);
    const mm  = t.slice(4, 6);
    m.time = { day, hh, mm, str: `${day}日 ${hh}:${mm} UTC` };
  }

  // AUTO / COR
  if (tokens[i] === 'AUTO' || tokens[i] === 'COR') i++;

  // Wind: dddssKT or dddssGggKT or VRB
  const windRe = /^(VRB|\d{3})(\d{2,3})(G(\d{2,3}))?(KT|MPS)$/;
  if (windRe.test(tokens[i])) {
    const w = tokens[i++].match(windRe);
    m.wind = {
      dir: w[1] === 'VRB' ? null : parseInt(w[1]),
      vrb: w[1] === 'VRB',
      spd: parseInt(w[2]),
      gust: w[4] ? parseInt(w[4]) : null,
      unit: w[5],
    };
    // Wind variability: dddVddd
    if (/^\d{3}V\d{3}$/.test(tokens[i])) {
      const v = tokens[i++].split('V');
      m.wind.varFrom = parseInt(v[0]);
      m.wind.varTo = parseInt(v[1]);
    }
  }

  // Visibility: CAVOK or VVVV or VVVVSM or M1/4SM
  if (tokens[i] === 'CAVOK') {
    m.vis = { raw: 'CAVOK', km: 10, sm: null, cavok: true };
    i++;
  } else {
    const visRe = /^(M?)(\d+\/?\d*)(SM)?$|^(\d{4})$/;
    if (visRe.test(tokens[i])) {
      const vt = tokens[i++];
      if (/^\d{4}$/.test(vt)) {
        const meters = parseInt(vt);
        m.vis = { raw: vt, km: meters >= 9999 ? '10+' : (meters / 1000).toFixed(1), sm: null };
      } else {
        const sm = parseSM(vt);
        m.vis = { raw: vt, km: null, sm };
      }
    }
    // Skip RVR
    while (/^R\d+/.test(tokens[i])) i++;
  }

  // Present weather
  m.wx = [];
  const wxRe = /^[-+]?(VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|GR|GS|IC|PL|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)+(TS)?$/;
  while (wxRe.test(tokens[i]) || tokens[i] === '//' ) {
    if (tokens[i] !== '//') m.wx.push(tokens[i]);
    i++;
  }

  // Clouds
  m.clouds = [];
  const cloudRe = /^(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?$/;
  while (cloudRe.test(tokens[i]) || tokens[i] === 'SKC' || tokens[i] === 'CLR' || tokens[i] === 'NSC' || tokens[i] === 'NCD') {
    const ct = tokens[i++];
    if (ct === 'SKC' || ct === 'CLR' || ct === 'NSC' || ct === 'NCD') {
      m.clouds.push({ cover: ct, alt: null });
    } else {
      const c = ct.match(cloudRe);
      m.clouds.push({ cover: c[1], alt: parseInt(c[2]) * 100, cb: c[3] || null });
    }
  }

  // Temp / Dew point
  const tdRe = /^(M?\d+)\/(M?\d+)?$/;
  if (tdRe.test(tokens[i])) {
    const td = tokens[i++].match(tdRe);
    m.temp = parseTemp(td[1]);
    m.dp   = td[2] ? parseTemp(td[2]) : null;
  }

  // Altimeter
  const altRe = /^([QA])(\d{4})$/;
  if (altRe.test(tokens[i])) {
    const a = tokens[i++].match(altRe);
    if (a[1] === 'Q') {
      m.qnh = { hpa: parseInt(a[2]), inhg: (parseInt(a[2]) * 0.02953).toFixed(2) };
    } else {
      const inhg = parseInt(a[2]) / 100;
      m.qnh = { hpa: Math.round(inhg * 33.8639), inhg: inhg.toFixed(2) };
    }
  }

  // Remarks / trend tokens
  m.remarks = [];
  while (i < tokens.length) {
    const tk = tokens[i++];
    if (tk === 'RMK') { m.remarks.push({ code: 'RMK', desc: '備註開始 Remarks (備註開始)' }); continue; }
    if (TREND_CODES[tk]) { m.remarks.push({ code: tk, desc: TREND_CODES[tk] }); continue; }
    // Altimeter remark (A2996)
    if (/^A\d{4}$/.test(tk)) {
      const inhg = (parseInt(tk.slice(1)) / 100).toFixed(2);
      m.remarks.push({ code: tk, desc: `高度表撥正值 Altimeter: ${inhg} inHg` });
      continue;
    }
    // SLP pressure
    if (/^SLP\d{3}$/.test(tk)) {
      const slp = parseInt(tk.slice(3));
      const hpa = slp >= 500 ? (900 + slp / 10).toFixed(1) : (1000 + slp / 10).toFixed(1);
      m.remarks.push({ code: tk, desc: `海平面氣壓 SLP: ${hpa} hPa` });
      continue;
    }
  }

  // Flight rules
  m.flightRules = getFlightRules(m);

  return m;
}

function parseTemp(s) {
  return s.startsWith('M') ? -parseInt(s.slice(1)) : parseInt(s);
}

function parseSM(s) {
  const m = s.match(/^(M?)(\d+)(?:\/(\d+))?SM$/);
  if (!m) return null;
  let val = parseInt(m[2]);
  if (m[3]) val = val + 1 / parseInt(m[3]);
  if (m[1]) val = -val;
  return val;
}

function getFlightRules(m) {
  let ceiling = Infinity;
  for (const c of m.clouds) {
    if ((c.cover === 'BKN' || c.cover === 'OVC' || c.cover === 'VV') && c.alt != null) {
      ceiling = Math.min(ceiling, c.alt);
    }
  }
  if (m.vis?.cavok) return 'VFR';

  let visSm = null;
  if (m.vis?.sm != null) visSm = m.vis.sm;
  else if (m.vis?.km != null) {
    const km = parseFloat(m.vis.km);
    visSm = km / 1.852;
  }

  const ceilOk = ceiling === Infinity;
  const visOk  = visSm === null;

  if ((ceilOk || ceiling >= 3000) && (visOk || visSm >= 5))  return 'VFR';
  if ((ceilOk || ceiling >= 1000) && (visOk || visSm >= 3))  return 'MVFR';
  if ((ceilOk || ceiling >= 500)  && (visOk || visSm >= 1))  return 'IFR';
  return 'LIFR';
}

// ── Runway calculation ──
function calcRunwayComponents(windDir, windSpd, runwayHdg) {
  const diff = ((windDir - runwayHdg) + 360) % 360;
  const rad  = diff * Math.PI / 180;
  const head = Math.round(windSpd * Math.cos(rad));
  const cross = Math.round(Math.abs(windSpd * Math.sin(rad)));
  return { head, cross };
}

function getBestRunway(icao, windDir, windSpd) {
  const runways = RUNWAY_DB[icao];
  if (!runways || windDir === null) return null;

  let best = null;
  let bestScore = -Infinity;
  const details = [];

  for (const rwy of runways) {
    const c = calcRunwayComponents(windDir, windSpd, rwy.hdg);
    // Score: maximise headwind, penalise crosswind
    const score = c.head - c.cross * 0.3;
    details.push({ id: rwy.id, head: c.head, cross: c.cross, score });
    if (score > bestScore) {
      bestScore = score;
      best = { id: rwy.id, head: c.head, cross: c.cross };
    }
  }

  // Filter to only "into wind" side (head >= -tailwind threshold)
  const candidates = details.filter(d => d.head >= -5);
  if (candidates.length > 0) {
    const top = candidates.reduce((a, b) => a.score > b.score ? a : b);
    best = { id: top.id, head: top.head, cross: top.cross };
  }

  return { best, details };
}

// ── Render ──
function renderMetar(raw) {
  const m = parseMetar(raw);

  // METAR card
  document.getElementById('stationId').textContent = m.station;
  const badge = document.getElementById('frBadge');
  badge.textContent = m.flightRules;
  badge.className = `fr-badge fr-${m.flightRules.toLowerCase()}`;
  document.getElementById('rawMetar').textContent = raw;
  document.getElementById('obsTime').textContent =
    m.time ? `觀測時間: ${m.time.str}` : '';
  show('metarCard');

  // Wind
  if (m.wind) {
    const dir = m.wind.vrb ? null : m.wind.dir;
    const spd = m.wind.spd;
    const unit = m.wind.unit || 'KT';
    if (dir !== null) {
      const arrow = document.getElementById('windArrow');
      arrow.style.transform = `translate(-50%, -100%) rotate(${dir}deg)`;
    }
    const windText = document.getElementById('windText');
    const dirStr = m.wind.vrb ? 'VRB' : `${m.wind.dir}°`;
    const gustStr = m.wind.gust ? ` G${m.wind.gust}` : '';
    windText.innerHTML =
      `<span class="wind-deg">${dirStr}</span> / <span class="wind-kt">${spd}${gustStr} ${unit}</span>`;
  }

  // Visibility
  const visEl = document.getElementById('visValue');
  if (m.vis) {
    if (m.vis.cavok) { visEl.textContent = 'CAVOK'; }
    else if (m.vis.km !== null) { visEl.textContent = m.vis.km === '10+' ? '10km+' : `${m.vis.km} km`; }
    else if (m.vis.sm !== null) { visEl.textContent = `${m.vis.sm} SM`; }
    else { visEl.textContent = '—'; }
  }

  // Temp/DP
  document.getElementById('tempVal').textContent = m.temp != null ? `${m.temp}°C` : '—';
  document.getElementById('dpVal').textContent   = m.dp   != null ? `${m.dp}°C`   : '—';

  // QNH
  if (m.qnh) {
    document.getElementById('qnhHpa').textContent  = m.qnh.hpa;
    document.getElementById('qnhInhg').textContent = `${m.qnh.inhg} inHg`;
  }

  show('dataGrid');

  // Runway
  if (m.wind && m.wind.dir !== null) {
    const rwyData = getBestRunway(m.station, m.wind.dir, m.wind.spd);
    if (rwyData) {
      const { best, details } = rwyData;
      document.getElementById('runwayId').textContent = best.id;
      document.getElementById('runwayWinds').innerHTML =
        `頂風 Head: <span class="hw">${best.head} KT</span><br>` +
        `側風 Cross: <span class="cw">${best.cross} KT</span>`;

      // Wind detail table
      let table = '<table><tr><th>跑道</th><th>頂風 Head</th><th>側風 Cross</th></tr>';
      for (const d of details) {
        const cls = d.id === best.id ? ' class="best"' : '';
        table += `<tr${cls}><td>${d.id}</td><td>${d.head > 0 ? d.head : `TW ${Math.abs(d.head)}`} KT</td><td>${d.cross} KT</td></tr>`;
      }
      table += '</table>';
      document.getElementById('windDetail').innerHTML = table;
      show('runwayCard');
    }
  }

  // Clouds
  if (m.clouds.length > 0) {
    const coverNames = { FEW: 'FEW', SCT: 'SCT', BKN: 'BKN', OVC: 'OVC', VV: 'VV', SKC: 'SKC', CLR: 'CLR', NSC: 'NSC', NCD: 'NCD' };
    let html = '';
    let ceilingMarked = false;
    for (const c of m.clouds) {
      const isCeiling = !ceilingMarked && (c.cover === 'BKN' || c.cover === 'OVC' || c.cover === 'VV') && c.alt != null;
      if (isCeiling) ceilingMarked = true;
      html += `<div class="cloud-row">
        <span class="cloud-cover">${coverNames[c.cover] || c.cover}${c.cb ? ' '+c.cb : ''}</span>
        <span class="cloud-alt">${c.alt != null ? c.alt.toLocaleString() + ' ft' : '—'}</span>
        ${isCeiling ? '<span class="ceiling-badge">CEILING</span>' : ''}
      </div>`;
    }
    document.getElementById('cloudsList').innerHTML = html;
    show('cloudsCard');
  }

  // Decoder
  const decoderItems = [];

  // Trend / remarks
  for (const r of m.remarks) {
    decoderItems.push({ code: r.code, desc: r.desc });
  }

  // Present weather
  for (const wx of m.wx) {
    decoderItems.push({ code: wx, desc: decodeWx(wx) });
  }

  if (decoderItems.length > 0) {
    let html = '';
    for (const d of decoderItems) {
      html += `<div class="decoder-row">
        <span class="decoder-code">${d.code}</span>
        <span class="decoder-desc">${d.desc}</span>
      </div>`;
    }
    document.getElementById('decoderList').innerHTML = html;
    show('decoderCard');
  }
}

function decodeWx(wx) {
  let result = '';
  let s = wx;
  // Intensity
  if (s[0] === '-' || s[0] === '+') {
    result += (WX_CODES[s[0]] || '') + ' ';
    s = s.slice(1);
  }
  // Descriptor / phenomena
  const codes = ['VC','MI','PR','BC','DR','BL','SH','TS','FZ',
                  'DZ','RA','SN','SG','GR','GS','IC','PL','UP',
                  'BR','FG','FU','VA','DU','SA','HZ','PO','SQ','FC','SS','DS'];
  while (s.length > 0) {
    let matched = false;
    for (const c of codes) {
      if (s.startsWith(c)) {
        result += (WX_CODES[c] || c) + ' ';
        s = s.slice(c.length);
        matched = true;
        break;
      }
    }
    if (!matched) { result += s; break; }
  }
  return result.trim();
}

function toggleWindDetail() {
  const el = document.getElementById('windDetail');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// ── Helpers ──
function show(id)    { document.getElementById(id).style.display = ''; }
function hide(id)    { document.getElementById(id).style.display = 'none'; }
function showLoading(v) { document.getElementById('loadingMsg').style.display = v ? 'block' : 'none'; }
function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.style.display = 'block';
}
function hideError() { hide('errorMsg'); }
function hideData() {
  ['metarCard','dataGrid','runwayCard','cloudsCard','decoderCard'].forEach(hide);
}

// ── Auto-load default airport on startup ──
fetchMetar('RCNN');
