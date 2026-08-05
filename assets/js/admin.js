/* =============================================================
   BandTracks — Área do administrador
   Login local + envio de pistas para o GitHub (Contents API)
   ============================================================= */
(function () {
  "use strict";

  const CFG = window.BT_CONFIG;
  const $ = function (s) { return document.querySelector(s); };
  const LS = {
    auth: "bt_auth", token: "bt_gh_token", owner: "bt_gh_owner",
    repo: "bt_gh_repo", branch: "bt_gh_branch"
  };

  let store = null;
  let catalog = { version: 1, songs: [] };
  let catalogSha = null;

  /* ================= LOGIN ================= */
  async function sha256(txt) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt));
    return Array.from(new Uint8Array(buf)).map(function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }

  $("#loginForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    const u = $("#loginUser").value.trim();
    const h = await sha256($("#loginPass").value);
    if (u === CFG.adminUser && h === CFG.adminPassHash) {
      sessionStorage.setItem(LS.auth, "1");
      showAdmin();
    } else {
      $("#loginErr").textContent = "Usuário ou senha incorretos.";
    }
  });

  $("#hashGen").addEventListener("click", async function () {
    const p = prompt("Digite a nova senha para gerar o hash SHA-256:");
    if (!p) return;
    const h = await sha256(p);
    prompt("Copie o hash abaixo e cole em config.js (adminPassHash):", h);
  });

  $("#logoutBtn").addEventListener("click", function () {
    sessionStorage.removeItem(LS.auth);
    location.reload();
  });

  function showAdmin() {
    $("#loginScreen").style.display = "none";
    $("#adminApp").style.display = "block";
    loadSettings();
  }

  /* ================= CONFIGURAÇÃO DO GITHUB ================= */
  function loadSettings() {
    $("#ghOwner").value  = localStorage.getItem(LS.owner)  || CFG.github.owner;
    $("#ghRepo").value   = localStorage.getItem(LS.repo)   || CFG.github.repo;
    $("#ghBranch").value = localStorage.getItem(LS.branch) || CFG.github.branch;
    $("#ghToken").value  = localStorage.getItem(LS.token)  || "";
    if ($("#ghToken").value) connect(true);
  }

  function buildStore() {
    return new GitHubStore({
      owner:  $("#ghOwner").value.trim(),
      repo:   $("#ghRepo").value.trim(),
      branch: $("#ghBranch").value.trim() || "main",
      token:  $("#ghToken").value.trim()
    });
  }

  async function connect(silent) {
    store = buildStore();
    if (!store.token) { setStatus(false, "Token não informado"); return; }
    localStorage.setItem(LS.owner, store.owner);
    localStorage.setItem(LS.repo, store.repo);
    localStorage.setItem(LS.branch, store.branch);
    if ($("#rememberToken").checked) localStorage.setItem(LS.token, store.token);

    try {
      const info = await store.test();
      setStatus(info.canWrite, info.name + (info.canWrite ? " · escrita OK" : " · SEM permissão de escrita"));
      if (!silent) log("Conectado a " + info.name, "ok");
      await loadCatalog();
    } catch (err) {
      setStatus(false, err.message);
      log("Falha na conexão: " + err.message, "err");
    }
  }

  function setStatus(ok, msg) {
    const b = $("#ghStatus");
    b.className = "badge " + (ok ? "on" : "off");
    b.textContent = ok ? "conectado" : "desconectado";
    $("#ghStatusMsg").textContent = msg || "";
    $("#btnPublish").disabled = !ok;
  }

  $("#btnConnect").addEventListener("click", function () { connect(false); });
  $("#btnForget").addEventListener("click", function () {
    localStorage.removeItem(LS.token);
    $("#ghToken").value = "";
    setStatus(false, "Token removido deste navegador.");
  });

  /* ================= CATÁLOGO ================= */
  async function loadCatalog() {
    try {
      const f = await store.getFile(CFG.github.dataFile);
      if (f) { catalog = JSON.parse(f.text); catalogSha = f.sha; }
      else { catalog = { version: 1, songs: [] }; catalogSha = null; }
    } catch (e) {
      log("Erro lendo catálogo: " + e.message, "err");
      catalog = { version: 1, songs: [] }; catalogSha = null;
    }
    if (!catalog.songs) catalog.songs = [];
    renderCatalog();
  }

  function renderCatalog() {
    const box = $("#songAdmin");
    box.innerHTML = "";
    if (!catalog.songs.length) {
      box.innerHTML = '<p class="hint" style="margin:0">Nenhuma música publicada ainda.</p>';
      return;
    }
    catalog.songs.forEach(function (s) {
      const d = document.createElement("div");
      d.className = "adm-song";
      d.innerHTML = '<div class="info"><b></b><span></span></div><button class="btn danger">Excluir</button>';
      d.querySelector("b").textContent = s.title;
      d.querySelector("span").textContent =
        (s.artist ? s.artist + " · " : "") + s.tracks.length + " pistas · " +
        s.tracks.map(function (t) { return t.name; }).join(", ");
      d.querySelector("button").addEventListener("click", function () { removeSong(s); });
      box.appendChild(d);
    });
  }

  async function removeSong(song) {
    if (!confirm('Excluir "' + song.title + '" e todos os seus arquivos de áudio?')) return;
    try {
      for (const t of song.tracks) {
        await store.deleteFile(t.file, "remove: " + t.file);
        log("Removido " + t.file, "ok");
      }
      catalog.songs = catalog.songs.filter(function (s) { return s.id !== song.id; });
      await saveCatalog("remove música: " + song.title);
      renderCatalog();
      log("Música excluída.", "ok");
    } catch (e) {
      log("Erro ao excluir: " + e.message, "err");
    }
  }

  async function saveCatalog(msg) {
    const cur = await store.getFile(CFG.github.dataFile);
    catalogSha = cur ? cur.sha : null;
    const res = await store.putText(
      CFG.github.dataFile, JSON.stringify(catalog, null, 2), msg, catalogSha
    );
    catalogSha = res.content.sha;
  }

  /* ================= FORMULÁRIO DE NOVA MÚSICA ================= */
  const trkBox = $("#trackRows");

  function addTrackRow(name) {
    const i = trkBox.children.length;
    const row = document.createElement("div");
    row.className = "trk-row";
    row.innerHTML =
      '<div class="idx">' + (i + 1) + '</div>' +
      '<input type="text" class="tname" placeholder="Nome da pista (ex.: Bateria)">' +
      '<input type="file" class="tfile" accept="audio/*">' +
      '<button class="del" title="Remover">&times;</button>';
    row.querySelector(".tname").value = name || "";
    row.querySelector(".del").addEventListener("click", function () { row.remove(); renumber(); });
    trkBox.appendChild(row);
  }

  function renumber() {
    Array.from(trkBox.children).forEach(function (r, i) {
      r.querySelector(".idx").textContent = i + 1;
    });
    $("#nTracks").value = trkBox.children.length;
  }

  $("#btnAddTrack").addEventListener("click", function () { addTrackRow(); renumber(); });
  $("#btnSetTracks").addEventListener("click", function () {
    const n = Math.max(1, Math.min(24, parseInt($("#nTracks").value, 10) || 1));
    trkBox.innerHTML = "";
    const sug = ["Bateria", "Baixo", "Guitarra", "Violão", "Teclado", "Voz principal",
                 "Backing vocal", "Percussão", "Sopros", "Guia/Clique"];
    for (let i = 0; i < n; i++) addTrackRow(sug[i] || "");
    renumber();
  });

  function slug(s) {
    return (s || "").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "faixa";
  }

  $("#btnPublish").addEventListener("click", async function () {
    const title  = $("#sTitle").value.trim();
    const artist = $("#sArtist").value.trim();
    const notes  = $("#sNotes").value.trim();
    if (!title) { alert("Informe o nome da música."); return; }

    const rows = Array.from(trkBox.children);
    if (!rows.length) { alert("Adicione pelo menos uma pista."); return; }

    const items = [];
    for (let i = 0; i < rows.length; i++) {
      const name = rows[i].querySelector(".tname").value.trim() || ("Pista " + (i + 1));
      const file = rows[i].querySelector(".tfile").files[0];
      if (!file) { alert('Selecione o arquivo de áudio da pista "' + name + '".'); return; }
      items.push({ name: name, file: file });
    }

    const songSlug = slug(title);
    const songId = songSlug + "-" + Date.now().toString(36);
    const dir = CFG.github.audioDir + "/" + songSlug;

    $("#btnPublish").disabled = true;
    setProgress(0);
    log('Publicando "' + title + '" (' + items.length + " pistas)...");

    const tracks = [];
    try {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const ext = (it.file.name.split(".").pop() || "mp3").toLowerCase();
        const path = dir + "/" + String(i + 1).padStart(2, "0") + "-" + slug(it.name) + "." + ext;

        log("↑ " + it.file.name + " → " + path + " (" + (it.file.size / 1048576).toFixed(1) + " MB)");
        await store.putFile(path, it.file, "add: " + path);
        tracks.push({ name: it.name, file: path, volume: 0.85 });

        setProgress(((i + 1) / (items.length + 1)) * 100);
        log("  gravado", "ok");
      }

      catalog.songs.push({
        id: songId, title: title, artist: artist, notes: notes,
        createdAt: new Date().toISOString(), tracks: tracks
      });
      await saveCatalog("add música: " + title);
      setProgress(100);
      log("Catálogo atualizado. Música publicada!", "ok");

      $("#sTitle").value = ""; $("#sArtist").value = ""; $("#sNotes").value = "";
      trkBox.innerHTML = ""; renumber();
      renderCatalog();
    } catch (e) {
      log("ERRO: " + e.message, "err");
      alert("Falha ao publicar: " + e.message);
    } finally {
      $("#btnPublish").disabled = false;
    }
  });

  function setProgress(p) { $("#pubBar").style.width = p + "%"; }

  function log(msg, cls) {
    const box = $("#log");
    const line = document.createElement("div");
    if (cls) line.className = cls;
    line.textContent = "[" + new Date().toLocaleTimeString("pt-BR") + "] " + msg;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  /* ================= INÍCIO ================= */
  if (sessionStorage.getItem(LS.auth) === "1") showAdmin();
  $("#admBandName").textContent = CFG.bandName || "BandTracks";
  addTrackRow("Bateria"); addTrackRow("Baixo"); addTrackRow("Guitarra"); renumber();
})();
