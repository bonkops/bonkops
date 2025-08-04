// Dynamic wallet configuration - can be hardcoded or loaded from storage
let WALLETS = [];

// Dev wallet configuration (separate from regular wallets)
let DEV_WALLET = null;

// API Configuration
const SOL_PRICE_USD = 162;
const HELIUS_API_KEY = "9d0efa84-4549-4b27-a086-50f8b350e475";
const RPC_ENDPOINT = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

// Log wallet configuration on startup
console.log('=== WALLET CONFIGURATION ===');
WALLETS.forEach((wallet, index) => {
    console.log(`Wallet ${index + 1}:`, {
        name: wallet.name,
        address: wallet.address
    });
});
console.log('Dev wallet will be configured separately');
console.log('========================');