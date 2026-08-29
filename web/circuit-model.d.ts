export interface CircuitPin { id: string; label: string; header?: string; x: number; y: number; used: boolean }
export interface CircuitComponent { id: string; name: string; part: string; purpose: string; step: number; x: number; y: number; w: number; h: number; asset?: string; pins: CircuitPin[] }
export interface CircuitWire { id: string; step: number; net: string; from: string; to: string; voltage: string; signal: string; route: number[][]; direction: string }
export interface GpioAssignment { signal: string; pin: string; capability: string }
export const components: CircuitComponent[];
export const wires: CircuitWire[];
export const gpioAssignments: GpioAssignment[];
export const assemblySteps: Array<{ id: string; title: string; detail: string; placementMs: number }>;
export const cameraViews: Array<{ id: string; label: string; viewBox: string }>;
export function endpoint(ref: string): unknown;
export function validateCircuit(): { valid: boolean; errors: string[]; checked: { components: number; pins: number; wires: number; gpio: number } };
export function connectedPinRows(): Array<Record<string, string>>;
