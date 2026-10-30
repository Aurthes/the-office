// @vitest-environment node
import fs from "node:fs";
import vm from "node:vm";
import { expect, it } from "vitest";
it("downsamples microphone audio and flushes the final partial frame without playback", () => {
  let Recorder!: new () => { port: { onmessage: (e: { data: string }) => void }; process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean };
  const messages: { pcm?: Int16Array; stopped?: boolean }[] = [];
  class Processor { port = { onmessage: null, postMessage: (value: typeof messages[number]) => messages.push(value) }; }
  vm.runInNewContext(fs.readFileSync("public/audio/native-dictation-recorder.js", "utf8"), { AudioWorkletProcessor: Processor, Int16Array, sampleRate: 48000, registerProcessor: (_name: string, ctor: typeof Recorder) => { Recorder = ctor; } });
  const capture = new Recorder(), output = new Float32Array(480).fill(1);
  capture.process([[new Float32Array(480).fill(0.25)]], [[output]]);
  expect(messages).toHaveLength(0); expect(output.every(value => value === 0)).toBe(true);
  capture.port.onmessage({ data: "stop" });
  expect(messages[0].pcm!.length).toBe(160); expect(messages[0].pcm![0]).toBe(8192); expect(messages[1].stopped).toBe(true);
});
