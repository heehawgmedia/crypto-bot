/** The imported plan drawing shown beneath the floor plan editor, with its image-to-feet calibration. */
export interface Underlay {
  canvas: HTMLCanvasElement;
  /** Image pixels per foot. */
  pxPerFt: number;
  /** Image pixel that maps to the building's north-west corner (0 ft, 0 ft). */
  originX: number;
  originY: number;
  opacity: number;
  visible: boolean;
}

export const ftToPx = (u: Underlay, xFt: number, zFt: number): { x: number; y: number } => ({ x: u.originX + xFt * u.pxPerFt, y: u.originY + zFt * u.pxPerFt });
export const pxToFt = (u: Underlay, x: number, y: number): { x: number; z: number } => ({ x: (x - u.originX) / u.pxPerFt, z: (y - u.originY) / u.pxPerFt });
