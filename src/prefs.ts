// User preferences in localStorage. Storage may be unavailable (private
// mode), in which case defaults are used and changes just aren't kept.

export function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not persisted; the in-memory value still applies for this visit.
  }
}

export interface Settings {
  sound: boolean;
  vibration: boolean;
}

export const settings: Settings = {
  sound: lsGet('sound') !== 'off',
  vibration: lsGet('vibration') !== 'off',
};

export function setSetting(key: keyof Settings, on: boolean) {
  settings[key] = on;
  lsSet(key, on ? 'on' : 'off');
}
