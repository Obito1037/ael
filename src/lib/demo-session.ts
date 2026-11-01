import { create } from "zustand";
import { createDemoState, transitionDemo, type DemoAction, type DemoState } from "./demo";

// Separate, memory-only store. Demo choices never enter AEL's task/skill stores
// or native IPC. Navigating away and back keeps the current demonstration.
export const useDemoSession = create<{
  state: DemoState;
  dispatch: (action: DemoAction) => void;
}>((set) => ({
  state: createDemoState(),
  dispatch: (action) => set(current => ({ state: transitionDemo(current.state, action) })),
}));
