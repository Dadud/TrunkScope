export type DiscoveredModels = {
  models: string[];
  source: string;
  catalogUrl: string;
};

export function pickTranscribeModel(models: string[], current?: string): string {
  if (current && models.includes(current)) {
    return current;
  }
  const ranked = [
    (name: string) => /qwen.*asr.*radio/i.test(name),
    (name: string) => /qwen.*asr/i.test(name),
    (name: string) => /whisper.*large/i.test(name),
    (name: string) => /whisper/i.test(name),
    (name: string) => /parakeet/i.test(name),
    (name: string) => /asr/i.test(name),
  ];
  for (const score of ranked) {
    const match = models.find(score);
    if (match) return match;
  }
  return models[0] ?? current ?? "";
}

export function pickSummaryModel(models: string[], current?: string): string {
  if (current && models.includes(current)) {
    return current;
  }
  const ranked = [
    (name: string) => /llama3\.2/i.test(name),
    (name: string) => /qwen/i.test(name),
    (name: string) => /llama/i.test(name),
    (name: string) => /mistral/i.test(name),
  ];
  for (const score of ranked) {
    const match = models.find(score);
    if (match) return match;
  }
  return models[0] ?? current ?? "";
}

export function deriveAiProfile(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes("radio") && lower.includes("qwen")) return "experimental-radio";
  if (lower.includes("qwen") && lower.includes("asr")) return "gpu-qwen3";
  if (lower.includes("parakeet")) return "gpu-parakeet";
  if (lower.includes("whisper") && lower.includes("large")) return "gpu-faster-whisper";
  if (lower.includes("whisper")) return "cpu-faster-whisper-small";
  return "endpoint";
}
