export interface ResistorBand {
  name: string;
  hex: string;
}

export interface ResistorCode {
  bands: ResistorBand[];
  label: string;
}

export interface ResistorAsset {
  src: string;
  alt: string;
  caption: string;
  bands: string[];
}

export function formatResistance(value: number): string;
export function resistorCode(resistanceOhms: number): ResistorCode | undefined;
export function createResistorAsset(resistanceOhms: number): ResistorAsset | undefined;
