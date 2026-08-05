/* =============================================================
   BandTracks — Área do usuário (mixer + transporte + velocidade)
   ============================================================= */
(function () {
  "use strict";

  const CFG = window.BT_CONFIG;
  const SPD = CFG.speed || {};
  const engine = new MultitrackEngine();

  const $ = function (s) { return document.querySelector(s); };
  const el = {
    bandName:  $("#bandName"),
    songlist:  $("#songlist"),
    search:    $("#search"),
    main:      $("#main"),
    hamburger: $("#hamburger"),
    backdrop:  $("#backdrop"),
    playBtn:   $("#playBtn"),
    stopBtn:   $("#stopBtn"),
    resetBtn:  $("#resetBtn"),
    seek:      $("#seek"),
    seekFill:  $("#seekFill"),
    seekKnob:  $("#seekKnob"),
    tCur:      $("#tCur"),
    tTot:      $("#tTot"),
    masterVol: $("#masterVol"),
    loadBar:   $("#loadBar"),
    trackCount:$("#trackCount"),
    // velocidade
    speedBtn:  $("#speedBtn"),
    speedVal:  $("#speedVal"),
    speedPop:  $("#speedPop"),
    speedPresets: $("#speedPresets"),
    speedRange:$("#speedRange"),
    speedNum:  $("#speedNum"),
    speedMin:  $("#speedMin"),
    speedMax:  $("#speedMax"),
    pitchChk:  $("#pitchChk"),
    pitchLabel:$("#pitchLabel"),
    speedNote: $("#speedNote"),
    speedReset:$("#speedReset")
  };

  let songs = [];
  let current = null;
  let seeking = false;

  const SMIN  = typeof SPD.min === "number" ? SPD.min : 0.25;
  const SMAX  = typeof SPD.max === "number" ? SPD.max : 1.00;
  const SSTEP = typeof SPD.step === "number" ? SPD.step : 0.05;
  const SFLOOR= typeof SPD.safeFloor === "number" ? SPD.safeFloor : 0.50;

  /* ---------------- carga do catálogo ---------------- */
  async function boot() {
    el.bandName.textContent = CFG.bandName || "BandTracks";
    document.title = (CFG.bandName || "BandTracks") + " — Pistas";
    try {
      const res = await fetch(CFG.github.dataFile + "?v=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      songs = data.songs || [];
    } catch (e) {
      songs = [];
      console.warn("Não foi possível ler o catálogo:", e.message);
    }
    renderList();
    if (songs.length) selectSong(songs[0].id); else renderEmpty("Nenhuma música cadastrada ainda.");
  }

  /* ---------------- lista lateral ---------------- */
  function renderList(filter) {
    const f = (filter || "").trim().toLowerCase();
    const list = songs.filter(function (s) {
      if (!f) return true;
      return (s.title + " " + (s.artist || "")).toLowerCase().indexOf(f) >= 0;
    });
    el.songlist.innerHTML = "";
    if (!list.length) {
      el.songlist.innerHTML = '<div style="padding:14px;color:var(--txt-2);font-size:13px">Nada encontrado.</div>';
      return;
    }
    list.forEach(function (s) {
      const b = document.createElement("button");
      b.className = "song-item" + (current && current.id === s.id ? " active" : "");
      b.innerHTML = '<span class="t"></span><span class="s"></span>';
      b.querySelector(".t").textContent = s.title;
      b.querySelector(".s").textContent =
        (s.artist ? s.artist + " · " : "") + s.tracks.length + " faixas";
      b.addEventListener("click", function () {
        selectSong(s.id);
        document.body.classList.remove("nav-open");
      });
      el.songlist.appendChild(b);
    });
    el.trackCount.textContent = songs.length + (songs.length === 1 ? " música" : " músicas");
  }

  /* ---------------- seleção e montagem do mixer ---------------- */
  function selectSong(id) {
    const s = songs.find(function (x) { return x.id === id; });
    if (!s) return;
    current = s;
    renderList(el.search.value);
    setPlayIcon(false);
    setLoad(0, s.tracks.length);

    engine.load(s);
    renderMixer(s);
    updateTime(0, 0);
  }

  function renderMixer(song) {
    el.main.innerHTML = "";

    const head = document.createElement("div");
    head.className = "song-head";
    head.innerHTML = '<h1></h1><div class="meta"></div>';
    head.querySelector("h1").textContent = song.title;
    head.querySelector(".meta").textContent =
      (song.artist ? song.artist + " · " : "") + song.tracks.length + " pistas" +
      (song.notes ? " · " + song.notes : "");
    el.main.appendChild(head);

    song.tracks.forEach(function (t, i) {
      const row = document.createElement("div");
      row.className = "track";
      row.dataset.i = i;
      row.innerHTML =
        '<div class="name"><span></span><small></small></div>' +
        '<div class="vol">' +
          '<input type="range" min="0" max="100" step="1" aria-label="Volume">' +
          '<span class="pct"></span>' +
        '</div>' +
        '<div class="btns">' +
          '<button class="tbtn mute" title="Mudo">M</button>' +
          '<button class="tbtn solo" title="Solo">S</button>' +
        '</div>';

      const vol = Math.round((engine.tracks[i] ? engine.tracks[i].volume : 0.85) * 100);
      row.querySelector(".name span").textContent = t.name;
      row.querySelector(".name small").textContent = "Pista " + (i + 1);
      const range = row.querySelector("input[type=range]");
      range.value = vol;
      range.style.setProperty("--fill", vol + "%");
      row.querySelector(".pct").textContent = vol + "%";

      range.addEventListener("input", function () {
        const v = parseInt(range.value, 10);
        range.style.setProperty("--fill", v + "%");
        row.querySelector(".pct").textContent = v + "%";
        engine.setVolume(i, v / 100);
      });
      row.querySelector(".mute").addEventListener("click", function () {
        engine.toggleMute(i); refreshStates();
      });
      row.querySelector(".solo").addEventListener("click", function () {
        engine.toggleSolo(i); refreshStates();
      });

      el.main.appendChild(row);
    });

    const foot = document.createElement("div");
    foot.style.cssText = "margin-top:14px;display:flex;gap:10px;flex-wrap:wrap";
    const clr = document.createElement("button");
    clr.className = "btn ghost"; clr.textContent = "Limpar mudo/solo";
    clr.addEventListener("click", function () { engine.clearSoloMute(); refreshStates(); });
    const all = document.createElement("button");
    all.className = "btn ghost"; all.textContent = "Volumes em 100%";
    all.addEventListener("click", function () {
      el.main.querySelectorAll(".track").forEach(function (r) {
        const i = +r.dataset.i;
        const rg = r.querySelector("input[type=range]");
        rg.value = 100; rg.style.setProperty("--fill", "100%");
        r.querySelector(".pct").textContent = "100%";
        engine.setVolume(i, 1);
      });
    });
    foot.appendChild(clr); foot.appendChild(all);
    el.main.appendChild(foot);

    refreshStates();
  }

  function refreshStates() {
    el.main.querySelectorAll(".track").forEach(function (row) {
      const i = +row.dataset.i;
      const t = engine.tracks[i]; if (!t) return;
      row.querySelector(".mute").classList.toggle("on-mute", t.muted);
      row.querySelector(".solo").classList.toggle("on-solo", t.solo);
      row.classList.toggle("is-silent", !engine.isAudible(t));
    });
  }

  function renderEmpty(msg) {
    el.main.innerHTML =
      '<div class="empty"><div class="big">&#9834;</div><div>' + msg + '</div>' +
      '<div style="font-size:13px">Use a <a href="admin.html">área do administrador</a> para enviar as pistas.</div></div>';
  }

  /* ---------------- transporte ---------------- */
  function setPlayIcon(playing) {
    el.playBtn.innerHTML = playing
      ? '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
    el.playBtn.setAttribute("aria-label", playing ? "Pausar" : "Tocar");
  }

  function updateTime(cur, dur) {
    el.tCur.textContent = fmtTime(cur);
    el.tTot.textContent = fmtTime(dur);
    const p = dur > 0 ? (cur / dur) * 100 : 0;
    el.seekFill.style.width = p + "%";
    el.seekKnob.style.left = p + "%";
  }

  function setLoad(done, total) {
    const p = total ? (done / total) * 100 : 0;
    el.loadBar.style.width = p + "%";
    el.loadBar.style.opacity = (done >= total) ? 0 : 1;
  }

  engine.onTime  = function (c, d) { if (!seeking) updateTime(c, d); };
  engine.onState = function (p) { setPlayIcon(p); };
  engine.onLoad  = function (d, t) { setLoad(d, t); };
  engine.onReady = function () { updateTime(0, engine.duration); };

  el.playBtn.addEventListener("click", function () { engine.toggle(); });
  el.stopBtn.addEventListener("click", function () { engine.stop(); updateTime(0, engine.duration); });
  el.resetBtn.addEventListener("click", function () { engine.seek(0); updateTime(0, engine.duration); });

  el.masterVol.addEventListener("input", function () {
    const v = parseInt(el.masterVol.value, 10);
    el.masterVol.style.setProperty("--fill", v + "%");
    engine.setMasterVolume(v / 100);
  });

  /* ---------------- velocidade ---------------- */
  function fmtRate(r) { return r.toFixed(2).replace(".", ",") + "×"; }

  function buildPresets() {
    const list = SPD.presets || [0.5, 0.65, 0.75, 0.85, 1.0];
    el.speedPresets.innerHTML = "";
    list.forEach(function (r) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.rate = r;
      b.textContent = fmtRate(r);
      b.addEventListener("click", function () { applyRate(r); });
      el.speedPresets.appendChild(b);
    });
  }

  function applyRate(r) {
    const rate = engine.setRate(r);
    syncSpeedUI(rate);
  }

  function syncSpeedUI(rate) {
    el.speedVal.textContent = fmtRate(rate);
    el.speedNum.textContent = fmtRate(rate);
    el.speedRange.value = Math.round(rate * 100);
    const fill = ((rate - SMIN) / (SMAX - SMIN)) * 100;
    el.speedRange.style.setProperty("--fill", fill + "%");

    el.speedPresets.querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("on", Math.abs(parseFloat(b.dataset.rate) - rate) < 0.001);
    });

    const alterada = Math.abs(rate - 1) > 0.001;
    const baixa = rate < SFLOOR - 0.001;
    el.speedBtn.classList.toggle("changed", alterada && !baixa);
    el.speedBtn.classList.toggle("low", baixa);
    el.speedNote.classList.toggle("show", baixa);
  }

  el.speedBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    el.speedPop.classList.toggle("open");
  });
  el.speedPop.addEventListener("click", function (e) { e.stopPropagation(); });
  document.addEventListener("click", function () { el.speedPop.classList.remove("open"); });

  el.speedRange.addEventListener("input", function () {
    applyRate(parseInt(el.speedRange.value, 10) / 100);
  });

  el.pitchChk.addEventListener("change", function () {
    engine.setPreservePitch(el.pitchChk.checked);
  });

  el.speedReset.addEventListener("click", function () { applyRate(1); });

  function initSpeed() {
    el.speedRange.min = Math.round(SMIN * 100);
    el.speedRange.max = Math.round(SMAX * 100);
    el.speedRange.step = Math.round(SSTEP * 100);
    el.speedMin.textContent = fmtRate(SMIN);
    el.speedMax.textContent = fmtRate(SMAX);
    buildPresets();

    const suportado = MultitrackEngine.supportsPitchPreservation;
    el.pitchChk.checked = SPD.preservePitch !== false;
    el.pitchChk.disabled = !suportado;
    if (!suportado) {
      el.pitchLabel.textContent =
        "Este navegador não permite controlar a correção de tom.";
    }
    engine.setPreservePitch(el.pitchChk.checked);
    syncSpeedUI(1);
  }

  /* ---- barra de tempo: clique e arraste (mouse + toque) ---- */
  function seekFromEvent(e) {
    const r = el.seek.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const p = Math.max(0, Math.min(1, x / r.width));
    return p * (engine.duration || 0);
  }
  function startSeek(e) {
    if (!engine.tracks.length) return;
    seeking = true; e.preventDefault();
    updateTime(seekFromEvent(e), engine.duration);
  }
  function moveSeek(e) {
    if (!seeking) return;
    updateTime(seekFromEvent(e), engine.duration);
  }
  function endSeek(e) {
    if (!seeking) return;
    const t = seekFromEvent(e.changedTouches ? { clientX: e.changedTouches[0].clientX } : e);
    seeking = false; engine.seek(t);
  }
  el.seek.addEventListener("mousedown", startSeek);
  document.addEventListener("mousemove", moveSeek);
  document.addEventListener("mouseup", endSeek);
  el.seek.addEventListener("touchstart", startSeek, { passive: false });
  document.addEventListener("touchmove", moveSeek, { passive: false });
  document.addEventListener("touchend", endSeek);

  /* ---------------- navegação mobile ---------------- */
  el.hamburger.addEventListener("click", function () { document.body.classList.toggle("nav-open"); });
  el.backdrop.addEventListener("click", function () { document.body.classList.remove("nav-open"); });
  el.search.addEventListener("input", function () { renderList(el.search.value); });

  /* ---------------- teclado (desktop) ---------------- */
  document.addEventListener("keydown", function (e) {
    if (e.target.tagName === "INPUT") return;
    if (e.code === "Space") { e.preventDefault(); engine.toggle(); }
    if (e.code === "ArrowRight") engine.seek(engine.currentTime + 5);
    if (e.code === "ArrowLeft")  engine.seek(engine.currentTime - 5);
    if (e.code === "Home")       engine.seek(0);
    // velocidade: - e + ajustam; 0 volta ao normal
    if (e.key === "-" || e.key === "_") applyRate(engine.rate - SSTEP);
    if (e.key === "+" || e.key === "=") applyRate(engine.rate + SSTEP);
    if (e.key === "0") applyRate(1);
  });

  // exposto para diagnóstico no console do navegador
  window.BT_ENGINE = engine;

  setPlayIcon(false);
  initSpeed();
  boot();
})();
