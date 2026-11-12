// minimal ABI encoder for the primitive types used here
const T = {
  uint256: (v) => pad(BigInt(v)),
  int256: (v) => twos(BigInt(v)),
  uint160: (v) => pad(BigInt(v)),
  uint128: (v) => pad(BigInt(v)),
  uint24: (v) => pad(BigInt(v)),
  int24: (v) => twos(BigInt(v), 256),
  bool: (v) => pad(v ? 1n : 0n),
};
function pad(v) { return v.toString(16).padStart(64, '0'); }
function twos(v) { let x = v < 0 ? (1n << 256n) + v : v; return x.toString(16).padStart(64, '0'); }
export function encodeAbiParameters(types, values) {
  return types.map((t, i) => T[t](values[i])).join('');
}
export function dec(hex, types) {
  const out = [];
  let s = hex.replace(/^0x/, '');
  for (let i = 0; i < types.length; i++) {
    const word = BigInt('0x' + s.slice(i * 64, (i + 1) * 64));
    out.push(types[i] === 'int24'||types[i]==='int256' ? signed(word) : word);
  }
  return out;
}
export function signed(w) { const M = 1n << 255n; return w >= M ? w - (1n << 256n) : w; }
