import { makeVM, deploy, call } from './evm.mjs';
import { dec } from './abi.mjs';
import { readFileSync } from 'node:fs';
const art = JSON.parse(readFileSync('./harness.json', 'utf8'));
const vm = await makeVM();
const h = await deploy(vm, art);
const R = (b, t) => dec('0x' + Buffer.from(b).toString('hex'), t);
let bad = 0, cases = 0, worst = 0n;
const rnd = (n) => BigInt(Math.floor(Math.random() * n));
for (let i = 0; i < 400; i++) {
  const tokenIs0 = i % 2 === 0;
  const spacing = BigInt([1, 10, 60, 200][i % 4]);
  const supply = 10n ** 27n;
  // phantom between 1e-6 and 1e6 tokens' worth, incl. 6-decimal quote scales
  const phantom = (10n ** (6n + rnd(19))) / 1n + 1n;
  let plan;
  try { plan = R(await call(vm, h, 'plan', [tokenIs0, supply, phantom, spacing]), ['uint160','int24','int24','uint128']); }
  catch (e) { continue; }
  const [sqrt, tl, tu, L] = plan;
  if (L === 0n) { console.log('ZERO L', tokenIs0, phantom); bad++; continue; }
  const needed = R(await call(vm, h, 'tokenAmount', [tokenIs0, supply, phantom, spacing]), ['uint256'])[0];
  if (needed > supply) { console.log('OVER SUPPLY', needed, supply); bad++; }
  cases++;
  // round trip: buy then sell everything back, must never profit
  const fee = BigInt(10000);
  for (const amtIn of [phantom / 100n, phantom / 10n, phantom]) {
    if (amtIn === 0n) continue;
    const buyZeroForOne = !tokenIs0;
    const [s2,, out] = R(await call(vm, h, 'swapExactIn', [sqrt, tl, tu, L, fee, buyZeroForOne, amtIn]), ['uint160','int24','uint256','uint256']);
    const [,, back] = R(await call(vm, h, 'swapExactIn', [s2, tl, tu, L, fee, !buyZeroForOne, out]), ['uint160','int24','uint256','uint256']);
    if (back > amtIn) { console.log('PROFIT!', tokenIs0, phantom, amtIn, back); bad++; }
    if (amtIn - back > worst) worst = amtIn - back;
  }
}
console.log(`cases=${cases} problems=${bad} worstRoundTripLoss(after 1%+1% fees)=${worst}`);
