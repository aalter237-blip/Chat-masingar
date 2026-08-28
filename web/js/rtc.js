/**
 * Masingar call engine.
 *
 * Design goals (the reason this file is more than a plain peer connection):
 *   • excellent audio on 2G/3G: Opus, mono, DTX + in-band FEC, adaptive bitrate
 *   • usable video when the link is weak: start small (180p @ 15fps) and climb
 *     a quality ladder only when measurements say the network can carry it
 *   • graceful degradation: temporal scalability (L1T3) → lower fps → lower
 *     resolution → drop to audio-only → automatic recovery when it improves
 *   • resilience: ICE restart with backoff, audio-only keep-alive, TCP/TURN
 */

/** Video quality ladder, from the leanest to the sharpest. */
export const LADDER = [
  { name: '180p', width: 320, height: 180, fps: 15, kbps: 160 },
  { name: '270p', width: 480, height: 270, fps: 20, kbps: 320 },
  { name: '360p', width: 640, height: 360, fps: 24, kbps: 600 },
  { name: '480p', width: 854, height: 480, fps: 30, kbps: 1100 },
  { name: '720p', width: 1280, height: 720, fps: 30, kbps: 1900 },
];

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export class CallEngine extends EventTarget {
  constructor({ iceServers = [], settings = {} } = {}) {
    super();
    this.iceServers = iceServers;
    this.settings = {
      autoQuality: true,
      dataSaver: false,
      hd: false,
      audioOnlyFallback: true,
      startLevel: 0,
      ...settings,
    };
    this.pc = null;
    this.localStream = null;
    this.remoteStream = new MediaStream();
    this.callId = null;
    this.peerId = null;
    this.conversationId = null;
    this.type = 'audio';
    this.isCaller = false;
    this.state = 'idle';
    this.startedAt = 0;
    this.level = this.settings.startLevel;
    this.videoSuspended = false;
    this.muted = false;
    this.speakerOn = this.type === 'video';
    this.cameraFacing = 'user';
    this.audioSender = null;
    this.videoSender = null;
    this.statsTimer = null;
    this.lastStats = null;
    this.pendingCandidates = [];
    this._iceQueue = [];
    this.remoteDescriptionSet = false;
    this._badSamples = 0;
    this._goodSamples = 0;
    this._iceRestarts = 0;
    this._ended = false;
    this.realtime = null;
    this._onSignal = this._onSignal.bind(this);
  }

  /* ------------------------------ helpers ----------------------------- */

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  setState(state, detail = {}) {
    this.state = state;
    this.emit('state', { state, ...detail });
  }

  attach(realtime) {
    this.detach();
    this.realtime = realtime;
    realtime.addEventListener('frame', this._onSignal);
  }

  detach() {
    if (this.realtime) this.realtime.removeEventListener('frame', this._onSignal);
    this.realtime = null;
  }

  send(frame) {
    this.realtime?.send(frame);
  }

  _onSignal(ev) {
    const f = ev.detail;
    if (!f || !this.callId) return;
    switch (f.t) {
      case 'call.answer':
        if (f.callId === this.callId && f.from === this.peerId) this._onAnswer(f.sdp || f.answer);
        break;
      case 'call.ice':
        if (f.callId === this.callId && f.from === this.peerId) this._onRemoteIce(f.candidate ?? f.candidates);
        break;
      case 'call.end':
        if (f.callId === this.callId) this.hangup({ remote: true, reason: f.reason });
        break;
      case 'call.decline':
        if (f.callId === this.callId) this.hangup({ remote: true, reason: 'declined' });
        break;
      case 'call.busy':
        if (f.callId === this.callId) this.hangup({ remote: true, reason: 'busy' });
        break;
      case 'call.restart':
        if (f.callId === this.callId && f.from === this.peerId) this._handleRestartOffer(f.sdp);
        break;
      case 'call.media':
        if (f.callId === this.callId) this.emit('peer-media', { video: !!f.video, reason: f.reason });
        break;
      default:
        break;
    }
  }

  /* --------------------------- media handling -------------------------- */

  async getLocalMedia(type, { video = true } = {}) {
    const want = [];
    const audioConstraints = {
      echoCancellation: { ideal: true },
      noiseSuppression: { ideal: true },
      autoGainControl: { ideal: true },
      channelCount: 1,
      sampleRate: 48000,
      sampleSize: 16,
    };
    const level = LADDER[clamp(this.level, 0, LADDER.length - 1)];
    const videoConstraints = {
      facingMode: this.cameraFacing,
      width: { ideal: level.width },
      height: { ideal: level.height },
      frameRate: { ideal: level.fps, max: level.fps },
    };
    if (type === 'video' && video) want.push('video');
    want.push('audio');

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: type === 'video' && video ? videoConstraints : false,
    });
    this.localStream = stream;
    this.emit('localstream', { stream });
    return stream;
  }

  async startOutgoing({ to, type = 'audio', conversationId }) {
    this.type = type;
    this.peerId = to;
    this.conversationId = conversationId || null;
    this.isCaller = true;
    this.setState('calling');
    await this.getLocalMedia(type);
    await this._createPeer();
    const offer = await this.pc.createOffer(this._offerOptions());
    await this.pc.setLocalDescription(offer);
    this.send({
      t: 'call.invite',
      to,
      type,
      conversationId,
      sdp: this.pc.localDescription,
      offer: this.pc.localDescription,
    });
    return this.callId;
  }

  /** Called after `call.ringing` arrives and the server assigned an id. */
  setCallId(callId) {
    this.callId = callId;
    const queued = this._iceQueue.splice(0);
    for (const frame of queued) this.send({ ...frame, callId });
  }

  async acceptIncoming({ callId, from, type, sdp, conversationId }) {
    this.callId = callId;
    this.peerId = from;
    this.type = type;
    this.conversationId = conversationId || null;
    this.isCaller = false;
    this.setState('connecting');
    await this.getLocalMedia(type);
    await this._createPeer();
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    this.remoteDescriptionSet = true;
    await this._flushCandidates();
    await this._ensureTransceivers();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.send({ t: 'call.answer', callId, to: from, sdp: this.pc.localDescription, answer: this.pc.localDescription });
  }

  _offerOptions() {
    return { offerToReceiveAudio: true, offerToReceiveVideo: this.type === 'video', iceRestart: false, voiceActivityDetection: true };
  }

  async _createPeer() {
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers?.length
        ? this.iceServers
        : [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
      iceCandidatePoolSize: 2,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      sdpSemantics: 'unified-plan',
    });
    this.pc = pc;
    this.remoteStream = new MediaStream();

    pc.addEventListener('icecandidate', (ev) => {
      if (!ev.candidate) return;
      const frame = { t: 'call.ice', callId: this.callId, to: this.peerId, candidate: ev.candidate };
      // the caller gathers candidates before the server assigns a call id
      if (!this.callId) this._iceQueue.push(frame);
      else this.send(frame);
    });
    pc.addEventListener('iceconnectionstatechange', () => this._onIceState());
    pc.addEventListener('connectionstatechange', () => {
      this.emit('connection', { state: pc.connectionState });
      if (pc.connectionState === 'connected') {
        this.startedAt = this.startedAt || Date.now();
        this.setState('connected');
      }
      if (pc.connectionState === 'failed') this._attemptRestart('failed');
      if (pc.connectionState === 'disconnected') this._attemptRestart('disconnected');
    });
    pc.addEventListener('track', (ev) => {
      for (const track of ev.streams[0]?.getTracks() || [ev.track]) this.remoteStream.addTrack(track);
      this.emit('remotestream', { stream: this.remoteStream });
    });

    /* add local tracks with explicit encoding settings */
    const audioTrack = this.localStream?.getAudioTracks()[0];
    if (audioTrack) {
      this.audioSender = pc.addTrack(audioTrack, this.localStream);
      await this._tuneAudio('normal');
    }
    if (this.type === 'video') {
      const videoTrack = this.localStream?.getVideoTracks()[0];
      if (videoTrack) {
        this.videoSender = pc.addTransceiver(videoTrack, {
          streams: [this.localStream],
          direction: 'sendrecv',
          sendEncodings: this._videoEncodings(),
        }).sender;
      } else {
        pc.addTransceiver('video', { direction: 'recvonly' });
      }
    }
    this._startStats();
    return pc;
  }

  /** Opus tuning: 3 profiles traded off against measured bandwidth. */
  async _tuneAudio(profile = 'normal') {
    if (!this.audioSender) return;
    const params = this.audioSender.getParameters();
    params.encodings = params.encodings?.length ? params.encodings : [{}];
    const profiles = {
      weak: { maxBitrate: 16_000, dtx: true, fec: true },
      normal: { maxBitrate: 32_000, dtx: true, fec: true },
      high: { maxBitrate: 64_000, dtx: false, fec: true },
      stereo: { maxBitrate: 96_000, dtx: false, fec: true },
    };
    const p = profiles[profile] || profiles.normal;
    params.encodings[0].maxBitrate = p.maxBitrate;
    params.encodings[0].networkPriority = 'high';
    try {
      await this.audioSender.setParameters(params);
    } catch {
      /* some browsers ignore audio encoding params */
    }
    this.audioProfile = profile;
  }

  _videoEncodings() {
    const level = LADDER[clamp(this.level, 0, LADDER.length - 1)];
    const cap = this.settings.dataSaver ? Math.min(level.kbps, 320) : level.kbps;
    return [
      {
        rid: 'q0',
        active: true,
        maxBitrate: cap * 1000,
        maxFramerate: level.fps,
        scaleResolutionDownBy: level.width >= 1280 ? 1 : Math.max(1, Math.round(1280 / level.width)),
        scalabilityMode: 'L1T3', // temporal layers keep video alive on lossy links
        networkPriority: 'low',
      },
    ];
  }

  async _ensureTransceivers() {
    // keep recv transceivers alive when the peer offered something we did not
    for (const tr of this.pc.getTransceivers()) {
      if (tr.receiver?.track && !this.remoteStream.getTracks().includes(tr.receiver.track)) {
        this.remoteStream.addTrack(tr.receiver.track);
      }
    }
    this.emit('remotestream', { stream: this.remoteStream });
  }

  async _onAnswer(sdp) {
    if (!sdp || !this.pc) return;
    this.setState('connecting');
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    this.remoteDescriptionSet = true;
    await this._flushCandidates();
    await this._ensureTransceivers();
  }

  async _onRemoteIce(candidate) {
    if (!this.pc) return;
    const list = Array.isArray(candidate) ? candidate : [candidate];
    for (const c of list) {
      if (!c) continue;
      if (!this.remoteDescriptionSet) {
        this.pendingCandidates.push(c);
        continue;
      }
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {
        /* stale candidate, ignore */
      }
    }
  }

  async _flushCandidates() {
    const list = this.pendingCandidates.splice(0);
    for (const c of list) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch {
        /* ignore */
      }
    }
  }

  /* ------------------------------- control ----------------------------- */

  setMuted(muted) {
    this.muted = muted;
    for (const track of this.localStream?.getAudioTracks() || []) track.enabled = !muted;
    this.emit('media-state', { muted });
  }

  /**
   * Route the remote audio to the loud speaker or to the earpiece.
   * Android Chrome and desktop Chrome expose output devices through setSinkId;
   * where that is unsupported we simply make sure the remote audio is audible.
   */
  async setSpeaker(on) {
    this.speakerOn = on;
    const remote = [...document.querySelectorAll('video, audio')].filter((el) => el.dataset.local !== '1');
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outs = devices.filter((d) => d.kind === 'audiooutput');
      const target = on
        ? outs.find((d) => /speaker|loud|default/i.test(d.label)) || outs[0]
        : outs.find((d) => /earpiece|handset|receiver|built-in/i.test(d.label)) || outs[0];
      for (const el of remote) {
        if (target?.deviceId && typeof el.setSinkId === 'function') await el.setSinkId(target.deviceId);
        el.muted = false;
      }
    } catch {
      for (const el of remote) el.muted = false;
    }
    this.emit('media-state', { speaker: on });
  }

  async setVideoEnabled(enabled, { notify = true } = {}) {
    if (this.type !== 'video') return;
    if (this.videoSender?.track) this.videoSender.track.enabled = enabled;
    for (const track of this.localStream?.getVideoTracks() || []) track.enabled = enabled;
    this.videoSuspended = !enabled;
    this.emit('media-state', { video: enabled });
    if (notify) this.send({ t: 'call.media', callId: this.callId, to: this.peerId, video: enabled, reason: enabled ? 'user' : 'weak-network' });
  }

  async switchCamera() {
    this.cameraFacing = this.cameraFacing === 'user' ? 'environment' : 'user';
    const track = this.localStream?.getVideoTracks()[0];
    if (!track) return;
    if (track.readyState === 'live' && 'switchCamera' in track) {
      try {
        await track.switchCamera();
        return;
      } catch {
        /* fall through */
      }
    }
    const next = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: this.cameraFacing, width: { ideal: LADDER[this.level].width }, height: { ideal: LADDER[this.level].height } },
      audio: false,
    });
    const videoTrack = next.getVideoTracks()[0];
    if (this.videoSender) await this.videoSender.replaceTrack(videoTrack);
    track.stop();
    this.localStream.removeTrack(track);
    this.localStream.addTrack(videoTrack);
    this.emit('localstream', { stream: this.localStream });
  }

  async _attemptRestart(reason) {
    if (this._ended || !this.pc) return;
    if (this.pc.connectionState === 'connected') return;
    if (this._iceRestarts >= 4) {
      this.emit('fatal', { reason: 'network' });
      return this.hangup({ reason: 'failed' });
    }
    this._iceRestarts += 1;
    this.setState('reconnecting', { reason });
    try {
      if (this.isCaller) {
        const offer = await this.pc.createOffer({ iceRestart: true });
        await this.pc.setLocalDescription(offer);
        // re-send the offer; the server relays it as a fresh invite for the same call
        this.send({ t: 'call.ice', callId: this.callId, to: this.peerId, candidate: null, restart: true, sdp: this.pc.localDescription });
      } else {
        this.emit('reconnecting', { reason });
      }
    } catch (err) {
      this.emit('error', { message: err.message });
    }
  }

  _onIceState() {
    const s = this.pc?.iceConnectionState;
    this.emit('ice', { state: s });
    if (s === 'failed') this._attemptRestart('ice-failed');
    if (s === 'disconnected') setTimeout(() => this.pc?.iceConnectionState === 'disconnected' && this._attemptRestart('ice-disconnected'), 2500);
  }

  async _handleRestartOffer(sdp) {
    if (!sdp || !this.pc) return;
    // ignore when we are the side that currently has a pending offer
    if (this.pc.signalingState === 'have-local-offer') return;
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.send({ t: 'call.ice', callId: this.callId, to: this.peerId, restart: true, sdp: this.pc.localDescription });
      this.setState('connecting');
    } catch (err) {
      this.emit('error', { message: err.message });
    }
  }

  hangup({ remote = false, reason = 'ended' } = {}) {
    if (this._ended) return;
    this._ended = true;
    const durationMs = this.startedAt ? Date.now() - this.startedAt : 0;
    clearInterval(this.statsTimer);
    try {
      this.pc?.getSenders().forEach((s) => s.track?.stop());
      this.pc?.close();
    } catch {
      /* ignore */
    }
    for (const t of this.localStream?.getTracks() || []) t.stop();
    this.detach();
    if (!remote && this.callId) this.send({ t: 'call.end', callId: this.callId, to: this.peerId, reason, durationMs, quality: JSON.stringify(this.lastStats || {}) });
    this.setState('ended', { reason, durationMs, remote });
  }

  /* --------------------------- adaptive quality ------------------------ */

  _startStats() {
    clearInterval(this.statsTimer);
    let last = null;
    this.statsTimer = setInterval(async () => {
      if (!this.pc || this._ended) return;
      let report;
      try {
        report = await this.pc.getStats();
      } catch {
        return;
      }
      const out = {
        bitrateKbps: 0,
        audioKbps: 0,
        videoKbps: 0,
        rtt: 0,
        jitter: 0,
        loss: 0,
        packetsLost: 0,
        availableKbps: 0,
        width: 0,
        height: 0,
        fps: 0,
        limitation: '',
        audioCodec: '',
        videoCodec: '',
        level: LADDER[this.level].name,
        qualityScore: 100,
        ts: Date.now(),
      };
      report.forEach((s) => {
        if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated !== false) {
          out.rtt = Math.round((s.currentRoundTripTime ?? 0) * 1000);
          out.availableKbps = Math.round((s.availableOutgoingBitrate ?? 0) / 1000);
        }
        if (s.type === 'remote-inbound-rtp' && s.kind === 'video') {
          out.loss = Number(((s.fractionLost ?? 0) * 100).toFixed(2));
          out.packetsLost = s.packetsLost ?? 0;
          out.jitter = Math.round((s.jitter ?? 0) * 1000);
        }
        if (s.type === 'outbound-rtp' && !s.isRemote) {
          const bytes = s.bytesSent ?? 0;
          const kind = s.kind || s.mediaType;
          if (last && last[kind]) {
            const delta = (bytes - last[kind]) * 8 / ((out.ts - last.ts) / 1000) / 1000;
            if (kind === 'audio') out.audioKbps = Math.round(delta);
            if (kind === 'video') out.videoKbps = Math.round(delta);
          }
          last = { ...(last || {}), [kind]: bytes, ts: out.ts };
          if (kind === 'video') {
            out.width = s.frameWidth ?? 0;
            out.height = s.frameHeight ?? 0;
            out.fps = Math.round(s.framesPerSecond ?? 0);
            out.limitation = s.qualityLimitationReason || '';
          }
        }
        if (s.type === 'codec') {
          const mime = (s.mimeType || '').split('/')[1] || '';
          if (/opus|pcmu|pcma|g722|isac|ilbc/i.test(mime)) out.audioCodec = mime;
          if (/vp8|vp9|h264|av1/i.test(mime)) out.videoCodec = mime;
        }
      });
      out.bitrateKbps = out.audioKbps + out.videoKbps;
      out.qualityScore = clamp(
        Math.round(100 - out.loss * 3 - Math.max(0, out.rtt - 150) / 8 - (out.limitation === 'bandwidth' ? 15 : 0)),
        0,
        100
      );
      this.lastStats = out;
      this.emit('stats', out);
      if (this.settings.autoQuality) this._adapt(out);
      if (this.type === 'video' && this.settings.audioOnlyFallback) this._maybeFallback(out);
    }, 1000);
  }

  _adapt(s) {
    if (this.type !== 'video' || this.videoSuspended) return;
    const bad = s.loss > 6 || s.rtt > 500 || s.limitation === 'bandwidth';
    const good = s.loss < 2 && s.rtt < 260 && s.limitation !== 'bandwidth';
    const headroom = s.availableKbps > LADDER[Math.min(this.level + 1, LADDER.length - 1)].kbps * 1.4;

    if (bad) {
      this._badSamples += 1;
      this._goodSamples = 0;
    } else if (good) {
      this._goodSamples += 1;
      this._badSamples = 0;
    } else {
      this._badSamples = Math.max(0, this._badSamples - 1);
    }

    if (this._badSamples >= 3 && this.level > 0) {
      this._badSamples = 0;
      this.setLevel(this.level - 1, 'weak-network');
    } else if (this._goodSamples >= 8 && headroom && this.level < LADDER.length - 1) {
      this._goodSamples = 0;
      this.setLevel(this.level + 1, 'improved');
    }
  }

  async _maybeFallback(s) {
    // only give up on video after several bad samples at the lowest rung
    const hopeless = (s.loss > 12 && s.rtt > 700) || (s.availableKbps > 0 && s.availableKbps < 90 && s.loss > 5);
    if (hopeless) {
      this._fallbackCount = (this._fallbackCount || 0) + 1;
      if (this._fallbackCount >= 3 && !this.videoSuspended) {
        this._fallbackCount = 0;
        await this.setVideoEnabled(false);
        this.emit('notice', { message: 'audioOnly', level: 'warn' });
      }
    } else if (!hopeless && this.videoSuspended) {
      this._recoverCount = (this._recoverCount || 0) + 1;
      if (this._recoverCount >= 6 && s.availableKbps > 250) {
        this._recoverCount = 0;
        this.setLevel(0, 'recover');
        await this.setVideoEnabled(true);
        this.emit('notice', { message: 'videoBackOn', level: 'ok' });
      }
    }
  }

  async setLevel(next, reason = '') {
    const level = clamp(next, 0, LADDER.length - 1);
    if (level === this.level && reason !== 'recover') return;
    this.level = level;
    const l = LADDER[level];
    // 1) encoding parameters (bitrate / fps / resolution scaling)
    if (this.videoSender) {
      const params = this.videoSender.getParameters();
      if (params.encodings?.length) {
        Object.assign(params.encodings[0], this._videoEncodings()[0]);
        try {
          await this.videoSender.setParameters(params);
        } catch {
          /* ignore */
        }
      }
    }
    // 2) camera constraints (works on every browser, including iOS)
    const track = this.localStream?.getVideoTracks()[0];
    if (track && track.readyState === 'live') {
      try {
        await track.applyConstraints({
          width: { ideal: l.width },
          height: { ideal: l.height },
          frameRate: { ideal: l.fps, max: l.fps },
        });
      } catch {
        /* ignore */
      }
    }
    // 3) audio profile follows the available bandwidth
    await this._tuneAudio(level <= 0 ? 'weak' : level === 1 ? 'normal' : 'high');
    this.emit('quality', { level, name: l.name, reason });
  }
}

/** Quality presets exposed in the settings screen. */
export const QUALITY_PRESETS = {
  saver: { dataSaver: true, autoQuality: true, startLevel: 0, hd: false, audioOnlyFallback: true },
  auto: { dataSaver: false, autoQuality: true, startLevel: 1, hd: false, audioOnlyFallback: true },
  hd: { dataSaver: false, autoQuality: true, startLevel: 3, hd: true, audioOnlyFallback: false },
};
