import { makeVM, deploy, call } from './evm.mjs';
import { dec } from './abi.mjs';
import { readFileSync } from 'node:fs';
const art = JSON.parse(readFileSync('./harness.json', 'utf8'));
const vm = await makeVM();
const h = await deploy(vm, art);
const R = (buf, t) => dec('0x' + Buffer.from(buf).toString('hex'), t);
const SUPPLY = 10n ** 27n, PHANTOM = 1355700000000000000n, SPACING = 10n, FEE = 10000n;

for (const tokenIs0 of [true, false]) {
  const [sqrt, tl, tu, L] = R(await call(vm, h, 'plan', [tokenIs0, SUPPLY, PHANTOM, SPACING]), ['uint160','int24','int24','uint128']);
  console.log(`tokenIs0=${tokenIs0} startSqrt=${sqrt} ticks=[${tl},${tu}] L=${L}`);
  // buying the launch token: the quote is currency1 when tokenIs0, currency0 otherwise
  const buyZeroForOne = !tokenIs0;   // quote in
  let cur = sqrt;
  for (const buy of [10n**15n, 10n**17n, 10n**18n]) {
    const [s2,t2,out,fee] = R(await call(vm,h,'swapExactIn',[cur,tl,tu,L,FEE,buyZeroForOne,buy]),['uint160','int24','uint256','uint256']);
    const [s3,t3,back,fee2] = R(await call(vm,h,'swapExactIn',[s2,tl,tu,L,FEE,!buyZeroForOne,out]),['uint160','int24','uint256','uint256']);
    console.log(`  buy ${buy} -> ${out} tokens (tick ${t2}, fee ${fee}); sell all back -> ${back} (tick ${t3}); pnl ${back-buy}`);
  }
}
