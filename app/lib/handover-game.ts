export const clampBasket = (position: number) => Math.max(16, Math.min(84, position));
// Coordinates are percentages of the play area; the rim is 28% wide, with a safety margin.
export const catchesDevice = (device: number, basket: number) => Math.abs(device - basket) <= 12;

// A smooth side-to-side path stays inside the basket's reachable range.
export function movingDeviceX(start: number, elapsedMs: number, direction: 1 | -1) {
  const phase = Math.asin(Math.max(-1, Math.min(1, (start - 50) / 30)));
  return 50 + 30 * Math.sin(phase + direction * elapsedMs / 1000 * 1.8);
}
