import { ConformancePanel } from '../components/ConformancePanel.js';
import { SessionsPanel } from '../components/SessionsPanel.js';
import { WalletPanel } from '../components/WalletPanel.js';

/** The working console: wallet, chain and the on-chain panels. */
export function ConsolePage({ onWallet }: { onWallet: () => void }) {
  return (
    <main className="console">
      <header className="console__head">
        <span className="eyebrow">
          <span className="eyebrow__dot" aria-hidden="true" />
          Live on BSC · Base · Ethereum
        </span>
        <h1>Console</h1>
        <p className="console__lede">
          Connect a wallet to read the sessions installed for it on <code>KeelPolicyHook</code> and run the
          ERC-7579 conformance suite against the deployed hook.
        </p>
      </header>

      <WalletPanel onWallet={onWallet} />

      <div className="grid">
        <SessionsPanel />
        <ConformancePanel />
      </div>
    </main>
  );
}
