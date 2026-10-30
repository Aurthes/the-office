/* Mono PCM capture, independent of browser speech-recognition services. */
class NativeDictationRecorder extends AudioWorkletProcessor {
  constructor() {
    super(); this.buffer = new Int16Array(4096); this.used = 0;
    this.phase = 0; this.sum = 0; this.count = 0; this.stopped = false;
    this.port.onmessage = event => {
      if (event.data === "stop") { this.stopped = true; this.flush(); this.port.postMessage({ stopped: true }); }
    };
  }
  flush() {
    if (!this.used) return;
    const pcm = this.buffer.slice(0, this.used); this.used = 0;
    this.port.postMessage({ pcm }, [pcm.buffer]);
  }
  process(inputs, outputs) {
    for (const channel of outputs[0] || []) channel.fill(0);
    if (this.stopped) return true;
    const channels = inputs[0]; if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let mono = 0; for (const channel of channels) mono += channel[i] || 0;
      this.sum += mono / channels.length; this.count++;
      this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        const value = Math.max(-1, Math.min(1, this.sum / this.count));
        this.buffer[this.used++] = Math.round(value * (value < 0 ? 32768 : 32767));
        this.sum = 0; this.count = 0;
        if (this.used === this.buffer.length) this.flush();
      }
    }
    return true;
  }
}
registerProcessor("native-dictation-recorder", NativeDictationRecorder);
