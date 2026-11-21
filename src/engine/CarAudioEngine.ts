export interface EngineAudioUpdateParams {
  rpm: number;
  speedKmh: number;
  throttle: number;
  isBraking: boolean;
  isDrifting: boolean;
  isTurbo: boolean;
  slipIntensity: number;
  dt: number;
}

/**
 * Procedural Web Audio synthesizer for a 4-cylinder 1.6 EA111 engine,
 * road/tire roll noise, drift screech, gear-shift transients, and arrival chime.
 * Generates all audio buffers mathematically with zero external audio assets.
 */
export class CarAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  private oscFundamental: OscillatorNode | null = null;
  private oscHarmonic2: OscillatorNode | null = null;
  private oscSub: OscillatorNode | null = null;
  private oscExhaust: OscillatorNode | null = null;

  private engineFilter: BiquadFilterNode | null = null;
  private engineOutputGain: GainNode | null = null;

  private rollSource: AudioBufferSourceNode | null = null;
  private rollFilter: BiquadFilterNode | null = null;
  private rollGain: GainNode | null = null;

  private screechSource: AudioBufferSourceNode | null = null;
  private screechFilterA: BiquadFilterNode | null = null;
  private screechFilterB: BiquadFilterNode | null = null;
  private screechGain: GainNode | null = null;

  private turboSource: AudioBufferSourceNode | null = null;
  private turboFilter: BiquadFilterNode | null = null;
  private turboGain: GainNode | null = null;

  private enabled = false;
  private initialized = false;
  private disposed = false;
  private shiftDipTimer = 0;

  private readonly onUserGestureBound: () => void;

  constructor() {
    this.onUserGestureBound = () => {
      if (this.disposed || !this.enabled) return;
      this.ensureInitialized();
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {});
      }
      if (this.initialized) {
        this.removeGestureListeners();
      }
    };

    window.addEventListener('pointerdown', this.onUserGestureBound, { passive: true });
    window.addEventListener('keydown', this.onUserGestureBound, { passive: true });
  }

  private removeGestureListeners(): void {
    window.removeEventListener('pointerdown', this.onUserGestureBound);
    window.removeEventListener('keydown', this.onUserGestureBound);
  }

  private ensureInitialized(): void {
    if (this.initialized || this.disposed) return;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      const ctx = new AudioCtx();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = this.enabled ? 0.34 : 0.0;
      master.connect(ctx.destination);
      this.masterGain = master;

      // Engine harmonic stack: 4-cylinder 4-stroke firing pulse + warmth + sub rumble
      const oscFund = ctx.createOscillator();
      oscFund.type = 'sawtooth';
      oscFund.frequency.value = 28.3;
      const gainFund = ctx.createGain();
      gainFund.gain.value = 0.48;

      const oscHarm2 = ctx.createOscillator();
      oscHarm2.type = 'triangle';
      oscHarm2.frequency.value = 56.6;
      const gainHarm2 = ctx.createGain();
      gainHarm2.gain.value = 0.32;

      const oscSub = ctx.createOscillator();
      oscSub.type = 'sine';
      oscSub.frequency.value = 14.15;
      const gainSub = ctx.createGain();
      gainSub.gain.value = 0.52;

      const oscExhaust = ctx.createOscillator();
      oscExhaust.type = 'sawtooth';
      oscExhaust.frequency.value = 42.5;
      const gainExhaust = ctx.createGain();
      gainExhaust.gain.value = 0.22;

      const shaper = ctx.createWaveShaper();
      shaper.curve = this.createWarmSaturationCurve(22);
      shaper.oversample = '2x';

      const engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 220;
      engineFilter.Q.value = 2.4;

      const engineOut = ctx.createGain();
      engineOut.gain.value = 0.26;

      oscFund.connect(gainFund);
      oscHarm2.connect(gainHarm2);
      oscSub.connect(gainSub);
      oscExhaust.connect(gainExhaust);

      gainFund.connect(shaper);
      gainHarm2.connect(shaper);
      gainSub.connect(shaper);
      gainExhaust.connect(shaper);

      shaper.connect(engineFilter);
      engineFilter.connect(engineOut);
      engineOut.connect(master);

      oscFund.start();
      oscHarm2.start();
      oscSub.start();
      oscExhaust.start();

      this.oscFundamental = oscFund;
      this.oscHarmonic2 = oscHarm2;
      this.oscSub = oscSub;
      this.oscExhaust = oscExhaust;
      this.engineFilter = engineFilter;
      this.engineOutputGain = engineOut;

      // Shared procedural noise buffer (2 seconds) for tires, screech, and turbo spool
      const bufferLen = ctx.sampleRate * 2;
      const noiseBuf = ctx.createBuffer(1, bufferLen, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < bufferLen; i++) {
        const white = Math.random() * 2 - 1;
        // Soft pink-weighted noise sounds more like asphalt & air turbulence than raw white static
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.16;
      }

      // Tire roll road rumble channel
      const rollSource = ctx.createBufferSource();
      rollSource.buffer = noiseBuf;
      rollSource.loop = true;

      const rollFilter = ctx.createBiquadFilter();
      rollFilter.type = 'bandpass';
      rollFilter.frequency.value = 240;
      rollFilter.Q.value = 0.85;

      const rollGain = ctx.createGain();
      rollGain.gain.value = 0;

      rollSource.connect(rollFilter);
      rollFilter.connect(rollGain);
      rollGain.connect(master);
      rollSource.start();

      this.rollSource = rollSource;
      this.rollFilter = rollFilter;
      this.rollGain = rollGain;

      // Dual-band resonant rubber screech for drift & hard braking
      const screechSource = ctx.createBufferSource();
      screechSource.buffer = noiseBuf;
      screechSource.loop = true;

      const screechFilterA = ctx.createBiquadFilter();
      screechFilterA.type = 'bandpass';
      screechFilterA.frequency.value = 980;
      screechFilterA.Q.value = 6.2;

      const screechFilterB = ctx.createBiquadFilter();
      screechFilterB.type = 'bandpass';
      screechFilterB.frequency.value = 1780;
      screechFilterB.Q.value = 7.4;

      const screechGain = ctx.createGain();
      screechGain.gain.value = 0;

      screechSource.connect(screechFilterA);
      screechSource.connect(screechFilterB);
      screechFilterA.connect(screechGain);
      screechFilterB.connect(screechGain);
      screechGain.connect(master);
      screechSource.start();

      this.screechSource = screechSource;
      this.screechFilterA = screechFilterA;
      this.screechFilterB = screechFilterB;
      this.screechGain = screechGain;

      // Turbo induction air spool
      const turboSource = ctx.createBufferSource();
      turboSource.buffer = noiseBuf;
      turboSource.loop = true;

      const turboFilter = ctx.createBiquadFilter();
      turboFilter.type = 'bandpass';
      turboFilter.frequency.value = 1650;
      turboFilter.Q.value = 3.1;

      const turboGain = ctx.createGain();
      turboGain.gain.value = 0;

      turboSource.connect(turboFilter);
      turboFilter.connect(turboGain);
      turboGain.connect(master);
      turboSource.start();

      this.turboSource = turboSource;
      this.turboFilter = turboFilter;
      this.turboGain = turboGain;

      this.initialized = true;
    } catch {
      // Gracefully degrade if Web Audio API is blocked or unavailable
    }
  }

  private createWarmSaturationCurve(drive: number) {
    const samples = 1024;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      // Slight asymmetry introduces realistic even-order exhaust harmonics
      curve[i] = Math.tanh((x + 0.08 * x * x) * (1 + drive * 0.14));
    }
    return curve;
  }

  public notifyGearShift(fromGear: string, toGear: string): void {
    if (!this.initialized || !this.enabled || fromGear === toGear) return;
    // Brief ignition-cut/throttle-lift dip simulates real manual/hydraulic gear transitions
    this.shiftDipTimer = 0.11;
  }

  public update(params: EngineAudioUpdateParams): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.disposed) return;

    const now = this.ctx.currentTime;
    if (this.shiftDipTimer > 0) {
      this.shiftDipTimer = Math.max(0, this.shiftDipTimer - params.dt);
    }

    const clampedRpm = Math.max(700, Math.min(7200, params.rpm));
    // 4-cylinder 4-stroke ignition frequency: (RPM / 60) * 2 = RPM / 30
    const firingFreq = clampedRpm / 30;
    const throttleLoad = Math.min(1, Math.abs(params.throttle));
    const rpmRatio = (clampedRpm - 800) / 6000;

    if (
      this.oscFundamental &&
      this.oscHarmonic2 &&
      this.oscSub &&
      this.oscExhaust &&
      this.engineFilter &&
      this.engineOutputGain
    ) {
      const smoothTime = 0.035;
      this.oscFundamental.frequency.setTargetAtTime(firingFreq, now, smoothTime);
      this.oscHarmonic2.frequency.setTargetAtTime(firingFreq * 2.0, now, smoothTime);
      this.oscSub.frequency.setTargetAtTime(firingFreq * 0.5, now, smoothTime);
      this.oscExhaust.frequency.setTargetAtTime(firingFreq * 1.504, now, smoothTime);

      const cutoff =
        165 +
        rpmRatio * 1350 +
        throttleLoad * 820 +
        (params.isTurbo ? 420 : 0);
      this.engineFilter.frequency.setTargetAtTime(cutoff, now, 0.045);
      this.engineFilter.Q.setTargetAtTime(2.0 + throttleLoad * 1.6, now, 0.05);

      const shiftAttenuation = this.shiftDipTimer > 0 ? 0.42 : 1.0;
      const targetEngineGain =
        (0.18 + rpmRatio * 0.16 + throttleLoad * 0.13) * shiftAttenuation;
      this.engineOutputGain.gain.setTargetAtTime(targetEngineGain, now, 0.04);
    }

    if (this.rollFilter && this.rollGain) {
      const speedNorm = Math.min(1, params.speedKmh / 140);
      this.rollFilter.frequency.setTargetAtTime(
        180 + params.speedKmh * 3.4,
        now,
        0.06,
      );
      this.rollGain.gain.setTargetAtTime(speedNorm * 0.11, now, 0.06);
    }

    if (this.screechFilterA && this.screechFilterB && this.screechGain) {
      const slip = Math.max(0, Math.min(1, params.slipIntensity));
      const screechActive = params.isDrifting || (params.isBraking && params.speedKmh > 18);
      const targetScreech = screechActive ? slip * 0.2 : 0;

      // Subtle pitch inflection with slip speed gives rubber-squeal realism
      const freqMod = 1 + slip * 0.14;
      this.screechFilterA.frequency.setTargetAtTime(960 * freqMod, now, 0.05);
      this.screechFilterB.frequency.setTargetAtTime(1760 * freqMod, now, 0.05);
      this.screechGain.gain.setTargetAtTime(targetScreech, now, 0.045);
    }

    if (this.turboFilter && this.turboGain) {
      const boostActive = params.isTurbo && throttleLoad > 0.15;
      const targetTurbo = boostActive ? 0.07 + rpmRatio * 0.08 : 0;
      this.turboFilter.frequency.setTargetAtTime(1400 + rpmRatio * 1300, now, 0.07);
      this.turboGain.gain.setTargetAtTime(targetTurbo, now, 0.07);
    }
  }

  /** Plays a gentle studio chime when parking/entering a project monument zone. */
  public playArrivalChime(): void {
    if (!this.enabled || this.disposed) return;
    this.ensureInitialized();
    if (!this.ctx || !this.masterGain || this.ctx.state !== 'running') return;

    const now = this.ctx.currentTime;
    const notes = [587.33, 880.0]; // D5 -> A5 clean fifth interval

    notes.forEach((freq, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const start = now + idx * 0.085;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.14, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(start);
      osc.stop(start + 0.45);
    });
  }

  /** Plays a short dual-tone Gol G5 horn burst. */
  public playHorn(): void {
    if (!this.enabled || this.disposed) return;
    this.ensureInitialized();
    if (!this.ctx || !this.masterGain) return;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }

    const now = this.ctx.currentTime;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1150;

    const hornGain = this.ctx.createGain();
    hornGain.gain.setValueAtTime(0.0001, now);
    hornGain.gain.exponentialRampToValueAtTime(0.16, now + 0.015);
    hornGain.gain.setValueAtTime(0.16, now + 0.14);
    hornGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    filter.connect(hornGain);
    hornGain.connect(this.masterGain);

    for (const freq of [415, 518]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.connect(filter);
      osc.start(now);
      osc.stop(now + 0.23);
    }
  }

  public toggleAudio(): boolean {
    this.enabled = !this.enabled;
    if (this.enabled) {
      this.ensureInitialized();
    }

    if (this.ctx && this.masterGain) {
      if (this.enabled && this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {});
      }
      this.masterGain.gain.setTargetAtTime(
        this.enabled ? 0.34 : 0.0,
        this.ctx.currentTime,
        0.04,
      );
    }
    return this.enabled;
  }

  public isAudioEnabled(): boolean {
    return this.enabled;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.removeGestureListeners();

    const safeStop = (node: OscillatorNode | AudioBufferSourceNode | null) => {
      if (!node) return;
      try {
        node.stop();
        node.disconnect();
      } catch {
        // Ignore already-stopped nodes during teardown
      }
    };

    safeStop(this.oscFundamental);
    safeStop(this.oscHarmonic2);
    safeStop(this.oscSub);
    safeStop(this.oscExhaust);
    safeStop(this.rollSource);
    safeStop(this.screechSource);
    safeStop(this.turboSource);

    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
