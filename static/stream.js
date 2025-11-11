//@ts-nocheck
let EventEmitter = EventEmitter2;

/**
 * @type {import("node:events").EventEmitter}
 */
let streamEmitter = new EventEmitter();

let begin_stats = {
    waitingForScreensharing: false,
    screensharing: false,
}

let join_stats = {
    waitingForScreenshare: false,
    joinedScreenshare: false,
}

async function fetchIceServers() {
    let iceServersList = JSON.parse(await (await fetch("/api/webrtc")).text());
    let iceServersCred = {};
    let promises = [];
    iceServersList.forEach(i => {
        promises.push(new Promise(async (res) => {
            let resp = await fetch(i[1]);
            let cred = await resp.json();
            res({key: i[1], value: cred});
        }));
    });
    let iceServersCredArr = await Promise.all(promises);
    iceServersCredArr.forEach(i => iceServersCred[i.key] = i.value);

    let iceServers = iceServersList.map(i => {
        return {
            urls: i[0],
            username: iceServersCred[i[1]].username,
            credential: iceServersCred[i[1]].password
        };
    });
    return iceServers;
}

/**
 * @param {{fps: number, microphone: boolean, forceAV1: boolean}} streamingConfiguration
 * @param {number} code
 * @param {WebSocket} conn
 */
async function beginScreenshare(streamingConfiguration = {}, code, conn) {
    if (begin_stats.screensharing || begin_stats.waitingForScreensharing) return;
    // ICE servers setup
    let iceServers = await fetchIceServers();
    let webrtc_configuration = {
        iceServers: iceServers,
        iceTransportPolicy: "relay"
    };
    let peerConnections = new Map();
    let media = null;
    let media2 = null;
    let ready = false;

    conn.send(JSON.stringify({
        type: "join",
        code: code,
        intent: "head",
    }));
    console.log("pass");

    streamEmitter.once("cancel", () => {
        streamEmitter.emit("end");
    });
    streamEmitter.once("end", () => {
        begin_stats.screensharing = false;
        begin_stats.waitingForScreensharing = false;
    });

    streamEmitter.once("connect", async () => {
        ready = true;
        try {
            media = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    frameRate: { ideal: streamingConfiguration.fps, max: streamingConfiguration.fps }
                }
            });
        } catch (e) {
            streamEmitter.emit("cancel");
            return;
        }
        if (streamingConfiguration.microphone) {
            try {
                media2 = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: false,
                        autoGainControl: false,
                        noiseSuppression: false,
                        sampleRate: 44100,
                        sampleSize: 8,
                        channelCount: 2,
                    },
                });
            } catch (e) {
                streamEmitter.emit("cancel");
                return;
            }
        }

        streamEmitter.emit("localVideo", media);
        media.getVideoTracks()[0].addEventListener("ended", () => {
            console.log("closing");
            streamEmitter.emit("end");
        });
    });

    streamEmitter.on("data", async data => {
        if (ready) {
            let peerCode = data.peerCode;
            if (!peerConnections.has(peerCode)) {
                let peerConnection = new RTCPeerConnection(webrtc_configuration);
                let videoTrack = media.getVideoTracks()[0];
                let videoTransceiver = peerConnection.addTransceiver(
                    videoTrack,
                    {
                        direction: "sendonly",
                        streams: [media]
                    }
                );
                let audioTrack = null;
                let audioTransceiver = null;
                if (streamingConfiguration.microphone) {
                    audioTrack = media2.getTracks()[0];
                    audioTransceiver = peerConnection.addTransceiver(
                        audioTrack,
                        {
                            direction: "sendonly",
                            streams: [media2]
                        }
                    )
                }
                if (streamingConfiguration.forceAV1) {
                    let codecs = RTCRtpSender.getCapabilities("video").codecs;
                    let av1Codecs = codecs.filter(c => c.mimeType.includes("AV1"));
                    let vp9Codecs = codecs.filter(c => c.mimeType.includes("VP9"));
                    if (av1Codecs.length) {
                        videoTransceiver.setCodecPreferences(av1Codecs);
                    } else if (vp9Codecs.length) {
                        videoTransceiver.setCodecPreferences(vp9Codecs);
                    } else {
                        videoTransceiver.setCodecPreferences(codecs);
                    }
                }
                peerConnection.addEventListener("icecandidate", (event) => {
                    if (event.candidate) {
                        console.log("New ICE candidate:", event.candidate);
                        conn.send(JSON.stringify({
                            type: "send",
                            code: peerCode,
                            data: {
                                new_ice_candidate: event.candidate,
                            },
                        }));
                    }
                });
                // Debugging
                {
                    peerConnection.addEventListener("connectionstatechange", () => {
                        if (peerConnection.connectionState == "connected") {
                            console.log("connected to peer", peerCode);
                        }
                    });
                    peerConnection.addEventListener(
                        "icecandidateerror",
                        (event) => {
                            console.log("err", event.errorText);
                        },
                    );
                    peerConnection.addEventListener(
                        "icegatheringstatechange",
                        (event) => {
                            console.log("state", event);
                        },
                    );
                    peerConnection.addEventListener(
                        "signalingstatechange",
                        (event) => {
                            console.log("sigstatechange", event);
                        },
                    );
                }

                peerConnections.set(peerCode, peerConnection);
            }

            /**
             * @type {RTCPeerConnection}
             */
            let peerConnection = peerConnections.get(peerCode);
            let msg = data.data;

            if (msg.ready) {
                let offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                conn.send(JSON.stringify({
                    type: "send",
                    code: peerCode,
                    data: {
                        offer: offer
                    }
                }));
            }
            if (msg.answer) {
                let remoteDescription = new RTCSessionDescription(msg.answer);
                await peerConnection.setRemoteDescription(remoteDescription);
            }
            if (msg.new_ice_candidate) {
                try {
                    await peerConnection.addIceCandidate(msg.new_ice_candidate);
                } catch(e) {
                    console.log("Error adding received ICE candidate", e);
                }
            }
        }
    });
}

/**
 * @param {number} code
 * @param {WebSocket} conn
 */
async function joinScreenshare(code, conn) {
    if (join_stats.joinedScreenshare || join_stats.waitingForScreenshare) return;
    // ICE servers setup
    let iceServers = await fetchIceServers();
    let webrtc_configuration = {
        iceServers: iceServers,
        iceTransportPolicy: "relay"
    };

    let peerConnection = new RTCPeerConnection(webrtc_configuration);
    peerConnection.ontrack = (event) => {
        let stream = event.streams[0];
        let audioTrack = event.track.kind === "audio" ? event.track : null;
        if (audioTrack) {
            streamEmitter.emit("remoteVideo", audioTrack);
        } else {
            streamEmitter.emit("remoteVideo", stream);
        }
    }
    peerConnection.addEventListener("connectionstatechange", (event) => {
        if (peerConnection.connectionState === "connected") {
            console.log("connected");
        }
        if (peerConnection.connectionState == "disconnected") {
            streamEmitter.emit("endRemote");
        }
    });
    peerConnection.addEventListener("icecandidate", (event) => {
        if (event.candidate) {
            console.log("New ICE candidate:", event.candidate);
            conn.send(JSON.stringify({
                type: "send",
                data: {
                    new_ice_candidate: event.candidate,
                },
            }));
        }
    });

    peerConnection.addEventListener("icecandidateerror", (event) => {
        console.log("err", event.errorText);
    });
    peerConnection.addEventListener("icegatheringstatechange", (event) => {
        console.log("state", event);
    });
    peerConnection.addEventListener("signalingstatechange", (event) => {
        console.log("sigstatechange", event);
    });

    conn.send(JSON.stringify({
        type: "join",
        code: code,
        intent: "peer",
    }));

    let ready = false;
    streamEmitter.once("cancel", () => {
        streamEmitter.emit("end");
    });
    streamEmitter.once("end", () => {
        join_stats.joinedScreenshare = false;
        join_stats.waitingForScreenshare = false;
        peerConnection.close();
        peerConnection = null;
    });
    streamEmitter.once("connect", () => {
        ready = true;
        conn.send(JSON.stringify({
            type: "send",
            data: {
                ready: true
            }
        }));
    });
    streamEmitter.on("data", async data => {
        if (ready) {
            let msg = data.data;
            if (msg.offer) {
                peerConnection.setRemoteDescription(new RTCSessionDescription(msg.offer));
                let answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                conn.send(JSON.stringify({
                    type: "send",
                    data: { answer }
                }));
            }
            if (msg.new_ice_candidate) {
                try {
                    await peerConnection.addIceCandidate(msg.new_ice_candidate);
                } catch(e) {
                    console.log("Error adding received ICE candidate", e);
                }
            }
        }
    });
}
