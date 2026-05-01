document.addEventListener('DOMContentLoaded', () => {
  const videoPlayer = document.getElementById('videoPlayer');
  if (!videoPlayer) {
    console.error('The videoPlayer element was not found.');
    return;
  }

  const playlistOverlay = document.getElementById('playlistOverlay');
  const togglePlaylistBtn = document.getElementById('togglePlaylist');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const pipBtn = document.getElementById('pipBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const speedSelect = document.getElementById('speedSelect');

  const nextOverlay = document.getElementById('nextOverlay');
  const nextTitle = document.getElementById('nextTitle');
  const countEl = document.getElementById('count');
  const cancelNext = document.getElementById('cancelNext');

  const osdOverlay = document.getElementById('kbdOverlay');
  const lastWatchedInfo = document.getElementById('lastWatchedInfo');
  const videoWrapper = document.querySelector('.video-wrapper');
  let watchHistorySection = document.getElementById('watchHistorySection');
  let watchHistoryList = document.getElementById('watchHistoryList');
  let watchHistoryEmpty = document.getElementById('watchHistoryEmpty');
  let clearWatchHistoryBtn = document.getElementById('clearWatchHistory');

  function ensureWatchHistoryElements() {
    const playerContainer = document.querySelector('.player-container');

    if (!watchHistorySection) {
      watchHistorySection = document.querySelector('.watch-history');
      if (watchHistorySection) watchHistorySection.id = 'watchHistorySection';
    }

    if (!watchHistorySection) {
      watchHistorySection = document.createElement('section');
      watchHistorySection.className = 'watch-history';
      watchHistorySection.id = 'watchHistorySection';
      if (playerContainer) playerContainer.insertAdjacentElement('afterend', watchHistorySection);
      else document.body.appendChild(watchHistorySection);
    }

    let head = watchHistorySection.querySelector('.watch-history-head');
    if (!head) {
      const oldHeader = watchHistorySection.querySelector('.history-header');
      if (oldHeader) oldHeader.remove();
      head = document.createElement('div');
      head.className = 'watch-history-head';
      watchHistorySection.prepend(head);
    }

    if (!head.querySelector('h2')) {
      const titleWrap = document.createElement('div');
      titleWrap.innerHTML = '<h2>Watch History</h2><p>Your recently watched videos and saved progress will appear here</p>';
      head.prepend(titleWrap);
    }

    clearWatchHistoryBtn = document.getElementById('clearWatchHistory');
    if (!clearWatchHistoryBtn) {
      clearWatchHistoryBtn = document.createElement('button');
      clearWatchHistoryBtn.className = 'history-clear-btn';
      clearWatchHistoryBtn.id = 'clearWatchHistory';
      clearWatchHistoryBtn.type = 'button';
      clearWatchHistoryBtn.textContent = 'Clear History';
      head.appendChild(clearWatchHistoryBtn);
    }

    watchHistoryList = document.getElementById('watchHistoryList');
    if (!watchHistoryList) {
      watchHistoryList = document.createElement('div');
      watchHistoryList.className = 'watch-history-list';
      watchHistoryList.id = 'watchHistoryList';
      watchHistorySection.appendChild(watchHistoryList);
    }

    watchHistoryEmpty = document.getElementById('watchHistoryEmpty');
    if (!watchHistoryEmpty) {
      watchHistoryEmpty = watchHistoryList.querySelector('.watch-history-empty') || watchHistoryList.querySelector('.history-empty');
      if (watchHistoryEmpty) {
        watchHistoryEmpty.className = 'watch-history-empty';
        watchHistoryEmpty.id = 'watchHistoryEmpty';
        watchHistoryEmpty.textContent = 'History is empty';
      }
    }

    if (!watchHistoryEmpty) {
      watchHistoryEmpty = document.createElement('div');
      watchHistoryEmpty.className = 'watch-history-empty';
      watchHistoryEmpty.id = 'watchHistoryEmpty';
      watchHistoryEmpty.textContent = 'History is empty';
      watchHistoryList.appendChild(watchHistoryEmpty);
    }
  }

  ensureWatchHistoryElements();

  const originalPlaylistSeasonsHtml = playlistOverlay
    ? Array.from(playlistOverlay.querySelectorAll('.season')).map((el) => el.outerHTML).join('')
    : '';
  let playlistItems = playlistOverlay ? Array.from(playlistOverlay.querySelectorAll('li[data-src]')) : [];

  // --- Constants / tuning for big playlists ---
  const SAVE_EVERY_MS = 5000;          // write progress at most once per 5s while playing
  const SAVE_MIN_DELTA_SEC = 1.0;      // don't write tiny time jitters
  const UI_UPDATE_MS = 250;            // update UI (progress/title) at most every 250ms
  const PROGRESS_BATCH = 120;          // progress bar paint batch size
  const HISTORY_LIMIT = 8;             // visible recent items under player

  const HIDE_DELAY = 3000;

  const originalTitle = document.querySelector('title')?.textContent || 'Video Player';

  const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;

  // Xbox console (Edge) detection: used only for CSS-based UI hiding
  const isXbox = /Xbox/i.test(navigator.userAgent || '');
  if (isXbox) document.documentElement.classList.add('is-xbox');

  // --- Small helpers ---
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const idle = (cb) => {
    if (typeof window.requestIdleCallback === 'function') {
      return window.requestIdleCallback(cb, { timeout: 1200 });
    }
    return window.setTimeout(() => cb({ timeRemaining: () => 0, didTimeout: true }), 0);
  };

  const cancelIdle = (id) => {
    if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(id);
    else window.clearTimeout(id);
  };

  function throttle(fn, waitMs) {
    let last = 0;
    let timer = null;
    let lastArgs = null;

    return function throttled(...args) {
      const now = Date.now();
      lastArgs = args;

      const run = () => {
        last = Date.now();
        timer = null;
        fn(...lastArgs);
      };

      if (!last || (now - last) >= waitMs) {
        run();
      } else if (!timer) {
        timer = setTimeout(run, waitMs - (now - last));
      }
    };
  }

  function debounce(fn, waitMs) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), waitMs);
    };
  }

  // --- Canonical key utils (so relative/absolute/%20 all match) ---
  function safeDecode(str) {
    try { return decodeURIComponent(str); } catch { return str; }
  }

  function videoKeyFromSrc(src) {
    const raw = (src || '').split('?')[0].split('#')[0];
    try {
      const u = new URL(raw, window.location.href);
      const path = safeDecode(u.pathname).replace(/^\/+/, '');
      return path.toLowerCase();
    } catch {
      return safeDecode(raw).replace(/^\/+/, '').toLowerCase();
    }
  }

  // --- Playlist index (cache DOM refs for speed) ---
  let playlistMeta = new Map(); // key -> { key, index, item, src, title, bar, fileName, isFolderFile }
  let metasInOrder = [];

  function keyFromPlaylistItem(li) {
    return li?.dataset?.key || videoKeyFromSrc(li?.dataset?.src || '');
  }

  function rebuildPlaylistIndex() {
    playlistItems = playlistOverlay ? Array.from(playlistOverlay.querySelectorAll('li[data-src]')) : [];
    playlistMeta = new Map();

    playlistItems.forEach((li, idx) => {
      const src = li.dataset.src || '';
      const key = keyFromPlaylistItem(li);
      if (!key || playlistMeta.has(key)) return;

      const title = li.querySelector('.item-title')?.textContent?.trim()
        || li.dataset.title
        || src;

      const bar = li.querySelector('.item-progress-bar') || null;

      playlistMeta.set(key, {
        key,
        index: idx,
        item: li,
        src,
        title,
        bar,
        fileName: li.dataset.fileName || '',
        isFolderFile: li.dataset.folderFile === '1'
      });
    });

    metasInOrder = Array.from(playlistMeta.values()).sort((a, b) => a.index - b.index);
    if (currentActive) currentActive = playlistMeta.get(currentActive.key) || null;
    if (currentActive) currentIndex = currentActive.index;
    else currentIndex = -1;
  }

  function getMetaBySrc(src) {
    const raw = String(src || '');
    if (!raw) return null;

    if (playlistMeta.has(raw)) return playlistMeta.get(raw);

    const canonical = videoKeyFromSrc(raw);
    if (playlistMeta.has(canonical)) return playlistMeta.get(canonical);

    return metasInOrder.find((meta) => {
      return meta.src === raw || meta.key === raw || videoKeyFromSrc(meta.src) === canonical;
    }) || null;
  }

  function indexOfSrc(src) {
    const m = getMetaBySrc(src);
    return m ? m.index : -1;
  }

  // Initial index is built after navigation state variables are declared.

  // --- IndexedDB (single store, versionless open) ---
  const DB_NAME = 'VideoProgressDB';
  const STORE_NAME = 'progressStore';
  let db = null;

  function openDB() {
    return new Promise((resolve) => {
      if (!('indexedDB' in window)) return resolve(null);

      const req = indexedDB.open(DB_NAME);
      req.onupgradeneeded = (e) => {
        const _db = e.target.result;
        if (!_db.objectStoreNames.contains(STORE_NAME)) {
          _db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => {
        db = e.target.result;
        resolve(db);
      };
      req.onerror = () => resolve(null);
    });
  }

  function withStore(mode, fn) {
    return new Promise(async (resolve) => {
      if (!db) await openDB();
      if (!db) return resolve(null);

      let tx;
      try {
        tx = db.transaction([STORE_NAME], mode);
      } catch (e) {
        console.error('IndexedDB tx error:', e);
        return resolve(null);
      }

      const store = tx.objectStore(STORE_NAME);
      try {
        const res = fn(store, tx);
        resolve(res);
      } catch (e) {
        console.error('IndexedDB op error:', e);
        resolve(null);
      }
    });
  }

  function idbGet(id) {
    return withStore('readonly', (store) => new Promise((resolve) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    }));
  }

  function idbGetAll() {
    return withStore('readonly', (store) => new Promise((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    }));
  }

  function idbPutMany(pairs) {
    return withStore('readwrite', (store) => new Promise((resolve) => {
      try {
        for (const { id, value } of pairs) store.put({ id, value });
      } catch (e) {
        console.error('IndexedDB putMany error:', e);
      }
      resolve(true);
    }));
  }


  function idbDeleteMatching(predicate) {
    return withStore('readwrite', (store) => new Promise((resolve) => {
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return resolve(true);

        try {
          if (predicate(cursor.key, cursor.value)) cursor.delete();
        } catch (err) {
          console.error('IndexedDB delete predicate error:', err);
        }

        cursor.continue();
      };
      req.onerror = () => resolve(false);
    }));
  }

  // New keys
  const VOLUME_KEY = 'videoVolume';
  const PLAYBACK_RATE_KEY = 'playbackRate';
  const LAST_PLAYED_KEY = 'lastPlayedKey';   // canonical key
  const LAST_PLAYED_SRC_KEY = 'lastPlayedSrc'; // legacy/backward compatible
  const PROGRESS_PREFIX = 'v:';              // v:<key> => { t, d, updatedAt }

  // Legacy keys support (your old script stores these)
  function legacyTimeId(src) { return `time_${encodeURIComponent(src)}`; }
  function legacyDurId(src) { return `duration_${encodeURIComponent(src)}`; }

  // In-memory cache for speed (no DB reads during playback)
  const progressCache = new Map(); // key -> { t, d, updatedAt }

  // --- Local folder picker (Chrome/Edge + localhost) ---
  const FOLDER_HANDLE_KEY = 'localFolderHandle';
  const FOLDER_INFO_KEY = 'localFolderInfo';
  const SUPPORTED_VIDEO_EXTENSIONS = new Set([
    '.mp4', '.mkv', '.webm', '.mov', '.m4v', '.avi', '.wmv', '.flv', '.ts', '.m2ts', '.3gp', '.ogv'
  ]);

  const folderObjectUrls = new Map(); // key -> blob url
  let currentFolderHandle = null;
  let currentFolderName = '';
  let folderStatusEl = null;
  let openFolderBtn = null;
  let reloadFolderBtn = null;
  let clearFolderBtn = null;
  let deleteCurrentBtn = null;

  // --- JSON log on Node server ---
  function makePlayerLogPayload(meta, progress = {}) {
    const time = Number(progress.t ?? videoPlayer.currentTime ?? 0) || 0;
    const duration = Number(progress.d ?? videoPlayer.duration ?? 0) || 0;
    const updatedAtMs = Number(progress.updatedAt) || Date.now();
    const percent = duration > 0 ? clamp((time / duration) * 100, 0, 100) : 0;

    return {
      key: meta?.key || '',
      title: meta?.title || '',
      src: meta?.src || '',
      fileName: meta?.fileName || meta?.src || '',
      folderName: currentFolderName || '',
      isFolderFile: Boolean(meta?.isFolderFile),
      time,
      duration,
      timeText: formatClock(time),
      durationText: duration > 0 ? formatClock(duration) : '',
      percent: Math.round(percent * 100) / 100,
      updatedAt: new Date(updatedAtMs).toISOString()
    };
  }

  function postPlayerLog(endpoint, payload, { beacon = false } = {}) {
    try {
      const body = JSON.stringify(payload || {});

      if (beacon && navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(endpoint, blob);
        return Promise.resolve(true);
      }

      return fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
      }).then((res) => res.ok).catch(() => false);
    } catch {
      return Promise.resolve(false);
    }
  }

  function logLastWatchedToJson(meta, progress, options = {}) {
    if (!meta) return Promise.resolve(false);
    return postPlayerLog('/api/player-log/last-watched', makePlayerLogPayload(meta, progress), options);
  }

  function logDeletedToJson(meta, progress = {}) {
    if (!meta) return Promise.resolve(false);
    const payload = {
      ...makePlayerLogPayload(meta, progress),
      deletedFromPlaylist: true
    };
    return postPlayerLog('/api/player-log/deleted', payload);
  }

  function logFolderRemovedToJson(payload = {}) {
    return postPlayerLog('/api/player-log/folder-removed', {
      folderName: currentFolderName || payload.folderName || '',
      videoCount: Number(payload.videoCount) || 0,
      currentVideo: currentActive?.isFolderFile ? makePlayerLogPayload(currentActive) : null,
      removedFromPlaylistOnly: true
    });
  }

  function resetPlayerLogJsonAfterFolderRemove(payload = {}) {
    return postPlayerLog('/api/player-log/reset', {
      reason: 'folder_removed_from_playlist',
      folderName: currentFolderName || payload.folderName || '',
      videoCount: Number(payload.videoCount) || 0
    });
  }

  const naturalVideoSorter = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base'
  });

  function isFileSystemAccessSupported() {
    return typeof window.showDirectoryPicker === 'function';
  }

  function normalizeRelativePath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  }

  function extname(name) {
    const clean = String(name || '').split('?')[0].split('#')[0];
    const dot = clean.lastIndexOf('.');
    return dot >= 0 ? clean.slice(dot).toLowerCase() : '';
  }

  function isSupportedVideoFile(name) {
    // The selected folder may contain photos, HTML, CSS, JS, and other files.
    // Only supported video extensions are added to the playlist.
    const ext = extname(name);
    if (!ext) return false;
    return SUPPORTED_VIDEO_EXTENSIONS.has(ext);
  }

  function makeFolderVideoKey(folderName, relativePath, file) {
    const stableName = normalizeRelativePath(relativePath).toLowerCase();
    const size = file && Number.isFinite(file.size) ? file.size : 0;
    return `folder:${String(folderName || 'folder').toLowerCase()}/${stableName}/${size}`;
  }

  function setFolderStatus(text, kind = '') {
    ensureFolderControls();
    if (!folderStatusEl) return;
    folderStatusEl.textContent = text || '';
    folderStatusEl.dataset.kind = kind;
  }

  function revokeFolderObjectUrls() {
    for (const url of folderObjectUrls.values()) {
      try { URL.revokeObjectURL(url); } catch {}
    }
    folderObjectUrls.clear();
  }

  function ensureFolderControls() {
    if (!playlistOverlay) return;

    let panel = playlistOverlay.querySelector('#folderPickerPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'folderPickerPanel';
      panel.className = 'folder-picker-panel';
      panel.innerHTML = `
        <div class="folder-picker-title">Local Folder</div>
        <div class="folder-picker-actions">
          <button id="openVideoFolder" class="folder-picker-btn" type="button">Choose Folder</button>
          <button id="reloadSavedFolder" class="folder-picker-btn muted" type="button">Last Folder</button>
          <button id="clearSelectedFolder" class="folder-picker-btn danger" type="button">Remove Folder</button>
        </div>
        <div id="folderPickerStatus" class="folder-picker-status"></div>
      `;

      const firstSeason = playlistOverlay.querySelector('.season');
      if (firstSeason) firstSeason.insertAdjacentElement('beforebegin', panel);
      else playlistOverlay.appendChild(panel);
    }

    openFolderBtn = document.getElementById('openVideoFolder');
    reloadFolderBtn = document.getElementById('reloadSavedFolder');
    clearFolderBtn = document.getElementById('clearSelectedFolder');
    folderStatusEl = document.getElementById('folderPickerStatus');

    if (!isFileSystemAccessSupported()) {
      if (openFolderBtn) openFolderBtn.disabled = true;
      if (reloadFolderBtn) reloadFolderBtn.disabled = true;
      if (clearFolderBtn) clearFolderBtn.disabled = true;
      if (folderStatusEl) {
        folderStatusEl.textContent = 'Direct folder selection works in Chrome/Edge on localhost.';
        folderStatusEl.dataset.kind = 'warn';
      }
      return;
    }

    if (openFolderBtn && !openFolderBtn.dataset.bound) {
      openFolderBtn.dataset.bound = '1';
      openFolderBtn.addEventListener('click', openFolderPicker);
    }

    if (reloadFolderBtn && !reloadFolderBtn.dataset.bound) {
      reloadFolderBtn.dataset.bound = '1';
      reloadFolderBtn.addEventListener('click', () => restoreSavedFolderPlaylist({ promptIfNeeded: true, autoplay: false }));
    }

    if (clearFolderBtn && !clearFolderBtn.dataset.bound) {
      clearFolderBtn.dataset.bound = '1';
      clearFolderBtn.addEventListener('click', () => clearSelectedFolder({ ask: true }));
    }

    // A small duplicate button in the top controls makes folder selection easier.
    const controls = document.querySelector('.controls-overlay');
    if (controls && !document.getElementById('openVideoFolderTop')) {
      const topBtn = document.createElement('button');
      topBtn.id = 'openVideoFolderTop';
      topBtn.className = 'control-btn';
      topBtn.type = 'button';
      topBtn.textContent = 'Folder';
      topBtn.addEventListener('click', openFolderPicker);
      controls.appendChild(topBtn);
    }

    if (controls && !document.getElementById('deleteCurrentVideoBtn')) {
      deleteCurrentBtn = document.createElement('button');
      deleteCurrentBtn.id = 'deleteCurrentVideoBtn';
      deleteCurrentBtn.className = 'control-btn danger-control-btn';
      deleteCurrentBtn.type = 'button';
      deleteCurrentBtn.textContent = 'Delete';
      deleteCurrentBtn.title = 'Delete the current video from disk';
      deleteCurrentBtn.addEventListener('click', deleteCurrentVideo);
      controls.appendChild(deleteCurrentBtn);
    } else {
      deleteCurrentBtn = document.getElementById('deleteCurrentVideoBtn');
    }
  }

  async function ensureHandlePermission(handle, { readWrite = false, prompt = false } = {}) {
    if (!handle || typeof handle.queryPermission !== 'function') return 'denied';

    const options = { mode: readWrite ? 'readwrite' : 'read' };
    let permission = await handle.queryPermission(options).catch(() => 'denied');

    if (permission !== 'granted' && prompt && typeof handle.requestPermission === 'function') {
      permission = await handle.requestPermission(options).catch(() => 'denied');
    }

    return permission;
  }

  async function collectVideoFilesFromDirectory(dirHandle, basePath = '') {
    const files = [];

    for await (const [name, handle] of dirHandle.entries()) {
      const relativePath = normalizeRelativePath(basePath ? `${basePath}/${name}` : name);

      if (handle.kind === 'file') {
        if (!isSupportedVideoFile(name)) continue;
        const file = await handle.getFile();
        files.push({ name, relativePath, file, handle });
      } else if (handle.kind === 'directory') {
        const nested = await collectVideoFilesFromDirectory(handle, relativePath);
        files.push(...nested);
      }
    }

    return files;
  }

  function buildFolderPlaylist(files, folderName) {
    if (!playlistOverlay) return;

    revokeFolderObjectUrls();
    playlistOverlay.querySelectorAll('.season').forEach((el) => el.remove());

    const section = document.createElement('div');
    section.className = 'season folder-season';
    section.id = 'selectedFolderSeason';

    const header = document.createElement('h4');
    header.textContent = `${folderName || 'Selected Folder'} • ${files.length} videos`;
    section.appendChild(header);

    const ul = document.createElement('ul');
    const frag = document.createDocumentFragment();

    files.forEach((entry, idx) => {
      const key = makeFolderVideoKey(folderName, entry.relativePath, entry.file);
      const objectUrl = URL.createObjectURL(entry.file);
      folderObjectUrls.set(key, objectUrl);

      const title = entry.relativePath.replace(/\.[^.]+$/, '').replace(/[._-]+/g, ' ').trim() || entry.relativePath;

      const li = document.createElement('li');
      li.dataset.src = objectUrl;
      li.dataset.key = key;
      li.dataset.title = title;
      li.dataset.fileName = entry.relativePath;
      li.dataset.folderFile = '1';
      li.tabIndex = 0;
      li.innerHTML = `
        <span class="item-title">${escapeHtml(title)}</span>
        <span class="item-file">${escapeHtml(entry.relativePath)}</span>
        <button class="folder-video-delete" type="button" data-delete-key="${escapeHtml(key)}" title="Delete from disk">Delete</button>
        <div class="item-progress">
          <div class="item-progress-bar" style="width:0%"></div>
        </div>
      `;
      frag.appendChild(li);
    });

    ul.appendChild(frag);
    section.appendChild(ul);
    playlistOverlay.appendChild(section);

    rebuildPlaylistIndex();
    paintAllProgressBars();
    renderHistory();
    updateNavigationButtonsByIndex(currentIndex);
  }

  async function loadFolderHandle(handle, { autoplay = false, makeActive = true } = {}) {
    if (!handle) return false;

    const permission = await ensureHandlePermission(handle, { readWrite: false, prompt: false });
    if (permission !== 'granted') {
      setFolderStatus('Opening the last folder requires permission. Click "Last Folder".', 'warn');
      return false;
    }

    const files = await collectVideoFilesFromDirectory(handle);
    files.sort((a, b) => naturalVideoSorter.compare(a.relativePath, b.relativePath));

    if (!files.length) {
      setFolderStatus('No supported video files were found in this folder.', 'warn');
      showOSD('The folder is empty');
      return false;
    }

    currentFolderHandle = handle;
    currentFolderName = handle.name || 'Selected Folder';

    buildFolderPlaylist(files, currentFolderName);

    await idbPutMany([
      { id: FOLDER_HANDLE_KEY, value: handle },
      { id: FOLDER_INFO_KEY, value: { name: currentFolderName, count: files.length, updatedAt: Date.now() } }
    ]);

    setFolderStatus(`Opened: ${currentFolderName} (${files.length} videos)`, 'ok');
    showOSD(`Folder added: ${files.length} videos`);

    if (makeActive && metasInOrder.length) {
      const lastKeyRec = await idbGet(LAST_PLAYED_KEY);
      const savedMeta = lastKeyRec?.value ? playlistMeta.get(String(lastKeyRec.value)) : null;
      const startMeta = savedMeta || metasInOrder[0];

      setSource(startMeta.src);
      videoPlayer.load();
      highlightCurrentBySrc(startMeta.src);
      updateMediaSession();

      videoPlayer.addEventListener('loadedmetadata', () => {
        const p = progressCache.get(startMeta.key);
        if (p && p.t > 1) {
          try { videoPlayer.currentTime = p.t; } catch {}
        }
        if (autoplay) videoPlayer.play().catch(() => {});
      }, { once: true });
    }

    return true;
  }

  async function openFolderPicker() {
    if (!isFileSystemAccessSupported()) {
      showOSD('Chrome/Edge + localhost required');
      return;
    }

    try {
      let handle;
      try {
        handle = await window.showDirectoryPicker({
          id: 'video-player-folder',
          mode: 'readwrite',
          startIn: 'videos'
        });
      } catch (pickerErr) {
        // Older Chromium builds may not support every option above.
        if (pickerErr?.name === 'TypeError') handle = await window.showDirectoryPicker();
        else throw pickerErr;
      }

      const permission = await ensureHandlePermission(handle, { readWrite: true, prompt: true });
      if (permission !== 'granted') {
        setFolderStatus('The folder was selected, but delete permission is missing. Playback will still work.', 'warn');
      }

      await loadFolderHandle(handle, { autoplay: false, makeActive: true });

      if (playlistOverlay && !playlistOverlay.classList.contains('open')) {
        playlistOverlay.classList.add('open');
        togglePlaylistBtn?.setAttribute('aria-expanded', 'true');
        if (togglePlaylistBtn) togglePlaylistBtn.textContent = 'Close Playlist';
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.error('Folder picker error:', err);
      setFolderStatus('Could not open the folder.', 'warn');
      showOSD('Folder error');
    }
  }

  async function restoreSavedFolderPlaylist({ promptIfNeeded = false, autoplay = false } = {}) {
    if (!isFileSystemAccessSupported()) return false;

    const saved = await idbGet(FOLDER_HANDLE_KEY);
    const handle = saved?.value;
    if (!handle) {
      const info = await idbGet(FOLDER_INFO_KEY);
      if (info?.value?.name) setFolderStatus(`Last folder: ${info.value.name} — selection is required again`, 'warn');
      return false;
    }

    const permission = await ensureHandlePermission(handle, { readWrite: false, prompt: promptIfNeeded });
    if (permission !== 'granted') {
      setFolderStatus('The last folder is remembered, but opening it requires permission.', 'warn');
      return false;
    }

    return loadFolderHandle(handle, { autoplay, makeActive: false });
  }

  function restoreOriginalPlaylistSections() {
    if (!playlistOverlay) return;

    playlistOverlay.querySelectorAll('.season').forEach((el) => el.remove());

    if (!originalPlaylistSeasonsHtml) return;

    const temp = document.createElement('div');
    temp.innerHTML = originalPlaylistSeasonsHtml;
    const nodes = Array.from(temp.children);
    const panel = playlistOverlay.querySelector('#folderPickerPanel');

    if (panel) panel.after(...nodes);
    else playlistOverlay.append(...nodes);
  }

  async function clearSelectedFolder({ ask = true } = {}) {
    const folderMetas = metasInOrder.filter((meta) => meta.isFolderFile);
    const hasFolderPlaylist = Boolean(currentFolderHandle || playlistOverlay?.querySelector('#selectedFolderSeason') || folderMetas.length);

    if (!hasFolderPlaylist) {
      showOSD('No folder has been added');
      setFolderStatus('No added folder found.', 'warn');
      return;
    }

    if (ask) {
      const folderLabel = currentFolderName || 'Selected Folder';
      const ok = window.confirm(`Remove this folder from the playlist?\n\n${folderLabel}\n\nFiles will not be deleted from disk.`);
      if (!ok) return;
    }

    const wasPlayingFolderVideo = Boolean(currentActive?.isFolderFile);
    const removedCount = folderMetas.length;

    try {
      if (wasPlayingFolderVideo) {
        try { videoPlayer.pause(); } catch {}
        try { await document.exitPictureInPicture?.(); } catch {}
      }

      await resetPlayerLogJsonAfterFolderRemove({ folderName: currentFolderName, videoCount: removedCount });

      revokeFolderObjectUrls();
      currentFolderHandle = null;
      currentFolderName = '';

      await idbDeleteMatching((id, value) => {
        if (id === FOLDER_HANDLE_KEY || id === FOLDER_INFO_KEY) return true;
        if (String(id || '').startsWith(`${PROGRESS_PREFIX}folder:`)) return true;
        if (id === LAST_PLAYED_KEY && String(value?.value || '').startsWith('folder:')) return true;
        if (id === LAST_PLAYED_SRC_KEY && String(value?.value || '').startsWith('blob:')) return true;
        return false;
      });

      for (const meta of folderMetas) progressCache.delete(meta.key);

      restoreOriginalPlaylistSections();
      rebuildPlaylistIndex();
      renderHistory();
      paintAllProgressBars();

      if (wasPlayingFolderVideo) {
        currentActive = null;
        currentIndex = -1;
        const fallback = metasInOrder[0];
        if (fallback) {
          setSource(fallback.src);
          videoPlayer.load();
          highlightCurrentBySrc(fallback.src);
          updateMediaSession();
          updateNavigationButtonsByIndex(fallback.index);
        } else {
          videoPlayer.pause();
          videoPlayer.removeAttribute('src');
          videoPlayer.load();
          updateNavigationButtonsByIndex(-1);
        }
      } else {
        updateNavigationButtonsByIndex(currentIndex);
      }

      setFolderStatus('The folder was removed from the playlist. Files remain on disk. JSON was cleared.', 'ok');
      showOSD('Folder removed');
    } catch (err) {
      console.error('Clear selected folder error:', err);
      setFolderStatus('Could not remove the folder.', 'warn');
      showOSD('Folder error');
    }
  }

  async function removeEntryByRelativePath(dirHandle, relativePath) {
    const parts = normalizeRelativePath(relativePath).split('/').filter(Boolean);
    if (!parts.length) throw new Error('Invalid file path');

    let parent = dirHandle;
    for (const part of parts.slice(0, -1)) {
      parent = await parent.getDirectoryHandle(part);
    }

    await parent.removeEntry(parts[parts.length - 1]);
  }

  function updateFolderHeaderCount() {
    const header = playlistOverlay?.querySelector('#selectedFolderSeason > h4');
    if (header) header.textContent = `${currentFolderName || 'Selected Folder'} • ${metasInOrder.length} videos`;
  }

  async function deleteCurrentVideo() {
    if (!currentActive) {
      showOSD('No active video');
      return;
    }

    await deleteFolderVideoByKey(currentActive.key);
  }

  async function deleteFolderVideoByKey(key) {
    const meta = playlistMeta.get(key);
    if (!meta?.isFolderFile || !currentFolderHandle) {
      showOSD('This video is not from the selected folder');
      return;
    }

    const fileName = meta.fileName || meta.title || 'video';
    const ok = window.confirm(`Delete this file from disk?\n\n${fileName}`);
    if (!ok) return;

    const permission = await ensureHandlePermission(currentFolderHandle, { readWrite: true, prompt: true });
    if (permission !== 'granted') {
      showOSD('Delete permission is missing');
      setFolderStatus('Read/write permission is required for deletion.', 'warn');
      return;
    }

    const wasCurrent = currentActive?.key === key;
    const removedIndex = meta.index;
    const deletedProgress = progressCache.get(key) || {
      t: wasCurrent ? (videoPlayer.currentTime || 0) : 0,
      d: wasCurrent ? (videoPlayer.duration || 0) : 0,
      updatedAt: Date.now()
    };

    try {
      if (wasCurrent) {
        try { videoPlayer.pause(); } catch {}
        try { await document.exitPictureInPicture?.(); } catch {}
      }

      await removeEntryByRelativePath(currentFolderHandle, fileName);
      await logDeletedToJson(meta, deletedProgress);

      const url = folderObjectUrls.get(key);
      if (url) {
        try { URL.revokeObjectURL(url); } catch {}
        folderObjectUrls.delete(key);
      }

      progressCache.delete(key);
      await idbDeleteMatching((id, value) => {
        if (id === `${PROGRESS_PREFIX}${key}`) return true;
        if (id === LAST_PLAYED_KEY && value?.value === key) return true;
        if (id === LAST_PLAYED_SRC_KEY && value?.value === meta.src) return true;
        return false;
      });

      meta.item?.remove();
      rebuildPlaylistIndex();
      updateFolderHeaderCount();
      renderHistory();
      paintAllProgressBars();

      showOSD('Deleted');

      if (wasCurrent) {
        const nextMeta = metasInOrder[removedIndex] || metasInOrder[removedIndex - 1] || metasInOrder[0];
        if (nextMeta) {
          isManuallyPaused = false;
          await playVideo(nextMeta.src, { clearTime: false, autoplay: true, forceAutoplay: true });
        } else {
          videoPlayer.pause();
          videoPlayer.removeAttribute('src');
          videoPlayer.load();
          currentActive = null;
          currentIndex = -1;
          updateNavigationButtonsByIndex(-1);
        }
      }
    } catch (err) {
      console.error('Delete video error:', err);
      showOSD('Delete failed');
      setFolderStatus('Delete failed. The file may be in use.', 'warn');
    }
  }


  // --- UI helpers ---
  function showOSD(text, withTime = false) {
    clearTimeout(window.__osdTimeout);

    let display = text;
    if (withTime && Number.isFinite(videoPlayer.duration) && videoPlayer.duration > 0) {
      const m  = Math.floor(videoPlayer.currentTime / 60);
      const s  = Math.floor(videoPlayer.currentTime % 60).toString().padStart(2, '0');
      const dm = Math.floor(videoPlayer.duration / 60);
      const ds = Math.floor(videoPlayer.duration % 60).toString().padStart(2, '0');
      display = `${text} (${m}:${s} / ${dm}:${ds})`;
    }

    if (!osdOverlay) return;
    osdOverlay.textContent = display;
    osdOverlay.classList.add('show');
    window.__osdTimeout = setTimeout(() => osdOverlay.classList.remove('show'), 900);
  }

  function setProgressBar(barEl, time, dur) {
    if (!barEl) return;
    if (!dur || dur <= 0 || !Number.isFinite(dur)) {
      barEl.style.width = '0%';
      return;
    }
    const pct = clamp((time / dur) * 100, 0, 100);
    barEl.style.width = `${pct}%`;
  }

  function formatClock(sec) {
    const total = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  function formatRelativeTime(ts) {
    const diffMs = Math.max(0, Date.now() - (Number(ts) || 0));
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hr ago`;
    const day = Math.floor(hr / 24);
    return `${day} days ago`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function renderHistory() {
    ensureWatchHistoryElements();
    if (!watchHistoryList) return;

    const entries = [];
    for (const meta of metasInOrder) {
      const progress = progressCache.get(meta.key);
      if (!progress || !Number.isFinite(progress.t) || progress.t <= 1) continue;
      entries.push({ meta, progress });
    }

    entries.sort((a, b) => (b.progress.updatedAt || 0) - (a.progress.updatedAt || 0));
    const recent = entries.slice(0, HISTORY_LIMIT);

    watchHistoryList.querySelectorAll('.watch-history-card').forEach((card) => card.remove());

    if (watchHistoryEmpty) {
      watchHistoryEmpty.hidden = recent.length > 0;
      if (!watchHistoryEmpty.parentElement) watchHistoryList.appendChild(watchHistoryEmpty);
    }

    if (!recent.length) return;

    const cardsHtml = recent.map(({ meta, progress }) => {
      const time = Number(progress.t) || 0;
      const duration = Number(progress.d) || 0;
      const percent = duration > 0 ? clamp((time / duration) * 100, 0, 100) : 0;
      const isCurrent = currentActive?.key === meta.key ? ' is-current' : '';
      const fileName = meta.src || '';

      return `
        <button class="watch-history-card${isCurrent}" type="button" data-history-src="${escapeHtml(meta.src)}" data-seek="${escapeHtml(time)}" data-duration="${escapeHtml(duration)}" aria-label="Open ${escapeHtml(meta.title || meta.src)} at ${formatClock(time)}">
          <span class="watch-history-top">
            <span class="watch-history-title">${escapeHtml(meta.title || meta.src)}</span>
            <span class="watch-history-badge">${Math.round(percent)}%</span>
          </span>

          <span class="watch-history-meta">
            <span>Resume: ${formatClock(time)}</span>
            <span>Duration: ${duration > 0 ? formatClock(duration) : 'Unknown'}</span>
          </span>

          <span class="watch-history-progress" aria-hidden="true">
            <span style="width:${percent}%"></span>
          </span>

          <span class="watch-history-bottom">
            <span>Last watched: ${formatRelativeTime(progress.updatedAt)}</span>
            <span>${escapeHtml(fileName)}</span>
          </span>
        </button>
      `;
    }).join('');

    watchHistoryList.insertAdjacentHTML('beforeend', cardsHtml);
  }

  // --- Navigation + active episode ---
  let currentActive = null; // meta
  let currentIndex = -1;
  let isManuallyPaused = false;

  rebuildPlaylistIndex();

  function updateNavigationButtonsByIndex(idx) {
    if (prevBtn) prevBtn.classList.toggle('hidden', idx <= 0);
    if (nextBtn) nextBtn.classList.toggle('hidden', idx < 0 || idx >= (playlistItems.length - 1));
  }

  // Title scrolling that DOES NOT restart every timeupdate
  let titleBase = originalTitle;
  let titleScrollPos = 0;
  let titleTicker = null;

  function getTimePrefix() {
    if (!Number.isFinite(videoPlayer.duration) || videoPlayer.duration <= 0) return '';
    const cm = Math.floor(videoPlayer.currentTime / 60);
    const cs = Math.floor(videoPlayer.currentTime % 60).toString().padStart(2, '0');
    const tm = Math.floor(videoPlayer.duration / 60);
    const ts = Math.floor(videoPlayer.duration % 60).toString().padStart(2, '0');
    return `[${cm}:${cs}/${tm}:${ts}] `;
  }

  function ensureTitleTicker() {
    const needsScroll = titleBase.length > 26;
    if (!needsScroll) {
      if (titleTicker) { clearInterval(titleTicker); titleTicker = null; }
      document.title = `${getTimePrefix()}${titleBase}`;
      return;
    }

    if (titleTicker) return; // already running
    const sep = ' ⟿ ';
    const padded = titleBase + sep;

    titleTicker = setInterval(() => {
      const scrolled = padded.substring(titleScrollPos) + padded.substring(0, titleScrollPos);
      document.title = `${getTimePrefix()}${scrolled}`;
      titleScrollPos = (titleScrollPos + 1) % padded.length;
    }, 180);
  }

  function setTitleBaseForCurrent() {
    const ep = currentActive?.title || '';
    titleBase = ep ? `${ep} - ${originalTitle}` : originalTitle;
    titleScrollPos = 0;
    if (titleTicker) { clearInterval(titleTicker); titleTicker = null; }
    ensureTitleTicker();
  }

  const updateTitleThrottled = throttle(() => ensureTitleTicker(), 900);

  function highlightCurrentBySrc(src) {
    const meta = getMetaBySrc(src);
    if (currentActive && currentActive.item !== meta?.item) currentActive.item.classList.remove('active');
    if (meta?.item) meta.item.classList.add('active');
    currentActive = meta;
    currentIndex = meta ? meta.index : -1;
    updateNavigationButtonsByIndex(currentIndex);
    setTitleBaseForCurrent();
  }

  // --- Media Session for lockscreen controls (Android/desktop) ---
  function updateMediaSession() {
    try {
      if (!('mediaSession' in navigator) || !currentActive) return;
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: currentActive.title || 'Video',
        artist: '',
        album: originalTitle
      });

      navigator.mediaSession.setActionHandler('play', () => videoPlayer.play().catch(() => {}));
      navigator.mediaSession.setActionHandler('pause', () => videoPlayer.pause());
      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        const step = details?.seekOffset || 10;
        videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - step);
      });
      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const step = details?.seekOffset || 10;
        videoPlayer.currentTime = Math.min(videoPlayer.duration || Infinity, videoPlayer.currentTime + step);
      });

      navigator.mediaSession.setActionHandler('previoustrack', () => prevBtn?.click());
      navigator.mediaSession.setActionHandler('nexttrack', () => nextBtn?.click());
    } catch {
      // ignore
    }
  }

  // --- Volume persistence (debounced) ---
  const saveVolumeDebounced = debounce(() => {
    idbPutMany([{ id: VOLUME_KEY, value: clamp(videoPlayer.volume, 0, 1) }]);
  }, 350);

  function loadVolumeFromDB(allRecordsMap) {
    const v = allRecordsMap.get(VOLUME_KEY);
    if (v && v.value != null) videoPlayer.volume = clamp(Number(v.value), 0, 1);
  }

  const ALLOWED_RATES = [0.25, 0.5, 1, 1.5, 2];
  let currentRate = 1;

  function normalizeRate(val) {
    const n = Number(val);
    if (!Number.isFinite(n)) return 1;
    // Prefer exact match; else fall back to 1
    if (ALLOWED_RATES.includes(n)) return n;
    return 1;
  }

  function setPlaybackRate(val, { persist = true, show = true } = {}) {
    const r = normalizeRate(val);
    currentRate = r;

    try { videoPlayer.playbackRate = r; } catch {}

    if (speedSelect) speedSelect.value = String(r);
    if (hudSpeed) hudSpeed.value = String(r);

    if (persist) idbPutMany([{ id: PLAYBACK_RATE_KEY, value: r }]);
    if (show) showOSD(`Speed ${r}x`);
  }

  function loadPlaybackRateFromDB(allRecordsMap) {
    const rec = allRecordsMap.get(PLAYBACK_RATE_KEY);
    if (rec && rec.value != null) {
      setPlaybackRate(rec.value, { persist: false, show: false });
    } else {
      // ensure UI defaults to 1x
      setPlaybackRate(1, { persist: false, show: false });
    }
  }

  videoPlayer.addEventListener('volumechange', saveVolumeDebounced);
  speedSelect?.addEventListener('change', () => setPlaybackRate(speedSelect.value));

  // --- Progress persistence ---
  let pendingSave = null;   // { key, src, t, d }
  let pendingSaveIdleId = null;

  let lastSavedAt = 0;
  let lastSavedTime = 0;

  function queueSaveNow(key, src, t, d) {
    pendingSave = { key, src, t, d };
    flushSaveSoon();
  }

  function flushSaveSoon() {
    if (pendingSaveIdleId != null) return;
    pendingSaveIdleId = idle(() => {
      pendingSaveIdleId = null;
      flushSave();
    });
  }

  async function flushSave() {
    const s = pendingSave;
    if (!s) return;
    pendingSave = null;

    const record = { t: s.t, d: s.d, updatedAt: Date.now() };
    progressCache.set(s.key, record);

    // Update UI for active item immediately
    const meta = playlistMeta.get(s.key);
    if (meta?.bar) setProgressBar(meta.bar, record.t, record.d);
    renderHistory();

    await idbPutMany([
      { id: `${PROGRESS_PREFIX}${s.key}`, value: record },
      { id: LAST_PLAYED_KEY, value: s.key },
      { id: LAST_PLAYED_SRC_KEY, value: s.src },   // keep old key too
    ]);

    logLastWatchedToJson(meta || getMetaBySrc(s.src), record);
  }

  function schedulePeriodicSave() {
    if (videoPlayer.paused || !currentActive) return;
    const now = Date.now();
    const t = videoPlayer.currentTime || 0;
    const d = videoPlayer.duration || 0;

    if ((now - lastSavedAt) < SAVE_EVERY_MS) return;
    if (Math.abs(t - lastSavedTime) < SAVE_MIN_DELTA_SEC) return;
    if (t < 1) return;

    lastSavedAt = now;
    lastSavedTime = t;

    queueSaveNow(currentActive.key, currentActive.src, t, d);
  }

  const updateUIThrottled = throttle(() => {
    if (!currentActive) return;
    const t = videoPlayer.currentTime || 0;
    const d = videoPlayer.duration || 0;
    if (currentActive.bar) setProgressBar(currentActive.bar, t, d);
    updateTitleThrottled();
  }, UI_UPDATE_MS);

  // Always flush on important lifecycle events (mobile-safe)
  function flushOnExit() {
    if (!currentActive) return;
    const t = videoPlayer.currentTime || 0;
    const d = videoPlayer.duration || 0;
    if (t >= 1) {
      const record = { t, d, updatedAt: Date.now() };
      pendingSave = { key: currentActive.key, src: currentActive.src, t, d };
      logLastWatchedToJson(currentActive, record, { beacon: true });
      // do sync-ish save best-effort
      flushSave();
    }
    if (titleTicker) { clearInterval(titleTicker); titleTicker = null; }
  }

  window.addEventListener('beforeunload', flushOnExit);
  window.addEventListener('pagehide', flushOnExit);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnExit();
  });

  // --- Progress loading (fast for huge playlists) ---
  async function loadAllFromDB() {
    const all = await idbGetAll();
    const map = new Map(); // id -> record
    for (const r of all) map.set(r.id, r);

    // Load volume
    loadVolumeFromDB(map);
    // Load playback rate
    loadPlaybackRateFromDB(map);

    // Parse progress in new format
    for (const [id, rec] of map) {
      if (typeof id === 'string' && id.startsWith(PROGRESS_PREFIX)) {
        const key = id.slice(PROGRESS_PREFIX.length);
        const val = rec.value || {};
        if (val && typeof val === 'object') {
          progressCache.set(key, {
            t: Number(val.t) || 0,
            d: Number(val.d) || 0,
            updatedAt: Number(val.updatedAt) || 0
          });
        }
      }
    }

    // --- Legacy migration (your old script saved time_/duration_ keys) ---
    // We DON'T delete legacy keys; we just build progressCache from them and write new compact records.
    const legacyTmp = new Map(); // key -> {t,d}
    for (const [id, rec] of map) {
      if (typeof id !== 'string') continue;

      if (id.startsWith('time_')) {
        const src = safeDecode(id.slice(5));
        const key = videoKeyFromSrc(src);
        const obj = legacyTmp.get(key) || {};
        obj.t = Number(rec.value) || 0;
        legacyTmp.set(key, obj);
      } else if (id.startsWith('duration_')) {
        const src = safeDecode(id.slice(9));
        const key = videoKeyFromSrc(src);
        const obj = legacyTmp.get(key) || {};
        obj.d = Number(rec.value) || 0;
        legacyTmp.set(key, obj);
      }
    }

    // Merge legacy into cache if newer/new record missing
    const toWrite = [];
    for (const [key, ld] of legacyTmp) {
      const existing = progressCache.get(key);
      if (!existing) {
        const record = { t: ld.t || 0, d: ld.d || 0, updatedAt: Date.now() };
        progressCache.set(key, record);
        toWrite.push({ id: `${PROGRESS_PREFIX}${key}`, value: record });
      }
    }

    // Also migrate lastPlayedSrc -> lastPlayedKey
    const lastSrc = map.get(LAST_PLAYED_SRC_KEY)?.value;
    const lastKey = map.get(LAST_PLAYED_KEY)?.value;
    if (!lastKey && lastSrc) {
      const k = videoKeyFromSrc(String(lastSrc));
      toWrite.push({ id: LAST_PLAYED_KEY, value: k });
    }

    if (toWrite.length) {
      // Do migration writes in idle so UI doesn't lag.
      idle(() => idbPutMany(toWrite));
    }

    return map;
  }

  function paintAllProgressBars() {
    let i = 0;
    const total = metasInOrder.length;

    const step = (deadline) => {
      const start = i;
      while (i < total) {
        const meta = metasInOrder[i];
        const p = progressCache.get(meta.key);
        if (p && meta.bar) setProgressBar(meta.bar, p.t, p.d);

        i++;
        if (!deadline.didTimeout && deadline.timeRemaining && deadline.timeRemaining() < 6) break;
        if ((i - start) >= PROGRESS_BATCH) break;
      }

      if (i < total) idle(step);
    };

    idle(step);
  }

  // --- Playback core ---
  function setSource(src) {
    let sourceEl = videoPlayer.querySelector('source');
    if (!sourceEl) {
      sourceEl = document.createElement('source');
      sourceEl.type = 'video/mp4';
      videoPlayer.appendChild(sourceEl);
    }
    sourceEl.src = src;
    videoPlayer.src = src;
    return true;
  }

  async function playVideo(src, { clearTime = false, autoplay = true, forceAutoplay = false } = {}) {
    const meta = getMetaBySrc(src);
    if (!meta) return;

    // flush current
    flushOnExit();

    const sourceEl = videoPlayer.querySelector('source');
    const currentAbs = sourceEl?.src || '';
    const isNew = videoKeyFromSrc(src) !== videoKeyFromSrc(currentAbs);

    if (isNew) {
      setSource(meta.src);
      videoPlayer.load();
    }

    const onReady = async () => {
      highlightCurrentBySrc(meta.src);
      updateMediaSession();
      // Re-apply saved playback rate (some browsers reset on load)
      setPlaybackRate(currentRate, { persist: false, show: false });

      if (!clearTime) {
        const p = progressCache.get(meta.key);
        if (p && p.t > 1) {
          try { videoPlayer.currentTime = p.t; } catch {}
          if (lastWatchedInfo) {
            const m = Math.floor(p.t / 60);
            const s = Math.floor(p.t % 60).toString().padStart(2, '0');
            lastWatchedInfo.textContent = `Resume: ${m}:${s}`;
            lastWatchedInfo.style.opacity = '1';
            setTimeout(() => { lastWatchedInfo.style.opacity = '0'; }, 2500);
          }
        }
      }

      // Save "last played" immediately (cheap)
      idbPutMany([
        { id: LAST_PLAYED_KEY, value: meta.key },
        { id: LAST_PLAYED_SRC_KEY, value: meta.src },
      ]);
      logLastWatchedToJson(meta, progressCache.get(meta.key) || { t: videoPlayer.currentTime || 0, d: videoPlayer.duration || 0, updatedAt: Date.now() });

      if (autoplay && (forceAutoplay || !isManuallyPaused)) {
        try {
          isManuallyPaused = false;
          await videoPlayer.play();
          isManuallyPaused = false;
        } catch {
          isManuallyPaused = true;
          showOSD('Press Play');
        }
      }

      updateUIThrottled();
      schedulePeriodicSave();
    };

    if (isNew || videoPlayer.readyState < 2) {
      videoPlayer.addEventListener('loadedmetadata', onReady, { once: true });
    } else {
      onReady();
    }
  }

  // --- Old next overlay cleanup (countdown autoplay disabled) ---
  let nextTimer = null;

  function clearNextOverlay() {
    if (nextTimer) { clearInterval(nextTimer); nextTimer = null; }
    if (nextOverlay) nextOverlay.classList.remove('active');
  }

  if (cancelNext) cancelNext.addEventListener('click', clearNextOverlay);

    // --- Fullscreen + HUD controls (no flicker, works with custom cursor) ---
  // Goal:
  // - Desktop: disable native video controls (they cause the "hide 1s then show again" fullscreen flicker),
  //   and use a small HUD bar + strict idle-hide (only real mouse move wakes).
  // - Mobile / coarse pointer: keep native controls (better UX on touch).

  const prefersNativeControls =
    isMobile ||
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  // Save whether the HTML had controls, so we can restore on mobile/coarse pointer.
  const initialNativeControls = videoPlayer.hasAttribute('controls') || videoPlayer.controls;

  function applyNativeControls(on) {
    videoPlayer.controls = !!on;
    if (on) videoPlayer.setAttribute('controls', '');
    else videoPlayer.removeAttribute('controls');
  }

  // Desktop: turn native controls OFF (prevents browser UI from reappearing by itself in fullscreen).
  if (!prefersNativeControls) applyNativeControls(false);

  // --- Minimal HUD (play/pause, seek, volume, fullscreen) ---
  let hud = null;
  let hudPlay = null;
  let hudSeek = null;
  let hudTime = null;
  let hudVol  = null;
  let hudSpeed = null;
  let hudFs   = null;

  let hudSeeking = false;
  let hudSeekWasPlaying = false;

  function fmtTime(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = Math.floor(s % 60).toString().padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }

  function syncHud() {
    if (!hud || prefersNativeControls) return;

    // Play icon
    if (hudPlay) hudPlay.textContent = videoPlayer.paused ? '▶' : '❚❚';

    // Volume
    if (hudVol && !Number.isNaN(videoPlayer.volume)) {
      const v = clamp(videoPlayer.volume, 0, 1);
      if (Math.abs(Number(hudVol.value) - v) > 0.01) hudVol.value = String(v);
    }

    // Speed
    if (hudSpeed) {
      const r = normalizeRate(videoPlayer.playbackRate || currentRate);
      if (hudSpeed.value !== String(r)) hudSpeed.value = String(r);
    }

    // Time + seek
    const d = Number.isFinite(videoPlayer.duration) ? videoPlayer.duration : 0;
    const t = Number.isFinite(videoPlayer.currentTime) ? videoPlayer.currentTime : 0;

    if (hudTime) hudTime.textContent = `${fmtTime(t)} / ${d > 0 ? fmtTime(d) : '0:00'}`;

    if (hudSeek && !hudSeeking) {
      const pct = d > 0 ? (t / d) : 0;
      hudSeek.value = String(Math.round(clamp(pct, 0, 1) * 1000));
    }
  }

  function ensureHud() {
    if (prefersNativeControls) return;
    if (!videoWrapper) return;
    if (hud) return;

    videoWrapper.classList.add('use-hud');

    hud = document.createElement('div');
    hud.className = 'hud-controls';
    hud.innerHTML = `
      <button class="hud-btn" id="hudPlay" type="button" aria-label="Play/Pause">▶</button>
      <div class="hud-time" id="hudTime" aria-live="off">0:00 / 0:00</div>
      <input class="hud-seek" id="hudSeek" type="range" min="0" max="1000" value="0" step="1" aria-label="Seek" />
      <input class="hud-vol" id="hudVol" type="range" min="0" max="1" step="0.01" aria-label="Volume" />
      <select class="hud-speed" id="hudSpeed" aria-label="Speed">
        <option value="0.25">0.25x</option>
        <option value="0.5">0.5x</option>
        <option value="1" selected>1x</option>
        <option value="1.5">1.5x</option>
        <option value="2">2x</option>
      </select>
      <button class="hud-btn" id="hudFs" type="button" aria-label="Fullscreen">⛶</button>
    `;
    videoWrapper.appendChild(hud);

    hudPlay = hud.querySelector('#hudPlay');
    hudSeek = hud.querySelector('#hudSeek');
    hudTime = hud.querySelector('#hudTime');
    hudVol  = hud.querySelector('#hudVol');
    hudSpeed = hud.querySelector('#hudSpeed');
    hudFs   = hud.querySelector('#hudFs');

    if (hudVol) hudVol.value = String(clamp(videoPlayer.volume, 0, 1));
    if (hudSpeed) hudSpeed.value = String(currentRate);

    const togglePlay = () => {
      if (videoPlayer.paused) videoPlayer.play().catch(() => { isManuallyPaused = true; });
      else videoPlayer.pause();
      syncHud();
    };

    hudPlay?.addEventListener('click', () => {
      togglePlay();
      showControls(true, 'auto');
    });

    // Seeking (pause while dragging; resume if needed)
    const seekToPct = (pct01) => {
      const d = videoPlayer.duration;
      if (!Number.isFinite(d) || d <= 0) return;
      videoPlayer.currentTime = clamp(pct01, 0, 1) * d;
      schedulePeriodicSave();
    };

    const beginSeek = () => {
      hudSeeking = true;
      hudSeekWasPlaying = !videoPlayer.paused;
      try { videoPlayer.pause(); } catch {}
    };

    const endSeek = () => {
      hudSeeking = false;
      if (hudSeekWasPlaying) videoPlayer.play().catch(() => {});
      hudSeekWasPlaying = false;
      syncHud();
    };

    hudSeek?.addEventListener('pointerdown', beginSeek, { passive: true });
    hudSeek?.addEventListener('pointerup', endSeek, { passive: true });
    hudSeek?.addEventListener('change', endSeek, { passive: true });

    hudSeek?.addEventListener('input', () => {
      const v = Number(hudSeek.value) || 0;
      seekToPct(v / 1000);
      syncHud();
      showControls(true, 'auto');
    }, { passive: true });

    hudVol?.addEventListener('input', () => {
      const v = clamp(Number(hudVol.value), 0, 1);
      videoPlayer.volume = v;
      showOSD(`Volume ${Math.round(v * 100)}%`);
      showControls(true, 'auto');
    }, { passive: true });

    hudSpeed?.addEventListener('change', () => {
      setPlaybackRate(hudSpeed.value);
      showControls(true, 'auto');
    });

    hudFs?.addEventListener('click', () => {
      toggleFullscreen();
      showControls(true, 'force');
    });
  }

  ensureHud();
  videoPlayer.addEventListener('loadedmetadata', syncHud);
  videoPlayer.addEventListener('timeupdate', syncHud, { passive: true });
  videoPlayer.addEventListener('play', syncHud);
  videoPlayer.addEventListener('pause', syncHud);
  videoPlayer.addEventListener('volumechange', syncHud, { passive: true });

  // --- Fullscreen helpers (with vendor fallbacks) ---
  function getFsEl() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
  }
  function isFullscreenActive() {
    return !!getFsEl();
  }

  async function enterFullscreen() {
    const el = videoWrapper || videoPlayer;
    if (!el) return;

    try {
      if (el.requestFullscreen) return await el.requestFullscreen();
      if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
      if (el.msRequestFullscreen) return el.msRequestFullscreen();
      // iOS Safari fallback (video element only)
      if (videoPlayer.webkitEnterFullscreen) return videoPlayer.webkitEnterFullscreen();
      showOSD('Fullscreen not supported');
    } catch (e) {
      console.error('Fullscreen error:', e);
      showOSD('Fullscreen blocked');
    }
  }

  function exitFullscreen() {
    try {
      if (document.exitFullscreen) return document.exitFullscreen();
      if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
      if (document.msExitFullscreen) return document.msExitFullscreen();
    } catch {}
  }

  function toggleFullscreen() {
    if (isFullscreenActive()) exitFullscreen();
    else enterFullscreen();
  }

  // --- Desktop fullscreen idle hide (ONLY real mouse move wakes) ---
  let controlsHidden = false;
  let controlsHideTimer = null;

  let lastClientX = null;
  let lastClientY = null;

  // Guard against synthetic move events around fullscreen transitions
  let ignoreMouseUntil = 0;
  const IGNORE_AFTER_FS_MS = 450;

  const MOVE_THRESHOLD_VISIBLE = 3;
  const MOVE_THRESHOLD_HIDDEN  = 14;

  function setFullscreenCursorHidden(hidden) {
    const fsEl = getFsEl();
    if (!fsEl) return;
    fsEl.classList.toggle('hide-cursor', !!hidden);

    // Extra safety for custom cursors
    if (hidden) {
      if (videoWrapper) videoWrapper.style.cursor = 'none';
      videoPlayer.style.cursor = 'none';
    } else {
      if (videoWrapper) videoWrapper.style.cursor = '';
      videoPlayer.style.cursor = '';
    }
  }

  function hideControls() {
    if (prefersNativeControls) return;
    if (!isFullscreenActive()) return;
    if (!videoWrapper) return;
    if (playlistOverlay?.classList.contains('open')) return;

    controlsHidden = true;
    videoWrapper.classList.add('hide-controls');
    setFullscreenCursorHidden(true);
    ignoreMouseUntil = Date.now() + IGNORE_AFTER_FS_MS;
  }

  function showControls(startTimer = true, reason = 'auto') {
    if (!videoWrapper) return;

    const desktopFs = isFullscreenActive() && !prefersNativeControls;

    // If hidden in fullscreen: ONLY mouse movement (or force) can wake.
    if (desktopFs && controlsHidden && reason !== 'mouse' && reason !== 'force') {
      clearTimeout(controlsHideTimer);
      if (startTimer && !playlistOverlay?.classList.contains('open')) {
        controlsHideTimer = setTimeout(hideControls, HIDE_DELAY);
      }
      return;
    }

    // Outside fullscreen: always show
    if (!desktopFs) {
      controlsHidden = false;
      videoWrapper.classList.remove('hide-controls');
      setFullscreenCursorHidden(false);
      clearTimeout(controlsHideTimer);

      // If we are on mobile/coarse pointer, keep whatever HTML had.
      if (prefersNativeControls) applyNativeControls(initialNativeControls);
      return;
    }

    // Desktop fullscreen
    controlsHidden = false;
    videoWrapper.classList.remove('hide-controls');
    setFullscreenCursorHidden(false);

    clearTimeout(controlsHideTimer);
    if (startTimer && !playlistOverlay?.classList.contains('open')) {
      controlsHideTimer = setTimeout(hideControls, HIDE_DELAY);
    }
  }

  function handleRealMouseMove(e) {
    if (!isFullscreenActive()) return;
    if (prefersNativeControls) return;
    if (!e.isTrusted) return;
    if (Date.now() < ignoreMouseUntil) return;

    const hasMovement = ('movementX' in e) && ('movementY' in e);
    const mx = hasMovement ? e.movementX : 0;
    const my = hasMovement ? e.movementY : 0;

    // Synthetic events often have 0,0
    if (hasMovement && (Math.abs(mx) + Math.abs(my)) === 0) return;

    const x = e.clientX;
    const y = e.clientY;

    if (lastClientX !== null && lastClientY !== null) {
      const dx = Math.abs(x - lastClientX);
      const dy = Math.abs(y - lastClientY);
      const th = controlsHidden ? MOVE_THRESHOLD_HIDDEN : MOVE_THRESHOLD_VISIBLE;

      if (!hasMovement && (dx + dy) < th) return;
      if (hasMovement && (Math.abs(mx) + Math.abs(my)) < 2 && (dx + dy) < th) return;
    }

    lastClientX = x;
    lastClientY = y;

    showControls(true, 'mouse');
  }

  document.addEventListener('mousemove', handleRealMouseMove, { passive: true });
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') handleRealMouseMove(e);
  }, { passive: true });

  // Keep timer sane, but don't wake while hidden (per your request)
  document.addEventListener('pointerdown', () => {
    if (!isFullscreenActive()) return;
    if (prefersNativeControls) return;
    showControls(true, 'auto');
  }, { passive: true });

  document.addEventListener('keydown', () => {
    if (!isFullscreenActive()) return;
    if (prefersNativeControls) return;
    showControls(true, 'auto');
  }, { capture: true });

  const fsChangeHandler = () => {
    lastClientX = null;
    lastClientY = null;
    ignoreMouseUntil = Date.now() + IGNORE_AFTER_FS_MS;

    if (isFullscreenActive()) {
      // Desktop: ensure native controls are OFF (no flicker)
      if (!prefersNativeControls) applyNativeControls(false);
      showControls(true, 'force');
    } else {
      showControls(false, 'force');
      setFullscreenCursorHidden(false);
      if (prefersNativeControls) applyNativeControls(initialNativeControls);
    }
  };

  ['fullscreenchange', 'webkitfullscreenchange', 'MSFullscreenChange'].forEach((ev) => {
    document.addEventListener(ev, fsChangeHandler);
  });

  // --- PIP (with WebKit fallback) ---
  async function togglePIP() {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        showOSD('PIP Off');
        return;
      }
      if (videoPlayer.requestPictureInPicture) {
        await videoPlayer.requestPictureInPicture();
        showOSD('PIP On');
        return;
      }
      // iOS Safari fallback
      if (videoPlayer.webkitSupportsPresentationMode && typeof videoPlayer.webkitSetPresentationMode === 'function') {
        const mode = videoPlayer.webkitPresentationMode;
        videoPlayer.webkitSetPresentationMode(mode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
        showOSD('PIP');
      }
    } catch {
      showOSD('PIP error');
    }
  }
  pipBtn?.addEventListener('click', togglePIP);

  // --- Download current video ---
  function downloadCurrentVideo() {
    const src =
      currentActive?.src ||
      videoPlayer.currentSrc ||
      videoPlayer.querySelector('source')?.getAttribute('src') ||
      '';

    if (!src) {
      showOSD('No video');
      return;
    }

    if (window.location.protocol === 'file:') {
      showOSD('Download disabled in file mode');
      return;
    }

    let filename = '';
    try {
      const u = new URL(src, window.location.href);
      filename = safeDecode(u.pathname.split('/').pop() || '');
    } catch {
      filename = safeDecode(String(src).split('?')[0].split('#')[0].split('/').pop() || '');
    }

    if (!filename) filename = 'video.mp4';

    const a = document.createElement('a');
    a.href = src;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();

    showOSD('Downloading…');
    showControls(true, 'force');
  }

  downloadBtn?.addEventListener('click', downloadCurrentVideo);


  // --- Playlist interactions (event delegation, no per-li listeners) ---
  playlistOverlay?.addEventListener('click', (e) => {
    const deleteBtn = e.target?.closest?.('.folder-video-delete');
    if (deleteBtn) {
      e.preventDefault();
      e.stopPropagation();
      deleteFolderVideoByKey(deleteBtn.dataset.deleteKey);
      return;
    }

    const li = e.target?.closest?.('li[data-src]');
    if (!li) return;
    const src = li.dataset.src;
    const title = li.querySelector('.item-title')?.textContent?.trim() || src;
    showOSD(`Playing: ${title}`);
    playVideo(src, { clearTime: false, autoplay: true });
  });

  // keep Enter/Space on focused item working even if global shortcuts exist
  playlistOverlay?.addEventListener('keydown', (e) => {
    const li = e.target?.closest?.('li[data-src]');
    if (!li) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      li.click();
    }
  });

  watchHistoryList?.addEventListener('click', (e) => {
    const card = e.target?.closest?.('[data-history-src]');
    if (!card) return;

    const src = card.dataset.historySrc;
    const meta = getMetaBySrc(src);
    if (!meta) return;

    const seek = Number(card.dataset.seek);
    const duration = Number(card.dataset.duration);
    if (Number.isFinite(seek) && seek > 0) {
      const existing = progressCache.get(meta.key) || {};
      progressCache.set(meta.key, {
        t: seek,
        d: Number.isFinite(duration) && duration > 0 ? duration : (Number(existing.d) || 0),
        updatedAt: Number(existing.updatedAt) || Date.now()
      });
    }

    showOSD(`Resume: ${meta.title}`);
    playVideo(meta.src, { clearTime: false, autoplay: true });
  });

  clearWatchHistoryBtn?.addEventListener('click', async () => {
    const playlistKeys = new Set(metasInOrder.map((meta) => meta.key));

    progressCache.clear();
    for (const meta of metasInOrder) {
      if (meta.bar) setProgressBar(meta.bar, 0, 0);
    }
    renderHistory();

    clearWatchHistoryBtn.disabled = true;
    await idbDeleteMatching((id) => {
      if (id === LAST_PLAYED_KEY || id === LAST_PLAYED_SRC_KEY) return true;
      if (typeof id !== 'string') return false;
      if (id.startsWith(PROGRESS_PREFIX)) return playlistKeys.has(id.slice(PROGRESS_PREFIX.length));

      if (id.startsWith('time_')) {
        const src = safeDecode(id.slice(5));
        return playlistKeys.has(videoKeyFromSrc(src));
      }

      if (id.startsWith('duration_')) {
        const src = safeDecode(id.slice(9));
        return playlistKeys.has(videoKeyFromSrc(src));
      }

      return false;
    });
    clearWatchHistoryBtn.disabled = false;

    showOSD('History cleared');
  });

  // --- Playlist toggle ---
  if (togglePlaylistBtn && playlistOverlay) {
    togglePlaylistBtn.addEventListener('click', () => {
      const isOpen = playlistOverlay.classList.toggle('open');
      togglePlaylistBtn.setAttribute('aria-expanded', String(isOpen));
      togglePlaylistBtn.textContent = isOpen ? 'Close Playlist' : 'Playlist';

      if (isOpen) {
        const activeItem = playlistOverlay.querySelector('li.active');
        if (activeItem) setTimeout(() => activeItem.scrollIntoView({ behavior: 'smooth', block: 'center' }), 220);
      }
      showControls(true);
    });
  }

  // --- Next / Prev buttons ---
  nextBtn?.addEventListener('click', () => {
    if (!playlistItems.length) return;
    if (currentIndex < 0) currentIndex = indexOfSrc(videoPlayer.querySelector('source')?.src || '');
    if (currentIndex < 0) return;
    const nextIndex = currentIndex + 1;
    if (nextIndex >= playlistItems.length) return;
    const li = playlistItems[nextIndex];
    const title = li.querySelector('.item-title')?.textContent?.trim() || li.dataset.src;
    showOSD(`Next: ${title}`);
    playVideo(li.dataset.src, { clearTime: false, autoplay: true });
  });

  prevBtn?.addEventListener('click', () => {
    if (!playlistItems.length) return;
    if (currentIndex < 0) currentIndex = indexOfSrc(videoPlayer.querySelector('source')?.src || '');
    if (currentIndex <= 0) return;
    const prevIndex = currentIndex - 1;
    const li = playlistItems[prevIndex];
    const title = li.querySelector('.item-title')?.textContent?.trim() || li.dataset.src;
    showOSD(`Previous: ${title}`);
    playVideo(li.dataset.src, { clearTime: false, autoplay: true });
  });

  // --- Global keyboard shortcuts (doesn't break playlist selection) ---
  document.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
    if (isTyping) return;

    const isPlaylistFocus = playlistOverlay?.classList.contains('open')
      && activeEl
      && playlistOverlay.contains(activeEl);

    // If the playlist is focused, let Enter/Space work there (we handle above).
    if (isPlaylistFocus && (e.key === 'Enter' || e.key === ' ')) return;

    const handledKeys = ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' ','k','K','f','F','p','P','n','N','b','B'];
    if (!handledKeys.includes(e.key)) return;

    e.preventDefault();
    e.stopPropagation();

    switch (e.key) {
      case 'ArrowRight': {
        const step = e.shiftKey ? 30 : 5;
        videoPlayer.currentTime = Math.min(videoPlayer.duration || Infinity, videoPlayer.currentTime + step);
        showOSD(`+${step}s`, true);
        schedulePeriodicSave();
        break;
      }
      case 'ArrowLeft': {
        const step = e.shiftKey ? 30 : 5;
        videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - step);
        showOSD(`-${step}s`, true);
        schedulePeriodicSave();
        break;
      }
      case 'ArrowUp':
        videoPlayer.volume = clamp(videoPlayer.volume + 0.1, 0, 1);
        showOSD(`Volume ${Math.round(videoPlayer.volume * 100)}%`);
        break;
      case 'ArrowDown':
        videoPlayer.volume = clamp(videoPlayer.volume - 0.1, 0, 1);
        showOSD(`Volume ${Math.round(videoPlayer.volume * 100)}%`);
        break;
      case ' ':
      case 'k':
      case 'K':
        if (videoPlayer.paused) videoPlayer.play().catch(() => { isManuallyPaused = true; });
        else videoPlayer.pause();
        showOSD(videoPlayer.paused ? 'Paused' : 'Playing');
        break;
      case 'n':
      case 'N':
        nextBtn?.click();
        break;
      case 'b':
      case 'B':
        prevBtn?.click();
        break;
      case 'f':
      case 'F':
        toggleFullscreen();
        showOSD('Fullscreen');
        break;
      case 'p':
      case 'P':
        togglePIP();
        break;
    }
  }, { capture: true });

    // Click / double tap: play-pause only. Fullscreen stays on F key and HUD fullscreen button.
  let __clickTimer = null;
  let __lastTapAt = 0;
  let __lastTapToggleAt = 0;
  const DOUBLE_TAP_MS = 320;
  const DUPLICATE_TAP_GUARD_MS = 260;

  function toggleVideoPlayPauseFromTap() {
    const now = Date.now();
    if ((now - __lastTapToggleAt) < DUPLICATE_TAP_GUARD_MS) return;
    __lastTapToggleAt = now;

    if (videoPlayer.paused) {
      videoPlayer.play()
        .then(() => {
          isManuallyPaused = false;
          syncHud();
          showOSD('Playing');
        })
        .catch(() => {
          isManuallyPaused = true;
          syncHud();
          showOSD('Playback blocked');
        });
    } else {
      videoPlayer.pause();
      isManuallyPaused = true;
      syncHud();
      showOSD('Paused');
    }
  }

  videoPlayer.addEventListener('click', (e) => {
    if (e.target !== videoPlayer) return;
    if (prefersNativeControls) return; // mobile/touch keeps native single-tap controls
    e.preventDefault();

    if (__clickTimer) return;
    __clickTimer = setTimeout(() => {
      __clickTimer = null;
      toggleVideoPlayPauseFromTap();
    }, 180);
  });

  videoPlayer.addEventListener('dblclick', (e) => {
    if (e.target !== videoPlayer) return;
    e.preventDefault();
    e.stopPropagation();
    if (__clickTimer) { clearTimeout(__clickTimer); __clickTimer = null; }
    toggleVideoPlayPauseFromTap();
  }, { capture: true });

  videoPlayer.addEventListener('touchend', (e) => {
    if (e.target !== videoPlayer) return;
    if (e.changedTouches && e.changedTouches.length !== 1) return;

    const now = Date.now();
    const isDoubleTap = (now - __lastTapAt) > 0 && (now - __lastTapAt) <= DOUBLE_TAP_MS;
    __lastTapAt = now;

    if (!isDoubleTap) return;

    e.preventDefault();
    e.stopPropagation();
    if (__clickTimer) { clearTimeout(__clickTimer); __clickTimer = null; }
    __lastTapAt = 0;
    toggleVideoPlayPauseFromTap();
  }, { passive: false, capture: true });

  // --- Playback event hooks ---
  videoPlayer.addEventListener('play', () => {
    isManuallyPaused = false;
    showControls(true);
    ensureTitleTicker();
  });

  videoPlayer.addEventListener('pause', () => {
    isManuallyPaused = true;
    showControls(true);
    flushOnExit();
  });

  videoPlayer.addEventListener('timeupdate', () => {
    if (!currentActive) return;
    if (!videoPlayer.paused) {
      updateUIThrottled();
      schedulePeriodicSave();
    }
  }, { passive: true });

  videoPlayer.addEventListener('seeking', () => {
    // user scrubbed: flush soon
    if (!currentActive) return;
    const t = videoPlayer.currentTime || 0;
    const d = videoPlayer.duration || 0;
    queueSaveNow(currentActive.key, currentActive.src, t, d);
  }, { passive: true });

  videoPlayer.addEventListener('ended', async () => {
    // Save final progress, close the old countdown overlay if it ever exists,
    // then move to the next playlist item immediately.
    flushOnExit();
    clearNextOverlay();

    if (!currentActive) return;

    const currentPos = metasInOrder.findIndex((meta) => meta.key === currentActive.key);
    const nextMeta = currentPos >= 0 ? metasInOrder[currentPos + 1] : null;

    if (nextMeta) {
      isManuallyPaused = false;
      await playVideo(nextMeta.src, {
        clearTime: false,
        autoplay: true
      });
    } else {
      showOSD('Playlist finished');
    }
  });

  // --- Init ---
  async function initialize() {
    await openDB();
    ensureFolderControls();
    await loadAllFromDB();
    await restoreSavedFolderPlaylist({ promptIfNeeded: false, autoplay: false });

    // Paint all episode progress bars in the background (fast even for huge lists)
    paintAllProgressBars();
    renderHistory();

    // Choose start episode: lastPlayedKey -> item, else first item
    const lastKeyRec = await idbGet(LAST_PLAYED_KEY);
    const lastSrcRec = await idbGet(LAST_PLAYED_SRC_KEY);

    let startSrc = '';
    if (lastKeyRec?.value && playlistMeta.has(String(lastKeyRec.value))) {
      startSrc = playlistMeta.get(String(lastKeyRec.value)).src;
    } else if (lastSrcRec?.value) {
      const m = getMetaBySrc(String(lastSrcRec.value));
      if (m) startSrc = m.src;
    }

    if (!startSrc) startSrc = metasInOrder[0]?.src || playlistItems[0]?.dataset?.src || '';
    if (!startSrc) {
      console.error('Playlist is empty.');
      return;
    }

    // Load initial source without autoplay
    setSource(startSrc);
    videoPlayer.load();
    highlightCurrentBySrc(startSrc);
    updateMediaSession();
    setPlaybackRate(currentRate, { persist: false, show: false });
    showControls(false);

    // Apply saved time once metadata loads (if any)
    videoPlayer.addEventListener('loadedmetadata', () => {
      const startMeta = getMetaBySrc(startSrc);
      const key = startMeta?.key || videoKeyFromSrc(startSrc);
      const p = progressCache.get(key);
      if (p && p.t > 1) {
        try { videoPlayer.currentTime = p.t; } catch {}
      }
      ensureTitleTicker();
    }, { once: true });

    // Make sure the HUD is synced on startup
    if (typeof syncHud === 'function') syncHud();
  }

  initialize();
});