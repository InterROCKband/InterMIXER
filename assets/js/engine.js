/* =============================================================
   BandTracks — Motor de reprodução multipista
   Usa <audio> (streaming, baixo consumo de memória) roteado para
   o Web Audio API, com um GainNode por faixa e correção de deriva.
   Suporta velocidade variável com preservação de tom.
   ============================================================= */
(function (global) {
  "use strict";

  const CFG = global.BT_CONFIG || {};
  const TOL = CFG.syncTolerance || 0.08;
  const SPD = CFG.speed || {};

  /** Define preservação de tom cobrindo os prefixos de fornecedor. */
  function applyPreservesPitch(el, on) {
    if ("preservesPitch" in el) el.preservesPitch = on;
    if ("webkitPreservesPitch" in el) el.webkitPreservesPitch = on;
    if ("mozPreservesPitch" in el) el.mozPreservesPitch = on;
  }

  /** O navegador suporta preservação de tom? */
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
      this._raf = null;
      this._syncTimer = null;
      this.onTime = null;      // (cur, dur) => void
      this.onState = null;     // (playing) => void
      this.onLoad = null;      // (loaded, total) => void
      this.onReady = null;     // () => void
      this.onRate = null;      // (rate) => void
    }

    /* ---------- contexto de áudio (criado no 1º gesto do usuário) ---------- */
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
          index: i,
          name: t.name || ("Faixa " + (i + 1)),
          el: el,
          gain: gain,
          volume: typeof t.volume === "number" ? t.volume : 0.85,
          muted: false,
          solo: false,
          ready: false
        };
        gain.gain.value = track.volume;

        el.addEventListener("loadedmetadata", function () {
          if (isFinite(el.duration) && el.duration > self.duration) {
            self.duration = el.duration;
          }
        });
        const markReady = function () {
          if (track.ready) return;
          track.ready = true;
          loaded++;
          if (self.onLoad) self.onLoad(loaded, total);
          if (loaded === total) {
            self._applyGains();
            self.setRate(self.rate);
            if (self.onTime) self.onTime(0, self.duration);
            if (self.onReady) self.onReady();
          }
        };
        el.addEventListener("canplaythrough", markReady);
        el.addEventListener("canplay", markReady);
        el.addEventListener("error", function () {
          console.warn("Falha ao carregar faixa:", t.file);
          markReady();
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
    /** Define a velocidade (multiplicador) em todas as faixas. */
    setRate(r) {
      const min = typeof SPD.min === "number" ? SPD.min : 0.25;
      const max = typeof SPD.max === "number" ? SPD.max : 1.0;
      this.rate = Math.max(min, Math.min(max, r));
      const self = this;
      this.tracks.forEach(function (t) {
        try {
          t.el.playbackRate = self.rate;
          t.el.defaultPlaybackRate = self.rate;
        } catch (e) {
          console.warn("playbackRate não aceito:", e.message);
        }
      });
      // realinha imediatamente: a troca de taxa pode desencontrar as faixas
      if (this.playing) this._align();
      if (this.onRate) this.onRate(this.rate);
      return this.rate;
    }

    /** Liga/desliga a correção de tom (false = efeito de fita). */
    setPreservePitch(on) {
      this.preservePitch = !!on;
      const self = this;
      this.tracks.forEach(function (t) { applyPreservesPitch(t.el, self.preservePitch); });
      return this.preservePitch;
    }

    static get supportsPitchPreservation() { return supportsPreservesPitch(); }

    /* ---------- estado de mudo/solo ---------- */
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
          t.gain.gain.setTargetAtTime(target, now, 0.015); // rampa curta: evita clique
        } else {
          t.gain.gain.value = target;
        }
      });
    }

    setVolume(i, v) {
      const t = this.tracks[i]; if (!t) return;
      t.volume = Math.max(0, Math.min(1, v));
      this._applyGains();
    }
    toggleMute(i) {
      const t = this.tracks[i]; if (!t) return;
      t.muted = !t.muted; this._applyGains(); return t.muted;
    }
    toggleSolo(i) {
      const t = this.tracks[i]; if (!t) return;
      t.solo = !t.solo; this._applyGains(); return t.solo;
    }
    clearSoloMute() {
      this.tracks.forEach(function (t) { t.muted = false; t.solo = false; });
      this._applyGains();
    }
    setMasterVolume(v) {
      this.masterVolume = Math.max(0, Math.min(1, v));
      if (this.master) this.master.gain.value = this.masterVolume;
    }

    /* ---------- transporte ---------- */
    get currentTime() {
      const ref = this._reference();
      return ref ? ref.el.currentTime : 0;
    }

    _reference() {
      // faixa mais longa = relógio mestre
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

    /** Tolerância efetiva: escalada pela velocidade, para que o erro
        percebido pelo ouvinte permaneça constante em tempo real. */
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
      const t0 = this.currentTime;
      const self = this;
      this.tracks.forEach(function (t) {
        if (Math.abs(t.el.currentTime - t0) > self._tolerance()) t.el.currentTime = t0;
        t.el.playbackRate = self.rate;   // reafirma: alguns navegadores reiniciam a taxa
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

    stop() { this.pause(); this.seek(0); }

    _handleEnd() {
      this.pause();
      this.seek(0);
    }

    /* ---------- laços de UI e de sincronismo ---------- */
    _startLoops() {
      const self = this;
      this._stopLoops();

      const tick = function () {
        if (self.onTime) self.onTime(self.currentTime, self.duration);
        self._raf = global.requestAnimationFrame(tick);
      };
      this._raf = global.requestAnimationFrame(tick);

      // correção de deriva entre as faixas
      this._syncTimer = global.setInterval(function () {
        if (!self.playing) return;
        self._align();
      }, 500);
    }

    _stopLoops() {
      if (this._raf) { global.cancelAnimationFrame(this._raf); this._raf = null; }
      if (this._syncTimer) { global.clearInterval(this._syncTimer); this._syncTimer = null; }
    }
  }

  /* ---------- utilitário de tempo ---------- */
  function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return m + ":" + String(r).padStart(2, "0");
  }

  global.MultitrackEngine = MultitrackEngine;
  global.fmtTime = fmtTime;
})(window);
