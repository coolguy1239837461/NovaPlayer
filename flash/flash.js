window.FlashModule = (function() {
    let activePlayer = null;
    let activeSwfUrl = null;
    let originalFetch = null;
    const fileObjectsMap = new Map();
    const assetBlobUrls = new Map();
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
            loadPromise.then(() => {
                if (window.NovaApp && window.NovaApp.logDiagnostic) {
                    window.NovaApp.logDiagnostic('ruffle', 'info', 'SWF load promise resolved', swfUrl);
                }
            }, (error) => {
                console.error('Ruffle failed to load the selected SWF:', error);
                if (window.NovaApp) window.NovaApp.setStatus(`Game load failed: ${error.message}`);
            });
        }

        if (onCanvasReady) {
            const startedAt = performance.now();
            const findCanvas = () => {
                const canvas = player.shadowRoot?.querySelector('canvas') || player.querySelector('canvas');
                if (canvas || performance.now() - startedAt >= 15000) {
                    if (window.NovaApp && window.NovaApp.logDiagnostic) {
                        window.NovaApp.logDiagnostic('ruffle', canvas ? 'info' : 'error', canvas ? 'Player canvas created' : 'Canvas not found after 15 seconds');
                    }
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
        activeSwfUrl = getOrCreateBlobUrl(mainSwfEntry.name.toLowerCase());
        if (!activeSwfUrl) {
            if (window.NovaApp) window.NovaApp.setStatus(`Could not index ${mainSwfEntry.name} for Ruffle.`);
            return;
        }
        if (window.NovaApp && window.NovaApp.logDiagnostic) {
            window.NovaApp.logDiagnostic('ruffle', 'info', 'Loading SWF', mainSwfEntry.name, 'with', selectedFilesMap.size, 'indexed files');
        }
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
        fileObjectsMap.clear();
        assetBlobUrls.forEach((url) => URL.revokeObjectURL(url));
        assetBlobUrls.clear();
        filesMap.forEach((file, path) => indexFileMetadata(file, path));

        window.fetch = async function(resource, options) {
            const urlString = typeof resource === 'string' ? resource : (resource.url || '');
            let decodedPath = urlString;
            try {
                decodedPath = new URL(urlString, window.location.href).pathname;
            } catch (_) {}
            try {
                decodedPath = decodeURIComponent(decodedPath);
            } catch (_) {}
            decodedPath = decodedPath.toLowerCase();

            const requestedFile = decodedPath.split('/').pop();
            let matchedKey = requestedFile;
            if (!fileObjectsMap.has(matchedKey)) {
                for (const key of fileObjectsMap.keys()) {
                    if (decodedPath.endsWith(key) || key.endsWith(requestedFile)) {
                        matchedKey = key;
                        break;
                    }
                }
            }

            const blobUrl = getOrCreateBlobUrl(matchedKey);
            if (window.NovaApp && window.NovaApp.logDiagnostic) {
                window.NovaApp.logDiagnostic('asset', blobUrl ? 'info' : 'warn', blobUrl ? 'served' : 'not indexed', requestedFile, 'matched key:', matchedKey);
            }
            return blobUrl ? originalFetch(blobUrl, options) : originalFetch(resource, options);
        };

        if (window.NovaApp) {
            window.NovaApp.setStatus(`Indexed ${filesMap.size} game files for Ruffle asset loading.`);
        }
    }

    function indexFileMetadata(file, path) {
        const cleanPath = path.replace(/^[\/\\]+/, '').toLowerCase();
        const filename = file.name.toLowerCase();
        fileObjectsMap.set(filename, file);
        fileObjectsMap.set(cleanPath, file);

        const pathSegments = cleanPath.split(/[\/\\]/);
        for (let index = 1; index < pathSegments.length; index++) {
            fileObjectsMap.set(pathSegments.slice(index).join('/'), file);
        }
    }

    function getOrCreateBlobUrl(lookupKey) {
        if (assetBlobUrls.has(lookupKey)) return assetBlobUrls.get(lookupKey);
        const file = fileObjectsMap.get(lookupKey);
        if (!file) return null;
        const blobUrl = URL.createObjectURL(file);
        assetBlobUrls.set(lookupKey, blobUrl);
        return blobUrl;
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
        const canvas = activePlayer.shadowRoot?.querySelector('canvas') || activePlayer;
        if (canvas.focus) canvas.focus({ preventScroll: true });
        canvas.dispatchEvent(new KeyboardEvent(pressed ? 'keydown' : 'keyup', {
            key: normalizedKey,
            code,
            keyCode: keyCodes[normalizedKey] || (normalizedKey.length === 1 ? normalizedKey.toUpperCase().charCodeAt(0) : 0),
            which: keyCodes[normalizedKey] || (normalizedKey.length === 1 ? normalizedKey.toUpperCase().charCodeAt(0) : 0),
            bubbles: true,
            composed: true,
            cancelable: true
        }));
    }

    function sendPointerInput(input) {
        const canvas = activePlayer?.shadowRoot?.querySelector('canvas') || activePlayer;
        if (!canvas || !input || !['pointermove', 'pointerdown', 'pointerup'].includes(input.eventType)) return;
        const bounds = canvas.getBoundingClientRect();
        const clientX = bounds.left + input.x * bounds.width;
        const clientY = bounds.top + input.y * bounds.height;
        if (canvas.focus) canvas.focus({ preventScroll: true });
        canvas.dispatchEvent(new PointerEvent(input.eventType, {
            bubbles: true,
            composed: true,
            cancelable: true,
            pointerId: 1,
            pointerType: input.pointerType || 'mouse',
            isPrimary: true,
            clientX,
            clientY,
            button: input.button ?? 0,
            buttons: input.buttons ?? 0
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
        assetBlobUrls.forEach((url) => URL.revokeObjectURL(url));
        assetBlobUrls.clear();
        activeSwfUrl = null;
        fileObjectsMap.clear();
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
        sendPointerInput: sendPointerInput,
        showRemoteVideo: showRemoteVideo,
        cleanup: cleanup
    };
})();
