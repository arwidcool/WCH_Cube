// =============================================================================
//  history.js — undo/redo as a stack of configuration snapshots.
//
//  Snapshots, not inverse commands: the whole configuration is a few kilobytes
//  of plain data, and a snapshot cannot drift out of step with the engine the
//  way a hand-written inverse can.
//
//  View state (selection, zoom, pan) is deliberately excluded — undo must not
//  scroll the chip around or change which peripheral is open.
//
//  Every engine mutator calls record(label) BEFORE it changes anything, so the
//  UI gets undo for free by going through the engine instead of writing S.
// =============================================================================
import { S } from './model.js';
import { deepClone } from './util.js';

const VIEW_KEYS = ['sel', 'selPin', 'zoom', 'panX', 'panY'];
const LIMIT = 100;

let undoStack = [];
let redoStack = [];
let batching = false;

// deepClone keeps Sets as Sets, which the checkbox settings rely on.
function snap() {
  const out = {};
  for (const [k, v] of Object.entries(S)) if (!VIEW_KEYS.includes(k)) out[k] = deepClone(v);
  return out;
}

// Restore in place: the UI and the engine hold a reference to S, so the object
// identity has to survive.
function restore(state) {
  for (const k of Object.keys(S)) if (!VIEW_KEYS.includes(k)) delete S[k];
  for (const [k, v] of Object.entries(state)) S[k] = deepClone(v);
}

export function clearHistory() { undoStack = []; redoStack = []; }

export function record(label) {
  if (!S || batching) return;      // inside batch(), the group's own record() already fired
  undoStack.push({ label, state: snap() });
  if (undoStack.length > LIMIT) undoStack.shift();
  redoStack = [];
}

// Undo/redo return the label of what moved, or null when there was nothing.
export function undo() {
  if (!undoStack.length) return null;
  const entry = undoStack.pop();
  redoStack.push({ label: entry.label, state: snap() });
  restore(entry.state);
  return entry.label;
}

export function redo() {
  if (!redoStack.length) return null;
  const entry = redoStack.pop();
  undoStack.push({ label: entry.label, state: snap() });
  restore(entry.state);
  return entry.label;
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;
export const undoLabel = () => (undoStack.length ? undoStack[undoStack.length - 1].label : null);
export const redoLabel = () => (redoStack.length ? redoStack[redoStack.length - 1].label : null);
export const historyDepth = () => ({ undo: undoStack.length, redo: redoStack.length });

// Group several mutations into one undo step (a package switch that also drops
// pins, say). The inner record() calls are suppressed.
export function batch(label, fn) {
  if (batching) return fn();
  record(label);
  batching = true;
  try { return fn(); } finally { batching = false; }
}
export const recording = () => !batching;
