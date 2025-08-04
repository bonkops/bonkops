# BonkOps Dashboard 🚀

A professional multi-wallet trading dashboard for pump.fun tokens with automated trading capabilities.

## Features ✨

- **Multi-Wallet Management** - Manage unlimited trading wallets from one interface
- **Live Position Tracking** - Real-time token balances and P&L monitoring
- **Instant Wallet Creation** - Create new wallets with one click via PumpPortal
- **Auto-Buy Sequences** - Automated buying when dev wallet creates tokens
- **Auto-Sell Triggers** - Set profit targets, time limits, or follow dev sells
- **Token Monitoring** - Track any pump.fun token with live trade flow
- **Export/Import** - Backup and restore your wallet configurations

## Quick Start 🏃‍♂️

### 1. Access the Dashboard
Simply open `index.html` in your web browser. No installation required.

### 2. Create Your First Wallet
1. Click **"Wallet Manager"** button
2. Click **"Create New Dev Wallet"** to instantly create a dev wallet
3. Click **"Create New Wallet"** to add trading wallets (auto-named Wallet 1, 2, 3...)

That's it! Your wallets are ready to trade.

## How to Use 📖

### Setting Up Wallets

#### Option 1: Instant Creation (Recommended)
- **Dev Wallet**: Click "Create New Dev Wallet" - instantly ready
- **Trading Wallets**: Click "Create New Wallet" - adds Wallet 1, 2, 3, etc.

#### Option 2: Import Existing Wallets
1. Click "Wallet Manager"
2. Click "+ Add Existing Wallet"
3. Enter your wallet details:
   - Wallet address
   - Private key
   - PumpPortal API key
   - Custom name

### Trading Operations

#### Manual Trading
1. Track a token by pasting its contract address in the token input field
2. Each wallet shows buy/sell buttons
3. Click to execute trades instantly

#### Setting Custom Amounts
1. Open Wallet Manager
2. Adjust buy amounts (default: 0.1, 0.5, 1 SOL)
3. Adjust sell percentages (default: 25%, 50%, 100%)
4. Modify slippage and priority fees

### Auto-Trading Setup 🤖

#### Auto-Buy Configuration
1. Click **"Auto Trade"** button
2. Enable Auto-Buy toggle
3. Add wallets to sequence with:
   - Amount to buy (SOL)
   - Delay before buying (ms)
   - Slippage tolerance
   - Priority fee

When your dev wallet creates a token, all configured wallets automatically buy in sequence.

#### Auto-Sell Configuration
1. In Auto Trade settings, scroll to Auto-Sell
2. Enable for specific wallets
3. Add triggers:
   - **Time**: Sell after X seconds
   - **Profit**: Sell at X multiplier (2x, 3x, etc.)
   - **Market Cap**: Sell when MC reaches $X
   - **Dev Sells**: Sell when dev wallet sells

### Monitoring Positions

- **Holdings Panel**: Shows total holdings percentage and average entry
- **Wallet Cards**: Display individual positions, P&L, and entry market cap
- **Live Stats**: Track buys/sells, volume, and market cap in real-time
- **Others' SOL**: See how much SOL other traders have invested

### Bulk Operations

- **NUKE Buttons**: Sell 25%, 50%, or 100% across ALL wallets instantly
- **Update All**: Refresh all wallet balances with one click
- **Export/Import**: Backup your entire configuration to JSON

## Keyboard Shortcuts ⌨️

- **Enter** in token field: Track token
- Hold click on buy/sell: Rapid fire (be careful!)

## Important Settings ⚙️

### Wallet Manager Settings
- **Buy Amounts**: SOL amounts for quick buy buttons
- **Sell Percentages**: Quick sell percentages
- **Buy Slippage**: Default 80% (high for new tokens)
- **Sell Slippage**: Default 99% (ensures sells go through)
- **Priority Fee**: Default 0.00005 SOL

### Activity Monitoring
- Click **"Recent Activity"** to see trade history
- Drag the activity window anywhere on screen
- Shows all buys, sells, and token creations

## Tips for Success 💡

1. **Dev Wallet First**: Always set up your dev wallet if you're launching tokens
2. **Test Small**: Start with small amounts to test your configuration
3. **Monitor Closely**: Keep the dashboard open to track positions
4. **Use Auto-Sell**: Protect profits with automatic sell triggers
5. **Export Regularly**: Backup your wallets to avoid losing configurations

## Security Notes 🔒

- Private keys are stored locally in your browser
- Never share your export files - they contain private keys
- Use a dedicated browser profile for trading
- Clear browser data to remove all stored wallets

## Troubleshooting 🔧

**Trades not executing?**
- Check wallet has sufficient SOL balance
- Verify PumpPortal API key is correct
- Increase slippage for volatile tokens

**WebSocket not connecting?**
- Refresh the page
- Check internet connection
- WebSocket auto-reconnects every 5 seconds

**Can't see positions?**
- Make sure you've tracked the token (paste CA and click Track)
- Positions only show for the tracked token

## Advanced Features 🎯

### Auto-Buy Sequences
Perfect for coordinated launches:
1. Set up multiple wallets with different delays
2. Configure varying buy amounts
3. Dev wallet creation triggers all buys automatically

### Multi-Trigger Auto-Sells
Combine multiple exit strategies:
- Sell 50% at 2x
- Sell 25% after 30 seconds  
- Sell remaining if dev sells

### Real-Time Market Monitoring
- Live trade flow shows all token transactions
- Net flow tracking (buys vs sells)
- Market cap P&L percentage

## Support 🤝

- Report issues on GitHub
- Check the console (F12) for error messages
- Export your configuration before making big changes

---

*Built for the BonkOps community* 🔥

**Note**: This tool is for educational purposes. Trade responsibly and never invest more than you can afford to lose.