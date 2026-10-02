window.ClientModule = (function() {
    let clientPeer = null;
    let clientConnection = null;
    let clientId = null;
    let flashReady = false;
    let pendingCall = null;
    let controlsLocked = false;
    let pendingControlChange = null;
    let hostAllowsCursor = false;
    let lastPointerSentAt = 0;
    let playerMapping = createDefaultMapping();

    function init() {
        const connectBtn = document.getElementById('client-connect-btn');
        if (connectBtn) {
            connectBtn.onclick = clientJoinLobby;
        }
        window.addEventListener('keydown', sendControlInput);
        window.addEventListener('keyup', sendControlInput);
        window.addEventListener('pointermove', sendPointerInput);
        window.addEventListener('pointerdown', sendPointerInput);
        window.addEventListener('pointerup', sendPointerInput);
        window.addEventListener('click', sendPointerInput);
        window.addEventListener('contextmenu', sendPointerInput);
        bindControlUI();

        if (window.NovaApp && window.NovaApp.setStatus) {
            window.NovaApp.setStatus("Client module loaded. Enter room code to connect.");
        }
    }

    async function clientJoinLobby() {
        const input = document.getElementById('room-code-input');
        if (!input) return;

        const code = input.value.trim().toUpperCase();
        if (!code) {
            alert("Please enter a valid room code.");
            return;
        }

        if (!window.Peer) {
            if (window.NovaApp) window.NovaApp.setStatus('PeerJS failed to load. Check the network and refresh the page.');
            return;
        }
        if (clientPeer) clientPeer.destroy();
        clientConnection = null;
        clientId = null;
        flashReady = false;
        pendingCall = null;
        pendingControlChange = null;
        hostAllowsCursor = false;
        if (window.NovaApp && window.NovaApp.setStatus) {
            window.NovaApp.setStatus(`Connecting to room ${code}...`);
        }

        clientPeer = new Peer();
        clientPeer.on('open', (peerId) => {
            clientId = peerId;
            clientConnection = clientPeer.connect(code, { reliable: true });
            clientConnection.on('open', () => {
                clientConnection.send({ type: 'JOIN_REQUEST', clientName: 'Chromebook-User' });
                clientConnection.send({ type: 'CONTROL_LOCK', locked: controlsLocked });
                if (window.NovaApp) window.NovaApp.setStatus('Connected to the host. Waiting for the game to start.');
            });
            clientConnection.on('data', handleHostMessage);
            clientConnection.on('close', () => {
                if (window.NovaApp) window.NovaApp.setStatus('The host connection was closed.');
            });
            clientConnection.on('error', (error) => {
                console.error('Client room connection error:', error);
                if (window.NovaApp) window.NovaApp.setStatus('Could not connect to that room code.');
            });
        });
        clientPeer.on('call', (call) => {
            pendingCall = call;
            if (flashReady) answerHostCall(call);
        });
        clientPeer.on('error', (error) => {
            console.error('Client peer error:', error);
            if (window.NovaApp) window.NovaApp.setStatus(`Room connection error: ${error.type || error.message}`);
        });
    }

    async function handleHostMessage(message) {
        if (message.type === 'GAME_STARTED') {
            if (window.NovaApp && window.NovaApp.loadFlashView) {
                await window.NovaApp.loadFlashView(true);
            }
            bindControlUI();
            flashReady = true;
            if (window.NovaApp) window.NovaApp.setStatus('Game started. Connecting to the host video stream...');
            if (pendingCall) answerHostCall(pendingCall);
        } else if (message.type === 'PLAYER_LIST') {
            const ownPlayer = message.players.find((player) => player.clientId === clientId);
            if (ownPlayer) {
                playerMapping = cloneMapping(ownPlayer.mapping);
                if (window.NovaApp) {
                    window.NovaApp.setStatus(`Connected as ${ownPlayer.name} · Player ${ownPlayer.slot}. Waiting for the host to start.`);
                }
            }
        } else if (message.type === 'CONTROL_SETTINGS') {
            hostAllowsCursor = Boolean(message.cursorEnabled);
            if (window.NovaApp) {
                window.NovaApp.setStatus(`Client mouse controls ${hostAllowsCursor ? 'enabled by host.' : 'disabled by host.'}`);
            }
        } else if (message.type === 'ROOM_FULL') {
            if (window.NovaApp) window.NovaApp.setStatus('This room already has the maximum number of players.');
            if (clientConnection) clientConnection.close();
        } else if (message.type === 'CONTROL_CHANGE_REQUEST') {
            showControlChangeRequest(message);
        }
    }

    function answerHostCall(call) {
        if (!call || call.open) return;
        call.answer();
        call.on('stream', (stream) => {
            const video = document.getElementById('remote-video');
            if (video) video.srcObject = stream;
            if (window.FlashModule && window.FlashModule.showRemoteVideo) {
                window.FlashModule.showRemoteVideo();
            }
            if (window.NovaApp) window.NovaApp.setStatus('Receiving the live game stream directly from the host.');
        });
        call.on('error', (error) => {
            console.error('Host video stream error:', error);
            if (window.NovaApp) window.NovaApp.setStatus('The host video stream could not be opened.');
        });
    }

    function sendControlInput(event) {
        if (!clientConnection || !clientConnection.open || event.repeat) return;
        if (event.target instanceof HTMLElement && event.target.closest('input, select, textarea, button')) return;
        const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
        const binding = playerMapping.find((item) => item.input === key);
        if (!binding) return;
        event.preventDefault();
        clientConnection.send({ type: 'CONTROL_INPUT', key: binding.output, pressed: event.type === 'keydown' });
    }

    function sendPointerInput(event) {
        if (!hostAllowsCursor || !clientConnection || !clientConnection.open || !flashReady) return;
        const video = document.getElementById('remote-video');
        if (!video || !video.videoWidth || !video.videoHeight) return;
        if (event.target !== video) return;
        if (event.type === 'contextmenu') event.preventDefault();
        if (event.type === 'pointerdown' && video.setPointerCapture) {
            video.setPointerCapture(event.pointerId);
        }
        const bounds = video.getBoundingClientRect();
        const scale = Math.min(bounds.width / video.videoWidth, bounds.height / video.videoHeight);
        const contentWidth = video.videoWidth * scale;
        const contentHeight = video.videoHeight * scale;
        const contentLeft = bounds.left + (bounds.width - contentWidth) / 2;
        const contentTop = bounds.top + (bounds.height - contentHeight) / 2;
        const x = (event.clientX - contentLeft) / contentWidth;
        const y = (event.clientY - contentTop) / contentHeight;
        if (x < 0 || x > 1 || y < 0 || y > 1) return;

        const now = performance.now();
        if (event.type === 'pointermove') {
            if (now - lastPointerSentAt < 16) return;
            lastPointerSentAt = now;
        }
        const eventTypes = {
            pointermove: 'mousemove',
            pointerdown: 'mousedown',
            pointerup: 'mouseup',
            click: 'click',
            contextmenu: 'contextmenu'
        };
        clientConnection.send({
            type: 'CONTROL_POINTER',
            eventType: eventTypes[event.type],
            x,
            y,
            button: event.button,
            buttons: event.buttons,
            pointerType: event.pointerType
        });
    }

    function createDefaultMapping() {
        return [
            { id: 'up', name: 'Up', input: 'w', output: 'ArrowUp' },
            { id: 'left', name: 'Left', input: 'a', output: 'ArrowLeft' },
            { id: 'down', name: 'Down', input: 's', output: 'ArrowDown' },
            { id: 'right', name: 'Right', input: 'd', output: 'ArrowRight' }
        ];
    }

    function cloneMapping(mapping) {
        const rows = Array.isArray(mapping)
            ? mapping
            : Object.entries(mapping || {}).map(([name, binding]) => ({ id: name, name, ...binding }));
        return rows.filter((row) => row && typeof row === 'object').map((row, index) => ({
            id: typeof row.id === 'string' && row.id ? row.id : `control-${index + 1}`,
            name: typeof row.name === 'string' ? row.name : `Control ${index + 1}`,
            input: typeof row.input === 'string' ? normalizeKey(row.input) : '',
            output: typeof row.output === 'string' ? normalizeKey(row.output) : ''
        }));
    }

    function normalizeKey(key) {
        return key.length === 1 ? key.toLowerCase() : key;
    }

    function formatKey(key) {
        return key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key;
    }

    function showControlChangeRequest(message) {
        if (!message.requestId || !message.mapping || pendingControlChange) {
            if (clientConnection && clientConnection.open && message.requestId) {
                clientConnection.send({ type: 'CONTROL_CHANGE_RESPONSE', requestId: message.requestId, accepted: false });
            }
            return;
        }
        pendingControlChange = {
            requestId: message.requestId,
            mapping: cloneMapping(message.mapping)
        };
        const overlay = document.getElementById('client-control-change-overlay');
        const list = document.getElementById('client-control-change-list');
        if (!overlay || !list) return;
        list.innerHTML = '';
        const oldBindings = new Map(playerMapping.map((binding) => [binding.id, binding]));
        const newIds = new Set(pendingControlChange.mapping.map((binding) => binding.id));
        pendingControlChange.mapping.forEach((after) => {
            const before = oldBindings.get(after.id);
            if (before && before.name === after.name && before.input === after.input && before.output === after.output) return;
            const item = document.createElement('li');
            const code = document.createElement('code');
            const oldKey = before && before.input !== after.input ? `${formatKey(before.input)} → ` : '';
            code.textContent = `${oldKey}${formatKey(after.input)} (${after.name}) → ${formatKey(after.output)}`;
            item.appendChild(code);
            list.appendChild(item);
        });
        playerMapping.forEach((before) => {
            if (newIds.has(before.id)) return;
            const item = document.createElement('li');
            item.textContent = `Remove ${before.name} (${formatKey(before.input)} → ${formatKey(before.output)})`;
            list.appendChild(item);
        });
        if (!list.children.length) {
            const item = document.createElement('li');
            item.textContent = 'No key changes';
            list.appendChild(item);
        }
        overlay.hidden = false;
        syncControlLockUI();
    }

    function respondToControlChange(accepted) {
        if (!pendingControlChange || !clientConnection || !clientConnection.open) return;
        if (accepted && controlsLocked) return;
        const request = pendingControlChange;
        if (accepted) playerMapping = cloneMapping(request.mapping);
        clientConnection.send({
            type: 'CONTROL_CHANGE_RESPONSE',
            requestId: request.requestId,
            accepted
        });
        pendingControlChange = null;
        const overlay = document.getElementById('client-control-change-overlay');
        if (overlay) overlay.hidden = true;
        if (window.NovaApp) {
            window.NovaApp.setStatus(accepted ? 'Control changes accepted.' : 'Control changes declined. Your current controls are unchanged.');
        }
    }

    function bindControlUI() {
        const lobbyToggle = document.getElementById('client-controls-locked');
        const gameToggle = document.getElementById('client-game-controls-locked');
        const promptToggle = document.getElementById('client-prompt-controls-locked');
        [lobbyToggle, gameToggle, promptToggle].forEach((toggle) => {
            if (toggle) toggle.onchange = () => {
                controlsLocked = toggle.checked;
                if (clientConnection && clientConnection.open) {
                    clientConnection.send({ type: 'CONTROL_LOCK', locked: controlsLocked });
                }
                syncControlLockUI();
            };
        });
        const accept = document.getElementById('client-control-accept');
        const decline = document.getElementById('client-control-decline');
        if (accept) accept.onclick = () => respondToControlChange(true);
        if (decline) decline.onclick = () => respondToControlChange(false);
        syncControlLockUI();
    }

    function syncControlLockUI() {
        ['client-controls-locked', 'client-game-controls-locked', 'client-prompt-controls-locked'].forEach((id) => {
            const toggle = document.getElementById(id);
            if (toggle) toggle.checked = controlsLocked;
        });
        const accept = document.getElementById('client-control-accept');
        const lockNote = document.getElementById('client-control-lock-note');
        if (accept) accept.disabled = controlsLocked;
        if (lockNote) lockNote.hidden = !controlsLocked;
    }

    function cleanup() {
        if (clientPeer) {
            clientPeer.destroy();
            clientPeer = null;
        }
        clientConnection = null;
        window.removeEventListener('keydown', sendControlInput);
        window.removeEventListener('keyup', sendControlInput);
        window.removeEventListener('pointermove', sendPointerInput);
        window.removeEventListener('pointerdown', sendPointerInput);
        window.removeEventListener('pointerup', sendPointerInput);
        window.removeEventListener('click', sendPointerInput);
        window.removeEventListener('contextmenu', sendPointerInput);
        clientId = null;
        flashReady = false;
        pendingCall = null;
        pendingControlChange = null;
        hostAllowsCursor = false;
    }

    return {
        init: init,
        cleanup: cleanup,
        clientJoinLobby: clientJoinLobby
    };
})();
