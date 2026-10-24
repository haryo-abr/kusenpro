
"use strict";

// GANTI dengan URL Web App Apps Script Anda.
const SCRIPT_URL =
  "https://script.google.com/macros/s/GANTI_DENGAN_ID_DEPLOYMENT/exec";

const CHANNEL = "KUSENPRO_BRIDGE";
const bridge = document.getElementById("backendBridge");
const form = document.getElementById("loginForm");
const loginButton = document.getElementById("loginButton");
const logoutButton = document.getElementById("logoutButton");
const message = document.getElementById("message");
const dashboard = document.getElementById("dashboard");

let bridgeOrigin = null;
let bridgeReady = false;
let busy = false;
const pending = new Map();

function setMessage(text, type = "") {
  message.textContent = text;
  message.className = "message " + type;
}

function trustedBridgeOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" &&
      (url.hostname === "script.google.com" ||
       url.hostname.endsWith(".googleusercontent.com"));
  } catch (_) {
    return false;
  }
}

function sendRequest(action, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!bridgeReady || !bridgeOrigin) {
      reject(new Error("Bridge belum siap. Muat ulang halaman."));
      return;
    }

    const id = crypto.randomUUID();

    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Backend tidak merespons. Periksa koneksi dan deployment."));
    }, 20000);

    pending.set(id, { resolve, reject, timeout });

    bridge.contentWindow.postMessage({
      channel: CHANNEL,
      type: "REQUEST",
      id,
      action,
      payload
    }, bridgeOrigin);
  });
}

window.addEventListener("message", async (event) => {
  if (event.source !== bridge.contentWindow) return;
  if (!trustedBridgeOrigin(event.origin)) return;

  const data = event.data;
  if (!data || data.channel !== CHANNEL) return;

  if (data.type === "READY") {
    bridgeOrigin = event.origin;
    bridgeReady = true;

    try {
      await sendRequest("ping");
      await restoreSession();
    } catch (error) {
      setMessage(error.message, "error");
    }
    return;
  }

  if (data.type === "RESPONSE" && typeof data.id === "string") {
    const request = pending.get(data.id);
    if (!request) return;

    clearTimeout(request.timeout);
    pending.delete(data.id);

    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
  }
});

function setBusy(value) {
  busy = value;
  loginButton.disabled = value;
  loginButton.textContent = value ? "Memproses..." : "Masuk";
}

function showUser(user) {
  form.hidden = true;
  dashboard.hidden = false;
  document.getElementById("welcomeName").textContent =
    user.full_name || user.username;
  document.getElementById("welcomeRole").textContent =
    "Role: " + (user.role || "Karyawan");
}

function showLogin() {
  form.hidden = false;
  dashboard.hidden = true;
  document.getElementById("password").value = "";
}

async function restoreSession() {
  const token = sessionStorage.getItem("kp_token");
  if (!token) return;

  try {
    const result = await sendRequest("validateSession", { token });

    if (result && result.success && result.user) {
      showUser(result.user);
    } else {
      sessionStorage.removeItem("kp_token");
      sessionStorage.removeItem("kp_user");
      showLogin();
    }
  } catch (error) {
    setMessage(error.message, "error");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  if (!username || !password) {
    setMessage("Username dan password wajib diisi.", "error");
    return;
  }

  setBusy(true);
  setMessage("Memeriksa akun...");

  try {
    const result = await sendRequest("login", { username, password });

    if (!result || !result.success || !result.token || !result.user) {
      throw new Error("Login gagal. Periksa akun Anda.");
    }

    sessionStorage.setItem("kp_token", result.token);
    sessionStorage.setItem("kp_user", JSON.stringify(result.user));
    document.getElementById("password").value = "";

    showUser(result.user);
    setMessage("");
  } catch (error) {
    setMessage(error.message || "Login gagal.", "error");
  } finally {
    setBusy(false);
  }
});

logoutButton.addEventListener("click", async () => {
  const token = sessionStorage.getItem("kp_token");

  try {
    if (token) await sendRequest("logout", { token });
  } catch (_) {
    // Hapus token lokal walaupun koneksi logout gagal.
  }

  sessionStorage.removeItem("kp_token");
  sessionStorage.removeItem("kp_user");
  showLogin();
  setMessage("Anda telah keluar.");
});

bridge.src = SCRIPT_URL + "?bridge=1";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js")
      .catch(error => console.error("PWA service worker:", error));
  });
}
