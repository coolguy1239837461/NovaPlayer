window.HostModule = (function() {
    let fileObjectsMap = new Map();
    let mainSwfBlobUrl = null;
    let activeRoomCode = '';
    let connectedClients = [];
    let broadcastChannel = null;

    function init() {
        const dropZone = document.getElementById('drop-zone');
        const folderInput = document.getElementById('folder-input');
        const genCodeBtn = document.getElementById('gen-code-btn');
        const startStreamBtn = document.getElementById('start-stream-btn');

        if (dropZone && folderInput) {
            dropZone.onclick = () => folderInput.click();

            dropZone.ondragover = (e) => {
                e.preventDefault();
                dropZone.classList.add('hover');
            };

            dropZone.ondragleave = () => {
                dropZone.classList.remove('hover');
            };

            dropZone.ondrop = (e) => {
                e.preventDefault();
                dropZone.classList.remove('hover');
                if (e.dataTransfer.items) {
                    const files = [];
                    for (let i = 0; i < e.dataTransfer.files.length; i++) {
                        const f = e.dataTransfer.files[i];
                        files.push({ file: f, path: f.webkitRelativePath || f.name });
                    }
                    indexHostFiles(files);
                }
            };

            folderInput.onchange = (e) => {
                const files = Array.from(e.target.files).map(f => ({ file: f, path: f.webkitRelativePath || f.name }));
                indexHostFiles(files);
            };
        }

        if (genCodeBtn) {
            genCodeBtn.onclick = generateRoomCode;
        }

        if (startStreamBtn) {
            startStreamBtn.onclick = launchHostGame;
        }

        if (window.NovaApp && window.NovaApp.setStatus) {
            window.NovaApp.setStatus("Host module loaded. Select game folder to begin.");
        }
    }

    async function indexHostFiles(files) {
        if (window.NovaApp && window.NovaApp.setStatus) {
            window.NovaApp.setStatus("Indexing files with low-RAM asset pipeline...");
        }
        let mainSwfName = null;
        fileObjectsMap.clear();

        files.forEach(item => {
            const filename = item.file.name.toLowerCase();
            fileObjectsMap.set(filename, item.file);
            if (filename === "game.swf" && !mainSwfName) mainSwfName = filename;
        });

        if (!mainSwfName) {
            const found = files.find(f => f.file.name.toLowerCase().endsWith('.swf'));
            if (found) mainSwfName = found.file.name.toLowerCase();
        }

        if (!mainSwfName) {
            if (window.NovaApp && window.NovaApp.setStatus) {
                window.NovaApp.setStatus("Error: No SWF file found in selected folder.");
            }
            return;
        }

        mainSwfBlobUrl = URL.createObjectURL(fileObjectsMap.get(mainSwfName));
        const genCodeBtn = document.getElementById('gen-code-btn');
        if (genCodeBtn) genCodeBtn.disabled = false;

        if (window.NovaApp && window.NovaApp.setStatus) {
            window.NovaApp.setStatus(`Folder indexed successfully (${files.length} files). Ready to generate room code.`);
        }
    }

    function generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
        code += '-';
        for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];

        activeRoomCode = code;
        const display = document.getElementById('room-code-display');
        const area = document.getElementById('room-info-area');
        const genBtn = document.getElementById('gen-code-btn');

        if (display) display.innerText = activeRoomCode;
        if (area) area.style.display = 'block';
        if (genBtn) genBtn.disabled = true;

        if (broadcastChannel) broadcastChannel.close();
        broadcastChannel = new BroadcastChannel('flash_room_' + activeRoomCode);

        broadcastChannel.onmessage = (event) => {
            if (event.data.type === 'JOIN_REQUEST') {
                if (!connectedClients.some(c => c.id === event.data.clientId)) {
                    connectedClients.push({ id: event.data.clientId, name: event.data.clientName });
                    updateLobbyUI();
                    broadcastChannel.postMessage({ type: 'WELCOME', clientId: event.data.clientId });
                }
            }
        };

        if (window.NovaApp && window.NovaApp.setStatus) {
            window.NovaApp.setStatus(`Room ${activeRoomCode} opened. Waiting for clients to join...`);
        }
    }

    function updateLobbyUI() {
        const lobbyBox = document.getElementById('player-lobby-list');
        const startBtn = document.getElementById('start-stream-btn');
        if (!lobbyBox) return;

        if (connectedClients.length === 0) {
            lobbyBox.innerHTML = '<div class="empty-lobby-msg">Waiting for players to join...</div>';
            if (startBtn) startBtn.disabled = true;
        } else {
            lobbyBox.innerHTML = '';
            connectedClients.forEach(p => {
                lobbyBox.innerHTML += `<div class="player-item"><span>👤 ${p.name}</span><span style="color: #00ffcc;">Connected</span></div>`;
            });
            if (startBtn) startBtn.disabled = false;
        }
    }

    async function launchHostGame() {
        if (!mainSwfBlobUrl) {
            alert("No SWF file loaded.");
            return;
        }

        if (window.NovaApp && window.NovaApp.loadFlashView) {
            await window.NovaApp.loadFlashView(false);
        }

        if (window.FlashModule && window.FlashModule.loadSwf) {
            window.FlashModule.loadSwf(mainSwfBlobUrl, (canvas) => {
                if (canvas && typeof canvas.captureStream === 'function') {
                    const stream = canvas.captureStream(30);
                    const pcHost = new RTCPeerConnection();
                    stream.getTracks().forEach(track => pcHost.addTrack(track, stream));

                    pcHost.createOffer().then(offer => pcHost.setLocalDescription(offer)).then(() => {
                        if (broadcastChannel) {
                            broadcastChannel.postMessage({
                                type: 'GAME_BROADCAST',
                                offer: pcHost.localDescription,
                                swfUrl: mainSwfBlobUrl
                            });
                        }
                    });

                    pcHost.onicecandidate = e => {
                        if (e.candidate && broadcastChannel) {
                            broadcastChannel.postMessage({ type: 'ICE_CANDIDATE', candidate: e.candidate });
                        }
                    };

                    if (window.NovaApp && window.NovaApp.setStatus) {
                        window.NovaApp.setStatus(`Host streaming active (Room: ${activeRoomCode}). Broadcasting to lobby.`);
                    }
                } else {
                    if (window.NovaApp && window.NovaApp.setStatus) {
                        window.NovaApp.setStatus(`Error: Browser canvas captureStream not supported.`);
                    }
                }
            });
        }
    }

    function cleanup() {
        if (broadcastChannel) {
            broadcastChannel.close();
            broadcastChannel = null;
        }
        connectedClients = [];
        fileObjectsMap.clear();
        mainSwfBlobUrl = null;
    }

    return {
        init: init,
        cleanup: cleanup,
        generateRoomCode: generateRoomCode,
        launchHostGame: launchHostGame
    };
})();
