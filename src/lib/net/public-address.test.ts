import { describe, expect, it } from "vitest";
import { isPublicAddress, publicOnlyLookup } from "./public-address";

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "224.0.0.1", "255.255.255.255", "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "[::1]",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1",
  ])("refuses %s", (address) => expect(isPublicAddress(address)).toBe(false));

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "accepts %s", (address) => expect(isPublicAddress(address)).toBe(true),
  );

  it("refuses anything that is not an address", () => {
    expect(isPublicAddress("example.com")).toBe(false);
    expect(isPublicAddress("")).toBe(false);
  });
});

describe("publicOnlyLookup", () => {
  it("fails a name that resolves to loopback, so the socket never connects", async () => {
    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) => publicOnlyLookup("localhost", {}, (e) => resolve(e)));
    expect(error?.code).toBe("EPRIVATEADDRESS");
  });
});
