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

}
