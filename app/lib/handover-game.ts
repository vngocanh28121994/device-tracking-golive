export const clampBasket = (position: number) => Math.max(16, Math.min(84, position));
// Coordinates are percentages of the play area; the rim is 28% wide, with a safety margin.
export const catchesDevice = (device: number, basket: number) => Math.abs(device - basket) <= 12;
