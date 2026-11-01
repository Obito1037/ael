// OpenUI 1.0.1 automatically downloads its inspector in development. AEL is a
// local desktop app: keep the renderer, but do not inject third-party scripts.
// This flag is the guard used by upstream react-lang/src/devtoolsBootstrap.ts.
const flags = globalThis as { [key: symbol]: boolean | undefined };
flags[Symbol.for("openui.devtools.autoMount")] = true;

export {};
