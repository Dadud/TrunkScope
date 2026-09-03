import { describe, expect, it } from "vitest";
import { deriveAiProfile, pickSummaryModel, pickTranscribeModel } from "./integrationModels";

describe("integration model selection", () => {
  it("prefers radio-tuned qwen asr models", () => {
    const models = [
      "Systran/faster-distil-whisper-small.en",
      "chrullis/qwen3-asr-radio-1.7b",
      "Qwen/Qwen3-ASR-1.7B",
    ];
    expect(pickTranscribeModel(models)).toBe("chrullis/qwen3-asr-radio-1.7b");
  });

  it("keeps the current transcribe model when still available", () => {
    const models = ["Qwen/Qwen3-ASR-1.7B", "Systran/faster-distil-whisper-small.en"];
    expect(pickTranscribeModel(models, "Systran/faster-distil-whisper-small.en")).toBe(
      "Systran/faster-distil-whisper-small.en",
    );
  });

  it("prefers llama summary models", () => {
    const models = ["qwen2.5:14b-instruct-q4_K_M", "llama3.2:3b"];
    expect(pickSummaryModel(models)).toBe("llama3.2:3b");
  });

  it("derives ai profile labels from model names", () => {
    expect(deriveAiProfile("chrullis/qwen3-asr-radio-1.7b")).toBe("experimental-radio");
    expect(deriveAiProfile("Qwen/Qwen3-ASR-1.7B")).toBe("gpu-qwen3");
  });
});
