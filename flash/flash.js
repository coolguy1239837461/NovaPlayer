window.FlashModule = (function() {
    let activePlayer = null;

    function init() {
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
        flashContainer.appendChild(activePlayer);

        activePlayer.load({ url: swfUrl, allowScriptAccess: true });

        if (onCanvasReady) {
            setTimeout(() => {
                const canvas = activePlayer.querySelector('canvas');
                onCanvasReady(canvas);
            }, 1500);
        }
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
        activePlayer = null;
    }

    return {
        init: init,
        loadSwf: loadSwf,
        showRemoteVideo: showRemoteVideo,
        cleanup: cleanup
    };
})();
