import { makeVM, deploy, call } from './evm.mjs';
import { dec } from './abi.mjs';
import { readFileSync } from 'node:fs';

const art = JSON.parse(readFileSync('./harness.json', 'utf8'));
const vm = await makeVM();
const h = await deploy(vm, art);
const R = (buf, types) => dec('0x' + Buffer.from(buf).toString('hex'), types);

const SUPPLY = 10n ** 27n;           // 1e9 * 1e18 (config 0)
const PHANTOM = 1355700000000000000n; // 1.3557 ETH
const SPACING = 10n;
const FEE = 10000n; // 1% in pips

for (const tokenIs0 of [true, false]) {
  const [sqrt, tl, tu, L] = R(await call(vm, h, 'plan', [tokenIs0, SUPPLY, PHANTOM, SPACING]), ['uint160','int24','int24','uint128']);
  const needed = R(await call(vm, h, 'tokenAmount', [tokenIs0, SUPPLY, PHANTOM, SPACING]), ['uint256'])[0];
  console.log(`tokenIs0=${tokenIs0} sqrt=${sqrt} ticks=[${tl},${tu}] L=${L} tokensInPosition=${needed} dust=${SUPPLY-needed}`);
  let cur = sqrt, tick = tl;
  for (const buy of [1n*10n**17n, 10n**18n, 10n**19n]) {
    const [s2, t2, out, fee] = R(await call(vm, h, 'swapExactIn', [cur, tl, tu, L, FEE, tokenIs0, buy]), ['uint160','int24','uint256','uint256']);
    // round trip: sell exactly `out` back
    const [s3, t3, back, fee2] = R(await call(vm, h, 'swapExactIn', [s2, tl, tu, L, FEE, !tokenIs0, out]), ['uint160','int24','uint256','uint256']);
    console.log(`   buy ${buy} -> ${out} tokens (postTick ${t2}), sell back -> ${back} quote  pnl=${back - buy}  sqrtBack-${s3===cur?'same':'diff'}`);
    cur = s3; tick = t3;
  }
}
