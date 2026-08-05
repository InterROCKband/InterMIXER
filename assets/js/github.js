/* =============================================================
   BandTracks — Cliente da API do GitHub (Contents API)
   Permite ao administrador gravar .mp3 e atualizar o catálogo
   diretamente no repositório, a partir do navegador.
   ============================================================= */
(function (global) {
  "use strict";

  const API = "https://api.github.com";

  class GitHubStore {
    constructor(cfg) {
      this.owner  = cfg.owner;
      this.repo   = cfg.repo;
      this.branch = cfg.branch || "main";
      this.token  = cfg.token || "";
    }

    get repoPath() { return this.owner + "/" + this.repo; }

    _headers(extra) {
      return Object.assign({
        "Authorization": "Bearer " + this.token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      }, extra || {});
    }

    async _req(url, opts) {
      const res = await fetch(url, opts);
      if (!res.ok) {
        let msg = res.status + " " + res.statusText;
        try { const j = await res.json(); if (j.message) msg += " — " + j.message; } catch (e) {}
        throw new Error(msg);
      }
      return res.status === 204 ? null : res.json();
    }

    /** Verifica token + permissão de escrita */
    async test() {
      const r = await this._req(API + "/repos/" + this.repoPath, { headers: this._headers() });
      return {
        name: r.full_name,
        private: r.private,
        canWrite: !!(r.permissions && (r.permissions.push || r.permissions.admin))
      };
    }

    /** Lê um arquivo. Retorna {text, sha} ou null se não existir. */
    async getFile(path) {
      const url = API + "/repos/" + this.repoPath + "/contents/" + encodeURI(path) +
                  "?ref=" + encodeURIComponent(this.branch);
      const res = await fetch(url, { headers: this._headers() });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("GET " + path + ": " + res.status);
      const j = await res.json();
      const text = decodeURIComponent(escape(atob(j.content.replace(/\n/g, ""))));
      return { text: text, sha: j.sha };
    }

    /** Grava/atualiza arquivo a partir de conteúdo já em base64 */
    async putBase64(path, base64, message, sha) {
      const body = { message: message, content: base64, branch: this.branch };
      if (sha) body.sha = sha;
      return this._req(API + "/repos/" + this.repoPath + "/contents/" + encodeURI(path), {
        method: "PUT", headers: this._headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(body)
      });
    }

    /** Grava/atualiza arquivo de texto (UTF-8) */
    async putText(path, text, message, sha) {
      const b64 = btoa(unescape(encodeURIComponent(text)));
      return this.putBase64(path, b64, message, sha);
    }

    /** Envia um File/Blob do computador */
    async putFile(path, file, message, onProgress) {
      const b64 = await fileToBase64(file, onProgress);
      const sha = await this.getFileSha(path);
      return this.putBase64(path, b64, message, sha);
    }

    async getFileSha(path) {
      const url = API + "/repos/" + this.repoPath + "/contents/" + encodeURI(path) +
                  "?ref=" + encodeURIComponent(this.branch);
      const res = await fetch(url, { headers: this._headers() });
      if (!res.ok) return null;
      const j = await res.json();
      return j.sha;
    }

    async deleteFile(path, message) {
      const sha = await this.getFileSha(path);
      if (!sha) return null;
      return this._req(API + "/repos/" + this.repoPath + "/contents/" + encodeURI(path), {
        method: "DELETE", headers: this._headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ message: message, sha: sha, branch: this.branch })
      });
    }
  }

  /** File -> base64 (sem o prefixo data:) */
  function fileToBase64(file, onProgress) {
    return new Promise(function (resolve, reject) {
      const fr = new FileReader();
      fr.onload = function () {
        const s = fr.result;
        resolve(s.slice(s.indexOf(",") + 1));
      };
      fr.onerror = function () { reject(new Error("Falha ao ler " + file.name)); };
      if (onProgress) {
        fr.onprogress = function (e) {
          if (e.lengthComputable) onProgress(e.loaded / e.total);
        };
      }
      fr.readAsDataURL(file);
    });
  }

  global.GitHubStore = GitHubStore;
})(window);
