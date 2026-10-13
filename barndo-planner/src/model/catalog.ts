import type { ExteriorDoorKind, RoomType, WindowKind } from './types';

export interface RoomTypeInfo {
  label: string;
  color: string;
  /** Default size when a room of this type is added. */
  w: number;
  d: number;
  /** Wet rooms always get tile flooring. */
  wet?: boolean;
  /** Shop / garage space is costed as unfinished, unconditioned area. */
  shop?: boolean;
  /** Skip these when auto-placing windows. */
  noWindows?: boolean;
}

export const ROOM_TYPES: Record<RoomType, RoomTypeInfo> = {
  bedroom: { label: 'Bedroom', color: '#7fa7d9', w: 12, d: 12 },
  bathroom: { label: 'Full bath', color: '#7fd0d9', w: 8, d: 6, wet: true },
  'half-bath': { label: 'Half bath', color: '#9ad9d0', w: 5, d: 5, wet: true, noWindows: true },
  kitchen: { label: 'Kitchen', color: '#e0b36a', w: 14, d: 12, wet: true },
  living: { label: 'Living room', color: '#d9a07f', w: 18, d: 16 },
  dining: { label: 'Dining', color: '#d9bf7f', w: 12, d: 12 },
  office: { label: 'Office', color: '#b7a3d9', w: 10, d: 10 },
  laundry: { label: 'Laundry', color: '#a3d9a5', w: 8, d: 6, wet: true, noWindows: true },
  mudroom: { label: 'Mudroom', color: '#c9c29a', w: 8, d: 6, wet: true },
  closet: { label: 'Closet', color: '#c4c4c4', w: 6, d: 6, noWindows: true },
  pantry: { label: 'Pantry', color: '#d6c7a1', w: 5, d: 6, noWindows: true },
  hallway: { label: 'Hallway', color: '#e3dfd3', w: 4, d: 16, noWindows: true },
  utility: { label: 'Utility / mech', color: '#b0b8c0', w: 6, d: 6, noWindows: true },
  shop: { label: 'Shop', color: '#9aa5b1', w: 30, d: 30, shop: true, noWindows: true },
  garage: { label: 'Garage', color: '#a9a9b8', w: 24, d: 24, shop: true, noWindows: true },
};

export const ROOM_TYPE_LIST = Object.keys(ROOM_TYPES) as RoomType[];

export const EXTERIOR_DOOR_KINDS: Record<ExteriorDoorKind, { label: string; width: number; height: number }> = {
  entry: { label: 'Entry door (3 ft)', width: 3, height: 6.75 },
  french: { label: 'French doors (6 ft)', width: 6, height: 6.75 },
  sliding: { label: 'Sliding patio door (6 ft)', width: 6, height: 6.75 },
  'overhead-10': { label: 'Overhead door 10×8', width: 10, height: 8 },
  'overhead-16': { label: 'Overhead door 16×10', width: 16, height: 10 },
};

export const WINDOW_KINDS: Record<WindowKind, { label: string; width: number; height: number; sill: number }> = {
  single: { label: 'Single 3×4', width: 3, height: 4, sill: 3 },
  double: { label: 'Double 6×4', width: 6, height: 4, sill: 3 },
  picture: { label: 'Picture 8×5', width: 8, height: 5, sill: 2.5 },
};

export const INTERIOR_DOOR_HEIGHT = 6.75;

export const INTERIOR_DOOR_WIDTHS: { value: number; label: string }[] = [
  { value: 2.5, label: 'Narrow door 2\'6"' },
  { value: 3, label: 'Standard door 3\'' },
  { value: 4, label: 'Cased opening 4\'' },
  { value: 6, label: 'Cased opening 6\'' },
  { value: 8, label: 'Cased opening 8\'' },
];
