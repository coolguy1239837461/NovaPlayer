window.FlashModule = (function() {
    let activePlayer = null;
    let activeSwfUrl = null;
    let originalFetch = null;
    let assetBlobUrls = new Map();
    let outboundStream = null;
    const viewerConnections = new Map();

    function init() {
        const endButton = document.getElementById('host-end-game-btn');
        if (endButton) {
            endButton.onclick = () => {
                if (window.HostModule && window.HostModule.stopHostingSession) {
                    window.HostModule.stopHostingSession();
                }
            };
        }
        const controlsButton = document.getElementById('host-controls-button');
        const controlsPanel = document.getElementById('host-controls-panel');
        const closeControlsButton = document.getElementById('host-controls-close');
        if (controlsButton && controlsPanel) {
            controlsButton.onclick = () => { controlsPanel.hidden = !controlsPanel.hidden; };
        }
        if (closeControlsButton && controlsPanel) {
            closeControlsButton.onclick = () => { controlsPanel.hidden = true; };
        }
        if (window.HostModule && window.HostModule.renderControlDashboard) {
            window.HostModule.renderControlDashboard();
        }
        if (window.NovaApp && window.NovaApp.setStatus) {
            window.NovaApp.setStatus("Flash module ready.");
        }
    }

    function loadSwf(swfUrl, onCanvasReady) {
        const flashContainer = document.getElementById('flash-container');
        if (!flashContainer) return;

        flashContainer.style.display = 'block';
        flashContainer.innerHTML = '';

        if (!window.RufflePlayer) {
            console.error("RufflePlayer script is not loaded.");
            return;
        }

        const ruffle = window.RufflePlayer.newest();
        activePlayer = ruffle.createPlayer();
        const player = activePlayer;
        flashContainer.appendChild(player);

        const loadPromise = player.load({
            url: swfUrl,
            allowScriptAccess: true,
            networkingAccessMode: 'all',
            sandbox: null
        });
        if (loadPromise && typeof loadPromise.catch === 'function') {
            loadPromise.catch((error) => {
                console.error('Ruffle failed to load the selected SWF:', error);
                if (window.NovaApp) window.NovaApp.setStatus(`Game load failed: ${error.message}`);
            });
        }

        if (onCanvasReady) {
            const startedAt = performance.now();
            const findCanvas = () => {
                const canvas = player.shadowRoot?.querySelector('canvas') || player.querySelector('canvas');
                if (canvas || performance.now() - startedAt >= 15000) {
                    onCanvasReady(canvas);
                } else {
                    requestAnimationFrame(findCanvas);
                }
            };
            requestAnimationFrame(findCanvas);
        }
    }

    async function setupHostStream(mainSwfEntry, selectedFilesMap) {
        const flashContainer = document.getElementById('flash-container');
        if (!flashContainer || !mainSwfEntry) return;
        if (!window.RufflePlayer) {
            if (window.NovaApp) window.NovaApp.setStatus('Ruffle Player could not be loaded. Check the network connection and retry.');
            return;
        }

        installAssetFetch(selectedFilesMap);
        if (activeSwfUrl) URL.revokeObjectURL(activeSwfUrl);
        activeSwfUrl = URL.createObjectURL(mainSwfEntry);
        await new Promise((resolve) => {
            loadSwf(activeSwfUrl, (canvas) => {
                if (canvas && canvas.captureStream) outboundStream = canvas.captureStream(30);
                resolve();
            });
            window.setTimeout(resolve, 16000);
        });
        if (outboundStream) {
            if (window.NovaApp) window.NovaApp.setStatus(`Running ${mainSwfEntry.name}; game feed is ready for players.`);
        } else if (window.NovaApp) {
            window.NovaApp.setStatus(`Running ${mainSwfEntry.name} on the host. This Ruffle player does not expose a capturable canvas, so clients cannot receive video.`);
        }
    }

    function installAssetFetch(filesMap) {
        if (originalFetch) window.fetch = originalFetch;
        originalFetch = window.fetch.bind(window);
        assetBlobUrls = new Map();

        const indexedFiles = Array.from(filesMap.entries()).map(([path, file]) => ({
            path: normalizeAssetPath(path),
            file
        }));

        window.fetch = async function(resource, options) {
            const requestedUrl = typeof resource === 'string' || resource instanceof URL
                ? resource.toString()
                : resource.url;
            let requestedPath;
            try {
                requestedPath = normalizeAssetPath(new URL(requestedUrl, window.location.href).pathname);
            } catch (_) {
                return originalFetch(resource, options);
            }

            const match = findAsset(requestedPath, indexedFiles);
            if (!match) return originalFetch(resource, options);

            let blobUrl = assetBlobUrls.get(match.path);
            if (!blobUrl) {
                blobUrl = URL.createObjectURL(match.file);
                assetBlobUrls.set(match.path, blobUrl);
            }
            return originalFetch(blobUrl, options);
        };

        if (window.NovaApp) {
            window.NovaApp.setStatus(`Indexed ${indexedFiles.length} game files for Ruffle asset loading.`);
        }
    }

    function normalizeAssetPath(path) {
        let normalized = path;
        try {
            normalized = decodeURIComponent(path);
        } catch (_) {}
        return normalized.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
    }

    function findAsset(requestedPath, indexedFiles) {
        const exactMatch = indexedFiles.find((entry) => entry.path === requestedPath);
        if (exactMatch) return exactMatch;

        const suffixMatch = indexedFiles.find((entry) => requestedPath.endsWith(`/${entry.path}`));
        if (suffixMatch) return suffixMatch;

        const requestedName = requestedPath.split('/').pop();
        return indexedFiles.find((entry) => entry.path.split('/').pop() === requestedName) || null;
    }

    function addViewer(clientId, peer) {
        if (!outboundStream || !peer || viewerConnections.has(clientId)) return;
        const call = peer.call(clientId, outboundStream);
        if (!call) return;
        viewerConnections.set(clientId, call);
        call.on('error', (error) => {
            console.error(`Video call to ${clientId} failed:`, error);
            viewerConnections.delete(clientId);
        });
    }

    function sendGameKey(key, pressed) {
        if (!activePlayer || typeof key !== 'string' || !key) return;
        const normalizedKey = key.length === 1 ? key.toLowerCase() : key;
        const keyCodes = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
        const code = normalizedKey.startsWith('Arrow')
            ? normalizedKey
            : /^[a-z]$/.test(normalizedKey) ? `Key${normalizedKey.toUpperCase()}`
                : /^[0-9]$/.test(normalizedKey) ? `Digit${normalizedKey}`
                    : normalizedKey === ' ' ? 'Space' : normalizedKey;
        activePlayer.dispatchEvent(new KeyboardEvent(pressed ? 'keydown' : 'keyup', {
            key: normalizedKey,
            code,
            keyCode: keyCodes[normalizedKey] || (normalizedKey.length === 1 ? normalizedKey.toUpperCase().charCodeAt(0) : 0),
            which: keyCodes[normalizedKey] || (normalizedKey.length === 1 ? normalizedKey.toUpperCase().charCodeAt(0) : 0),
            bubbles: true
        }));
    }

    function showRemoteVideo() {
        const remoteContainer = document.getElementById('remote-video-container');
        const waitingScreen = document.getElementById('waiting-screen');
        const remoteVideo = document.getElementById('remote-video');

        if (remoteContainer) remoteContainer.style.display = 'block';
        if (waitingScreen) waitingScreen.style.display = 'none';
        if (remoteVideo) remoteVideo.style.display = 'block';
    }

    function cleanup() {
        const flashContainer = document.getElementById('flash-container');
        if (flashContainer) flashContainer.innerHTML = '';
        viewerConnections.forEach((call) => call.close());
        viewerConnections.clear();
        if (outboundStream) {
            outboundStream.getTracks().forEach((track) => track.stop());
            outboundStream = null;
        }
        if (activeSwfUrl) {
            URL.revokeObjectURL(activeSwfUrl);
            activeSwfUrl = null;
        }
        assetBlobUrls.forEach((url) => URL.revokeObjectURL(url));
        assetBlobUrls.clear();
        if (originalFetch) {
            window.fetch = originalFetch;
            originalFetch = null;
        }
        activePlayer = null;
    }

    return {
        init: init,
        loadSwf: loadSwf,
        setupHostStream: setupHostStream,
        addViewer: addViewer,
        sendGameKey: sendGameKey,
        showRemoteVideo: showRemoteVideo,
        cleanup: cleanup
    };
})();
