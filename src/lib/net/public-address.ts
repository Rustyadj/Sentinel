// Whether an address is one a stranger's server could legitimately live at.
// Used wherever Sentinel fetches a URL a person typed in, which is an SSRF
// vector: without this the server can be pointed at its own loopback, the
// Docker bridge, or a cloud metadata endpoint.

import { lookup as dnsLookup } from "node:dns";
import { BlockList, isIP } from "node:net";
import type { LookupFunction } from "node:net";

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
] as const) blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 127], // unspecified and loopback
  ["64:ff9b::", 96], // NAT64, reaches IPv4
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) blocked.addSubnet(network, prefix, "ipv6");

/** IPv4-mapped IPv6 (::ffff:a.b.c.d) is judged as the IPv4 address it carries. */
function unmapped(address: string): string {
  const match = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (match) return match[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (!hex) return address;
  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/** False for anything that is not an IP literal, and for every non-routable range. */
export function isPublicAddress(raw: string): boolean {
  const address = unmapped(raw.replace(/^\[|\]$/g, ""));
  const family = isIP(address);
  if (family === 0) return false;
  return !blocked.check(address, family === 6 ? "ipv6" : "ipv4");
}

/**
 * A DNS lookup for `http(s).request` that refuses names resolving anywhere
 * non-public. The socket connects to exactly the addresses this returns, so
 * the check and the connection use the same answer: a name that re-resolves
 * to a private address between a check and a later fetch gains nothing.
 */
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 0);
    const refused = addresses.find((entry) => !isPublicAddress(entry.address));
    if (refused || addresses.length === 0) {
      const failure = Object.assign(new Error(`${hostname} resolves to a private or reserved address`), { code: "EPRIVATEADDRESS" });
      return callback(failure, "", 0);
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
};
