/** `TRUST_PROXY` is a comma-separated list of addresses, CIDR ranges or keywords (`loopback`, `uniquelocal`). */
export function trustProxyAddresses(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
