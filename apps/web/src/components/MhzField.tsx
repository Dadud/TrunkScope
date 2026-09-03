import { useEffect, useState } from "react";
import { hzToMhz, mhzToHz } from "../format";

interface MhzFieldProps {
  valueHz: number | undefined;
  onChange: (valueHz: number) => void;
  placeholder?: string;
}

// Text-input-backed MHz field. Holds raw text while focused so decimals can be
// typed naturally, then round-trips through Hz for the API on every change.
export function MhzField({ valueHz, onChange, placeholder }: MhzFieldProps) {
  const [text, setText] = useState(() => hzToMhz(valueHz));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(hzToMhz(valueHz));
  }, [valueHz, focused]);

  return (
    <input
      type="text"
      inputMode="decimal"
      placeholder={placeholder}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setText(hzToMhz(valueHz));
      }}
      onChange={(e) => {
        setText(e.target.value);
        onChange(mhzToHz(e.target.value));
      }}
    />
  );
}
