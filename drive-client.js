// drive-client.js
// Google Drive connector for ACube Xerox expense tracker.
//
// Provides two functions used by app.js:
//   - fetchExpenseData() -> Promise<object>
//   - saveExpenseData(data: object) -> Promise<void>
//
// Uses the same Google Drive OAuth pattern as your VentScript journal.
// JSON is stored in a single Drive file named "expenses_data.json".
// Also keeps a localStorage backup for offline safety.

(function () {
  "use strict";

  // ===== CONFIG =====
  // Reuse the same API key and client ID you used for VentScript.
  const API_KEY = "AIzaSyCgkQ2GWpKqy-z0eZqmSA0t13QCxm5r9DY";
  const CLIENT_ID =
    "79019240158-qa38g7i61r4cof05k7i149gs0v2pq8ih.apps.googleusercontent.com";

  // You can keep full Drive scope like before
  const SCOPES = "https://www.googleapis.com/auth/drive";

  const EXPENSES_FILE_NAME = "expenses_data.json";
  const EXPENSES_FILE_LS_KEY = "acubeExpensesFileId";
  const AUTH_LS_KEY = "acubeExpensesAuthToken";
  const LOCAL_STORAGE_KEY = "acubeExpensesLocalData";

  // ===== STATE =====
  let tokenClient;
  let gapiInited = false;
  let gisInited = false;
  let expensesFileId = null;

  // ===== INITIAL STRUCTURE =====
  function initialExpensesData() {
    return {
      settings: {
        businessName: "ACube Xerox",
        currency: "INR"
      },
      entries: [],
      closedDays: []
    };
  }

  // ===== GOOGLE INIT (called by <script ... onload="...">) =====
  async function initGapiClient() {
    try {
      await gapi.client.init({
        apiKey: API_KEY,
        discoveryDocs: [
          "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"
        ]
      });
      gapiInited = true;
      maybeAutoSignIn();
    } catch (err) {
      console.error("Error initializing gapi client", err);
    }
  }

  function gapiLoaded() {
    if (window.gapi && gapi.load) {
      gapi.load("client", initGapiClient);
    } else {
      console.error("gapi not available");
    }
  }

  function gisLoaded() {
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      console.error("Google Identity Services not available");
      return;
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: () => {}
    });
    gisInited = true;
    maybeAutoSignIn();
  }

  function maybeAutoSignIn() {
    if (!gapiInited || !gisInited || !tokenClient) return;

    const stored = JSON.parse(localStorage.getItem(AUTH_LS_KEY) || "null");
    const now = Date.now();

    // If we already have a valid token in localStorage, reuse it.
    if (stored && stored.access_token && stored.expires_at > now) {
      gapi.client.setToken({ access_token: stored.access_token });
      console.info("[Drive] Using stored token");
      return;
    }

    // Otherwise, try silent token refresh (works only if user already granted access).
    tokenClient.callback = (resp) => {
      if (resp.error) {
        console.info("[Drive] Silent auth not yet granted or failed.", resp);
        return;
      }
      const expiresAt = Date.now() + (resp.expires_in * 1000 - 60_000);
      localStorage.setItem(
        AUTH_LS_KEY,
        JSON.stringify({
          access_token: resp.access_token,
          expires_at: expiresAt
        })
      );
      gapi.client.setToken(resp);
      console.info("[Drive] Silent auth successful");
    };

    try {
      tokenClient.requestAccessToken({ prompt: "" });
    } catch (err) {
      console.warn("[Drive] Silent auth error:", err);
    }
  }

  // ===== PUBLIC SIGN-IN / SIGN-OUT HELPERS (optional UI) =====
  function handleSignIn() {
    if (!gapiInited || !gisInited || !tokenClient) {
      alert("Google libraries not ready yet. Please try again in a moment.");
      return;
    }

    tokenClient.callback = (resp) => {
      if (resp.error) {
        console.error("[Drive] Sign-in failed", resp);
        return;
      }
      const expiresAt = Date.now() + (resp.expires_in * 1000 - 60_000);
      localStorage.setItem(
        AUTH_LS_KEY,
        JSON.stringify({
          access_token: resp.access_token,
          expires_at: expiresAt
        })
      );
      gapi.client.setToken(resp);
      console.info("[Drive] Signed in");
    };

    tokenClient.requestAccessToken({ prompt: "consent" });
  }

  function handleSignOut() {
    try {
      if (
        typeof gapi !== "undefined" &&
        gapi.client &&
        typeof gapi.client.getToken === "function"
      ) {
        const token = gapi.client.getToken();
        if (token && window.google && google.accounts && google.accounts.oauth2) {
          google.accounts.oauth2.revoke(token.access_token);
        }
        gapi.client.setToken(null);
      }
    } catch (err) {
      console.warn("[Drive] Error revoking token", err);
    }

    localStorage.removeItem(AUTH_LS_KEY);
    localStorage.removeItem(EXPENSES_FILE_LS_KEY);
    expensesFileId = null;
    console.info("[Drive] Signed out");
  }

  // ===== DRIVE FILE HELPERS =====
  async function ensureExpensesFile() {
    if (!gapi.client || !gapi.client.drive) {
      throw new Error("Google Drive client not initialized.");
    }

    // 1) Try cached ID from localStorage
    if (!expensesFileId) {
      const cachedId = localStorage.getItem(EXPENSES_FILE_LS_KEY);
      if (cachedId) {
        try {
          const res = await gapi.client.drive.files.get({
            fileId: cachedId,
            fields: "id, trashed"
          });
          if (!res.result.trashed) {
            expensesFileId = cachedId;
          }
        } catch (err) {
          console.warn("[Drive] Cached file not found, searching by name");
        }
      }
    }

    // 2) If still not known, search by name "expenses_data.json"
    if (!expensesFileId) {
      const listRes = await gapi.client.drive.files.list({
        q: `name='${EXPENSES_FILE_NAME}' and trashed=false`,
        fields: "files(id, name)",
        spaces: "drive",
        pageSize: 1
      });

      if (listRes.result.files && listRes.result.files.length > 0) {
        expensesFileId = listRes.result.files[0].id;
        localStorage.setItem(EXPENSES_FILE_LS_KEY, expensesFileId);
      }
    }

    // 3) If still not found, create a new file with initial structure
    if (!expensesFileId) {
      const createRes = await gapi.client.drive.files.create({
        resource: {
          name: EXPENSES_FILE_NAME,
          mimeType: "application/json"
        },
        fields: "id"
      });

      expensesFileId = createRes.result.id;

      await gapi.client.request({
        path: `/upload/drive/v3/files/${expensesFileId}`,
        method: "PATCH",
        params: { uploadType: "media" },
        body: JSON.stringify(initialExpensesData())
      });

      localStorage.setItem(EXPENSES_FILE_LS_KEY, expensesFileId);
      console.info("[Drive] Created new expenses_data.json");
    }

    return expensesFileId;
  }

  async function loadExpensesFromDrive() {
    const fileId = await ensureExpensesFile();

    const res = await gapi.client.request({
      path: `/drive/v3/files/${fileId}`,
      method: "GET",
      params: { alt: "media" }
    });

    let data;
    try {
      data = typeof res.body === "string" ? JSON.parse(res.body) : res.result;
    } catch (err) {
      console.warn(
        "[Drive] expenses_data.json invalid JSON, resetting",
        err
      );
      data = initialExpensesData();
    }

    if (!data || typeof data !== "object") {
      data = initialExpensesData();
    }
    if (!data.settings) data.settings = {};
    if (!Array.isArray(data.entries)) data.entries = [];
    if (!Array.isArray(data.closedDays)) data.closedDays = [];

    return data;
  }

  async function saveExpensesToDrive(data) {
    const fileId = await ensureExpensesFile();

    await gapi.client.request({
      path: `/upload/drive/v3/files/${fileId}`,
      method: "PATCH",
      params: { uploadType: "media" },
      body: JSON.stringify(data)
    });

    console.info("[Drive] Saved expenses_data.json");
  }

  // ===== LOCAL STORAGE FALLBACK =====
  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) return initialExpensesData();
      const data = JSON.parse(raw);

      if (!data.settings) data.settings = {};
      if (!Array.isArray(data.entries)) data.entries = [];
      if (!Array.isArray(data.closedDays)) data.closedDays = [];

      return data;
    } catch (err) {
      console.warn(
        "[Drive] Failed to load expenses from localStorage, reinitializing.",
        err
      );
      return initialExpensesData();
    }
  }

  function saveToLocalStorage(data) {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.warn("[Drive] Failed to save to localStorage:", err);
    }
  }

  // ===== GENERAL HELPERS =====
  function getCurrentToken() {
    try {
      if (
        typeof gapi !== "undefined" &&
        gapi.client &&
        typeof gapi.client.getToken === "function"
      ) {
        return gapi.client.getToken();
      }
    } catch (_) {}
    return null;
  }

  function waitForDriveInit(timeoutMs = 15000) {
    return new Promise((resolve) => {
      const start = Date.now();

      (function check() {
        if (gapiInited && gisInited) {
          resolve();
        } else if (Date.now() - start > timeoutMs) {
          console.warn("[Drive] Client not fully initialized within timeout.");
          resolve();
        } else {
          setTimeout(check, 100);
        }
      })();
    });
  }

  // ===== PUBLIC API USED BY app.js =====
  async function fetchExpenseData() {
    // Make sure we've at least tried to init Drive
    await waitForDriveInit();

    const token = getCurrentToken();
    if (!token) {
      console.warn(
        "[Drive] No token found – loading expenses from localStorage only."
      );
      return loadFromLocalStorage();
    }

    try {
      const data = await loadExpensesFromDrive();
      saveToLocalStorage(data); // keep a local backup
      return data;
    } catch (err) {
      console.error(
        "[Drive] Error loading expenses from Drive. Falling back to local.",
        err
      );
      return loadFromLocalStorage();
    }
  }

  async function saveExpenseData(data) {
    if (!data || typeof data !== "object") {
      throw new Error("saveExpenseData: data must be an object.");
    }

    await waitForDriveInit();

    // Always keep a local copy
    saveToLocalStorage(data);

    const token = getCurrentToken();
    if (!token) {
      // Let app.js know Drive wasn't updated (it will show a toast error)
      throw new Error("Not signed in to Google Drive.");
    }

    try {
      await saveExpensesToDrive(data);
    } catch (err) {
      console.error("[Drive] Error saving expenses to Drive:", err);
      throw err;
    }
  }

  // ===== EXPORT TO WINDOW =====
  window.gapiLoaded = gapiLoaded;
  window.gisLoaded = gisLoaded;

  window.fetchExpenseData = fetchExpenseData;
  window.saveExpenseData = saveExpenseData;

  // Optional: hook these to Sign in / Sign out buttons in your expenses UI
  window.driveSignIn = handleSignIn;
  window.driveSignOut = handleSignOut;
})();
