window.ClientModule = (function() {
    let clientPc = null;
    let clientChannel = null;

    function init() {
        const connectBtn = document.getElementById('client-connect-btn');
        if (connectBtn) {
            connectBtn.onclick = clientJoinLobby;
        }

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

        if (window.NovaApp && window.NovaApp.setStatus) {
            window.NovaApp.setStatus(`Joined room ${code}. Connecting to host broadcast...`);
        }

        if (window.NovaApp && window.NovaApp.loadFlashView) {
            await window.NovaApp.loadFlashView(true);
        }

        const clientId = 'Client_' + Math.floor(Math.random() * 9000 + 1000);

        if (clientChannel) clientChannel.close();
        clientChannel = new BroadcastChannel('flash_room_' + code);

        clientChannel.postMessage({ type: 'JOIN_REQUEST', clientId: clientId, clientName: 'Chromebook-User' });

        clientChannel.onmessage = async (event) => {
            if (event.data.type === 'GAME_BROADCAST') {
                if (window.FlashModule && window.FlashModule.showRemoteVideo) {
                    window.FlashModule.showRemoteVideo();
                }

                const videoEl = document.getElementById('remote-video');

                if (clientPc) clientPc.close();
                clientPc = new RTCPeerConnection();

                clientPc.ontrack = (e) => {
                    if (videoEl) videoEl.srcObject = e.streams[0];
                };

                clientPc.onicecandidate = (e) => {
                    if (e.candidate && clientChannel) {
                        clientChannel.postMessage({ type: 'ICE_CANDIDATE', candidate: e.candidate });
                    }
                };

                await clientPc.setRemoteDescription(new RTCSessionDescription(event.data.offer));
                const answer = await clientPc.createAnswer();
                await clientPc.setLocalDescription(answer);

                clientChannel.postMessage({ type: 'ANSWER', answer: answer });

                if (window.NovaApp && window.NovaApp.setStatus) {
                    window.NovaApp.setStatus(`Stream feed received from Host! Displaying live canvas.`);
                }
            } else if (event.data.type === 'ICE_CANDIDATE' && clientPc) {
                try {
                    await clientPc.addIceCandidate(new RTCIceCandidate(event.data.candidate));
                } catch (err) {
                    console.error('ICE candidate error:', err);
                }
            }
        };
    }

    function cleanup() {
        if (clientPc) {
            clientPc.close();
            clientPc = null;
        }
        if (clientChannel) {
            clientChannel.close();
            clientChannel = null;
        }
    }

    return {
        init: init,
        cleanup: cleanup,
        clientJoinLobby: clientJoinLobby
    };
})();
