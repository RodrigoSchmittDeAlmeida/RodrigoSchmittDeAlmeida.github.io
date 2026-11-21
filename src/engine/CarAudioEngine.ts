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
 * AM-modulated intake breathing, road/wind noise, tire screech,
 * gear-shift transients, dual-tone horn, and arrival chime.
 * Generates all waveforms and buffers mathematically with zero external audio assets.
 */
export class CarAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private masterPreFilter: BiquadFilterNode | null = null;
  private masterCompressor: DynamicsCompressorNode | null = null;
  private mixBus: GainNode | null = null;

  // Layer 1: Block & warm exhaust oscillators (PeriodicWave)
  private oscSub: OscillatorNode | null = null;
  private oscFundamental: OscillatorNode | null = null;
  private oscTwin: OscillatorNode | null = null;
  private oscExhaust: OscillatorNode | null = null;

  private engineLowpass: BiquadFilterNode | null = null;
  private exhaustResonator: BiquadFilterNode | null = null;
  private exhaustResonatorGain: GainNode | null = null;
  private engineOutputGain: GainNode | null = null;

  // Layer 2: AM-modulated intake & combustion air texture
  private intakeSource: AudioBufferSourceNode | null = null;
  private intakeFilter: BiquadFilterNode | null = null;
  private intakeAmGain: GainNode | null = null;
  private intakeModOsc: OscillatorNode | null = null;
  private intakeModDepth: GainNode | null = null;
  private intakeOutputGain: GainNode | null = null;

  // Road roll & high-speed wind
  private rollSource: AudioBufferSourceNode | null = null;
  private rollFilter: BiquadFilterNode | null = null;
  private rollGain: GainNode | null = null;

  private windSource: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;

  // Tire screech & turbo induction spool
  private screechSource: AudioBufferSourceNode | null = null;
  private screechFilterA: BiquadFilterNode | null = null;
  private screechFilterB: BiquadFilterNode | null = null;
  private screechGain: GainNode | null = null;

  private turboSource: AudioBufferSourceNode | null = null;
  private turboFilter: BiquadFilterNode | null = null;
  private turboGain: GainNode | null = null;

  private hornWave: PeriodicWave | null = null;

  private enabled = false;
  private initialized = false;
  private disposed = false;
  private shiftDipTimer = 0;
  private readonly shiftDipDuration = 0.16;
  private lopePhaseTime = 0;

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

  /**
   * Calibrated harmonic series for 4-cylinder block combustion:
   * strong 1f fundamental, warm 2f/3f body, and smooth exponential decay above 5f
   * to avoid harsh sawtooth buzzing.
   */
  private createCombustionWave(ctx: AudioContext): PeriodicWave {
    const harmonics = 16;
    const real = new Float32Array(harmonics + 1);
    const imag = new Float32Array(harmonics + 1);

    imag[1] = 1.0;
    imag[2] = 0.52;
    real[2] = 0.12;
    imag[3] = 0.34;
    real[3] = -0.06;
    imag[4] = 0.18;
    imag[5] = 0.1;

    for (let k = 6; k <= harmonics; k++) {
      imag[k] = 0.1 * Math.exp(-0.55 * (k - 5));
    }

    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  /**
   * Deeper, rounded harmonic profile for warm exhaust resonance.
   */
  private createExhaustWave(ctx: AudioContext): PeriodicWave {
    const harmonics = 12;
    const real = new Float32Array(harmonics + 1);
    const imag = new Float32Array(harmonics + 1);

    imag[1] = 0.92;
    imag[2] = 0.62;
    real[2] = 0.14;
    imag[3] = 0.28;
    real[3] = -0.05;
    imag[4] = 0.12;
    imag[5] = 0.05;

    for (let k = 6; k <= harmonics; k++) {
      imag[k] = 0.05 * Math.exp(-0.72 * (k - 5));
    }

    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  /**
   * Warm brass/diaphragm horn harmonic table without raw sawtooth rasp.
   */
  private createHornWave(ctx: AudioContext): PeriodicWave {
    const harmonics = 10;
    const real = new Float32Array(harmonics + 1);
    const imag = new Float32Array(harmonics + 1);

    imag[1] = 1.0;
    imag[2] = 0.58;
    real[2] = 0.08;
    imag[3] = 0.42;
    imag[4] = 0.24;
    imag[5] = 0.13;
    imag[6] = 0.06;

    for (let k = 7; k <= harmonics; k++) {
      imag[k] = 0.06 * Math.exp(-0.75 * (k - 6));
    }

    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  private makeLoopSeamless(data: Float32Array): void {
    const fadeSamples = Math.min(128, Math.floor(data.length / 8));
    for (let i = 0; i < fadeSamples; i++) {
      const t = i / fadeSamples;
      const tailIdx = data.length - fadeSamples + i;
      const blended = data[i] * t + data[tailIdx] * (1 - t);
      data[i] = blended;
      data[tailIdx] = blended;
    }
  }

  private createNoiseBuffers(ctx: AudioContext): {
    pinkBuf: AudioBuffer;
    brownPinkBuf: AudioBuffer;
  } {
    const bufferLen = ctx.sampleRate * 2;
    const pinkBuf = ctx.createBuffer(1, bufferLen, ctx.sampleRate);
    const pinkData = pinkBuf.getChannelData(0);

    const brownPinkBuf = ctx.createBuffer(1, bufferLen, ctx.sampleRate);
    const bpData = brownPinkBuf.getChannelData(0);

    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let brown = 0;

    for (let i = 0; i < bufferLen; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      const pink = (b0 + b1 + b2 + white * 0.1848) * 0.16;
      pinkData[i] = pink;

      brown = (brown + 0.028 * white) / 1.028;
      bpData[i] = brown * 1.85 + pink * 0.38;
    }

    this.makeLoopSeamless(pinkData);
    this.makeLoopSeamless(bpData);
    return { pinkBuf, brownPinkBuf };
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

      // Master chain: mixBus -> gentle 3800 Hz lowpass -> DynamicsCompressor -> masterGain -> destination
      const mixBus = ctx.createGain();
      mixBus.gain.value = 1.0;

      const masterPreFilter = ctx.createBiquadFilter();
      masterPreFilter.type = 'lowpass';
      masterPreFilter.frequency.value = 3800;
      masterPreFilter.Q.value = 0.55;

      const masterCompressor = ctx.createDynamicsCompressor();
      masterCompressor.threshold.value = -14;
      masterCompressor.knee.value = 12;
      masterCompressor.ratio.value = 6;
      masterCompressor.attack.value = 0.005;
      masterCompressor.release.value = 0.12;

      const master = ctx.createGain();
      master.gain.value = this.enabled ? 0.36 : 0.0;

      mixBus.connect(masterPreFilter);
      masterPreFilter.connect(masterCompressor);
      masterCompressor.connect(master);
      master.connect(ctx.destination);

      this.mixBus = mixBus;
      this.masterPreFilter = masterPreFilter;
      this.masterCompressor = masterCompressor;
      this.masterGain = master;

      const combustionWave = this.createCombustionWave(ctx);
      const exhaustWave = this.createExhaustWave(ctx);
      this.hornWave = this.createHornWave(ctx);

      // Layer 1: 4-cylinder VW EA111 1.6 block & exhaust synthesis
      const oscSub = ctx.createOscillator();
      oscSub.setPeriodicWave(combustionWave);
      oscSub.frequency.value = 14.15;
      const gainSub = ctx.createGain();
      gainSub.gain.value = 0.56;

      const oscFund = ctx.createOscillator();
      oscFund.setPeriodicWave(combustionWave);
      oscFund.frequency.value = 28.3;
      const gainFund = ctx.createGain();
      gainFund.gain.value = 0.46;

      const oscTwin = ctx.createOscillator();
      oscTwin.setPeriodicWave(combustionWave);
      oscTwin.frequency.value = 28.41;
      const gainTwin = ctx.createGain();
      gainTwin.gain.value = 0.28;

      const oscExhaust = ctx.createOscillator();
      oscExhaust.setPeriodicWave(exhaustWave);
      oscExhaust.frequency.value = 56.6;
      const gainExhaust = ctx.createGain();
      gainExhaust.gain.value = 0.24;

      const shaper = ctx.createWaveShaper();
      shaper.curve = this.createWarmSaturationCurve(12);
      shaper.oversample = '2x';

      const engineLowshelf = ctx.createBiquadFilter();
      engineLowshelf.type = 'lowshelf';
      engineLowshelf.frequency.value = 95;
      engineLowshelf.gain.value = 5.0;

      const engineLowpass = ctx.createBiquadFilter();
      engineLowpass.type = 'lowpass';
      engineLowpass.frequency.value = 155;
      engineLowpass.Q.value = 1.25;

      const exhaustResonator = ctx.createBiquadFilter();
      exhaustResonator.type = 'bandpass';
      exhaustResonator.frequency.value = 135;
      exhaustResonator.Q.value = 1.4;

      const exhaustResonatorGain = ctx.createGain();
      exhaustResonatorGain.gain.value = 0.46;

      const engineOut = ctx.createGain();
      engineOut.gain.value = 0.28;

      oscSub.connect(gainSub);
      oscFund.connect(gainFund);
      oscTwin.connect(gainTwin);
      oscExhaust.connect(gainExhaust);

      gainSub.connect(shaper);
      gainFund.connect(shaper);
      gainTwin.connect(shaper);
      gainExhaust.connect(shaper);

      shaper.connect(engineLowshelf);

      // Parallel lowpass body + bandpass exhaust resonance preserve sub weight while adding pipe timbre
      engineLowshelf.connect(engineLowpass);
      engineLowpass.connect(engineOut);

      engineLowshelf.connect(exhaustResonator);
      exhaustResonator.connect(exhaustResonatorGain);
      exhaustResonatorGain.connect(engineOut);

      engineOut.connect(mixBus);

      oscSub.start();
      oscFund.start();
      oscTwin.start();
      oscExhaust.start();

      this.oscSub = oscSub;
      this.oscFundamental = oscFund;
      this.oscTwin = oscTwin;
      this.oscExhaust = oscExhaust;
      this.engineLowpass = engineLowpass;
      this.exhaustResonator = exhaustResonator;
      this.exhaustResonatorGain = exhaustResonatorGain;
      this.engineOutputGain = engineOut;

      // Procedural noise buffers
      const { pinkBuf, brownPinkBuf } = this.createNoiseBuffers(ctx);

      // Layer 2: AM-modulated mechanical intake & combustion air pulse
      const intakeSource = ctx.createBufferSource();
      intakeSource.buffer = brownPinkBuf;
      intakeSource.loop = true;

      const intakeFilter = ctx.createBiquadFilter();
      intakeFilter.type = 'bandpass';
      intakeFilter.frequency.value = 320;
      intakeFilter.Q.value = 1.4;

      const intakeAmGain = ctx.createGain();
      intakeAmGain.gain.value = 0.56;

      const intakeModOsc = ctx.createOscillator();
      intakeModOsc.type = 'sine';
      intakeModOsc.frequency.value = 28.3;

      const intakeModDepth = ctx.createGain();
      intakeModDepth.gain.value = 0.36;

      const intakeOutputGain = ctx.createGain();
      intakeOutputGain.gain.value = 0.05;

      intakeSource.connect(intakeFilter);
      intakeFilter.connect(intakeAmGain);
      intakeModOsc.connect(intakeModDepth);
      intakeModDepth.connect(intakeAmGain.gain);
      intakeAmGain.connect(intakeOutputGain);
      intakeOutputGain.connect(mixBus);

      intakeSource.start();
      intakeModOsc.start();

      this.intakeSource = intakeSource;
      this.intakeFilter = intakeFilter;
      this.intakeAmGain = intakeAmGain;
      this.intakeModOsc = intakeModOsc;
      this.intakeModDepth = intakeModDepth;
      this.intakeOutputGain = intakeOutputGain;

      // Asphalt tire roll channel (warm lowpass ~360 Hz)
      const rollSource = ctx.createBufferSource();
      rollSource.buffer = brownPinkBuf;
      rollSource.loop = true;

      const rollFilter = ctx.createBiquadFilter();
      rollFilter.type = 'lowpass';
      rollFilter.frequency.value = 320;
      rollFilter.Q.value = 0.65;

      const rollGain = ctx.createGain();
      rollGain.gain.value = 0;

      rollSource.connect(rollFilter);
      rollFilter.connect(rollGain);
      rollGain.connect(mixBus);
      rollSource.start();

      this.rollSource = rollSource;
      this.rollFilter = rollFilter;
      this.rollGain = rollGain;

      // Subtle aerodynamic wind above 70 km/h
      const windSource = ctx.createBufferSource();
      windSource.buffer = pinkBuf;
      windSource.loop = true;

      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 480;
      windFilter.Q.value = 0.55;

      const windGain = ctx.createGain();
      windGain.gain.value = 0;

      windSource.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(mixBus);
      windSource.start();

      this.windSource = windSource;
      this.windFilter = windFilter;
      this.windGain = windGain;

      // Dual-band resonant rubber screech for drift & hard braking
      const screechSource = ctx.createBufferSource();
      screechSource.buffer = pinkBuf;
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
      screechGain.connect(mixBus);
      screechSource.start();

      this.screechSource = screechSource;
      this.screechFilterA = screechFilterA;
      this.screechFilterB = screechFilterB;
      this.screechGain = screechGain;

      // Turbo induction air spool
      const turboSource = ctx.createBufferSource();
      turboSource.buffer = pinkBuf;
      turboSource.loop = true;

      const turboFilter = ctx.createBiquadFilter();
      turboFilter.type = 'bandpass';
      turboFilter.frequency.value = 1650;
      turboFilter.Q.value = 3.1;

      const turboGain = ctx.createGain();
      turboGain.gain.value = 0;

      turboSource.connect(turboFilter);
      turboFilter.connect(turboGain);
      turboGain.connect(mixBus);
      turboSource.start();

      this.turboSource = turboSource;
      this.turboFilter = turboFilter;
      this.turboGain = turboGain;

      this.initialized = true;
    } catch {
      // Gracefully degrade if Web Audio API is blocked or unavailable
    }
  }

  private createWarmSaturationCurve(drive: number): Float32Array<ArrayBuffer> {
    const samples = 1024;
    const buffer = new ArrayBuffer(samples * Float32Array.BYTES_PER_ELEMENT);
    const curve = new Float32Array(buffer);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      // Soft asymmetric analog saturation introduces even-order warmth without buzz
      curve[i] = Math.tanh((x + 0.065 * x * x) * (1 + drive * 0.09));
    }
    return curve;
  }

  public notifyGearShift(fromGear: string, toGear: string): void {
    if (!this.initialized || !this.enabled || fromGear === toGear) return;
    this.shiftDipTimer = this.shiftDipDuration;
  }

  public update(params: EngineAudioUpdateParams): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.disposed) return;

    const now = this.ctx.currentTime;
    const safeDt = Math.max(0, Math.min(0.1, params.dt));
    this.lopePhaseTime += safeDt;

    if (this.shiftDipTimer > 0) {
      this.shiftDipTimer = Math.max(0, this.shiftDipTimer - safeDt);
    }

    const clampedRpm = Math.max(700, Math.min(7200, params.rpm));
    const throttleLoad = Math.min(1, Math.abs(params.throttle));

    // Organic idle lope (±9 RPM) when idling near ~800-1250 RPM with closed throttle
    const idleWeight =
      Math.max(0, 1 - (clampedRpm - 800) / 480) *
      Math.max(0, 1 - throttleLoad * 4);
    const lopeOffsetRpm =
      (Math.sin(this.lopePhaseTime * 14.5) * 0.65 +
        Math.sin(this.lopePhaseTime * 23.2) * 0.35) *
      9.0 *
      idleWeight;

    const effectiveRpm = Math.max(680, clampedRpm + lopeOffsetRpm);
    // 4-cylinder 4-stroke ignition frequency: (RPM / 60) * 2 = RPM / 30
    const firingFreq = effectiveRpm / 30;
    const rpmRatio = Math.max(0, Math.min(1, (effectiveRpm - 800) / 6000));

    // Subtle overrun decel burble when off-throttle above 2600 RPM
    const decelEligible =
      clampedRpm > 2600 && throttleLoad < 0.08
        ? Math.min(1, (clampedRpm - 2600) / 3600) *
          ((0.08 - throttleLoad) / 0.08)
        : 0;
    const burblePulse =
      decelEligible > 0
        ? (0.5 +
            0.3 * Math.sin(this.lopePhaseTime * 88) +
            0.2 * Math.sin(this.lopePhaseTime * 137)) *
          decelEligible
        : 0;

    // Smooth gear-shift torque dip & progressive recovery envelope
    let shiftAttenuation = 1.0;
    let shiftCutoffScale = 1.0;
    if (this.shiftDipTimer > 0) {
      const progress = 1 - this.shiftDipTimer / this.shiftDipDuration; // 0 -> 1
      const dipCurve =
        progress < 0.25
          ? progress / 0.25
          : 1 - Math.pow((progress - 0.25) / 0.75, 0.85);
      const dipDepth = Math.max(0, Math.min(1, dipCurve));
      shiftAttenuation = 1 - dipDepth * 0.48;
      shiftCutoffScale = 1 - dipDepth * 0.24;
    }

    if (
      this.oscSub &&
      this.oscFundamental &&
      this.oscTwin &&
      this.oscExhaust &&
      this.engineLowpass &&
      this.exhaustResonator &&
      this.exhaustResonatorGain &&
      this.engineOutputGain
    ) {
      const smoothTime = 0.032;
      this.oscSub.frequency.setTargetAtTime(firingFreq * 0.5, now, smoothTime);
      this.oscFundamental.frequency.setTargetAtTime(firingFreq, now, smoothTime);
      this.oscTwin.frequency.setTargetAtTime(firingFreq * 1.004, now, smoothTime);
      this.oscExhaust.frequency.setTargetAtTime(firingFreq * 2.0, now, smoothTime);

      const baseCutoff =
        140 +
        Math.pow(rpmRatio, 0.88) * 410 +
        throttleLoad * 130 +
        (params.isTurbo ? 45 : 0);
      const dynamicCutoff = Math.max(
        140,
        Math.min(680, baseCutoff * shiftCutoffScale - burblePulse * 35),
      );
      const dynamicQ = Math.max(
        1.1,
        Math.min(1.8, 1.1 + throttleLoad * 0.45 + rpmRatio * 0.25),
      );
      this.engineLowpass.frequency.setTargetAtTime(dynamicCutoff, now, 0.045);
      this.engineLowpass.Q.setTargetAtTime(dynamicQ, now, 0.05);

      const exhaustFreq = Math.max(
        110,
        Math.min(340, 110 + rpmRatio * 185 + throttleLoad * 45),
      );
      this.exhaustResonator.frequency.setTargetAtTime(exhaustFreq, now, 0.045);
      this.exhaustResonator.Q.setTargetAtTime(1.4, now, 0.05);
      this.exhaustResonatorGain.gain.setTargetAtTime(
        0.44 + throttleLoad * 0.14 + burblePulse * 0.26,
        now,
        0.04,
      );

      const targetEngineGain =
        (0.2 + rpmRatio * 0.15 + throttleLoad * 0.12 + burblePulse * 0.05) *
        shiftAttenuation;
      this.engineOutputGain.gain.setTargetAtTime(targetEngineGain, now, 0.04);
    }

    // Layer 2: AM-modulated intake & combustion air texture
    if (
      this.intakeFilter &&
      this.intakeAmGain &&
      this.intakeModOsc &&
      this.intakeModDepth &&
      this.intakeOutputGain
    ) {
      const intakeFreq = Math.max(
        260,
        Math.min(950, 260 + rpmRatio * 510 + throttleLoad * 180),
      );
      this.intakeFilter.frequency.setTargetAtTime(intakeFreq, now, 0.045);
      this.intakeFilter.Q.setTargetAtTime(1.3 + throttleLoad * 0.45, now, 0.05);

      this.intakeModOsc.frequency.setTargetAtTime(firingFreq, now, 0.032);
      const modBase = 0.56;
      const modDepth = 0.34 + throttleLoad * 0.1;
      this.intakeAmGain.gain.setTargetAtTime(modBase, now, 0.04);
      this.intakeModDepth.gain.setTargetAtTime(modDepth, now, 0.04);

      const intakeLevel =
        (0.04 + throttleLoad * 0.11 + rpmRatio * 0.08 + burblePulse * 0.035) *
        shiftAttenuation;
      this.intakeOutputGain.gain.setTargetAtTime(intakeLevel, now, 0.045);
    }

    // Road roll (warm lowpass around ~360 Hz) + subtle wind above 70 km/h
    if (this.rollFilter && this.rollGain) {
      const speedNorm = Math.min(1, params.speedKmh / 140);
      const rollCutoff = Math.min(410, 240 + speedNorm * 150);
      this.rollFilter.frequency.setTargetAtTime(rollCutoff, now, 0.06);
      this.rollGain.gain.setTargetAtTime(speedNorm * 0.12, now, 0.06);
    }

    if (this.windFilter && this.windGain) {
      const windNorm =
        params.speedKmh > 70
          ? Math.min(1, (params.speedKmh - 70) / 100)
          : 0;
      this.windFilter.frequency.setTargetAtTime(420 + windNorm * 320, now, 0.08);
      this.windGain.gain.setTargetAtTime(windNorm * 0.055, now, 0.08);
    }

    if (this.screechFilterA && this.screechFilterB && this.screechGain) {
      const slip = Math.max(0, Math.min(1, params.slipIntensity));
      const screechActive =
        params.isDrifting || (params.isBraking && params.speedKmh > 18);
      const targetScreech = screechActive ? slip * 0.18 : 0;

      const freqMod = 1 + slip * 0.14;
      this.screechFilterA.frequency.setTargetAtTime(960 * freqMod, now, 0.05);
      this.screechFilterB.frequency.setTargetAtTime(1760 * freqMod, now, 0.05);
      this.screechGain.gain.setTargetAtTime(targetScreech, now, 0.045);
    }

    if (this.turboFilter && this.turboGain) {
      const boostActive = params.isTurbo && throttleLoad > 0.15;
      const targetTurbo = boostActive ? 0.065 + rpmRatio * 0.075 : 0;
      this.turboFilter.frequency.setTargetAtTime(1400 + rpmRatio * 1300, now, 0.07);
      this.turboGain.gain.setTargetAtTime(targetTurbo, now, 0.07);
    }
  }

  /** Plays a gentle studio chime when parking/entering a project monument zone. */
  public playArrivalChime(): void {
    if (!this.enabled || this.disposed) return;
    this.ensureInitialized();
    const targetBus = this.mixBus ?? this.masterGain;
    if (!this.ctx || !targetBus || this.ctx.state !== 'running') return;

    const now = this.ctx.currentTime;
    const notes = [587.33, 880.0]; // D5 -> A5 clean fifth interval

    notes.forEach((freq, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const start = now + idx * 0.085;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.14, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);

      osc.connect(gain);
      gain.connect(targetBus);
      osc.start(start);
      osc.stop(start + 0.45);
    });
  }

  /** Plays a warm dual-tone Gol G5 horn burst (400 Hz + 500 Hz). */
  public playHorn(): void {
    if (!this.enabled || this.disposed) return;
    this.ensureInitialized();
    const targetBus = this.mixBus ?? this.masterGain;
    if (!this.ctx || !targetBus) return;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }

    const now = this.ctx.currentTime;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1100;
    filter.Q.value = 0.85;

    const hornGain = this.ctx.createGain();
    hornGain.gain.setValueAtTime(0.0001, now);
    hornGain.gain.exponentialRampToValueAtTime(0.16, now + 0.015);
    hornGain.gain.setValueAtTime(0.16, now + 0.14);
    hornGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    filter.connect(hornGain);
    hornGain.connect(targetBus);

    const wave = this.hornWave ?? this.createHornWave(this.ctx);
    for (const freq of [400, 500]) {
      const osc = this.ctx.createOscillator();
      osc.setPeriodicWave(wave);
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
        this.enabled ? 0.36 : 0.0,
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

    safeStop(this.oscSub);
    safeStop(this.oscFundamental);
    safeStop(this.oscTwin);
    safeStop(this.oscExhaust);
    safeStop(this.intakeSource);
    safeStop(this.intakeModOsc);
    safeStop(this.rollSource);
    safeStop(this.windSource);
    safeStop(this.screechSource);
    safeStop(this.turboSource);

    this.masterPreFilter?.disconnect();
    this.masterCompressor?.disconnect();
    this.mixBus?.disconnect();

    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
