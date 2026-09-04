import "@testing-library/jest-dom/vitest";

// This jsdom+Vitest combination exposes `window.localStorage`/`localStorage`
// as an object with none of the `Storage` interface's methods present
// (verified directly: `typeof localStorage.getItem === "undefined"`, not a
// missing-global or `this`-binding issue) — a real browser's `localStorage`
// always has them. CoreUI's `useColorModes` hook (SHELL-4, ADR-0019) calls
// `localStorage.getItem`/`.setItem` directly, which otherwise throws
// "localStorage.getItem is not a function" in every test that mounts
// `AppHeader` (i.e. most of the authenticated-shell test suite, not just
// SHELL-4's own tests). A minimal in-memory `Storage` polyfill, installed
// globally here once, is the correct fix — not a per-test mock, since the
// underlying gap is this environment's `localStorage` stub, not something
// any individual component test should have to work around.
class InMemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
}

Object.defineProperty(globalThis, "localStorage", {
  value: new InMemoryStorage(),
  writable: true,
  configurable: true,
});

// jsdom does not implement `window.matchMedia` at all (a documented jsdom
// gap, not a Vitest quirk) — CoreUI's `useColorModes` hook calls it to
// resolve the "auto" color-mode's system preference. Standard
// jsdom-test-environment stub: no real media queries evaluated, `matches`
// always `false` (i.e. "prefers-color-scheme: dark" never matches), which is
// an accurate-enough default for a headless test environment with no real
// display.
Object.defineProperty(globalThis, "matchMedia", {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
