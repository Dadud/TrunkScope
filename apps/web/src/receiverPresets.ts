import type { ReceiverInput, ReceiverSubmodelPreset } from "./api";

// Applies a device preset's optimal defaults onto a receiver draft,
// replacing any auto-generated driver args with the preset's serial.
export function applySubmodelPreset(
  draft: ReceiverInput,
  submodel: ReceiverSubmodelPreset,
): ReceiverInput {
  return {
    ...draft,
    centerFrequencyHz: submodel.centerFrequencyHz,
    sampleRateHz: submodel.sampleRateHz,
    gainDb: submodel.gainDb,
    ppm: submodel.ppm,
  };
}

export function presetSummary(submodel: ReceiverSubmodelPreset): string {
  return [
    `${(submodel.sampleRateHz / 1e6).toFixed(submodel.sampleRateHz % 1e6 === 0 ? 1 : 3)} MS/s`,
    `${submodel.gainDb} dB`,
    `${(submodel.centerFrequencyHz / 1e6).toFixed(4)} MHz`,
  ].join(", ");
}
