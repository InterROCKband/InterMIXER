/* =============================================================
   BandTracks — Motor de reprodução multipista
   <audio> em streaming roteado para o Web Audio API, um GainNode
   por faixa, correção de deriva, velocidade variável (tom preservado)
   e LOOP de trecho.
   Toda a lógica trabalha em "tempo de mídia" (currentTime dos áudios),
   por isso o LOOP é independente da velocidade de reprodução.
   ============================================================= */
(function (global) {
  "use strict";

  const CFG = global.BT_CONFIG || {};
  const TOL = CFG.syncTolerance || 0.08;
  const SPD = CFG.speed || {};
  const LP  = CFG.loop || {};
  const MIN_SPAN = typeof LP.minSpan === "number" ? LP.minSpan : 1.0;

  function applyPreservesPitch(el, on) {
    if ("preservesPitch" in el) el.preservesPitch = on;
    if ("webkitPreservesPitch" in el) el.webkitPreservesPitch = on;
    if ("mozPreservesPitch" in el) el.mozPreservesPitch = on;
  }
  function supportsPreservesPitch() {
    const a = document.createElement("audio");
    return ("preservesPitch" in a) || ("webkitPreservesPitch" in a) ||
           ("mozPreservesPitch" in a);
  }

  class MultitrackEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.tracks = [];
      this.duration = 0;
      this.playing = false;
      this.masterVolume = 1;
      this.rate = 1;
      this.preservePitch = SPD.preservePitch !== false;

      // ---- LOOP ----
      this.loopEnabled = false;
      this.loopStart = 0;
      this.loopEnd = 0;          // 0 = ainda não definido; ao carregar vira a duração

      this._raf = null;
      this._syncTimer = null;
      this._seekingBack = false; // trava reentrância do salto de loop

      this.onTime = null;   // (cur, dur) => void
      this.onState = null;  // (playing) => void
      this.onLoad = null;   // (loaded, total) => void
      this.onReady = null;  // () => void
      this.onRate = null;   // (rate) => void
      this.onLoop = null;   // (start, end, enabled) => void
    }

    /* ---------- contexto de áudio ---------- */
    _ensureCtx() {
      if (!this.ctx) {
        const AC = global.AudioContext || global.webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.masterVolume;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
      return this.ctx;
    }

    /* ---------- carregar uma música ---------- */
    load(song) {
      this.unload();
      this._ensureCtx();

      const total = song.tracks.length;
      let loaded = 0;
      const self = this;

      // reinicia o loop para os extremos ao trocar de música
      this.loopStart = 0;
      this.loopEnd = 0;

      this.tracks = song.tracks.map(function (t, i) {
        const el = new Audio();
        el.preload = "auto";
        el.crossOrigin = "anonymous";
        el.src = t.file;
        el.playbackRate = self.rate;
        el.defaultPlaybackRate = self.rate;
        applyPreservesPitch(el, self.preservePitch);
        el.load();

        const srcNode = self.ctx.createMediaElementSource(el);
        const gain = self.ctx.createGain();
        srcNode.connect(gain);
        gain.connect(self.master);

        const track = {
          index: i, name: t.name || ("Faixa " + (i + 1)),
          el: el, gain: gain,
          volume: typeof t.volume === "number" ? t.volume : 0.85,
          muted: false, solo: false, ready: false
        };
        gain.gain.value = track.volume;

        el.addEventListener("loadedmetadata", function () {
          if (isFinite(el.duration) && el.duration > self.duration) {
            self.duration = el.duration;
            if (self.loopEnd === 0) self.loopEnd = self.duration;
          }
        });
        const markReady = function () {
          if (track.ready) return;
          track.ready = true;
          loaded++;
          if (self.onLoad) self.onLoad(loaded, total);
          if (loaded === total) {
            if (self.loopEnd === 0) self.loopEnd = self.duration;
            self._applyGains();
            self.setRate(self.rate);
            if (self.onLoop) self.onLoop(self.loopStart, self.loopEnd, self.loopEnabled);
            if (self.onTime) self.onTime(0, self.duration);
            if (self.onReady) self.onReady();
          }
        };
        el.addEventListener("canplaythrough", markReady);
        el.addEventListener("canplay", markReady);
        el.addEventListener("error", function () {
          console.warn("Falha ao carregar faixa:", t.file); markReady();
        });
        el.addEventListener("ended", function () {
          if (self._allEnded()) self._handleEnd();
        });
        return track;
      });

      if (this.onLoad) this.onLoad(0, total);
      return this.tracks;
    }

    unload() {
      this.pause();
      this.tracks.forEach(function (t) {
        try { t.el.pause(); t.el.removeAttribute("src"); t.el.load(); } catch (e) {}
      });
      this.tracks = [];
      this.duration = 0;
      this.playing = false;
      this._stopLoops();
    }

    /* ---------- velocidade ---------- */
    setRate(r) {
      const min = typeof SPD.min === "number" ? SPD.min : 0.25;
      const max = typeof SPD.max === "number" ? SPD.max : 1.0;
      this.rate = Math.max(min, Math.min(max, r));
      const self = this;
      this.tracks.forEach(function (t) {
        try { t.el.playbackRate = self.rate; t.el.defaultPlaybackRate = self.rate; }
        catch (e) { console.warn("playbackRate não aceito:", e.message); }
      });
      if (this.playing) this._align();
      if (this.onRate) this.onRate(this.rate);
      return this.rate;
    }
    setPreservePitch(on) {
      this.preservePitch = !!on;
      const self = this;
      this.tracks.forEach(function (t) { applyPreservesPitch(t.el, self.preservePitch); });
      return this.preservePitch;
    }
    static get supportsPitchPreservation() { return supportsPreservesPitch(); }

    /* ---------- LOOP ---------- */
    setLoopEnabled(on) {
      this.loopEnabled = !!on;
      if (this.loopEnabled) {
        // garante limites válidos
        if (this.loopEnd <= 0) this.loopEnd = this.duration;
        this._clampLoop();
        // se estiver tocando fora do trecho, entra no início do trecho
        const c = this.currentTime;
        if (c < this.loopStart - 0.001 || c > this.loopEnd + 0.001) {
          this.seek(this.loopStart);
        }
      }
      if (this.onLoop) this.onLoop(this.loopStart, this.loopEnd, this.loopEnabled);
      return this.loopEnabled;
    }

    /** Define os pontos do loop (em segundos de mídia). */
    setLoop(start, end) {
      const d = this.duration || 0;
      let s = (start === null || start === undefined) ? this.loopStart : start;
      let e = (end === null || end === undefined) ? this.loopEnd : end;
      s = Math.max(0, Math.min(d, s));
      e = Math.max(0, Math.min(d, e));
      // mantém largura mínima empurrando o lado que NÃO foi movido
      if (e - s < MIN_SPAN) {
        if (start !== null && start !== undefined) s = Math.max(0, e - MIN_SPAN);
        else e = Math.min(d, s + MIN_SPAN);
        // se ainda inválido (música curta), ocupa tudo
        if (e - s < MIN_SPAN) { s = 0; e = d; }
      }
      this.loopStart = s;
      this.loopEnd = e;
      if (this.onLoop) this.onLoop(this.loopStart, this.loopEnd, this.loopEnabled);
      return { start: s, end: e };
    }

    resetLoop() {
      this.loopStart = 0;
      this.loopEnd = this.duration;
      if (this.onLoop) this.onLoop(this.loopStart, this.loopEnd, this.loopEnabled);
      return { start: this.loopStart, end: this.loopEnd };
    }

    getLoop() {
      return { start: this.loopStart, end: this.loopEnd, enabled: this.loopEnabled };
    }

    _clampLoop() {
      const d = this.duration || 0;
      this.loopStart = Math.max(0, Math.min(d, this.loopStart));
      this.loopEnd = Math.max(0, Math.min(d, this.loopEnd));
      if (this.loopEnd - this.loopStart < MIN_SPAN) {
        this.loopEnd = Math.min(d, this.loopStart + MIN_SPAN);
        if (this.loopEnd - this.loopStart < MIN_SPAN) { this.loopStart = 0; this.loopEnd = d; }
      }
    }

    /** Verifica a borda do loop e salta se necessário. Chamado a cada quadro. */
    _checkLoop() {
      if (!this.loopEnabled || !this.playing || this._seekingBack) return;
      const c = this.currentTime;
      // margem proporcional à velocidade: antecipa o salto o suficiente
      const margin = Math.max(0.02, 0.05 * this.rate);
      if (c >= this.loopEnd - margin) {
        this._seekingBack = true;
        this.seek(this.loopStart);
        const self = this;
        // pequena trava para não re-disparar no mesmo quadro
        setTimeout(function () { self._seekingBack = false; }, 60);
      }
    }

    /* ---------- mudo/solo ---------- */
    _anySolo() { return this.tracks.some(function (t) { return t.solo; }); }
    isAudible(t) {
      const solo = this._anySolo();
      return solo ? (t.solo && !t.muted) : !t.muted;
    }
    _applyGains() {
      const self = this;
      const now = this.ctx ? this.ctx.currentTime : 0;
      this.tracks.forEach(function (t) {
        const target = self.isAudible(t) ? t.volume : 0;
        if (self.ctx) {
          t.gain.gain.cancelScheduledValues(now);
          t.gain.gain.setTargetAtTime(target, now, 0.015);
        } else { t.gain.gain.value = target; }
      });
    }
    setVolume(i, v) { const t = this.tracks[i]; if (!t) return; t.volume = Math.max(0, Math.min(1, v)); this._applyGains(); }
    toggleMute(i) { const t = this.tracks[i]; if (!t) return; t.muted = !t.muted; this._applyGains(); return t.muted; }
    toggleSolo(i) { const t = this.tracks[i]; if (!t) return; t.solo = !t.solo; this._applyGains(); return t.solo; }
    clearSoloMute() { this.tracks.forEach(function (t) { t.muted = false; t.solo = false; }); this._applyGains(); }
    setMasterVolume(v) { this.masterVolume = Math.max(0, Math.min(1, v)); if (this.master) this.master.gain.value = this.masterVolume; }

    /* ---------- transporte ---------- */
    get currentTime() { const ref = this._reference(); return ref ? ref.el.currentTime : 0; }

    _reference() {
      let ref = null, max = -1;
      this.tracks.forEach(function (t) {
        const d = isFinite(t.el.duration) ? t.el.duration : 0;
        if (d > max) { max = d; ref = t; }
      });
      return ref;
    }
    _allEnded() {
      return this.tracks.every(function (t) {
        return t.el.ended || t.el.currentTime >= t.el.duration - 0.05;
      });
    }
    _tolerance() { return Math.max(0.02, TOL * this.rate); }

    _align() {
      const ref = this._reference(); if (!ref) return;
      const t0 = ref.el.currentTime;
      const tol = this._tolerance();
      this.tracks.forEach(function (t) {
        if (t === ref || t.el.ended) return;
        if (Math.abs(t.el.currentTime - t0) > tol) {
          try { t.el.currentTime = t0; } catch (e) {}
        }
      });
    }

    play() {
      if (!this.tracks.length) return;
      this._ensureCtx();
      // se o loop está ligado e o cursor está fora do trecho, começa no início dele
      if (this.loopEnabled) {
        const c = this.currentTime;
        if (c < this.loopStart - 0.001 || c >= this.loopEnd - 0.001) this.seek(this.loopStart);
      }
      const t0 = this.currentTime;
      const self = this;
      this.tracks.forEach(function (t) {
        if (Math.abs(t.el.currentTime - t0) > self._tolerance()) t.el.currentTime = t0;
        t.el.playbackRate = self.rate;
      });
      const promises = this.tracks.map(function (t) {
        const p = t.el.play();
        return p && p.catch ? p.catch(function (e) { console.warn("play():", e.message); }) : null;
      });
      Promise.all(promises).then(function () {
        self.playing = true;
        self.tracks.forEach(function (t) { t.el.playbackRate = self.rate; });
        if (self.onState) self.onState(true);
        self._startLoops();
      });
    }

    pause() {
      this.tracks.forEach(function (t) { t.el.pause(); });
      this.playing = false;
      this._stopLoops();
      if (this.onState) this.onState(false);
    }
    toggle() { this.playing ? this.pause() : this.play(); }

    seek(sec) {
      const s = Math.max(0, Math.min(this.duration || 0, sec));
      this.tracks.forEach(function (t) {
        try { t.el.currentTime = Math.min(s, isFinite(t.el.duration) ? t.el.duration : s); } catch (e) {}
      });
      if (this.onTime) this.onTime(s, this.duration);
    }
    stop() { this.pause(); this.seek(this.loopEnabled ? this.loopStart : 0); }

    _handleEnd() {
      // fim natural do arquivo: se o loop está ligado, recomeça no início do trecho
      if (this.loopEnabled) { this.seek(this.loopStart); if (this.playing) this.play(); return; }
      this.pause(); this.seek(0);
    }

    /* ---------- laços ---------- */
    _startLoops() {
      const self = this;
      this._stopLoops();
      const tick = function () {
        self._checkLoop();                       // borda do loop (responsivo, ~60fps)
        if (self.onTime) self.onTime(self.currentTime, self.duration);
        self._raf = global.requestAnimationFrame(tick);
      };
      this._raf = global.requestAnimationFrame(tick);
      this._syncTimer = global.setInterval(function () {
        if (!self.playing) return;
        self._align();
        self._checkLoop();                       // backstop caso a aba perca foco
      }, 250);
    }
    _stopLoops() {
      if (this._raf) { global.cancelAnimationFrame(this._raf); this._raf = null; }
      if (this._syncTimer) { global.clearInterval(this._syncTimer); this._syncTimer = null; }
    }
  }

  function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return m + ":" + String(r).padStart(2, "0");
  }
  function fmtTimeMs(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const r = (s % 60);
    const whole = Math.floor(r);
    const dec = Math.floor((r - whole) * 10);
    return m + ":" + String(whole).padStart(2, "0") + "." + dec;
  }

  global.MultitrackEngine = MultitrackEngine;
  global.fmtTime = fmtTime;
  global.fmtTimeMs = fmtTimeMs;
})(window);
