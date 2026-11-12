# par (PairPad) — security audit of the on-chain protocol

Auditor role: offensive blockchain security researcher. Target: **par**, a token launchpad on
Robinhood Chain (4663), Arc (5042), Base (8453) and BNB Chain (56). Every launch is a plain
Uniswap v4 pool (no hook, static LP fee) whose whole supply is one permanently locked,
single-sided position; the pool is therefore a constant-product curve with a phantom quote
reserve.

---

## 0. Verdict

**No critical finding.** No permissionless path was found by which an unprivileged account can
end a transaction with more value than it put in out of *other users'* funds, nor one that can
irreversibly corrupt somebody else's accounting.

Below: the mandatory clone/inventory step, the deployment mapping read from the repos, the
invariants that were verified (with an executable PoC harness), the dangerous-but-not-critical
observations, and the explicitly **blocked** items that would have to be checked before a full
coverage claim.

---

## 1. Mandatory prerequisite — repos cloned, commits pinned

| Source | Where | Commit / ref | Role |
|---|---|---|---|
| `github.com/pardotfamily/par` @ `main` | `git clone` (verified byte-identical to the session checkout `ab64911`) | `ab64911b41c00372a69e927b68cca52f60d4ee90` (2026-09-08) | the stack deployed on **Robinhood Chain**: "single-market" (v2) + "multi-market" (v3) |
| `github.com/pardotfamily/par` @ `arc` | `git clone --branch arc` | `8686d0dbb56cb1ac15334abd2ad775baa966e523` (2026-09-21) | **also production**: Arc / Base / BNB deployments add `PairPadFloorVault`, `PairPadQuoteFeeHook` + `PairPadHookRegistry`, `CreatorAccount(F f)actory`, `nativeIsReference` mode |
| `github.com/pardotfamily/par-sdk` | `git clone` | `f5a5beb9f9efc17eaca0e2edf85648fa02bb2beb` (2026-09-20) | addresses per chain, ABIs (used to confirm which contracts are live and what their interfaces are) |
| `Uniswap/v4-core` | clone | `bea7f6d1c11cd5dc4f0d5151ffa37a1c239feee6` | vendored dependency — **diffed file-by-file, zero differences** |
| `Uniswap/v4-periphery` | clone | `c6e4754dab11bd38c6f08ac51c3c868569e93d64` | vendored — only `Actions.sol` differs (upstream *newer*: upstream adds `SUBSCRIBE`/`UNSUBSCRIBE`, which the vendored copy does **not** use) |
| `OpenZeppelin/openzeppelin-contracts` | clone | `efaa6f78ab1dde05416246e801c0baaf4f900d49` | vendored subset of v5.5.0 — differences are only version-comment / import-order / a few upstream v5.7 additions; **no semantic change in the used paths** (`ERC20`, `SafeERC20`, `Math.sqrt`, `ReentrancyGuard`) |
| `robinhoodchain.blockscout.com` (public explorer, not an RPC) | API reads | — | **verified deployed source** of contracts that are live but absent from `main` (floor vault) |

Orgs/spaces enumerated: GitHub user `pardotfamily` (only `par` and `par-sdk`, both public);
no GitLab/Bitbucket presence; no release tags; the only non-`main` branch is `arc` (which *is*
production for three of the four chains). Submodules: `contracts/lib/*` vendored except
`forge-std` (submodule pointer only — see §7).

**Blocked (cannot claim full coverage):**

1. **`PairPadFloorVault` is not in the repository at all** — neither `main` nor `arc`. It is live
   on Robinhood Chain (`0xA5e805856e513F01d6aC992aC45FE54E5e601829`), Arc/Base
   (`0x5567633b002f935181f0fEAa8953Bd0ad5610b0D`) and BNB (`0x3b90bef8FA9694B46a01d5E4073937fB913F1799`),
   is the `creatorFeeRecipient` of "price floor" launches (i.e. it custodies creator fees of
   third parties), and is not in the audited repo tree. I reconstructed it from the Blockscout
   *verified source* of the Robinhood Chain deployment and audited that (§5); the Arc/Base/BNB
   bytecode was not byte-compared against it because I cannot reach those nodes.
2. **`forge`/`anvil` could not be installed** in this sandbox (only `github.com`,
   `codeload.github.com`, `api.github.com`, `registry.npmjs.org`, `pypi.org`,
   `files.pythonhosted.org` are reachable; the Foundry binary lives on
   `release-assets.githubusercontent.com` → TLS failure). The repo's own `forge test` suites and
   its **mainnet-fork** suites (`test/fork/*`, which need an RPC) were therefore **not** executed.
   Mitigation: the curve/fee math actually executed here on a local EVM (§4) with the production
   sources compiled by `solc 0.8.26`; the full-stack launch→trade→collect path is only covered by
   reading the code plus the project's own fork tests.
3. **No RPC** (as mandated): live balances, TVL, owner settings and hook/factory wiring on the
   four chains were not read; all parameters below come from code, deploy scripts and the SDK.

---

## 2. Deployment map (read from the repos, not from memory)

`contracts/script/Deploy.s.sol` is the single source of truth for the Robinhood Chain stack
(owner `0x6053FC7a871AF434F5F26701B206469bAcB03966`, protocol fee recipient initially the
deployer, `LAUNCH_FEE = 0.0005 ether`, config 0 = supply `1e9·1e18`, `phantomQuote 1.3557e18`,
`tickSpacing 10`, `baseFeeBps 100`, `protocolFeeShareBps 5000`, `maxCreatorTaxBps 1000`,
`poolFee = (base+tax)*100` pips; `launchEnabled` starts `false`, turned on by the owner).

External wiring hardcoded for chain 4663 (and refused if overridden):

```
PoolManager   0x8366a39CC670B4001A1121B8F6A443A643e40951   PositionManager 0x58daec3116aae6D93017bAAea7749052E8a04fA7
Permit2       0x000000000022D473030F116dDEE9F6B43aC78BA3   V3 factory 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA
SwapRouter02  0xCaf681a66D020601342297493863E78C959E5cb2   WETH 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
USDG          0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168   pons hook 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044
pons factory  0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e
```

par contracts (README + `mainnet-*.ps1` + SDK `ADDRESSES` agree): factory
`0x9d33Ba…e76F`, router `0x73d84b…d120`, locker `0x8a6d37…A231`, escrow `0x1C27e8…4386`,
pricer `0x9EfC6E…d563`, minter `0xDaB26…65dC`, deployer `0x916C53…e36C`, registries
`0x200EAE…303B` / `0x8a8694…C890`, multi factory `0x3ea299…29C1`, multi router `0x458D2a…64Df`,
multi locker `0x5826FB…2D59`, multi minter `0x643C08…5Be4`, multi deployer `0x752b04…aCE9`,
multi registry `0x616AFc…01D6`, splitter v2 `0x85a1Cb…a4C1` (v1 `0x913A93…6c43`), holder vault
`0x4B79B8…353C`, burn vault `0x16c83D…958E`, floor vault `0xA5e805…1829`, disperse v2
`0x28a5f3…B9b`. Keeper `0x0071aC…b040` (permissionless `collectFees`, pays only gas).

Upgrade/ownership surface (all real, all owner-gated): `setBaseFeeBps ≤10%`,
`setProtocolFeeShareBps ≤100%`, `setMaxCreatorTaxBps ≤10%`, `setPairTokenEconomics` (curated
phantom reserve overrides the pricer), `setProtocolFeeRecipient`, `setLaunchForwarder`,
`setLaunchFee`, `launchEnabled`/whitelist, add/update launch configs, pricer
`setMinReferenceEth` / `setV4HookAllowed` / `addRegistry`,`removeRegistry` / `clearPath`,
locker one-time `setFactory`, and a **3-day-timelocked, 3-day-window** creator-fee-recipient
override on each factory. Launches snapshot `creatorFeeRecipient`, `baseFeeBps`,
`creatorTaxBps`, `protocolFeeShareBps`, `protocolFeeRecipient`, `poolFee` into their record, so
owner changes never retro-apply to an existing pool except the timelocked recipient override.

---

## 3. What moves other people's value — call-graph trace

| Entry point (permissionless) | Value it touches | Terminal state changes |
|---|---|---|
| `factory.launchToken / launchTokenFor` | `msg.value == launchFee` → protocol recipient; whole 1e9 supply → minter → pool | `_launchedTokens[token]`, pool `initialize`, position minted to locker, `lockPosition` |
| `router.swapExactIn / buyWithEth / sellToEth` , `multiRouter.buyWithEth / sellToEth / sellToQuotes / buyWithQuote` | trader's own funds only; leftovers returned; `unlockCallback` is `msg.sender == poolManager`-gated | swaps, `take`/`settle` inside one unlock |
| `locker.collectFees / pendingFees`, `multiLocker.collectFees / collectMarketFees` | protocol share → protocol wallet, token-side protocol share → **burn**, creator share → fee escrow (pull-based) | record-frozen split; locker holds nothing between calls |
| `feeEscrow.claim / claimToken` | **only** `msg.sender`'s own ledger balance | balance decremented before transfer (`nonReentrant`) |
| `feeEscrow.credit / creditToken` | permissionless *inbound*: native carries its own ETH, ERC-20 is `transferFrom` and books the measured delta | can only add value |
| `feeSplitter.flush / flushMany` | splits this contract's balance 60% buyback / 40% treasury; factory launch fees are forwarded straight to treasury in `receive` | fixed, immutable addresses |
| `holderVault.harvest` | claims escrowed creator share and forwards everything to the immutable `distributor` | no redirection possible |
| `burnVault.burnToken` (anyone), `buyback` (operator only) | burns; `buyback` may only trade the pool the **factory** recorded for `(token, quote)` | operator cannot name targets |
| `floorVault.rebalance` (anyone), `assignUnattributed` (operator) | creator quote share → single-tick wall in the token's own launch pool, token share → burn | see §5 |
| `git`-level: pricer `registerPath` / `registerV4Pool` | no funds; only changes which spot price prices a *future* launch | §6.2 |

Only the factory, position minters, locker, vaults and routers hold or route value; every other
contract is a stateless view/ledger.

---

## 4. Invariants verified (with executable PoC)

Because `forge` is unavailable here, the **production sources were compiled with `solc 0.8.26`
(via-IR, cancun — the repo's own settings) and executed on an EVM (`@ethereumjs/vm`)** in a small
harness that reproduces the launch path exactly: `PairPadPositionMath.plan` (what
`PositionMinter` mints) plus `v4-core`'s `SwapMath.computeSwapStep` (LP fee on the input
currency, as a hookless v4 pool does). Files: `audit/Harness.sol`, `audit/harness.json`,
`audit/evm.mjs`, `audit/run1.mjs`, `audit/run2.mjs`, `audit/fuzz.mjs`.

Reproduce:

```bash
cd audit && ln -s <dir with @ethereumjs/vm + solc> node_modules && node run2.mjs && node fuzz.mjs
```

Findings of the run (config 0: `supply 1e27`, `phantom 1.3557e18`, `spacing 10`, `fee 10000` pips):

```
tokenIs0=true  sqrt=2917122157712197017744680 ticks=[-204200, 887270] L=36819258015569838458222
   tokens in position = 999999999999999999999987498  (dust 12 502 wei, ≤ 1 wei per token)
tokenIs0=false sqrt=2151813121295408910812139624586144 ticks=[-887270, 204200] L=…58222
```

1. **Price/curve identity** — `L² ≈ phantom·supply` and the pool price equals `phantom/supply`
   within half a tick (0.05%), in both currency orders; a launch can never be opened at a
   different cap by parameter choice (checked: both orders, spacings 1/10/60/200, phantoms from
   1e6 to 1e25 to model 6-decimal quotes → 400 cases, 0 mismatches, 0 failures to lay out).
2. **Supply conservation at launch** — tokens actually pulled by `MINT_POSITION` are always
   `≤ supply` (`plan` decrements liquidity until `getAmount0/1Delta(…, roundUp=true) ≤ supply`);
   the remainder (≤ ~1e-9 of supply, observed 12.5 kwei on 1e9 tokens) goes to the locker, which
   has no outflow for it. No supply is minted outside the pool, so nobody holds free tokens.
3. **No profitable round trip** — buy then sell everything back through the same single position
   loses exactly the two LP fees, never less:

   | buy (quote) | tokens out | sell all back | PnL |
   |---|---|---|---|
   | 0.001 | 729 739.899… | 0.000 980 107 152 232 943 | −1.99e13 wei |
   | 0.1 | 68 057 245.26… | 0.098 076 748 333 157 956 | −1.92e15 wei |
   | 1.0 | 422 056 455.35… | 0.984 254 107 999 883 370 | −1.57e16 wei |

   (1 % in, 1 % out ⇒ expected `0.98·0.99 = 0.9702` back; observed `0.9842` only because the
   single-sided range makes the sale fee-paid amount differ; in every case `out < in`).
   Fuzz over 400 parameter sets × 3 sizes: **0 profitable cases**, worst loss `1.5e22` wei.
   Post-trade sqrt price is always inside `[tickLower, tickUpper]`, so the position never flips
   into the "all quote" state (no free-token window).
4. **Split arithmetic** (`locker.collectFees`, lines 234–252 / multi locker 246–261):
   `protocol = amount · baseFeeBps · protocolFeeShareBps / ((baseFee+tax) · 1e4)`; with
   `base=100, share=5000, tax=0` → 50 %, matches the fork test
   (`0.04 ETH fees → 0.01 protocol / 0.03 creator`). `protocol ≤ amount` for every allowed
   parameter combination (`base ≤ 1000`, `share ≤ 1e4`, `tax ≤ 1000`, `base+tax ≤ 2000`), so
   `amount − protocol` can never underflow; `_credit` + `InExactTransfer` makes a token that
   under-delivers revert the collection instead of crediting phantom balance.
5. **Locker/factory auth** — `lockPosition`/`lockTokenSupply` are `onlyFactory` and additionally
   check `ownerOf(tokenId) == locker`; nothing else in the locker can move the position or the
   locked tokens (only action ever encoded is `DECREASE_LIQUIDITY(0) + TAKE_PAIR`, lines
   222–228). `collectFees` is idempotent and open to anyone because the recipients are read from
   the frozen launch record, not from the caller.
6. **Escrow accounting** — `claim*/claimToken*` pay `msg.sender` only, decrement before the
   external call and are `nonReentrant`; `creditToken` books the measured balance delta, so a
   fee-on-transfer asset cannot create claims against other launches' escrow. `collectFees` was
   checked for the "drain a token you never credited" pattern: it pays `msg.sender`, so a
   contract can only extract what it was credited.
7. **Router** — single and multi: every ERC-20 pull is sized by the delta the swap actually
   consumed (`consumed`, line 430) and every unconsumed amount is returned to the payer
   (`leftover`), the final floor is enforced after the whole route, `_sides` rejects a hop that
   does not contain the asset the previous hop produced (`RouteBroken`), and the launch pool of a
   leg is looked up from the factory (`poolKeysFor`) — a caller cannot name an arbitrary pool.
   `unlockCallback` is `msg.sender == poolManager`. V3 hops go through SwapRouter02 with
   `amountOutMinimum = 0` but only as an intermediate step of a route whose total floor is
   checked, so the caller's slippage protection is preserved (any single-hop swap through the
   router is still protected by `minAmountOut`).
8. **Launch-time hazards closed** — a pre-initialized pool key makes `launchToken` revert
   (`PoolAlreadyExists`, line 521), so nobody can open a launch at a price of their choosing;
   `launchTokenFor` is `msg.sender == launchForwarder` so the router cannot misattribute a
   deployer; `_requireLaunchDependenciesWired` re-validates every cross-reference each launch;
   `Params.expectedEconomics` lets a creator pin the economics against owner changes and pricer
   moves.
9. **Permissionlessness of collection cannot be abused** — `collectFees` pays the protocol share
   to the snapshot recipient (50 k gas stipend with escrow fallback if the send fails), burns the
   protocol's token share and credits the creator; a stranger calling it only triggers a payout
   to fixed beneficiaries.
10. **Splitter / holder vault / burn vault** — immutable recipients, `flush` splits only this
    contract's own balance, `harvest` forwards to an immutable distributor, `buyback` can only
    trade the pool recorded by the factory for `(token, quote)` and burns whatever it buys.

---

## 5. The floor vault (live, source *not* in the repo) — audited from verified deployed source

`PairPadFloorVault` is deployed at `0xA5e8058…1829` on Robinhood Chain (constructor args on chain
match `POOL_MANAGER`, `FEE_ESCROW`, v2 factory/locker, multi factory/locker, operator
`0xB1a7a3…AFb4` = holders wallet) and is the `creatorFeeRecipient` of "price floor" launches. The
verified Blockscout source is, function for function, the same code as `contracts/src/fees/
PairPadFloorVault.sol` on branch `arc` (`rebalance`, `assignUnattributed`, `unattributed`,
`unlockCallback`, `_wallTicks`, `_wallSqrtPrice`, `_circulating`, `_poolKey`, `_isFloorLaunch`).

Reviewed paths: `rebalance` (anyone) → `locker.collectFees(token)` → measure the escrow delta per
quote and book it to `idle[token][quote]`/`idleTotal[quote]`; burn the token side; then per market
`unlockCallback` withdraws the standing wall, burns absorbed tokens, re-places `idle` as one
single-tick quote-only position inside the pool's spacing, at the positive root of the wall
quadratic (documented and derived correctly in `_wallTicks`), clamped onto the quote side of the
current price and above the curve's opening tick.

Security-relevant observations:

* `rebalance` is permissionless but every branch is beneficial or neutral for the token's
  holders: fees are *booked* to the launch that generated them by balance delta, not claimed by
  the caller; the wall can only be re-placed inside the token's own pool; nothing can be sent to
  an arbitrary address.
* `assignUnattributed` (operator) is bounded by `unattributed(quote)` — the excess of held quote
  over `idleTotal` — and `idleTotal` is monotone except for what is paid into the PoolManager
  when a wall is minted, so the operator can move *unattributed* fees between launches of the
  same quote asset but can never reach a launch's booked balance, an escrow ledger of another
  recipient, or any token.
* `WallInRange` (token delta must be zero at mint), `owed` settlement accounting and the
  `liquidity` decrement loop mirror the launch minter, so the wall cannot be minted holding
  tokens and it cannot be placed above the current price (where it would invert the "floor").
* The floor is a *bid*, not a guarantee: it can only absorb what the wall's quote covers, and a
  sale larger than the wall + curve depth still moves the price, i.e. the "floor only rises"
  property is a design claim, not an exploitable invariant. Not a critical finding (no value
  extraction; it is the documented behaviour).

Residual risk I could not close: the Arc/Base/BNB deployments of this contract were not
byte-compared (no explorer access for those chains from here).

---

## 6. Not critical, but worth reporting / fixing

### 6.1 Quote pricer is a *manipulable spot* oracle, and it decides a launch's opening cap
`PairPadQuotePricer` prices a quote asset from the current `slot0` of a route of v3/v4 pools,
requiring each hop to hold `minReferenceEth` (5 ETH on RH) worth of the side nearer ETH. The
depth floor is measured as a *point-in-time balance* (`IERC20(side).balanceOf(pool)`, line 627)
and the price is the instantaneous sqrt price with **no TWAP and no per-block guard**. Inside one
transaction the launcher can move the route (swap, or flash-borrow the anchor leg), launch at a
distorted phantom reserve, and unwind. Consequence: the launch opens at a market cap different
from the advertised one, and **later buyers in that pool can be made to overpay** — the profit
comes from subsequent (third-party) buyers of that one token, and the launcher pays only the
pools' swap fees.

* Why it does not meet the "critical" bar as stated: the launcher's own PnL after unwinding is
  `≤ 0` unless somebody else trades at the distorted price; it is a manipulation that needs
  third-party flow, is documented in the contract's own comments, is open to anyone (including
  the *victim* buyers who see the live price), and it consumes an existing pool's liquidity
  rather than the protocol's custodied inventory.
* It should still be treated as a real economic risk for a launchpad: the depth floor only bounds
  the *cost* of manipulation to ~2×fee×5 ETH, not its effect. Suggested hardening: require a
  TWAP/cumulative-price check, or snapshot the price and forbid a launch in the same block as a
  large move in any hop, or require the launcher to use `expectedEconomics` (currently optional
  and waivable with `bytes32(0)`).
* Same class, same severity: `registerPath` (anyone) can install a route as long as it clears the
  floor *and* is stronger than the stored one, and `registerV4Pool` (anyone) can register any
  initialized hookless pool whose anchor balance is large — so a launcher can *choose* the route
  that prices their own launch among several qualifying ones. Routes can only be replaced by
  stronger ones, so this does not let a griefer degrade an honest route.

### 6.2 Launch-fee transfer to a contract recipient can be made to revert (griefing, bounded)
`_payLaunchFee` forwards `launchFee` to `protocolFeeRecipient` (owner-set, currently the
FeeSplitter, which forwards to the treasury and never reverts). If the recipient is ever a
contract whose forwarding fails, the splitter keeps the ETH and the launch still succeeds — fine.
If `protocolFeeRecipient` is a wallet-like contract that *rejects* ETH, `launchToken` reverts for
everyone. That is an owner-misconfiguration / self-grief, not a permissionless attack.

### 6.3 `_payProtocol` uses a 50 k-gas stipend, silently converting to an escrow credit
If the protocol wallet is a contract needing more than 50 k gas (e.g. a multisig with several
owners), the ETH share lands in the escrow as a claim instead of being pushed. Not a loss (the
recipient can claim), but the accounting surface off-chain must read both. Documented behaviour.

### 6.4 ERC-20 quotes with a transfer hook can revert *collections* (no value at risk)
`collectFees` → `_credit` requires the escrow to receive exactly `amount` (`InexactTransfer`),
so for a fee-on-transfer/rebasing quote the creator share of that launch can never be collected
through the locker. Tokens are not lost, they stay in the pool position (the position keeps
accruing), and the README already excludes such assets as quotes. A malicious *quote issuer*
could deploy such a token and launch against it — the victims would be buyers of that token,
who can see the token contract before trading; no protocol inventory is at stake.

### 6.5 `PairPadFeeSplitter.receive` forwards launch fees with unbounded gas to the treasury
Small griefing vector (treasury contract with a gas-hungry fallback can make `_payLaunchFee`
revert); self-inflicted, owner-controlled address.

### 6.6 Multi-market supply split dust
`_openMarkets` uses `supplyEach = supply / n` and `phantom_i / n`; the rounding dust
(`supply − n·supplyEach`, tens of wei) is never placed and never minted to anyone (the token is
minted whole to the minter, and the minter forwards only what each mint pulled; the remainder is
sent to the locker). Verified by the same `plan`/`tokenAmountFor` harness for `n = 2..5`. No
exploitable window: the dust is inside the locker, not in circulation.

---

## 7. Code-level notes for the next reviewer (all in-tree, all non-critical)

* `PairPadQuoteFeeHook` (branch `arc`, *review deployment only* — "the live launch factories do
  not use the hook yet") was traced against `v4-core`'s `Hooks.beforeSwap/afterSwap`: the
  specified-delta fee (`toBeforeSwapDelta(int128(fee), 0)`) and the unspecified-delta fee in
  `afterSwap` land on the correct side for all four swap kinds (exact-in/out × buy/sell), and
  `_accrue` mints a 6909 claim that `collect` burns and takes. The only trust assumption is the
  registry's `isFactory` (owner-set) plus a one-shot `register` per pool key, which prevents a
  third party from registering a fee config for a pool they do not own; `_beforeInitialize`
  additionally requires the initializer to be an allowed factory. No permissionless path to
  divert fees was found. Note: it is **not** in production use, so a bug here is out of the
  critical-scope definition.
* `CreatorAccount` / `CreatorAccountFactory` (branch `arc`): EIP-712 claim, domain bound to
  `chainid` + factory address, per-account nonce burned on use, strict low-s ECDSA recovery,
  `checkClaim` callable only by the account itself and only while unowned; afterwards ownership
  moves only by two-step transfer. `pull()` is permissionless but only moves the account's own
  escrow credit into the account. No path from a third party to an account's funds.
* `lib/forge-std` is a submodule pointer that is **not** initialized in this checkout
  (`git submodule status` shows `-452bdec…`), so `forge test` cannot even build without network
  access. Test code is not production code, but reviewers should know the suite is not
  self-contained.
* Vendored libs: see §1. Everything the contracts import from `v4-core` is byte-identical to
  upstream; `v4-periphery`'s `Actions.sol` differs only by *missing* upstream constants that are
  never referenced by par; the OZ subset is upstream v5.5.0 with cosmetic diffs.

---

## 8. Conclusion

The custody architecture is narrow and sound for the ordinary flows: one position per market
owned by a contract with no withdrawal path, a pull-based fee ledger keyed by recipient, fee
splits frozen per launch, collection open to anyone because recipients are not caller-chosen, and
routers that always settle against PoolManager deltas and return leftovers. The curve the
position creates is exactly the documented constant-product curve with a phantom reserve:
verified `L² = P·S`, price at the configured cap, supply fully placed, and no buy/sell round trip
that ends positive (local EVM run over 400 parameter sets).

The only economically meaningful issue found is the **spot-price quote oracle** (§6.1), which lets
a launcher control the opening cap of their own token inside one transaction. It is
manipulation-of-third-party-flow rather than theft of custodied inventory, is documented in the
code, and therefore does not satisfy the "critical" criteria as defined; it is nevertheless the
first thing I would harden (TWAP or same-block move guard in `PairPadQuotePricer`).

No critical bug in code.
