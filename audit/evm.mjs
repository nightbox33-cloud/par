import { VM } from '@ethereumjs/vm';
import { Address, hexToBytes, bytesToHex, utf8ToBytes } from '@ethereumjs/util';
import { keccak256 } from 'ethereum-cryptography/keccak.js';
import { Common, Hardfork, Chain } from '@ethereumjs/common';
import { encodeAbiParameters } from './abi.mjs';

import { Account } from '@ethereumjs/util';
export async function makeVM() {
  const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Cancun });
  const vm = await VM.create({ common });
  return vm;
}
async function fund(vm, addr) {
  const acct = await vm.stateManager.getAccount(addr);
  if (acct) { acct.balance = 10n ** 24n; await vm.stateManager.putAccount(addr, acct); }
  else await vm.stateManager.putAccount(addr, new Account(0n, 10n ** 24n));
}
export async function deploy(vm, { abi, bytecode }) {
  const caller = new Address(hexToBytes('0x' + '11'.repeat(20)));
  await fund(vm, caller);
  const r = await vm.evm.runCall({ caller, origin: caller, data: hexToBytes(bytecode), gasLimit: 30000000n, gasPrice: 0n });
  if (r.execResult.exceptionError) throw new Error('deploy failed ' + JSON.stringify(r.execResult.exceptionError));
  return { address: r.createdAddress, abi };
}
function sig(fn) { return `${fn.name}(${fn.inputs.map((i) => i.type).join(',')})`; }
export async function call(vm, contract, name, args) {
  const fn = contract.abi.find((e) => e.type === 'function' && e.name === name);
  const selector = bytesToHex(keccak256(utf8ToBytes(sig(fn)))).slice(2, 10);
  const data = hexToBytes('0x' + selector + encodeAbiParameters(fn.inputs.map((i) => i.type), args));
  const caller = new Address(hexToBytes('0x' + '22'.repeat(20)));
  await fund(vm, caller);
  const r = await vm.evm.runCall({ caller, to: contract.address, data, gasLimit: 30000000n, gasPrice: 0n });
  if (r.execResult.exceptionError) throw new Error('call ' + name + ' reverted ' + JSON.stringify(r.execResult.exceptionError));
  return r.execResult.returnValue;
}
