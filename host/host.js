window.HostModule = (function() {
    let selectedFilesMap = new Map(); // Stores name -> File object for everything in the directory
    let selectedSwfFiles = [];        // List of SWF file objects found
    let activeRoomCode = null;
    let hostChannel = null;
    let hostPc = null;

    function init() {
        const folderBtn = document.getElementById('host-select-folder-btn');
        const startBtn = document.getElementById('host-start-btn');
        const stopBtn = document.getElementById('host-stop-btn');

        if (folderBtn) folderBtn.onclick = handleFolderSelection;
        if (startBtn) startBtn.onclick = startHostingSession;
        if (stopBtn) stopBtn.onclick = stopHostingSession;

        if (window.NovaApp && window.NovaApp.setStatus) {
            window.NovaApp.setStatus("Host module ready. Please select your game folder.");
        }
    }

    async function handleFolderSelection() {
        if (!window.showDirectoryPicker) {
            alert("Directory Picker API is not supported in this browser. Please use Google Chrome or a Chromium-based browser on macOS.");
            return;
        }

        try {
            const dirHandle = await window.showDirectoryPicker();
            selectedFilesMap.clear();
            selectedSwfFiles = [];

            const folderDisplay = document.getElementById('selected-folder-name');
            if (folderDisplay) folderDisplay.innerText = `Folder: ${dirHandle.name}`;

            // Recursively read directory contents (handles assets folder alongside main swf)
            await readDirectoryRecursive(dirHandle, '');

            const swfSelectGroup = document.getElementById('swf-select-group');
            const swfSelectDropdown = document.getElementById('swf-file-select');
            const startBtn = document.getElementById('host-start-btn');

            if (selectedSwfFiles.length === 0) {
                if (window.NovaApp) window.NovaApp.setStatus("Error: No SWF file found in selected folder.");
                alert("No .swf files found in the selected folder hierarchy. Ensure your main SWF file is present.");
                if (swfSelectGroup) swfSelectGroup.style.display = 'none';
                if (startBtn) startBtn.disabled = true;
                return;
            }

            // Populate the SWF selector dropdown
            if (swfSelectDropdown) {
                swfSelectDropdown.innerHTML = '';
                selectedSwfFiles.forEach((fileObj, index) => {
                    const option = document.createElement('option');
                    option.value = fileObj.relativePath;
                    option.textContent = fileObj.relativePath;
                    swfSelectDropdown.appendChild(option);
                });
            }

            if (swfSelectGroup) swfSelectGroup.style.display = 'block';
            if (startBtn) startBtn.disabled = false;

            if (window.NovaApp) {
                window.NovaApp.setStatus(`Loaded folder successfully. Found ${selectedSwfFiles.length} SWF file(s) and assets.`);
            }

        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error(err);
                if (window.NovaApp) window.NovaApp.setStatus(`Error reading folder: ${err.message}`);
            }
        }
    }

    async function readDirectoryRecursive(dirHandle, pathPrefix) {
        for await (const entry of dirHandle.values()) {
            const currentPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
            if (entry.kind === 'file') {
                const file = await entry.getFile();
                selectedFilesMap.set(currentPath, file);
                
                if (entry.name.toLowerCase().endsWith('.swf')) {
                    selectedSwfFiles.push({
                        name: entry.name,
                        relativePath: currentPath,
                        file: file
                    });
                }
            } else if (entry.kind === 'directory') {
                await readDirectoryRecursive(entry, currentPath);
            }
        }
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

        activeRoomCode = Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
        
        // Switch setup card view to active session view
        document.getElementById('host-setup-card').style.display = 'none';
        document.getElementById('host-active-card').style.display = 'block';
        document.getElementById('active-room-code').innerText = activeRoomCode;

        if (window.NovaApp && window.NovaApp.setStatus) {
            window.NovaApp.setStatus(`Hosting session active. Room Code: ${activeRoomCode}`);
        }

        // Load the Flash View and pass both the main SWF and full directory file map for asset lookups
        if (window.NovaApp && window.NovaApp.loadFlashView) {
            await window.NovaApp.loadFlashView(false);
        }

        if (window.FlashModule && window.FlashModule.setupHostStream) {
            window.FlashModule.setupHostStream(mainSwfEntry, selectedFilesMap, activeRoomCode);
        }
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
        if (hostPc) {
            hostPc.close();
            hostPc = null;
        }
        if (hostChannel) {
            hostChannel.close();
            hostChannel = null;
        }
    }

    return {
        init: init,
        cleanup: cleanup
    };
})();