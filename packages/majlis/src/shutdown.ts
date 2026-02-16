let _requested = false;

export function requestShutdown(): void { _requested = true; }
export function isShutdownRequested(): boolean { return _requested; }
