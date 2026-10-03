import { useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'

export function WalletButton() {
  const { connected, connecting, disconnect, publicKey, wallet } = useWallet()
  const { setVisible } = useWalletModal()
  const [message, setMessage] = useState('')
  const address = publicKey?.toBase58()

  useEffect(() => {
    const adapter = wallet?.adapter
    if (!adapter) return
    const showError = () => setMessage('Phantom could not connect. Check the wallet and try again.')
    adapter.on('error', showError)
    return () => {
      adapter.off('error', showError)
    }
  }, [wallet])

  async function handleClick() {
    setMessage('')
    try {
      if (connected) await disconnect()
      else if (wallet) await wallet.adapter.connect()
      else setVisible(true)
    } catch {
      setMessage('Wallet connection failed. Check Phantom and try again.')
    }
  }

  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={connecting}
        aria-label={connected ? `Disconnect wallet ${address ?? ''}` : 'Connect Phantom wallet'}
        className="flex items-center gap-2 border border-outline-variant bg-transparent px-3 py-2 font-mono text-utility-sm text-secondary-fixed transition-colors hover:bg-surface-container disabled:cursor-wait disabled:opacity-60 sm:px-4"
      >
        <span>{connecting ? 'Connecting…' : connected && address ? `${address.slice(0, 4)}…${address.slice(-4)}` : 'Connect Wallet'}</span>
        <span className="material-symbols-outlined text-base" aria-hidden="true">account_balance_wallet</span>
      </button>
      {message && <span role="status" className="mt-1 max-w-48 text-right font-body text-xs text-error">{message}</span>}
    </div>
  )
}
