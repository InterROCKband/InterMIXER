/* =============================================================
   BandTracks — Configuração global
   Edite este arquivo depois de criar o repositório no GitHub.
   ============================================================= */
window.BT_CONFIG = {
  // Nome exibido no topo do site
  bandName: "InterROCK",

  // ---- Repositório do GitHub onde os áudios ficam armazenados ----
  github: {
    owner:  "InterROCKband",     // ex.: "flaviolevis"
    repo:   "InterMIXER",      // nome do repositório
    branch: "main",            // branch publicada no GitHub Pages
    audioDir: "audio",         // pasta dos .mp3 dentro do repositório
    dataFile: "data/songs.json"// catálogo de músicas
  },

  // ---- Área do administrador ----
  // Senha de entrada da área admin (SHA-256 em hexadecimal).
  // Padrão abaixo = "banda2026".  Troque usando admin.html > "Gerar hash".
  adminUser: "admin",
  adminPassHash: "aacb9f92bf0bf319988b9636e02450aa1a7abc807b2a8b5c349f7516acf23d77",

  // Sincronismo entre faixas (segundos). Acima disso o player realinha a faixa.
  // O valor é escalado pela velocidade de reprodução.
  syncTolerance: 0.08,

  // ---- Controle de velocidade ----
  speed: {
    min: 0.25,          // limite inferior do controle fino
    max: 1.00,          // limite superior
    step: 0.05,         // incremento
    // Abaixo deste valor, alguns navegadores podem silenciar o áudio.
    // O player exibe um aviso quando a velocidade cai abaixo daqui.
    safeFloor: 0.50,
    presets: [0.50, 0.65, 0.75, 0.85, 1.00],
    preservePitch: true // manter o tom original ao reduzir a velocidade
  }
};
