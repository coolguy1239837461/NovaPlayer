window.HostModule = (function() {
    let selectedFilesMap = new Map(); // Stores name -> File object for everything in the directory
    let selectedSwfFiles = [];        // List of SWF file objects found
    let selectedFolderName = null;
    let activeRoomCode = null;
    let hostPeer = null;
    let selectedSwf = null;
    let gameStarted = false;
    let clientCursorEnabled = false;
    let players = new Map();
    const controlActions = [
        ['up', 'Up'],
        ['down', 'Down'],
        ['left', 'Left'],
        ['right', 'Right'],
        ['jump', 'Jump'],
        ['action', 'Action']
    ];
    let hostMapping = createDefaultMapping(1);
    let hostMappingDraft = null;
    const controlDrafts = new Map();

    function init() {
        const folderInput = document.getElementById('host-folder-fallback');
        const swfInput = document.getElementById('host-swf-file-fallback');
        const folderDropzone = document.getElementById('host-folder-dropzone');
        const startBtn = document.getElementById('host-start-btn');
        const stopBtn = document.getElementById('host-stop-btn');
        const launchBtn = document.getElementById('host-launch-game-btn');

        if (folderInput) folderInput.onchange = handleFallbackFolderSelection;
        if (folderDropzone) {
            folderDropzone.ondragover = (event) => {
                event.preventDefault();
                folderDropzone.classList.add('drag-active');
            };
            folderDropzone.ondragleave = () => folderDropzone.classList.remove('drag-active');
            folderDropzone.ondrop = handleFolderDrop;
        }
        if (startBtn) startBtn.onclick = startHostingSession;
        if (stopBtn) stopBtn.onclick = stopHostingSession;
        if (launchBtn) launchBtn.onclick = startGame;
        document.addEventListener('change', handleCursorInputToggle);
        window.addEventListener('keydown', handleHostKey);
        window.addEventListener('keyup', handleHostKey);

        if (window.NovaApp && window.NovaApp.setStatus) {
            window.NovaApp.setStatus("Host module ready. Please select your game folder.");
        }
        renderControlDashboard();
    }

    function handleFallbackFolderSelection(event) {
        const folderInput = event.currentTarget;
        const files = Array.from(folderInput.files || []);
        folderInput.value = '';
        if (!files.length) {
            showFolderSummary('No files were returned by the folder picker. Try dropping the folder here.');
            return;
        }

        selectedFilesMap.clear();
        selectedSwfFiles = [];
        let folderName = 'Selected folder';
        files.forEach((file) => {
            const path = file.webkitRelativePath || file.name;
            const segments = path.split('/');
            if (segments.length > 1) folderName = segments[0];
            const relativePath = segments.length > 1 ? segments.slice(1).join('/') : file.name;
            storeSelectedFile(file, relativePath);
        });
        updateSelectedFolder(folderName);
    }

    function handleManualSwfSelection(event) {
        const input = event.currentTarget;
        const file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        storeSelectedFile(file, file.name);
        if (!selectedSwfFiles.some((entry) => entry.relativePath === file.name)) {
            selectedSwfFiles.push({ name: file.name, relativePath: file.name, file });
        }
        updateSelectedFolder(selectedFolderName || 'Selected SWF file');
    }

    async function handleFolderDrop(event) {
        event.preventDefault();
        event.currentTarget.classList.remove('drag-active');
        selectedFilesMap.clear();
        selectedSwfFiles = [];
        const items = Array.from(event.dataTransfer.items || []);
        const entries = items.map((item) => item.webkitGetAsEntry && item.webkitGetAsEntry()).filter(Boolean);
        try {
            if (!entries.length) {
                const files = Array.from(event.dataTransfer.files || []);
                if (!files.length) {
                    showFolderSummary('The dropped item did not contain readable files.');
                    return;
                }
                let folderName = 'Dropped files';
                files.forEach((file) => {
                    const path = file.webkitRelativePath || file.name;
                    const segments = path.split('/');
                    if (segments.length > 1) folderName = segments[0];
                    storeSelectedFile(file, segments.length > 1 ? segments.slice(1).join('/') : file.name);
                });
                updateSelectedFolder(folderName);
                return;
            }
            for (const entry of entries) {
                if (entry.isDirectory) {
                    await readDroppedDirectory(entry, '');
                } else if (entry.isFile) {
                    const file = await getDroppedFile(entry);
                    storeSelectedFile(file, file.name);
                }
            }
            const rootName = entries.find((entry) => entry.isDirectory)?.name || 'Dropped files';
            updateSelectedFolder(rootName);
        } catch (err) {
            console.error(err);
            if (window.NovaApp) window.NovaApp.setStatus(`Error reading dropped folder: ${err.message}`);
        }
    }

    async function readDroppedDirectory(directoryEntry, pathPrefix) {
        const reader = directoryEntry.createReader();
        let entries;
        do {
            entries = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
            for (const entry of entries) {
                if (entry.isDirectory) {
                    await readDroppedDirectory(entry, `${pathPrefix}${entry.name}/`);
                } else if (entry.isFile) {
                    const file = await getDroppedFile(entry);
                    storeSelectedFile(file, `${pathPrefix}${file.name}`);
                }
            }
        } while (entries.length);
    }

    function getDroppedFile(entry) {
        return new Promise((resolve, reject) => entry.file(resolve, reject));
    }

    function storeSelectedFile(file, relativePath) {
        selectedFilesMap.set(relativePath, file);
        const existingIndex = selectedSwfFiles.findIndex((entry) => entry.relativePath === relativePath);
        if (file.name.toLowerCase().endsWith('.swf')) {
            const entry = { name: file.name, relativePath, file };
            if (existingIndex >= 0) selectedSwfFiles[existingIndex] = entry;
            else selectedSwfFiles.push(entry);
        } else if (existingIndex >= 0) {
            selectedSwfFiles.splice(existingIndex, 1);
        }
    }

    function updateSelectedFolder(folderName) {
        selectedFolderName = folderName;
        const folderDisplay = document.getElementById('selected-folder-name');
        const manualPickGroup = document.getElementById('swf-manual-pick-group');
        const swfSelectGroup = document.getElementById('swf-select-group');
        const swfSelectDropdown = document.getElementById('swf-file-select');
        const startBtn = document.getElementById('host-start-btn');
        if (folderDisplay) folderDisplay.innerText = `Folder: ${folderName}`;
        showFolderSummary(`${selectedFilesMap.size} file(s) found; ${selectedSwfFiles.length} SWF file(s) found.`);
        if (window.NovaApp && window.NovaApp.logDiagnostic) {
            window.NovaApp.logDiagnostic('host', 'info', 'Indexed folder', folderName, `${selectedFilesMap.size} file(s)`, selectedSwfFiles.map((entry) => entry.relativePath));
        }

        if (selectedSwfFiles.length === 0) {
            if (swfSelectGroup) swfSelectGroup.style.display = 'none';
            if (manualPickGroup) manualPickGroup.style.display = 'block';
            if (startBtn) startBtn.disabled = true;
            if (window.NovaApp) window.NovaApp.setStatus('No SWF found in that folder. Choose the main SWF file separately.');
            return;
        }

        if (swfSelectDropdown) {
            swfSelectDropdown.innerHTML = '';
            selectedSwfFiles.forEach((fileObj) => {
                const option = document.createElement('option');
                option.value = fileObj.relativePath;
                option.textContent = fileObj.relativePath;
                swfSelectDropdown.appendChild(option);
            });
        }
        if (manualPickGroup) manualPickGroup.style.display = 'none';
        if (swfSelectGroup) swfSelectGroup.style.display = 'block';
        if (startBtn) startBtn.disabled = false;
        if (window.NovaApp) {
            window.NovaApp.setStatus(`Loaded folder successfully. Found ${selectedSwfFiles.length} SWF file(s) and assets.`);
        }
    }

    function showFolderSummary(message) {
        const summary = document.getElementById('folder-selection-summary');
        if (summary) summary.textContent = message;
        if (window.NovaApp) window.NovaApp.setStatus(message);
    }

    async function startHostingSession() {
        const swfSelectDropdown = document.getElementById('swf-file-select');
        if (!swfSelectDropdown || !swfSelectDropdown.value) {
            alert("Please select a main SWF file to run.");
            return;
        }

        const chosenSwfPath = swfSelectDropdown.value;
        const mainSwfEntry = selectedFilesMap.get(chosenSwfPath);

        if (!mainSwfEntry) {
            alert("Could not locate the selected SWF file in memory.");
            return;
        }

        selectedSwf = mainSwfEntry;
        if (window.NovaApp && window.NovaApp.logDiagnostic) {
            window.NovaApp.logDiagnostic('host', 'info', 'Starting session with', chosenSwfPath, 'folder files:', selectedFilesMap.size);
        }
        gameStarted = false;
        clientCursorEnabled = false;
        syncCursorInputToggles();
        players.clear();
        controlDrafts.clear();
        activeRoomCode = Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
        
        // Switch setup card view to active session view
        document.getElementById('host-setup-card').style.display = 'none';
        document.getElementById('host-active-card').style.display = 'block';
        document.getElementById('active-room-code').innerText = activeRoomCode;
        document.getElementById('host-launch-game-btn').disabled = false;
        renderPlayers();

        if (!window.Peer) {
            if (window.NovaApp) window.NovaApp.setStatus('PeerJS failed to load. Check the network and refresh the page.');
            return;
        }
        if (hostPeer) hostPeer.destroy();
        hostPeer = new Peer(activeRoomCode);
        hostPeer.on('open', () => {
            if (window.NovaApp) window.NovaApp.setStatus(`Hosting session active. Room Code: ${activeRoomCode}`);
        });
        hostPeer.on('connection', (connection) => {
            connection.on('data', (message) => handleClientMessage(connection, message));
            connection.on('close', () => {
                players.delete(connection.peer);
                renderPlayers();
                publishPlayers();
            });
            connection.on('open', () => {
                if (window.NovaApp) window.NovaApp.setStatus(`${players.size + 1} client connection${players.size ? 's' : ''} established.`);
            });
        });
        hostPeer.on('error', (error) => {
            console.error('Host peer error:', error);
            if (window.NovaApp) window.NovaApp.setStatus(`Room connection error: ${error.type || error.message}`);
        });

        if (window.NovaApp && window.NovaApp.setStatus) {
            window.NovaApp.setStatus(`Hosting session active. Room Code: ${activeRoomCode}`);
        }

        publishPlayers();
    }

    function handleClientMessage(connection, message) {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'JOIN_REQUEST') {
            if (!players.has(connection.peer)) {
                const slot = nextAvailableSlot();
                if (slot === null) {
                    connection.send({ type: 'ROOM_FULL' });
                    connection.close();
                    return;
                }
                players.set(connection.peer, {
                    name: message.clientName || 'Player',
                    slot,
                    mapping: createDefaultMapping(slot),
                    controlsLocked: false,
                    pendingChange: null,
                    connection
                });
            }
            renderPlayers();
            publishPlayers();
            connection.send({ type: 'CONTROL_SETTINGS', cursorEnabled: clientCursorEnabled });
            if (gameStarted) startGameForClient(connection.peer);
        } else if (message.type === 'CONTROL_INPUT' && players.has(connection.peer)) {
            if (window.NovaApp && window.NovaApp.logDiagnostic) {
                window.NovaApp.logDiagnostic('input', 'debug', 'Client key received', players.get(connection.peer).name, message.key, message.pressed ? 'down' : 'up');
            }
            if (window.FlashModule && window.FlashModule.sendGameKey) {
                window.FlashModule.sendGameKey(message.key, message.pressed);
            }
        } else if (message.type === 'CONTROL_POINTER' && clientCursorEnabled && players.has(connection.peer)) {
            if (window.FlashModule && window.FlashModule.sendPointerInput) {
                window.FlashModule.sendPointerInput(message);
            }
        } else if (message.type === 'CONTROL_LOCK' && players.has(connection.peer)) {
            players.get(connection.peer).controlsLocked = Boolean(message.locked);
            renderPlayers();
        } else if (message.type === 'CONTROL_CHANGE_RESPONSE' && players.has(connection.peer)) {
            const player = players.get(connection.peer);
            const pending = player.pendingChange;
            if (!pending || message.requestId !== pending.requestId) return;
            if (message.accepted) player.mapping = pending.mapping;
            player.pendingChange = null;
            controlDrafts.delete(connection.peer);
            renderControlDashboard();
            if (message.accepted) publishPlayers();
            if (window.NovaApp) {
                window.NovaApp.setStatus(message.accepted
                    ? `${player.name} accepted the control changes.`
                    : `${player.name} declined the control changes.`);
            }
        }
    }

    function nextAvailableSlot() {
        const usedSlots = new Set(Array.from(players.values(), (player) => player.slot));
        for (let slot = 2; slot <= 4; slot++) {
            if (!usedSlots.has(slot)) return slot;
        }
        return null;
    }

    function handleCursorInputToggle(event) {
        if (!event.target.matches('#host-client-cursor-toggle, #host-game-client-cursor-toggle')) return;
        clientCursorEnabled = event.target.checked;
        syncCursorInputToggles();
        sendToClients({ type: 'CONTROL_SETTINGS', cursorEnabled: clientCursorEnabled });
        if (window.NovaApp) {
            window.NovaApp.setStatus(`Client mouse controls ${clientCursorEnabled ? 'enabled' : 'disabled'}.`);
        }
    }

    function syncCursorInputToggles() {
        ['host-client-cursor-toggle', 'host-game-client-cursor-toggle'].forEach((id) => {
            const toggle = document.getElementById(id);
            if (toggle) toggle.checked = clientCursorEnabled;
        });
    }

    function renderPlayers() {
        const list = document.getElementById('host-player-list');
        const status = document.getElementById('host-peer-status');
        if (!list || !status) return;

        status.textContent = players.size ? `${players.size} player${players.size === 1 ? '' : 's'} connected` : 'Waiting for client connection...';
        list.innerHTML = '';
        if (!players.size) {
            const empty = document.createElement('li');
            empty.className = 'empty-player-list';
            empty.textContent = 'Waiting for players to join';
            list.appendChild(empty);
            return;
        }

        players.forEach((player, clientId) => {
            const row = document.createElement('li');
            const name = document.createElement('span');
            name.textContent = player.name;
            const slot = document.createElement('select');
            slot.className = 'dropdown-select';
            slot.setAttribute('aria-label', `${player.name} player slot`);
            for (let value = 1; value <= 4; value++) {
                const option = document.createElement('option');
                option.value = String(value);
                option.textContent = `Player ${value}`;
                option.selected = player.slot === value;
                slot.appendChild(option);
            }
            slot.disabled = gameStarted;
            slot.onchange = () => {
                player.slot = Number(slot.value);
                publishPlayers();
            };
            row.append(name, slot);
            list.appendChild(row);
        });
        renderControlDashboard();
    }

    function publishPlayers() {
        if (!hostPeer) return;
        const message = {
            type: 'PLAYER_LIST',
            players: Array.from(players, ([clientId, player]) => ({
                clientId,
                name: player.name,
                slot: player.slot,
                mapping: player.mapping
            }))
        };
        players.forEach((player) => {
            if (player.connection.open) player.connection.send(message);
        });
    }

    async function startGame() {
        if (!selectedSwf || gameStarted) return;
        gameStarted = true;
        const launchBtn = document.getElementById('host-launch-game-btn');
        if (launchBtn) launchBtn.disabled = true;
        renderPlayers();
        sendToClients({ type: 'GAME_STARTED' });

        if (window.NovaApp && window.NovaApp.loadFlashView) {
            await window.NovaApp.loadFlashView(false);
        }
        renderControlDashboard();
        if (window.FlashModule && window.FlashModule.setupHostStream) {
            await window.FlashModule.setupHostStream(selectedSwf, selectedFilesMap);
            players.forEach((player, clientId) => window.FlashModule.addViewer(clientId, hostPeer));
        } else if (window.NovaApp) {
            window.NovaApp.setStatus('Flash player is unavailable; could not start the game.');
        }
    }

    function startGameForClient(clientId) {
        const player = players.get(clientId);
        if (player && player.connection.open) player.connection.send({ type: 'GAME_STARTED' });
        if (window.FlashModule && window.FlashModule.addViewer) {
            window.FlashModule.addViewer(clientId, hostPeer);
        }
    }

    function sendToClients(message) {
        players.forEach((player) => {
            if (player.connection.open) player.connection.send(message);
        });
    }

    function stopHostingSession() {
        cleanup();
        document.getElementById('host-active-card').style.display = 'none';
        document.getElementById('host-setup-card').style.display = 'block';
        
        if (window.NovaApp) {
            window.NovaApp.setStatus("Hosting session ended.");
            window.NovaApp.selectRole('host');
        }
    }

    function cleanup() {
        if (hostPeer) {
            hostPeer.destroy();
            hostPeer = null;
        }
        if (window.FlashModule && window.FlashModule.cleanup) window.FlashModule.cleanup();
        selectedSwf = null;
        activeRoomCode = null;
        gameStarted = false;
        players.clear();
        controlDrafts.clear();
        clientCursorEnabled = false;
        document.removeEventListener('change', handleCursorInputToggle);
        window.removeEventListener('keydown', handleHostKey);
        window.removeEventListener('keyup', handleHostKey);
    }

    function createDefaultMapping(slot) {
        const keys = slot === 1
            ? { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', jump: 'z', action: 'x' }
            : { up: 'w', down: 's', left: 'a', right: 'd', jump: 'j', action: 'k' };
        const outputs = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', jump: 'z', action: 'x' };
        return Object.fromEntries(controlActions.map(([action]) => [action, {
            input: keys[action],
            output: outputs[action]
        }]));
    }

    function cloneMapping(mapping) {
        return Object.fromEntries(controlActions.map(([action]) => [action, {
            input: mapping[action].input,
            output: mapping[action].output
        }]));
    }

    function normalizeKey(key) {
        return key.length === 1 ? key.toLowerCase() : key;
    }

    function formatKey(key) {
        return key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key;
    }

    function handleHostKey(event) {
        if (!gameStarted || !selectedSwf || event.repeat) return;
        if (event.target instanceof HTMLElement && event.target.closest('input, select, textarea, button')) return;
        const inputKey = normalizeKey(event.key);
        const binding = Object.values(hostMapping).find((item) => item.input === inputKey);
        if (!binding) return;
        event.preventDefault();
        if (window.FlashModule && window.FlashModule.sendGameKey) {
            window.FlashModule.sendGameKey(binding.output, event.type === 'keydown');
        }
    }

    function renderControlDashboard() {
        renderMappingEditor(document.getElementById('host-own-control-mappings'), 'Host controls', hostMapping, {
            kind: 'host'
        });
        renderMappingEditor(document.getElementById('host-game-own-control-mappings'), 'Host controls', hostMapping, {
            kind: 'host'
        });
        const playerTargets = [
            document.getElementById('host-player-control-mappings'),
            document.getElementById('host-game-player-control-mappings')
        ];
        for (const target of playerTargets) {
            if (!target) continue;
            target.innerHTML = '';
            if (!players.size) {
                const empty = document.createElement('p');
                empty.className = 'control-empty-state';
                empty.textContent = 'Player mappings will appear when clients join.';
                target.appendChild(empty);
                continue;
            }
            players.forEach((player, clientId) => {
                const draft = controlDrafts.get(clientId) || player.mapping;
                renderMappingEditor(target, `${player.name} · Player ${player.slot}`, draft, {
                    kind: 'player',
                    clientId,
                    locked: player.controlsLocked,
                    pending: player.pendingChange
                });
            });
        }
    }

    function renderMappingEditor(target, title, mapping, context) {
        if (!target) return;
        if (context.kind === 'host') target.innerHTML = '';
        const section = document.createElement('section');
        section.className = 'mapping-editor';
        const heading = document.createElement('h4');
        heading.textContent = title;
        section.appendChild(heading);
        if (context.kind === 'player') {
            const state = document.createElement('p');
            state.className = 'mapping-state';
            state.textContent = context.pending
                ? 'Waiting for player approval'
                : context.locked ? 'Player controls are locked' : 'Player controls are unlocked';
            section.appendChild(state);
        }

        const table = document.createElement('div');
        table.className = 'mapping-table';
        const header = document.createElement('div');
        header.className = 'mapping-row mapping-heading-row';
        ['Action', 'Input key', 'Game key'].forEach((label) => {
            const cell = document.createElement('span');
            cell.textContent = label;
            header.appendChild(cell);
        });
        table.appendChild(header);
        for (const [action, label] of controlActions) {
            const row = document.createElement('div');
            row.className = 'mapping-row';
            const actionLabel = document.createElement('span');
            actionLabel.textContent = label;
            row.appendChild(actionLabel);
            for (const field of ['input', 'output']) {
                const input = document.createElement('input');
                input.type = 'text';
                input.readOnly = true;
                input.value = formatKey(mapping[action][field]);
                input.setAttribute('aria-label', `${title} ${label} ${field === 'input' ? 'input' : 'game key'}`);
                input.title = 'Click, then press a key';
                input.addEventListener('keydown', (event) => {
                    if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') return;
                    event.preventDefault();
                    event.stopPropagation();
                    const key = normalizeKey(event.key);
                    const next = context.kind === 'host'
                        ? (hostMappingDraft || cloneMapping(hostMapping))
                        : (controlDrafts.get(context.clientId) || cloneMapping(players.get(context.clientId).mapping));
                    next[action][field] = key;
                    input.value = formatKey(key);
                    if (context.kind === 'host') hostMappingDraft = next;
                    else controlDrafts.set(context.clientId, next);
                });
                row.appendChild(input);
            }
            table.appendChild(row);
        }
        section.appendChild(table);
        const apply = document.createElement('button');
        apply.type = 'button';
        apply.className = 'mapping-apply-btn';
        apply.textContent = context.kind === 'host' ? 'Apply Host Controls' : 'Apply Mapping';
        apply.disabled = Boolean(context.pending);
        apply.onclick = () => applyMapping(context);
        section.appendChild(apply);
        target.appendChild(section);
    }

    function applyMapping(context) {
        if (context.kind === 'host') {
            if (hostMappingDraft) hostMapping = cloneMapping(hostMappingDraft);
            hostMappingDraft = null;
            renderControlDashboard();
            return;
        }
        const player = players.get(context.clientId);
        const draft = controlDrafts.get(context.clientId);
        if (!player || !draft || player.pendingChange) return;
        if (!gameStarted) {
            player.mapping = cloneMapping(draft);
            controlDrafts.delete(context.clientId);
            renderControlDashboard();
            publishPlayers();
            return;
        }
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        player.pendingChange = { requestId, mapping: cloneMapping(draft) };
        player.connection.send({ type: 'CONTROL_CHANGE_REQUEST', requestId, mapping: player.pendingChange.mapping });
        renderControlDashboard();
    }

    return {
        init: init,
        cleanup: cleanup,
        stopHostingSession: stopHostingSession,
        renderControlDashboard: renderControlDashboard
    };
})();