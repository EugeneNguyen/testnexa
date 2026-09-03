import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAccessToken,
  getAccessToken,
  setAccessToken,
  subscribe,
} from "../../../src/lib/auth/tokenStore";

describe("tokenStore", () => {
  afterEach(() => {
    clearAccessToken();
  });

  it("returns null when no token has been set", () => {
    expect(getAccessToken()).toBeNull();
  });

  it("returns the token after it has been set", () => {
    setAccessToken("abc123");
    expect(getAccessToken()).toBe("abc123");
  });

  it("returns null again after clearAccessToken", () => {
    setAccessToken("abc123");
    clearAccessToken();
    expect(getAccessToken()).toBeNull();
  });

  it("notifies subscribers on set", () => {
    const callback = vi.fn();
    subscribe(callback);

    setAccessToken("abc123");

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("notifies subscribers on clear", () => {
    const callback = vi.fn();
    setAccessToken("abc123");
    subscribe(callback);

    clearAccessToken();

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("stops notifying after unsubscribe", () => {
    const callback = vi.fn();
    const unsubscribe = subscribe(callback);

    unsubscribe();
    setAccessToken("abc123");

    expect(callback).not.toHaveBeenCalled();
  });
});
