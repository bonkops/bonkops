// ========================================
// PART 1: GLOBAL VARIABLES AND CONFIGURATION
// ========================================

// WebSocket connection
let ws = null;
let reconnectInterval = null;
let pingInterval = null;

// Portfolio tracking
const walletPositions = new Map(); // wallet address -> position data
const recentActivity = [];
const transactionQueue = [];
let isProcessingQueue = false;

// Current active token (detected from ANY wallet's first buy)
let currentActiveToken = null;
let tokenTradeSubscribed = false;
let tokenTrades = [];
let tokenBuyCount = 0;
let tokenSellCount = 0;
let netTokenFlow = 0;
let totalTokenVolume = 0; // Track total volume
let currentMarketCapUSD = 0; // Track current market cap in USD

let currentSolInBondingCurve = 0;  // Track current SOL in bonding curve
const BASE_SOL_IN_CURVE = 30;      // Base/initial SOL that's always in the curve

// Portfolio stats
const walletBalances = new Map();
const initialBalances = new Map();
let initialBalanceTime = null;

// Win/loss tracking
let winCount = 0;
let lossCount = 0;

// Wallet manager state
const walletSettings = new Map(); // Store custom buy amounts per wallet

// Auto Trade Configuration
let autoTradeConfig = {
    autoBuy: {
        enabled: false,
        sequence: [] // Array of { walletAddress, amount, delay, slippage, priorityFee }
    },
    autoSell: {
        enabled: false,
        wallets: {} // walletAddress -> { triggers: [{type, value, sellPercent}], slippage }
    }
};

// Auto sell monitoring
const autoSellMonitors = new Map(); // wallet address -> interval IDs

// Spam Launch Configuration
let spamLaunchConfig = {
    enabled: false,
    launches: [] // Array of { walletAddress, tokenName, symbol, description, imageUrl, socialLinks, initialBuy, delay }
};

// ========================================
// PART 1.1: HELPER FUNCTIONS
// ========================================

// Helper function to get all wallets including dev wallet
function getAllWallets() {
    const allWallets = [...WALLETS];
    if (DEV_WALLET) {
        allWallets.unshift(DEV_WALLET); // Dev wallet always first
    }
    return allWallets;
}

// Utility functions
function formatNumber(num) {
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(4);
}

function formatTime(timestamp) {
    const date = new Date(timestamp * 1000);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    const milliseconds = date.getMilliseconds().toString().padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function shortenAddress(address) {
    if (!address) return '';
    return address.slice(0, 6) + '...' + address.slice(-4);
}

// ========================================
// PART 2: WALLET MANAGEMENT FUNCTIONS
// ========================================

// Trading Wallet Management
function showAddWalletForm() {
    document.getElementById('addWalletForm').style.display = 'block';
}

function hideAddWalletForm() {
    document.getElementById('addWalletForm').style.display = 'none';
    // Clear form
    document.getElementById('newWalletName').value = '';
    document.getElementById('newWalletAddress').value = '';
    document.getElementById('newWalletPrivateKey').value = '';
    document.getElementById('newWalletApiKey').value = '';
}

function addTradingWallet() {
    const name = document.getElementById('newWalletName').value.trim();
    const address = document.getElementById('newWalletAddress').value.trim();
    const privateKey = document.getElementById('newWalletPrivateKey').value.trim();
    const apiKey = document.getElementById('newWalletApiKey').value.trim();
    
    if (!name || !address || !privateKey || !apiKey) {
        alert('Please fill in all wallet fields');
        return;
    }
    
    // Check if wallet already exists
    if (WALLETS.some(w => w.address === address)) {
        alert('This wallet address already exists');
        return;
    }
    
    // Add new wallet
    const newWallet = {
        address: address,
        privateKey: privateKey,
        apiKey: apiKey,
        name: name
    };
    
    WALLETS.push(newWallet);
    
    // Initialize position tracking for new wallet
    walletPositions.set(address, {
        wallet: newWallet,
        position: null
    });
    
    // Initialize settings for new wallet
    walletSettings.set(address, {
        buyAmounts: [0.1, 0.5, 1],
        sellPercentages: [25, 50, 100],
        buySlippage: 80,
        sellSlippage: 99,
        priorityFee: 0.00005
    });
    
    // Subscribe to new wallet if WebSocket is connected
    if (ws && ws.readyState === WebSocket.OPEN) {
        const payload = {
            method: "subscribeAccountTrade",
            keys: [address]
        };
        console.log('Subscribing to new wallet:', payload);
        ws.send(JSON.stringify(payload));
    }
    
    // Save wallets to storage
    saveTradingWallets();
    
    // Update UI
    hideAddWalletForm();
    updateWalletCount();
    updateWalletGrid();
    updateWalletManagerList();
    fetchWalletBalance(address, true);
    
    console.log('New wallet added:', name);
}

function removeTradingWallet(address) {
    if (!confirm('Are you sure you want to remove this wallet?')) {
        return;
    }
    
    // Find and remove wallet
    const index = WALLETS.findIndex(w => w.address === address);
    if (index > -1) {
        WALLETS.splice(index, 1);
        
        // Clean up maps
        walletPositions.delete(address);
        walletSettings.delete(address);
        walletBalances.delete(address);
        initialBalances.delete(address);
        
        // Save changes
        saveTradingWallets();
        
        // Update UI
        updateWalletCount();
        updateWalletGrid();
        updateWalletManagerList();
        
        console.log('Wallet removed:', address);
    }
}

function saveTradingWallets() {
    // Save to localStorage
    localStorage.setItem('tradingWallets', JSON.stringify(WALLETS));
}

function loadTradingWallets() {
    const saved = localStorage.getItem('tradingWallets');
    if (saved) {
        try {
            const loaded = JSON.parse(saved);
            if (Array.isArray(loaded) && loaded.length > 0) {
                WALLETS = loaded;
                console.log('Loaded trading wallets from storage:', WALLETS.length);
            }
        } catch (e) {
            console.error('Error loading trading wallets:', e);
        }
    }
}

// ========================================
// PART 2.1: DEV WALLET FUNCTIONS
// ========================================

function saveDevWallet() {
    const address = document.getElementById('devWalletAddress').value.trim();
    const privateKey = document.getElementById('devWalletPrivateKey').value.trim();
    const apiKey = document.getElementById('devWalletApiKey').value.trim();
    
    if (!address || !privateKey || !apiKey) {
        alert('Please fill in all dev wallet fields');
        return;
    }
    
    // Create dev wallet object
    DEV_WALLET = {
        address: address,
        privateKey: privateKey,
        apiKey: apiKey,
        name: "Dev Wallet",
        isDevWallet: true
    };
    
    // Save to localStorage
    localStorage.setItem('devWallet', JSON.stringify(DEV_WALLET));
    
    // Initialize position tracking for dev wallet
    walletPositions.set(DEV_WALLET.address, {
        wallet: DEV_WALLET,
        position: null
    });
    
    // Initialize settings for dev wallet
    walletSettings.set(DEV_WALLET.address, {
        buyAmounts: [0.1, 0.5, 1],
        sellPercentages: [25, 50, 100],
        buySlippage: 80,
        sellSlippage: 99,
        priorityFee: 0.00005
    });
    
    // Subscribe to dev wallet if WebSocket is connected
    if (ws && ws.readyState === WebSocket.OPEN) {
        const payload = {
            method: "subscribeAccountTrade",
            keys: [DEV_WALLET.address]
        };
        console.log('Subscribing to dev wallet:', payload);
        ws.send(JSON.stringify(payload));
    }
    
    // Update UI
    updateDevWalletStatus();
    updateWalletCount();
    updateWalletGrid();
    fetchWalletBalance(DEV_WALLET.address, true);
    
    console.log('Dev wallet saved:', DEV_WALLET.address);
}

function clearDevWallet() {
    if (!confirm('Are you sure you want to clear the dev wallet configuration?')) {
        return;
    }
    
    // Clear from memory
    if (DEV_WALLET) {
        walletPositions.delete(DEV_WALLET.address);
        walletSettings.delete(DEV_WALLET.address);
        walletBalances.delete(DEV_WALLET.address);
        initialBalances.delete(DEV_WALLET.address);
    }
    
    DEV_WALLET = null;
    
    // Clear from localStorage
    localStorage.removeItem('devWallet');
    
    // Clear form
    document.getElementById('devWalletAddress').value = '';
    document.getElementById('devWalletPrivateKey').value = '';
    document.getElementById('devWalletApiKey').value = '';
    
    // Update UI
    updateDevWalletStatus();
    updateWalletCount();
    updateWalletGrid();
    
    console.log('Dev wallet cleared');
}

function loadDevWallet() {
    const saved = localStorage.getItem('devWallet');
    if (saved) {
        try {
            DEV_WALLET = JSON.parse(saved);
            DEV_WALLET.isDevWallet = true; // Ensure flag is set
            
            // Initialize position tracking
            walletPositions.set(DEV_WALLET.address, {
                wallet: DEV_WALLET,
                position: null
            });
            
            // Initialize settings
            walletSettings.set(DEV_WALLET.address, {
                buyAmounts: [0.1, 0.5, 1],
                sellPercentages: [25, 50, 100],
                buySlippage: 80,
                sellSlippage: 99,
                priorityFee: 0.00005
            });
            
            // Update form fields
            document.getElementById('devWalletAddress').value = DEV_WALLET.address;
            document.getElementById('devWalletPrivateKey').value = DEV_WALLET.privateKey;
            document.getElementById('devWalletApiKey').value = DEV_WALLET.apiKey;
            
            console.log('Dev wallet loaded:', DEV_WALLET.address);
        } catch (e) {
            console.error('Error loading dev wallet:', e);
        }
    }
}

function updateDevWalletStatus() {
    const statusEl = document.getElementById('devWalletStatus');
    const statusTextEl = document.getElementById('devWalletStatusText');
    
    if (DEV_WALLET) {
        statusEl.className = 'dev-wallet-status configured';
        statusTextEl.textContent = 'Configured';
    } else {
        statusEl.className = 'dev-wallet-status not-configured';
        statusTextEl.textContent = 'Not Configured';
    }
}

function updateWalletCount() {
    const count = WALLETS.length + (DEV_WALLET ? 1 : 0);
    document.getElementById('walletCount').textContent = `${count} wallets`;
}

// ========================================
// PART 2.2: WALLET SETTINGS MANAGEMENT
// ========================================

function updateWalletSettings(walletAddress, type, index, value) {
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue > 0) {
        const settings = walletSettings.get(walletAddress);
        if (settings) {
            if (type === 'buy' && index !== null) {
                settings.buyAmounts[index] = numValue;
            } else if (type === 'sell' && index !== null) {
                settings.sellPercentages[index] = numValue;
            } else if (type === 'buySlippage') {
                settings.buySlippage = numValue;
            } else if (type === 'sellSlippage') {
                settings.sellSlippage = numValue;
            } else if (type === 'priorityFee') {
                settings.priorityFee = numValue;
            }
            // Save to localStorage immediately
            saveWalletSettingsToStorage();
            // Update the wallet grid to reflect the new settings
            updateWalletGrid();
        }
    }
}

function saveWalletSettingsToStorage() {
    localStorage.setItem('walletSettings', JSON.stringify(Array.from(walletSettings.entries())));
}

function saveWalletSettings() {
    // Settings are already saved in real-time via onchange events
    // Just update the grid and close the window
    updateWalletGrid();
    console.log('Wallet settings saved');
    closeWalletManager();
}

// Load saved settings on startup
function loadWalletSettings() {
    const saved = localStorage.getItem('walletSettings');
    if (saved) {
        try {
            const entries = JSON.parse(saved);
            entries.forEach(([address, settings]) => {
                if (walletSettings.has(address)) {
                    // Ensure we have the proper structure
                    const currentSettings = walletSettings.get(address);
                    if (settings.buyAmounts && Array.isArray(settings.buyAmounts)) {
                        currentSettings.buyAmounts = settings.buyAmounts;
                    }
                    if (settings.sellPercentages && Array.isArray(settings.sellPercentages)) {
                        currentSettings.sellPercentages = settings.sellPercentages;
                    }
                    if (typeof settings.buySlippage === 'number') {
                        currentSettings.buySlippage = settings.buySlippage;
                    }
                    if (typeof settings.sellSlippage === 'number') {
                        currentSettings.sellSlippage = settings.sellSlippage;
                    }
                    if (typeof settings.priorityFee === 'number') {
                        currentSettings.priorityFee = settings.priorityFee;
                    }
                    // Handle old format
                    if (settings.buyAmount && !settings.buyAmounts) {
                        currentSettings.buyAmounts = [settings.buyAmount, 0.5, 1];
                    }
                }
            });
        } catch (e) {
            console.error('Error loading wallet settings:', e);
        }
    }
    
    // Load auto trade settings
    loadAutoTradeSettings();
    
    // Load spam launch settings
    loadSpamLaunchSettings();
}

// ========================================
// WALLET CREATION FUNCTIONS - Add to script.js
// ========================================

// Create Dev Wallet via PumpPortal API
async function createDevWallet() {
    const btn = document.getElementById('createDevWalletBtn');
    if (!btn) return;
    
    // Show loading state
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `
        <svg class="spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v4m0 12v4m-7-7h4m12 0h4"></path>
        </svg>
        Creating...
    `;
    
    try {
        // Call PumpPortal API to create wallet
        const response = await fetch('https://pumpportal.fun/api/create-wallet', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to create wallet: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Dev wallet created:', data);
        
        // Create dev wallet object
        DEV_WALLET = {
            address: data.walletPublicKey,
            privateKey: data.privateKey,
            apiKey: data.apiKey,
            name: "Dev Wallet",
            isDevWallet: true
        };
        
        // Save to localStorage
        localStorage.setItem('devWallet', JSON.stringify(DEV_WALLET));
        
        // Initialize position tracking for dev wallet
        walletPositions.set(DEV_WALLET.address, {
            wallet: DEV_WALLET,
            position: null
        });
        
        // Initialize settings for dev wallet
        walletSettings.set(DEV_WALLET.address, {
            buyAmounts: [0.1, 0.5, 1],
            sellPercentages: [25, 50, 100],
            buySlippage: 80,
            sellSlippage: 99,
            priorityFee: 0.00005
        });
        
        // Subscribe to dev wallet if WebSocket is connected
        if (ws && ws.readyState === WebSocket.OPEN) {
            const payload = {
                method: "subscribeAccountTrade",
                keys: [DEV_WALLET.address]
            };
            console.log('Subscribing to dev wallet:', payload);
            ws.send(JSON.stringify(payload));
        }
        
        // Update form fields
        document.getElementById('devWalletAddress').value = DEV_WALLET.address;
        document.getElementById('devWalletPrivateKey').value = DEV_WALLET.privateKey;
        document.getElementById('devWalletApiKey').value = DEV_WALLET.apiKey;
        
        // Update UI
        updateDevWalletStatus();
        updateWalletCount();
        updateWalletGrid();
        fetchWalletBalance(DEV_WALLET.address, true);
        
        // Show success message
        btn.style.background = 'var(--color-success)';
        btn.innerHTML = '✓ Created Successfully';
        
        setTimeout(() => {
            btn.style.background = '';
            btn.innerHTML = originalText;
            btn.disabled = false;
        }, 2000);
        
    } catch (error) {
        console.error('Error creating dev wallet:', error);
        
        // Show error state
        btn.style.background = 'var(--color-danger)';
        btn.innerHTML = '✗ Creation Failed';
        
        setTimeout(() => {
            btn.style.background = '';
            btn.innerHTML = originalText;
            btn.disabled = false;
        }, 2000);
        
        alert('Failed to create dev wallet: ' + error.message);
    }
}

// Create Trading Wallet via PumpPortal API
async function createTradingWallet() {
    const btn = document.getElementById('createTradingWalletBtn');
    if (!btn) return;
    
    // Show loading state
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `
        <svg class="spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v4m0 12v4m-7-7h4m12 0h4"></path>
        </svg>
        Creating...
    `;
    
    try {
        // Call PumpPortal API to create wallet
        const response = await fetch('https://pumpportal.fun/api/create-wallet', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to create wallet: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Trading wallet created:', data);
        
        // Generate sequential name
        const walletNumber = WALLETS.length + 1;
        const walletName = `Wallet ${walletNumber}`;
        
        // Create new wallet object
        const newWallet = {
            address: data.walletPublicKey,
            privateKey: data.privateKey,
            apiKey: data.apiKey,
            name: walletName
        };
        
        // Add to wallets array
        WALLETS.push(newWallet);
        
        // Initialize position tracking
        walletPositions.set(newWallet.address, {
            wallet: newWallet,
            position: null
        });
        
        // Initialize settings
        walletSettings.set(newWallet.address, {
            buyAmounts: [0.1, 0.5, 1],
            sellPercentages: [25, 50, 100],
            buySlippage: 80,
            sellSlippage: 99,
            priorityFee: 0.00005
        });
        
        // Subscribe to new wallet if WebSocket is connected
        if (ws && ws.readyState === WebSocket.OPEN) {
            const payload = {
                method: "subscribeAccountTrade",
                keys: [newWallet.address]
            };
            console.log('Subscribing to new wallet:', payload);
            ws.send(JSON.stringify(payload));
        }
        
        // Save wallets to storage
        saveTradingWallets();
        
        // Update UI
        updateWalletCount();
        updateWalletGrid();
        updateWalletManagerList();
        fetchWalletBalance(newWallet.address, true);
        
        // Show success message
        btn.style.background = 'var(--color-success)';
        btn.innerHTML = `✓ ${walletName} Created`;
        
        setTimeout(() => {
            btn.style.background = '';
            btn.innerHTML = originalText;
            btn.disabled = false;
        }, 2000);
        
        console.log(`Created ${walletName} successfully`);
        
    } catch (error) {
        console.error('Error creating trading wallet:', error);
        
        // Show error state
        btn.style.background = 'var(--color-danger)';
        btn.innerHTML = '✗ Creation Failed';
        
        setTimeout(() => {
            btn.style.background = '';
            btn.innerHTML = originalText;
            btn.disabled = false;
        }, 2000);
        
        alert('Failed to create trading wallet: ' + error.message);
    }
}

// ========================================
// PART 3: WEBSOCKET AND TRADING FUNCTIONS
// ========================================

function connectWebSocket() {
    console.log('Connecting to PumpPortal WebSocket...');
    
    ws = new WebSocket('wss://pumpportal.fun/api/data');
    
    // Add readyState monitoring
    console.log('WebSocket state:', ws.readyState);
    // 0 = CONNECTING, 1 = OPEN, 2 = CLOSING, 3 = CLOSED
    
    ws.onopen = function() {
        console.log('WebSocket connected successfully!');
        
        // Subscribe to each wallet INDIVIDUALLY like in the PumpPortal example
        WALLETS.forEach((wallet, index) => {
            setTimeout(() => {
                const payload = {
                    method: "subscribeAccountTrade",
                    keys: [wallet.address] // ONE address at a time in an array
                };
                
                console.log(`Subscribing to ${wallet.name}:`, JSON.stringify(payload));
                ws.send(JSON.stringify(payload));
            }, index * 100); // Small delay between each subscription
        });
        
        // Subscribe to dev wallet if configured
        if (DEV_WALLET) {
            setTimeout(() => {
                const payload = {
                    method: "subscribeAccountTrade",
                    keys: [DEV_WALLET.address]
                };
                console.log('Subscribing to dev wallet:', JSON.stringify(payload));
                ws.send(JSON.stringify(payload));
            }, WALLETS.length * 100);
        }
    };

    ws.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            
            // Log ALL messages for debugging
            console.log('WebSocket raw message:', data);
            
            // Skip only specific known non-trade messages
            if (data.method === "subscribeAccountTrade" || 
                data.method === "subscribeTokenTrade" ||
                data.message === "Successfully subscribed to keys" ||
                data.errors) {
                console.log('Skipping subscription confirmation or error message');
                return;
            }
            
            // System 1: Check if this is a wallet trade and update positions
            const walletAddress = data.traderPublicKey || 
                               data.walletAddress || 
                               data.buyer || 
                               data.seller ||
                               data.trader ||
                               data.account;
            
            const allWallets = getAllWallets();
            if (allWallets.some(w => w.address === walletAddress)) {
                console.log('Processing wallet trade:', data);
                processTrade(data);
                // NO RETURN - let it also process as token trade if applicable
            }
            
            // System 2: Check if this is a token trade and update market stats
            if (data.marketCapSol && data.mint && data.mint === currentActiveToken?.mint) {
                console.log('Processing token trade:', data);
                processTokenTrade(data);
            }
            
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    };

    ws.onerror = function(error) {
        console.error('WebSocket error:', error);
    };

    ws.onclose = function(event) {
        console.log('WebSocket disconnected');
        console.log('Close code:', event.code);
        console.log('Close reason:', event.reason);
        console.log('Was clean?', event.wasClean);
        
        // Clear ping interval
        if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
        }
        
        // Reconnect after 5 seconds
        if (!reconnectInterval) {
            reconnectInterval = setInterval(() => {
                console.log('Attempting to reconnect...');
                connectWebSocket();
            }, 5000);
        }
    };
}

// ========================================
// PART 3.1: TRADE PROCESSING
// ========================================

function processTrade(tradeData) {
    console.log('=== PROCESSING TRADE ===');
    console.log('Trade data received:', tradeData);
    
    // Add to recent activity regardless
    recentActivity.unshift(tradeData);
    if (recentActivity.length > 50) recentActivity.pop();
    
    // Try multiple fields to find the wallet address
    let walletAddress = tradeData.traderPublicKey || 
                       tradeData.walletAddress || 
                       tradeData.buyer || 
                       tradeData.seller ||
                       tradeData.trader ||
                       tradeData.account;
                       
    console.log('Looking for wallet address:', walletAddress);
    const allWallets = getAllWallets();
    console.log('Available wallet addresses:', allWallets.map(w => w.address));
    
    let matchedWallet = null;
    allWallets.forEach(wallet => {
        if (wallet.address === walletAddress) {
            console.log(`MATCHED! Trade belongs to ${wallet.name}`);
            matchedWallet = wallet;
            
            const walletData = walletPositions.get(wallet.address);
            
            // Determine trade type - check multiple possible fields
            const isBuy = tradeData.txType === 'buy' || 
                         tradeData.type === 'buy' || 
                         tradeData.side === 'buy' ||
                         tradeData.action === 'buy';
                         
            const isSell = tradeData.txType === 'sell' || 
                          tradeData.type === 'sell' || 
                          tradeData.side === 'sell' ||
                          tradeData.action === 'sell';
                          
            const isCreate = tradeData.txType === 'create' || 
                            tradeData.type === 'create';
            
            console.log(`Trade type - Buy: ${isBuy}, Sell: ${isSell}, Create: ${isCreate}`);
            
            // Check if this is a token creation from dev wallet
            if (isCreate && wallet.isDevWallet) {
                console.log('DEV WALLET CREATED A TOKEN!');
                
                // Extract token info
                const tokenMint = tradeData.mint || tradeData.tokenAddress || tradeData.token;
                const tokenSymbol = tradeData.symbol || tradeData.tokenSymbol || 'UNKNOWN';
                const tokenName = tradeData.name || tradeData.tokenName || 'Unknown Token';
                
                // Set as active token immediately
                setActiveToken({
                    mint: tokenMint,
                    symbol: tokenSymbol,
                    name: tokenName
                });
                
                // Process the initial buy that comes with creation
                if (tradeData.initialBuy && tradeData.initialBuy > 0) {
                    const solAmount = tradeData.solAmount || tradeData.sol || 0;
                    const tokenAmount = tradeData.initialBuy;
                    const marketCapSol = tradeData.marketCapSol || tradeData.marketCap || 0;
                    const timestamp = tradeData.timestamp || (Date.now() / 1000);
                    
                    walletData.position = {
                        mint: tokenMint,
                        symbol: tokenSymbol,
                        name: tokenName,
                        balance: tokenAmount,
                        totalBought: tokenAmount,
                        totalInvested: solAmount,
                        avgPrice: solAmount / tokenAmount,
                        entryMarketCapSol: marketCapSol,
                        entryTimestamp: timestamp,
                        trades: [{
                            ...tradeData,
                            cumulativeBalance: tokenAmount
                        }]
                    };
                    console.log('Dev wallet position created with initial buy:', walletData.position);
                    
                    // START AUTO-SELL MONITORING FOR DEV WALLET
                    startAutoSellMonitoring(wallet.address);
                }
                
                // Trigger auto-buy sequence if enabled
                if (autoTradeConfig.autoBuy.enabled && autoTradeConfig.autoBuy.sequence.length > 0) {
                    console.log('=== TRIGGERING AUTO-BUY SEQUENCE ===');
                    executeAutoBuySequence();
                }
                
                // Trigger spam launches if enabled
                if (spamLaunchConfig.enabled && spamLaunchConfig.launches.length > 0) {
                    console.log('=== TRIGGERING SPAM LAUNCHES ===');
                    executeSpamLaunches();
                }
            } else if (isBuy) {
                console.log('Processing BUY trade');
                
                // Extract token info from multiple possible fields
                const tokenMint = tradeData.mint || tradeData.tokenAddress || tradeData.token;
                const tokenSymbol = tradeData.symbol || tradeData.tokenSymbol || 'UNKNOWN';
                const tokenName = tradeData.name || tradeData.tokenName || 'Unknown Token';
                const marketCapSol = tradeData.marketCapSol || tradeData.marketCap || 0;
                const timestamp = tradeData.timestamp || (Date.now() / 1000);
                
                // If no active token is set AND this is NOT from dev wallet, set as active token
                if (!currentActiveToken && !wallet.isDevWallet) {
                    console.log('No active token - setting this as active token!');
                    setActiveToken({
                        mint: tokenMint,
                        symbol: tokenSymbol,
                        name: tokenName
                    });
                }
                
                // CRITICAL: Use ONLY PumpPortal's newTokenBalance
                const solAmount = tradeData.solAmount || tradeData.sol || 0;
                const tokenAmount = tradeData.tokenAmount || tradeData.amount || 0;
                const newTokenBalance = tradeData.newTokenBalance || 0;
                
                if (!walletData.position || walletData.position.mint !== tokenMint) {
                    // New position - use the newTokenBalance from PumpPortal
                    walletData.position = {
                        mint: tokenMint,
                        symbol: tokenSymbol,
                        name: tokenName,
                        balance: newTokenBalance, // USE PUMPPORTAL DATA
                        totalBought: tokenAmount,
                        totalInvested: solAmount,
                        avgPrice: solAmount / tokenAmount,
                        entryMarketCapSol: marketCapSol,
                        entryTimestamp: timestamp,
                        trades: [{
                            ...tradeData,
                            cumulativeBalance: newTokenBalance
                        }]
                    };
                    console.log('Created new position with balance:', newTokenBalance);
                    
                    // Start auto-sell monitoring if enabled for this wallet
                    startAutoSellMonitoring(wallet.address);
                } else {
                    // Update existing position - ONLY use PumpPortal data
                    const oldTotalBought = walletData.position.totalBought;
                    const oldTotalInvested = walletData.position.totalInvested;
                    
                    // Update totals
                    const newTotalBought = oldTotalBought + tokenAmount;
                    const newTotalInvested = oldTotalInvested + solAmount;
                    
                    // Calculate weighted average market cap
                    const oldWeight = oldTotalBought / newTotalBought;
                    const newWeight = tokenAmount / newTotalBought;
                    const avgMarketCap = (walletData.position.entryMarketCapSol * oldWeight) + (marketCapSol * newWeight);
                    
                    walletData.position.balance = newTokenBalance; // USE PUMPPORTAL DATA
                    walletData.position.totalBought = newTotalBought;
                    walletData.position.totalInvested = newTotalInvested;
                    walletData.position.avgPrice = newTotalInvested / newTotalBought;
                    walletData.position.entryMarketCapSol = avgMarketCap;
                    walletData.position.trades.push({
                        ...tradeData,
                        cumulativeBalance: newTokenBalance
                    });
                    
                    console.log('Updated position with new balance:', newTokenBalance);
                }
                
                console.log('Position after BUY:', walletData.position);
                
            } else if (isSell && walletData.position) {
                console.log('Processing SELL trade');
                
                const soldAmount = tradeData.tokenAmount || tradeData.amount || 0;
                const soldValue = tradeData.solAmount || tradeData.sol || 0;
                const newTokenBalance = tradeData.newTokenBalance || 0;
                
                console.log(`Sell details - New balance from PumpPortal: ${newTokenBalance}`);
                
                // CRITICAL: Use ONLY PumpPortal's newTokenBalance
                walletData.position.balance = newTokenBalance;
                
                if (newTokenBalance <= 0) {
                    // Position fully closed
                    console.log('Position fully closed - clearing position');
                    
                    // Track final P&L
                    const costBasis = soldAmount * walletData.position.avgPrice;
                    if (soldValue > costBasis) {
                        winCount++;
                    } else {
                        lossCount++;
                    }
                    
                    // Clear the position
                    walletData.position = null;
                } else {
                    // Partial sell - just update the balance from PumpPortal
                    walletData.position.trades.push({
                        ...tradeData,
                        cumulativeBalance: newTokenBalance
                    });
                    
                    // Track P&L for this partial sell
                    const costBasis = soldAmount * walletData.position.avgPrice;
                    if (soldValue > costBasis) {
                        winCount++;
                    } else {
                        lossCount++;
                    }
                    
                    console.log('Position after partial SELL:', walletData.position);
                }
            }
            
            // Add wallet info to trade data for activity display
            tradeData.walletName = wallet.name;
            tradeData.walletAddress = wallet.address;
            tradeData.isDevWallet = wallet.isDevWallet;
        }
    });
    
    if (!matchedWallet) {
        console.log('WARNING: Could not match trade to any wallet!');
        console.log('Trade wallet address:', walletAddress);
        console.log('Available wallet addresses:', allWallets.map(w => w.address));
    }
    
    updateUI();
}

// ========================================
// PART 3.2: TOKEN MANAGEMENT
// ========================================

function setActiveToken(tokenData) {
    currentActiveToken = {
        mint: tokenData.mint,
        symbol: tokenData.symbol || 'UNKNOWN',
        name: tokenData.name || 'Unknown Token',
        detectedAt: Date.now()
    };
    
    console.log('Active token set to:', currentActiveToken);
    
    // Update UI to show the active token
    document.getElementById('currentTokenName').textContent = currentActiveToken.symbol;
    document.getElementById('currentTokenMint').textContent = currentActiveToken.mint; // Show full CA
    document.getElementById('activeTokenDisplay').textContent = currentActiveToken.symbol;
    
    const tokenStatus = document.getElementById('tokenStatus');
    tokenStatus.classList.add('active');
    tokenStatus.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        Token Active
    `;
    
    // Show clear button
    document.getElementById('clearTokenBtn').style.display = 'flex';
    
    // Clear input
    document.getElementById('tokenCAInput').value = '';
    
    // Subscribe to token trades
    subscribeToTokenTrades();
    
    // Show trades section
    document.getElementById('tokenTradesSection').style.display = 'block';
    
    updateWalletGrid();
}

function subscribeToTokenTrades() {
    if (!currentActiveToken || !ws || ws.readyState !== WebSocket.OPEN || tokenTradeSubscribed) {
        return;
    }
    
    const payload = {
        method: "subscribeTokenTrade",
        keys: [currentActiveToken.mint]
    };
    
    console.log('Subscribing to token trades:', payload);
    ws.send(JSON.stringify(payload));
    tokenTradeSubscribed = true;
    
    // Reset trade stats
    tokenTrades = [];
    tokenBuyCount = 0;
    tokenSellCount = 0;
    netTokenFlow = 0;
    totalTokenVolume = 0;
    currentMarketCapUSD = 0;
    updateTradeStats();
}

function processTokenTrade(data) {
    // Add to trades array
    tokenTrades.unshift(data);
    if (tokenTrades.length > 100) tokenTrades.pop();
    
    // Update stats
    if (data.txType === 'buy') {
        tokenBuyCount++;
        netTokenFlow += data.solAmount;
    } else if (data.txType === 'sell') {
        tokenSellCount++;
        netTokenFlow -= data.solAmount;
    }
    
    // Update volume
    totalTokenVolume += data.solAmount;
    
    // Update current market cap
    currentMarketCapUSD = data.marketCapSol * SOL_PRICE_USD;

     // NEW: Update SOL in bonding curve
    if (data.vSolInBondingCurve !== undefined) {
        currentSolInBondingCurve = data.vSolInBondingCurve;
    }
    
    // Update live market cap for all positions
    const currentMarketCapSol = data.marketCapSol;
    
    Array.from(walletPositions.entries()).forEach(([address, walletData]) => {
        if (walletData.position && walletData.position.mint === data.mint) {
            // Store the live market cap
            walletData.position.currentMarketCapSol = currentMarketCapSol;
        }
    });
    
    // Update UI
    updateTradeStats();
    updateTradeFlow();
    updateWalletGrid(); // This will now show live P&L
}

// Clear active token function
function clearActiveToken() {
    if (!currentActiveToken) return;
    
    console.log('Clearing active token:', currentActiveToken);
    
    // Stop all auto-sell monitoring
    stopAllAutoSellMonitoring();
    
    // Reset token state
    currentActiveToken = null;
    tokenTradeSubscribed = false;
    tokenTrades = [];
    tokenBuyCount = 0;
    tokenSellCount = 0;
    netTokenFlow = 0;
    totalTokenVolume = 0;
    currentMarketCapUSD = 0;
    currentSolInBondingCurve = 0;
    
    // Update UI
    document.getElementById('currentTokenName').textContent = 'No active token';
    document.getElementById('currentTokenMint').textContent = '-';
    document.getElementById('activeTokenDisplay').textContent = 'None';
    
    const tokenStatus = document.getElementById('tokenStatus');
    tokenStatus.classList.remove('active');
    tokenStatus.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        Ready
    `;
    
    // Hide clear button
    document.getElementById('clearTokenBtn').style.display = 'none';
    
    // Hide trades section
    document.getElementById('tokenTradesSection').style.display = 'none';
    
    // Clear all positions for this token
    Array.from(walletPositions.entries()).forEach(([address, data]) => {
        if (data.position && data.position.mint === currentActiveToken?.mint) {
            data.position = null;
        }
    });
    
    updateWalletGrid();
}

// Track token from input
async function trackTokenFromInput() {
    const input = document.getElementById('tokenCAInput');
    const mint = input.value.trim();
    
    if (!mint || mint.length < 32) {
        alert('Please enter a valid contract address');
        return;
    }
    
    // Set as active token
    setActiveToken({
        mint: mint,
        symbol: 'TRACKING',
        name: 'Tracked Token'
    });
    
    console.log('Manually tracking token:', mint);
}

// ========================================
// PART 3.3: TRADE EXECUTION
// ========================================

// Buy token function - IMMEDIATE EXECUTION
async function buyToken(walletAddress, solAmount) {
    if (!currentActiveToken) return;
    
    const allWallets = getAllWallets();
    const wallet = allWallets.find(w => w.address === walletAddress);
    if (!wallet) return;
    
    const settings = walletSettings.get(walletAddress);
    
    // Execute immediately - no queue
    executeTrade({
        action: 'buy',
        mint: currentActiveToken.mint,
        walletAddress,
        walletName: wallet.name,
        privateKey: wallet.privateKey,
        apiKey: wallet.apiKey,
        amount: solAmount,
        tokenSymbol: currentActiveToken.symbol,
        slippage: settings.buySlippage,
        priorityFee: settings.priorityFee,
        id: Date.now() + Math.random() // Unique ID for tracking
    });
}

// Sell token function - IMMEDIATE EXECUTION
async function sellToken(walletAddress, percentage) {
    const walletData = walletPositions.get(walletAddress);
    if (!walletData || !walletData.position || walletData.position.balance <= 0) return;
    
    const wallet = walletData.wallet;
    const position = walletData.position;
    const settings = walletSettings.get(walletAddress);
    
    // Execute immediately - no queue
    executeTrade({
        action: 'sell',
        mint: position.mint,
        walletAddress,
        walletName: wallet.name,
        privateKey: wallet.privateKey,
        apiKey: wallet.apiKey,
        percentage,
        tokenSymbol: position.symbol,
        amount: percentage === 100 ? "100%" : (position.balance * percentage / 100),
        slippage: settings.sellSlippage,
        priorityFee: settings.priorityFee,
        id: Date.now() + Math.random() // Unique ID for tracking
    });
}

// NUKE function - sells percentage of ALL positions
async function nukeAllPositions(percentage) {
    if (!currentActiveToken) return;
    
    console.log(`NUKING ${percentage}% of all positions!`);
    
    // Find all wallets with positions
    Array.from(walletPositions.entries()).forEach(([address, data]) => {
        if (data.position && data.position.mint === currentActiveToken.mint && data.position.balance > 0) {
            // Send sell for each wallet that has a position
            sellToken(address, percentage);
        }
    });
}

// Execute trade immediately without queue
async function executeTrade(transaction) {
    // Add to visual queue for tracking
    transactionQueue.push({
        ...transaction,
        status: 'processing',
        timestamp: Date.now()
    });
    updateQueueDisplay();
    
    // Retry logic - 3 attempts with 0.5s delay
    let attempts = 0;
    const maxAttempts = 3;
    let lastError = null;
    
    while (attempts < maxAttempts) {
        attempts++;
        console.log(`${transaction.action} attempt ${attempts}/${maxAttempts} for ${transaction.walletName}`);
        console.log(`Using slippage: ${transaction.slippage}%, priorityFee: ${transaction.priorityFee} SOL`);
        
        try {
            const response = await fetch(`https://pumpportal.fun/api/trade?api-key=${transaction.apiKey}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    "action": transaction.action,
                    "mint": transaction.mint,
                    "privateKey": transaction.privateKey,
                    "amount": transaction.amount,
                    "denominatedInSol": transaction.action === 'buy' ? "true" : "false",
                    "slippage": transaction.slippage,
                    "priorityFee": transaction.priorityFee,
                    "pool": "auto"
                })
            });
            
            const data = await response.json();
            
            if (data.signature) {
                // Update transaction status in queue
                const queueItem = transactionQueue.find(t => t.id === transaction.id);
                if (queueItem) {
                    queueItem.status = 'success';
                    queueItem.signature = data.signature;
                }
                console.log(`${transaction.action} successful on attempt ${attempts}: ${data.signature}`);
                updateQueueDisplay();
                
                // Clean up old queue items after 10 seconds
                setTimeout(() => {
                    const index = transactionQueue.findIndex(t => t.id === transaction.id);
                    if (index > -1) {
                        transactionQueue.splice(index, 1);
                        updateQueueDisplay();
                    }
                }, 10000);
                
                break; // Success - exit retry loop
                
            } else {
                lastError = data.error || 'Unknown error';
                console.log(`${transaction.action} failed on attempt ${attempts}: ${lastError}`);
                
                // Check if we should retry
                if (attempts < maxAttempts && 
                    (lastError.includes('insufficient') || 
                     lastError.includes('blockhash') ||
                     lastError.includes('failed'))) {
                    // Wait 0.5 seconds before retry
                    await new Promise(resolve => setTimeout(resolve, 500));
                    continue;
                }
                
                // Don't retry this error
                break;
            }
        } catch (error) {
            lastError = error.message;
            console.error(`${transaction.action} error on attempt ${attempts}:`, error);
            
            if (attempts < maxAttempts) {
                // Wait 0.5 seconds before retry
                await new Promise(resolve => setTimeout(resolve, 500));
                continue;
            }
        }
    }
    
    // If we exhausted all attempts and still failed
    if (!transactionQueue.find(t => t.id === transaction.id)?.signature) {
        const queueItem = transactionQueue.find(t => t.id === transaction.id);
        if (queueItem) {
            queueItem.status = 'error';
            queueItem.error = lastError;
        }
        console.error(`${transaction.action} failed after ${attempts} attempts:`, lastError);
        updateQueueDisplay();
        
        // Clean up failed items after 10 seconds
        setTimeout(() => {
            const index = transactionQueue.findIndex(t => t.id === transaction.id);
            if (index > -1) {
                transactionQueue.splice(index, 1);
                updateQueueDisplay();
            }
        }, 10000);
    }
}

// Test function to simulate a trade
function testTrade() {
    const testData = {
        txType: 'buy',
        traderPublicKey: WALLETS[0].address,
        mint: 'TEST123456789TEST123456789TEST123456789TEST',
        symbol: 'TEST',
        name: 'Test Token',
        solAmount: 0.1,
        tokenAmount: 1000000,
        newTokenBalance: 1000000,
        marketCapSol: 10,
        timestamp: Date.now() / 1000,
        signature: 'test-sig-' + Date.now()
    };
    
    console.log('Sending test trade:', testData);
    processTrade(testData);
}

// ========================================
// PART 3.4: WALLET BALANCE FUNCTIONS
// ========================================

async function fetchAllWalletBalances(isInitial = false) {
    const allWallets = getAllWallets();
    const promises = allWallets.map(wallet => fetchWalletBalance(wallet.address, isInitial));
    await Promise.all(promises);
    updatePortfolioStats();
}

async function fetchWalletBalance(walletAddress, isInitial = false) {
    try {
        const response = await fetch(RPC_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getBalance',
                params: [walletAddress]
            })
        });

        const data = await response.json();
        if (data.result && data.result.value !== undefined) {
            const balance = data.result.value / 1e9;
            walletBalances.set(walletAddress, balance);
            
            if (isInitial && !initialBalances.has(walletAddress)) {
                initialBalances.set(walletAddress, balance);
                if (!initialBalanceTime) {
                    initialBalanceTime = new Date();
                }
            }
        }
    } catch (error) {
        console.error(`Error fetching balance for ${walletAddress}:`, error);
    }
}

async function updateAllBalances() {
    const btn = document.getElementById('updateBalanceBtn');
    const icon = document.getElementById('refreshIcon');
    
    if (btn.classList.contains('loading')) return;
    
    btn.classList.add('loading');
    icon.classList.add('spinning');
    
    await fetchAllWalletBalances(false);
    updateWalletGrid();
    
    setTimeout(() => {
        btn.classList.remove('loading');
        icon.classList.remove('spinning');
    }, 500);
}

// ========================================
// PART 4: UI UPDATE FUNCTIONS
// ========================================

function updateUI() {
    updatePortfolioStats();
    updateWalletGrid();
    updateRecentActivity();
}

function updatePortfolioStats() {
    // Calculate total balances
    const totalInitial = Array.from(initialBalances.values()).reduce((sum, bal) => sum + bal, 0);
    const totalCurrent = Array.from(walletBalances.values()).reduce((sum, bal) => sum + bal, 0);
    const realizedPnl = totalCurrent - totalInitial;
    const realizedPnlPercent = totalInitial > 0 ? (realizedPnl / totalInitial) * 100 : 0;
    const winRate = (winCount + lossCount) > 0 ? (winCount / (winCount + lossCount)) * 100 : 0;
    
    document.getElementById('initialHoldings').textContent = `${totalInitial.toFixed(4)} SOL`;
    document.getElementById('currentHoldings').textContent = `${totalCurrent.toFixed(4)} SOL`;
    document.getElementById('realizedPnl').textContent = `${realizedPnl >= 0 ? '+' : ''}${realizedPnl.toFixed(4)} SOL`;
    document.getElementById('realizedPnl').className = `stat-value ${realizedPnl >= 0 ? 'positive' : 'negative'}`;
    document.getElementById('winRate').textContent = `${winRate.toFixed(0)}% (${winCount}W/${lossCount}L)`;
}

function updateTradeStats() {
    document.getElementById('liveBuyCount').textContent = tokenBuyCount;
    document.getElementById('liveSellCount').textContent = tokenSellCount;
    
    const netFlowEl = document.getElementById('netFlow');
    netFlowEl.textContent = `${netTokenFlow >= 0 ? '+' : ''}${netTokenFlow.toFixed(4)} SOL`;
    netFlowEl.style.color = netTokenFlow >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
}

function updateTradeFlow() {
    const flowContainer = document.getElementById('tradeFlow');
    
    if (tokenTrades.length === 0) {
        flowContainer.innerHTML = '<div class="empty-state"><p>Waiting for trades...</p></div>';
        return;
    }
    
    flowContainer.innerHTML = tokenTrades.slice(0, 50).map(trade => {
        const isBuy = trade.txType === 'buy';
        const isCreate = trade.txType === 'create';
        const trader = shortenAddress(trade.traderPublicKey);
        const amount = trade.solAmount.toFixed(4);
        const tokens = formatNumber(trade.tokenAmount || trade.initialBuy || 0);
        const mcUsd = (trade.marketCapSol * 161).toFixed(0);
        
        let typeClass = isBuy ? 'buy' : (isCreate ? 'create' : 'sell');
        let typeText = isBuy ? 'BUY' : (isCreate ? 'CREATE' : 'SELL');
        
        return `
            <div class="trade-item ${typeClass}">
                <div class="trade-info">
                    <span class="trade-type-badge ${typeClass}">${typeText}</span>
                    <div class="trade-details">
                        <span class="trade-amount">${amount} SOL</span>
                        <span style="color: var(--text-tertiary);">for ${tokens} tokens</span>
                    </div>
                    <span style="color: var(--text-tertiary); font-size: 11px;">${trader}</span>
                </div>
                <div class="trade-mc">
                    <div class="trade-mc-label">Market Cap</div>
                    <div class="trade-mc-value">${formatNumber(mcUsd)}</div>
                </div>
            </div>
        `;
    }).join('');
}

// ========================================
// PART 4.1: WALLET GRID UPDATE
// ========================================

function updateWalletGrid() {
    const grid = document.getElementById('walletsGrid');
    
    console.log('UpdateWalletGrid - currentActiveToken:', currentActiveToken);
    
    let gridHTML = '';
    
    // Always show the holdings panel
    let totalTokenBalance = 0;
    let totalSolValue = 0;
    let totalWeightedMC = 0;
    let totalTokensBought = 0;
    
    // Calculate totals if there's an active token - using ONLY PumpPortal balances
    if (currentActiveToken) {
        Array.from(walletPositions.entries()).forEach(([address, data]) => {
            if (data.position && data.position.mint === currentActiveToken.mint) {
                totalTokenBalance += data.position.balance; // This is now always from PumpPortal
                totalSolValue += data.position.balance * data.position.avgPrice;
                totalWeightedMC += data.position.entryMarketCapSol * data.position.totalBought;
                totalTokensBought += data.position.totalBought;
            }
        });
    }
    
    const holdingPercentage = totalTokenBalance > 0 ? (totalTokenBalance / 1000000000) * 100 : 0;
    const avgEntryMC = totalTokensBought > 0 ? totalWeightedMC / totalTokensBought : 0;
    const avgEntryMCUSD = avgEntryMC * 161; // SOL at $161
    
    // Calculate MC P&L
    let mcPnlPercent = 0;
    let mcPnlClass = '';
    if (avgEntryMCUSD > 0 && currentMarketCapUSD > 0) {
        mcPnlPercent = ((currentMarketCapUSD / avgEntryMCUSD) - 1) * 100;
        mcPnlClass = mcPnlPercent >= 0 ? 'positive' : 'negative';
    }

    // Calculate Others' SOL function
    function calculateOthersSol() {
        if (!currentActiveToken || currentSolInBondingCurve === 0) {
            return 0;
        }
        
        // Calculate total SOL invested by all our wallets
        let myTotalInvestment = 0;
        
        Array.from(walletPositions.entries()).forEach(([address, data]) => {
            if (data.position && data.position.mint === currentActiveToken.mint) {
                myTotalInvestment += data.position.totalInvested;
            }
        });
        
        // Calculate others' SOL: Total in curve - Base amount - My investment
        const othersSol = Math.max(0, currentSolInBondingCurve - BASE_SOL_IN_CURVE - myTotalInvestment);
        
        return othersSol;
    }
    
    // Always display the holdings panel with values or placeholders
    gridHTML += `
        <div class="token-holdings-panel" style="grid-column: 1 / -1;">
            <div class="holdings-section position-section">
                <div class="nuke-buttons">
                    <button class="nuke-btn" onmousedown="nukeAllPositions(25)" ${!currentActiveToken ? 'disabled' : ''}>NUKE 25%</button>
                    <button class="nuke-btn" onmousedown="nukeAllPositions(50)" ${!currentActiveToken ? 'disabled' : ''}>NUKE 50%</button>
                    <button class="nuke-btn" onmousedown="nukeAllPositions(100)" ${!currentActiveToken ? 'disabled' : ''}>NUKE 100%</button>
                </div>
                <div class="holdings-stats">
                    <div class="holdings-stat">
                        <div class="holdings-label">Total Holdings</div>
                        <div class="holdings-value highlight">${holdingPercentage.toFixed(4)}%</div>
                    </div>
                    <div class="holdings-stat">
                        <div class="holdings-label">Total Value</div>
                        <div class="holdings-value">${totalSolValue.toFixed(4)} SOL</div>
                    </div>
                    <div class="holdings-stat">
                        <div class="holdings-label">Avg Entry MC</div>
                        <div class="holdings-value">${avgEntryMCUSD > 0 ? formatNumber(avgEntryMCUSD) : '$0.00'}</div>
                    </div>
                </div>
            </div>
            <div class="holdings-section market-section">
                <div class="market-stats">
                    <div class="market-stat">
                        <div class="market-label">Buys / Sells</div>
                        <div class="market-value">${tokenBuyCount} / ${tokenSellCount}</div>
                    </div>
                    <div class="market-stat">
                        <div class="market-label">Volume</div>
                        <div class="market-value">${formatNumber(totalTokenVolume * SOL_PRICE_USD)}</div>
                    </div>
                    <div class="market-stat">
                        <div class="market-label">Market Cap</div>
                        <div class="market-value">${formatNumber(currentMarketCapUSD)}</div>
                    </div>
                    <div class="market-stat">
                        <div class="market-label">MC P&L</div>
                        <div class="market-value mc-pnl ${mcPnlClass}">
                            ${mcPnlPercent >= 0 ? '+' : ''}${mcPnlPercent.toFixed(2)}%
                        </div>
                    </div>
                    <div class="market-stat others-sol">
                        <div class="market-label others-sol-tooltip">Others' SOL</div>
                        <div class="market-value others-sol-value">${calculateOthersSol().toFixed(2)} SOL</div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Display all wallets
    const allWallets = getAllWallets();
    gridHTML += allWallets.map((wallet) => {
        const address = wallet.address;
        const walletData = walletPositions.get(address);
        const position = walletData?.position;
        const balance = walletBalances.get(address) || 0;
        
        // Check if this wallet has the current active token
        const hasToken = position && position.mint === currentActiveToken?.mint;
        const tokenBalance = hasToken ? position.balance : 0; // Always from PumpPortal
        
        // Show auto-trade indicators
        const autoBuyEnabled = autoTradeConfig.autoBuy.enabled && 
            autoTradeConfig.autoBuy.sequence.some(s => s.walletAddress === address);
        const autoSellConfig = autoTradeConfig.autoSell.wallets[address];
        const autoSellEnabled = autoTradeConfig.autoSell.enabled && 
            autoSellConfig?.enabled && autoSellConfig?.triggers?.length > 0;
        const spamLaunchEnabled = spamLaunchConfig.enabled && 
            spamLaunchConfig.launches.some(l => l.walletAddress === address);
        
        // FIX: Include spamLaunchEnabled in the condition check
        const autoIndicators = (autoBuyEnabled || autoSellEnabled || spamLaunchEnabled) ? `
            <div class="wallet-auto-indicators">
                ${autoBuyEnabled ? '<div class="auto-indicator buy" title="Auto-buy enabled">B</div>' : ''}
                ${autoSellEnabled ? '<div class="auto-indicator sell" title="Auto-sell enabled">S</div>' : ''}
                ${spamLaunchEnabled ? '<div class="auto-indicator launch" title="Spam launch enabled">L</div>' : ''}
            </div>
        ` : '';
        
        // Calculate P&L if position exists - using totalInvested for accuracy
        let pnlDisplay = '';
        if (hasToken && tokenBalance > 0) {
            // Use live market cap if available, otherwise use position avg price
            const currentMarketCapSol = position.currentMarketCapSol || position.entryMarketCapSol;
            const multiplier = currentMarketCapSol / position.entryMarketCapSol;
            const currentValue = position.totalInvested * multiplier;
            const pnl = currentValue - position.totalInvested;
            const pnlPercent = position.totalInvested > 0 ? (pnl / position.totalInvested) * 100 : 0;
            
            pnlDisplay = `
                <div class="wallet-pnl ${pnl >= 0 ? 'positive' : 'negative'}">
                    ${pnl >= 0 ? '+' : ''}${formatNumber(pnl)} SOL (${pnl >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)
                    ${multiplier !== 1 ? `<span style="color: var(--accent-primary); font-size: 11px;"> • ${multiplier.toFixed(2)}x</span>` : ''}
                </div>
            `;
        } else {
            // Placeholder for P&L
            pnlDisplay = `<div class="wallet-pnl placeholder">P&L will appear here</div>`;
        }
        
        // Entry info with placeholder
        let entryInfo = '';
        if (hasToken && position.entryMarketCapSol) {
            const entryMCUSD = position.entryMarketCapSol * 161;
            const entryTime = position.entryTimestamp ? new Date(position.entryTimestamp * 1000).toLocaleTimeString() : '';
            entryInfo = `
                Entry MC: <span class="wallet-entry-mc">${formatNumber(entryMCUSD)}</span>
                ${entryTime ? `<span class="wallet-entry-time"> • ${entryTime}</span>` : ''}
            `;
        } else {
            entryInfo = `<span style="color: var(--text-tertiary);">Entry info will appear here</span>`;
        }
        
        const settings = walletSettings.get(address) || { buyAmounts: [0.1, 0.5, 1], sellPercentages: [25, 50, 100] };
        
        // Holdings display with placeholder
        const holdingsDisplay = hasToken ? 
            `${formatNumber(tokenBalance)} ${currentActiveToken.symbol}` : 
            `<span style="color: var(--text-tertiary);">No position</span>`;
        
        // Value display with placeholder
        const valueDisplay = hasToken && tokenBalance > 0 ? 
            `Value: ${formatNumber(tokenBalance * position.avgPrice)} SOL` : 
            `<span style="color: var(--text-tertiary);">Awaiting position</span>`;
        
        // Check if this is the dev wallet
        const isDevWallet = wallet.isDevWallet;
        
        return `
            <div class="wallet-card ${isDevWallet ? 'dev-wallet' : ''}" data-wallet="${address}">
                ${autoIndicators}
                <div class="wallet-identifier">
                    <span class="wallet-name">${wallet.name}</span>
                    ${isDevWallet ? '<span class="dev-wallet-badge">DEV</span>' : ''}
                </div>
                <div class="wallet-balance">${balance.toFixed(4)} SOL</div>
                <div class="wallet-holdings ${hasToken ? '' : 'no-position'}">
                    ${holdingsDisplay}
                </div>
                <div class="wallet-value">
                    ${valueDisplay}
                </div>
                <div class="wallet-entry-info">
                    ${entryInfo}
                </div>
                <div class="wallet-pnl-container">
                    ${pnlDisplay}
                </div>
                <div class="wallet-actions">
                    ${currentActiveToken ? `
                        <div class="action-row">
                            <button class="buy-btn" onmousedown="buyToken('${address}', ${settings.buyAmounts[0]})">Buy ${settings.buyAmounts[0].toFixed(2)}</button>
                            <button class="buy-btn" onmousedown="buyToken('${address}', ${settings.buyAmounts[1]})">Buy ${settings.buyAmounts[1].toFixed(2)}</button>
                            <button class="buy-btn" onmousedown="buyToken('${address}', ${settings.buyAmounts[2]})">Buy ${settings.buyAmounts[2].toFixed(2)}</button>
                        </div>
                        <div class="action-row">
                            <button class="sell-btn" ${!hasToken || tokenBalance <= 0 ? 'disabled' : ''} onmousedown="sellToken('${address}', ${settings.sellPercentages[0]})">Sell ${settings.sellPercentages[0]}%</button>
                            <button class="sell-btn" ${!hasToken || tokenBalance <= 0 ? 'disabled' : ''} onmousedown="sellToken('${address}', ${settings.sellPercentages[1]})">Sell ${settings.sellPercentages[1]}%</button>
                            <button class="sell-btn" ${!hasToken || tokenBalance <= 0 ? 'disabled' : ''} onmousedown="sellToken('${address}', ${settings.sellPercentages[2]})">Sell ${settings.sellPercentages[2]}%</button>
                        </div>
                    ` : `
                        <div class="action-row">
                            <button class="buy-btn" disabled>Buy ${settings.buyAmounts[0].toFixed(2)}</button>
                            <button class="buy-btn" disabled>Buy ${settings.buyAmounts[1].toFixed(2)}</button>
                            <button class="buy-btn" disabled>Buy ${settings.buyAmounts[2].toFixed(2)}</button>
                        </div>
                        <div class="action-row">
                            <button class="sell-btn" disabled>Sell ${settings.sellPercentages[0]}%</button>
                            <button class="sell-btn" disabled>Sell ${settings.sellPercentages[1]}%</button>
                            <button class="sell-btn" disabled>Sell ${settings.sellPercentages[2]}%</button>
                        </div>
                    `}
                </div>
            </div>
        `;
    }).join('');
    
    grid.innerHTML = gridHTML;
}

// ========================================
// PART 4.2: ACTIVITY AND QUEUE UPDATES
// ========================================

function updateRecentActivity() {
    const list = document.getElementById('activityList');
    
    if (recentActivity.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <p>No recent activity</p>
                <div class="loading-spinner"></div>
            </div>
        `;
        return;
    }
    
    list.innerHTML = recentActivity.slice(0, 20).map(trade => {
        // Extract trade type from multiple possible fields
        const tradeType = trade.txType || trade.type || trade.side || trade.action || 'unknown';
        const isBuy = tradeType.toLowerCase().includes('buy');
        const isSell = tradeType.toLowerCase().includes('sell');
        const isCreate = tradeType.toLowerCase().includes('create');
        const isSpamLaunch = tradeType === 'spam-launch';
        
        // Determine type class for styling
        let typeClass = '';
        if (isBuy) typeClass = 'buy';
        else if (isSell) typeClass = 'sell';
        else if (isCreate) typeClass = 'create';
        else if (isSpamLaunch) typeClass = 'spam-launch';
        
        // Display type text
        let displayType = tradeType.toUpperCase();
        if (isSpamLaunch) displayType = 'SPAM';
        
        // Extract symbol from multiple possible fields
        const symbol = trade.symbol || trade.tokenSymbol || 'UNKNOWN';
        
        // Extract amount from multiple possible fields
        const amount = trade.solAmount || trade.sol || trade.amount || trade.initialBuy || 0;
        
        // Build auto-sell info for spam launches
        const autoSellInfo = trade.autoSell ? 
            `<div class="activity-auto-sell">Auto-sell: ${trade.autoSell}</div>` : '';
        
        // Build wallet info
        const walletInfo = trade.walletName || 'Unknown Wallet';
        const walletLabel = trade.isDevWallet ? ' (DEV)' : 
                          isSpamLaunch ? ' (SPAM)' : '';
        
        return `
            <div class="activity-item">
                <div class="activity-header-row">
                    <span class="activity-type ${typeClass}">${displayType}</span>
                    <span class="activity-time">${formatTime(trade.timestamp || Date.now() / 1000)}</span>
                </div>
                <div class="activity-details">
                    <span>${symbol}</span>
                    <span>${formatNumber(amount)} SOL</span>
                </div>
                <div class="activity-wallet">${walletInfo}${walletLabel}</div>
                ${autoSellInfo}
            </div>
        `;
    }).join('');
}

function updateQueueDisplay() {
    const queueContainer = document.getElementById('transactionQueue');
    const queueItems = document.getElementById('queueItems');
    
    const activeTransactions = transactionQueue.filter(t => 
        t.status === 'pending' || t.status === 'processing'
    );
    
    if (activeTransactions.length === 0) {
        queueContainer.classList.remove('active');
        return;
    }
    
    queueContainer.classList.add('active');
    
    queueItems.innerHTML = transactionQueue.slice(-5).reverse().map(t => {
        let statusClass = '';
        let statusText = '';
        
        switch(t.status) {
            case 'pending':
                statusClass = '';
                statusText = 'Pending...';
                break;
            case 'processing':
                statusClass = 'processing';
                statusText = 'Processing...';
                break;
            case 'success':
                statusClass = 'success';
                statusText = 'Success ✓';
                break;
            case 'error':
                statusClass = 'error';
                statusText = `Error: ${t.error}`;
                break;
        }
        
        const actionText = t.action === 'buy' ? 
            `Buy ${t.amount} SOL ${t.tokenSymbol}` : 
            `Sell ${t.percentage}% ${t.tokenSymbol}`;
        
        return `
            <div class="queue-item ${statusClass}">
                <div>${actionText} - ${t.walletName}</div>
                <div style="font-size: 10px; color: var(--text-tertiary); margin-top: 4px;">${statusText}</div>
            </div>
        `;
    }).join('');
}

// ========================================
// PART 4.3: WALLET MANAGER UI
// ========================================

// Wallet Manager Functions
function toggleWalletManager() {
    const window = document.getElementById('walletManagerWindow');
    const overlay = document.getElementById('walletManagerOverlay');
    
    if (window.classList.contains('active')) {
        closeWalletManager();
    } else {
        window.classList.add('active');
        overlay.classList.add('active');
        updateWalletManagerList();
    }
}

function closeWalletManager() {
    document.getElementById('walletManagerWindow').classList.remove('active');
    document.getElementById('walletManagerOverlay').classList.remove('active');
}

function updateWalletManagerList() {
    const list = document.getElementById('walletManagerList');
    let totalBalance = 0;
    
    list.innerHTML = WALLETS.map(wallet => {
        const address = wallet.address;
        const currentBalance = walletBalances.get(address) || 0;
        const initialBalance = initialBalances.get(address) || 0;
        const settings = walletSettings.get(address) || { 
            buyAmounts: [0.1, 0.5, 1], 
            sellPercentages: [25, 50, 100],
            buySlippage: 80,
            sellSlippage: 99,
            priorityFee: 0.00005
        };
        const position = walletPositions.get(address)?.position;
        
        totalBalance += currentBalance;
        
        const hasPosition = position && position.balance > 0 && currentActiveToken;
        
        return `
            <div class="wallet-manager-item">
                <div class="wallet-manager-info">
                    <div class="wallet-manager-name">${wallet.name}</div>
                    <div class="wallet-manager-address">${shortenAddress(address)}</div>
                    <div class="wallet-manager-balances">
                        <span class="balance-info">Initial: <span class="balance-value">${initialBalance.toFixed(4)} SOL</span></span>
                        <span class="balance-info">Current: <span class="balance-value">${currentBalance.toFixed(4)} SOL</span></span>
                        ${hasPosition ? `<span class="balance-info">Holdings: <span class="balance-value">${formatNumber(position.balance)} ${position.symbol}</span></span>` : ''}
                    </div>
                </div>
                <div class="wallet-manager-actions">
                    <div class="action-group">
                        <div class="action-label">Buy Amounts (SOL)</div>
                        <div class="action-row">
                            <input type="number" 
                                class="amount-input" 
                                id="buyAmount1-${address}" 
                                value="${settings.buyAmounts[0]}" 
                                step="0.1" 
                                min="0.01"
                                placeholder="Buy 1"
                                onchange="updateWalletSettings('${address}', 'buy', 0, this.value)">
                            <input type="number" 
                                class="amount-input" 
                                id="buyAmount2-${address}" 
                                value="${settings.buyAmounts[1]}" 
                                step="0.1" 
                                min="0.01"
                                placeholder="Buy 2"
                                onchange="updateWalletSettings('${address}', 'buy', 1, this.value)">
                            <input type="number" 
                                class="amount-input" 
                                id="buyAmount3-${address}" 
                                value="${settings.buyAmounts[2]}" 
                                step="0.1" 
                                min="0.01"
                                placeholder="Buy 3"
                                onchange="updateWalletSettings('${address}', 'buy', 2, this.value)">
                        </div>
                    </div>
                    <div class="action-group">
                        <div class="action-label">Sell Percentages (%)</div>
                        <div class="action-row">
                            <input type="number" 
                                class="amount-input" 
                                id="sellPercent1-${address}" 
                                value="${settings.sellPercentages[0]}" 
                                step="5" 
                                min="1"
                                max="100"
                                placeholder="Sell 1"
                                onchange="updateWalletSettings('${address}', 'sell', 0, this.value)">
                            <input type="number" 
                                class="amount-input" 
                                id="sellPercent2-${address}" 
                                value="${settings.sellPercentages[1]}" 
                                step="5" 
                                min="1"
                                max="100"
                                placeholder="Sell 2"
                                onchange="updateWalletSettings('${address}', 'sell', 1, this.value)">
                            <input type="number" 
                                class="amount-input" 
                                id="sellPercent3-${address}" 
                                value="${settings.sellPercentages[2]}" 
                                step="5" 
                                min="1"
                                max="100"
                                placeholder="Sell 3"
                                onchange="updateWalletSettings('${address}', 'sell', 2, this.value)">
                        </div>
                    </div>
                    <div class="action-group">
                        <div class="action-label">Slippage & Priority Fee</div>
                        <div class="action-row">
                            <div class="input-wrapper">
                                <span class="slippage-label">BUY</span>
                                <input type="number" 
                                    class="amount-input" 
                                    id="buySlippage-${address}" 
                                    value="${settings.buySlippage}" 
                                    step="1" 
                                    min="0.1"
                                    max="100"
                                    placeholder="Buy %"
                                    title="Buy Slippage %"
                                    onchange="updateWalletSettings('${address}', 'buySlippage', null, this.value)">
                            </div>
                            <div class="input-wrapper">
                                <span class="slippage-label">SELL</span>
                                <input type="number" 
                                    class="amount-input" 
                                    id="sellSlippage-${address}" 
                                    value="${settings.sellSlippage}" 
                                    step="1" 
                                    min="0.1"
                                    max="100"
                                    placeholder="Sell %"
                                    title="Sell Slippage %"
                                    onchange="updateWalletSettings('${address}', 'sellSlippage', null, this.value)">
                            </div>
                            <div class="input-wrapper">
                                <span class="slippage-label">FEE</span>
                                <input type="number" 
                                    class="amount-input" 
                                    id="priorityFee-${address}" 
                                    value="${settings.priorityFee}" 
                                    step="0.00001" 
                                    min="0"
                                    max="0.1"
                                    placeholder="SOL"
                                    title="Priority Fee (SOL)"
                                    onchange="updateWalletSettings('${address}', 'priorityFee', null, this.value)">
                            </div>
                        </div>
                    </div>
                    <div style="margin-top: 12px;">
                        <button class="remove-wallet-btn" onclick="removeTradingWallet('${address}')">Remove Wallet</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    // Include dev wallet balance if configured
    if (DEV_WALLET) {
        const devBalance = walletBalances.get(DEV_WALLET.address) || 0;
        totalBalance += devBalance;
    }
    
    document.getElementById('totalBalanceInfo').textContent = `Total: ${totalBalance.toFixed(4)} SOL`;
}

// ========================================
// PART 4.4: WINDOW MANAGEMENT
// ========================================

// Activity Window Functions
function toggleActivityWindow() {
    const window = document.getElementById('activityWindow');
    if (window.classList.contains('active')) {
        closeActivityWindow();
    } else {
        window.classList.add('active');
    }
}

function closeActivityWindow() {
    document.getElementById('activityWindow').classList.remove('active');
}

// Initialize activity window dragging
function initializeActivityWindowDragging() {
    const window = document.getElementById('activityWindow');
    const header = document.getElementById('activityWindowHeader');
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;

    header.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);

    function dragStart(e) {
        if (e.target.closest('.activity-window-close')) return;
        
        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;

        if (e.target === header || header.contains(e.target)) {
            isDragging = true;
        }
    }

    function dragEnd(e) {
        initialX = currentX;
        initialY = currentY;
        isDragging = false;
    }

    function drag(e) {
        if (isDragging) {
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;

            xOffset = currentX;
            yOffset = currentY;

            window.style.transform = `translate(calc(-50% + ${currentX}px), calc(-50% + ${currentY}px))`;
        }
    }
}

// Window dragging functionality
function initializeWindowDragging() {
    const window = document.getElementById('walletManagerWindow');
    const header = document.getElementById('windowHeader');
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;

    header.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);

    function dragStart(e) {
        if (e.target.closest('.window-close')) return;
        
        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;

        if (e.target === header || header.contains(e.target)) {
            isDragging = true;
        }
    }

    function dragEnd(e) {
        initialX = currentX;
        initialY = currentY;
        isDragging = false;
    }

    function drag(e) {
        if (isDragging) {
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;

            xOffset = currentX;
            yOffset = currentY;

            window.style.transform = `translate(calc(-50% + ${currentX}px), calc(-50% + ${currentY}px))`;
        }
    }
}

// ========================================
// PART 5: AUTO TRADE FUNCTIONS
// ========================================

// Auto Trade Window Management
function toggleAutoTrade() {
    const window = document.getElementById('autoTradeWindow');
    const overlay = document.getElementById('autoTradeOverlay');
    
    if (window.classList.contains('active')) {
        closeAutoTrade();
    } else {
        window.classList.add('active');
        overlay.classList.add('active');
        updateAutoTradeUI();
    }
}

function closeAutoTrade() {
    document.getElementById('autoTradeWindow').classList.remove('active');
    document.getElementById('autoTradeOverlay').classList.remove('active');
}

function toggleAutoBuy() {
    console.log('=== TOGGLE AUTO-BUY ===');
    console.log('Before toggle:', autoTradeConfig.autoBuy.enabled);
    
    autoTradeConfig.autoBuy.enabled = !autoTradeConfig.autoBuy.enabled;
    
    console.log('After toggle:', autoTradeConfig.autoBuy.enabled);
    console.log('Full config:', JSON.parse(JSON.stringify(autoTradeConfig)));
    
    updateAutoTradeUI();
    updateAutoTradeButton();
    
    // Auto-save immediately
    saveAutoTradeSettings();
}

function toggleAutoSell() {
    autoTradeConfig.autoSell.enabled = !autoTradeConfig.autoSell.enabled;
    updateAutoTradeUI();
    updateAutoTradeButton();
}

function updateAutoTradeButton() {
    const btn = document.getElementById('autoTradeBtn');
    if (autoTradeConfig.autoBuy.enabled || autoTradeConfig.autoSell.enabled) {
        btn.classList.add('active');
    } else {
        btn.classList.remove('active');
    }
}

function updateAutoTradeUI() {
    // Update toggles
    const buyToggle = document.getElementById('autoBuyToggle');
    const sellToggle = document.getElementById('autoSellToggle');
    
    if (autoTradeConfig.autoBuy.enabled) {
        buyToggle.classList.add('active');
    } else {
        buyToggle.classList.remove('active');
    }
    
    if (autoTradeConfig.autoSell.enabled) {
        sellToggle.classList.add('active');
    } else {
        sellToggle.classList.remove('active');
    }
    
    // Update buy sequence
    updateBuySequenceList();
    
    // Update sell configurations
    updateAutoSellWallets();
}

// ========================================
// PART 5.1: AUTO BUY CONFIGURATION
// ========================================

function updateBuySequenceList() {
    const container = document.getElementById('buySequenceList');
    const allWallets = getAllWallets();
    
    container.innerHTML = autoTradeConfig.autoBuy.sequence.map((item, index) => {
        const wallet = allWallets.find(w => w.address === item.walletAddress);
        const walletName = wallet ? wallet.name : 'Unknown Wallet';
        
        return `
            <div class="buy-sequence-item" draggable="true" data-index="${index}">
                <div class="sequence-handle">≡</div>
                <div class="sequence-number">${index + 1}</div>
                <select class="sequence-wallet-select" onchange="updateBuySequenceWallet(${index}, this.value)">
                    <option value="">Select Wallet</option>
                    ${allWallets.map(w => `
                        <option value="${w.address}" ${item.walletAddress === w.address ? 'selected' : ''}>
                            ${w.name}
                        </option>
                    `).join('')}
                </select>
                <div class="sequence-settings">
                    <div>
                        <span class="sequence-label">Amount</span>
                        <input type="number" class="sequence-input" 
                            value="${item.amount}" 
                            step="0.1" 
                            min="0.01"
                            placeholder="SOL"
                            onchange="updateBuySequenceItem(${index}, 'amount', this.value)">
                    </div>
                    <div>
                        <span class="sequence-label">Delay</span>
                        <input type="number" class="sequence-input" 
                            value="${item.delay}" 
                            step="100" 
                            min="0"
                            placeholder="ms"
                            onchange="updateBuySequenceItem(${index}, 'delay', this.value)">
                    </div>
                    <div>
                        <span class="sequence-label">Slip %</span>
                        <input type="number" class="sequence-input" 
                            value="${item.slippage || 80}" 
                            step="1" 
                            min="1"
                            max="100"
                            placeholder="%"
                            onchange="updateBuySequenceItem(${index}, 'slippage', this.value)">
                    </div>
                    <div>
                        <span class="sequence-label">Fee</span>
                        <input type="number" class="sequence-input" 
                            value="${item.priorityFee || 0.00005}" 
                            step="0.00001" 
                            min="0"
                            placeholder="SOL"
                            onchange="updateBuySequenceItem(${index}, 'priorityFee', this.value)">
                    </div>
                </div>
                <button class="sequence-remove" onclick="removeBuySequenceItem(${index})">×</button>
            </div>
        `;
    }).join('');
    
    // Initialize drag and drop
    initializeDragAndDrop();
}

function addBuySequenceItem() {
    autoTradeConfig.autoBuy.sequence.push({
        walletAddress: '',
        amount: 0.1,
        delay: autoTradeConfig.autoBuy.sequence.length * 100,
        slippage: 80,
        priorityFee: 0.00005
    });
    updateBuySequenceList();
}

function removeBuySequenceItem(index) {
    autoTradeConfig.autoBuy.sequence.splice(index, 1);
    updateBuySequenceList();
}

function updateBuySequenceWallet(index, walletAddress) {
    autoTradeConfig.autoBuy.sequence[index].walletAddress = walletAddress;
}

function updateBuySequenceItem(index, field, value) {
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue >= 0) {
        autoTradeConfig.autoBuy.sequence[index][field] = numValue;
    }
}

// Execute auto-buy sequence
async function executeAutoBuySequence() {
    console.log('=== EXECUTE AUTO-BUY SEQUENCE CALLED ===');
    console.log('currentActiveToken:', currentActiveToken);
    console.log('autoTradeConfig.autoBuy.enabled:', autoTradeConfig.autoBuy.enabled);
    console.log('typeof enabled:', typeof autoTradeConfig.autoBuy.enabled);
    
    // Make sure we're checking boolean properly
    if (!currentActiveToken || autoTradeConfig.autoBuy.enabled !== true) {
        console.log('=== AUTO-BUY BLOCKED ===');
        console.log('No token:', !currentActiveToken);
        console.log('Not enabled:', autoTradeConfig.autoBuy.enabled !== true);
        return;
    }
    
    console.log('=== AUTO-BUY PROCEEDING ===');
    console.log('Executing auto-buy sequence for token:', currentActiveToken.symbol);
    console.log('Number of wallets in sequence:', autoTradeConfig.autoBuy.sequence.length);
    
    // Create array of buy promises that execute in parallel
    const buyPromises = autoTradeConfig.autoBuy.sequence.map(async (item, index) => {
        console.log(`Processing sequence item ${index + 1}:`, item);
        
        if (!item.walletAddress || item.amount <= 0) {
            console.log(`Skipping sequence item ${index + 1}: Invalid wallet or amount`);
            return;
        }
        
        // Find wallet
        const allWallets = getAllWallets();
        const wallet = allWallets.find(w => w.address === item.walletAddress);
        if (!wallet) {
            console.log(`Skipping sequence item ${index + 1}: Wallet not found`);
            return;
        }
        
        // Wait for this wallet's specific delay
        if (item.delay > 0) {
            console.log(`${wallet.name} waiting ${item.delay}ms before buying...`);
            await new Promise(resolve => setTimeout(resolve, item.delay));
        }
        
        console.log(`${wallet.name} executing buy of ${item.amount} SOL at ${new Date().toLocaleTimeString()}`);
        
        // Execute buy
        return executeTrade({
            action: 'buy',
            mint: currentActiveToken.mint,
            walletAddress: item.walletAddress,
            walletName: wallet.name,
            privateKey: wallet.privateKey,
            apiKey: wallet.apiKey,
            amount: item.amount,
            tokenSymbol: currentActiveToken.symbol,
            slippage: item.slippage || 80,
            priorityFee: item.priorityFee || 0.00005,
            id: Date.now() + Math.random(),
            isAutoBuy: true
        });
    });
    
    // Execute all buys in parallel
    console.log(`Starting parallel execution of ${buyPromises.length} auto-buys`);
    await Promise.all(buyPromises);
    console.log('All auto-buys completed');
}

// ========================================
// PART 5.2: AUTO SELL CONFIGURATION
// ========================================

function updateAutoSellWallets() {
    const container = document.getElementById('autoSellWallets');
    const allWallets = getAllWallets();
    
    container.innerHTML = allWallets.map(wallet => {
        const config = autoTradeConfig.autoSell.wallets[wallet.address] || { triggers: [], slippage: 99 };
        
        return `
            <div class="auto-sell-wallet-config">
                <div class="auto-sell-wallet-header">
                    <span class="auto-sell-wallet-name">${wallet.name}</span>
                    <div class="toggle-switch ${config.enabled ? 'active' : ''}" 
                        onclick="toggleWalletAutoSell('${wallet.address}')"></div>
                </div>
                <div class="auto-sell-triggers">
                    ${config.triggers.map((trigger, index) => `
                        <div class="trigger-item">
                            <select class="trigger-type-select" 
                                onchange="updateSellTrigger('${wallet.address}', ${index}, 'type', this.value)">
                                <option value="time" ${trigger.type === 'time' ? 'selected' : ''}>Time</option>
                                <option value="profit" ${trigger.type === 'profit' ? 'selected' : ''}>Profit</option>
                                <option value="marketcap" ${trigger.type === 'marketcap' ? 'selected' : ''}>Market Cap</option>
                                <option value="devSell" ${trigger.type === 'devSell' ? 'selected' : ''}>Dev Sells</option>
                            </select>
                            ${trigger.type === 'time' ? `
                                <input type="number" class="trigger-input" 
                                    value="${trigger.value}" 
                                    placeholder="sec"
                                    onchange="updateSellTrigger('${wallet.address}', ${index}, 'value', this.value)">
                                <span class="trigger-label">seconds</span>
                            ` : trigger.type === 'profit' ? `
                                <input type="number" class="trigger-input" 
                                    value="${trigger.value}" 
                                    step="0.1"
                                    placeholder="x"
                                    onchange="updateSellTrigger('${wallet.address}', ${index}, 'value', this.value)">
                                <span class="trigger-label">x profit</span>
                            ` : trigger.type === 'marketcap' ? `
                                <span class="trigger-label">$</span>
                                <input type="number" class="trigger-input" 
                                    value="${trigger.value}" 
                                    placeholder="USD"
                                    onchange="updateSellTrigger('${wallet.address}', ${index}, 'value', this.value)">
                            ` : `
                                <span class="trigger-label">When dev sells</span>
                            `}
                            <span class="trigger-label">Sell</span>
                            <input type="number" class="trigger-input" 
                                value="${trigger.sellPercent}" 
                                min="1" 
                                max="100"
                                placeholder="%"
                                onchange="updateSellTrigger('${wallet.address}', ${index}, 'sellPercent', this.value)">
                            <span class="trigger-label">%</span>
                            <button class="remove-trigger-btn" 
                                onclick="removeSellTrigger('${wallet.address}', ${index})">×</button>
                        </div>
                    `).join('')}
                    <button class="add-trigger-btn" onclick="addSellTrigger('${wallet.address}')">
                        + Add Trigger
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function toggleWalletAutoSell(walletAddress) {
    if (!autoTradeConfig.autoSell.wallets[walletAddress]) {
        autoTradeConfig.autoSell.wallets[walletAddress] = { triggers: [], slippage: 99, enabled: false };
    }
    autoTradeConfig.autoSell.wallets[walletAddress].enabled = 
        !autoTradeConfig.autoSell.wallets[walletAddress].enabled;
    updateAutoSellWallets();
}

function addSellTrigger(walletAddress) {
    if (!autoTradeConfig.autoSell.wallets[walletAddress]) {
        autoTradeConfig.autoSell.wallets[walletAddress] = { triggers: [], slippage: 99, enabled: false };
    }
    autoTradeConfig.autoSell.wallets[walletAddress].triggers.push({
        type: 'time',
        value: 30,
        sellPercent: 100
    });
    updateAutoSellWallets();
}

function removeSellTrigger(walletAddress, index) {
    autoTradeConfig.autoSell.wallets[walletAddress].triggers.splice(index, 1);
    updateAutoSellWallets();
}

function updateSellTrigger(walletAddress, index, field, value) {
    if (field === 'type') {
        autoTradeConfig.autoSell.wallets[walletAddress].triggers[index][field] = value;
        // Reset value when type changes
        if (value === 'time') {
            autoTradeConfig.autoSell.wallets[walletAddress].triggers[index].value = 30;
        } else if (value === 'profit') {
            autoTradeConfig.autoSell.wallets[walletAddress].triggers[index].value = 2;
        } else if (value === 'marketcap') {
            autoTradeConfig.autoSell.wallets[walletAddress].triggers[index].value = 50000;
        }
    } else {
        const numValue = parseFloat(value);
        if (!isNaN(numValue) && numValue > 0) {
            autoTradeConfig.autoSell.wallets[walletAddress].triggers[index][field] = numValue;
        }
    }
    updateAutoSellWallets();
}

// ========================================
// PART 5.3: AUTO SELL MONITORING
// ========================================

// Auto-sell monitoring
function startAutoSellMonitoring(walletAddress) {
    if (!autoTradeConfig.autoSell.enabled) return;
    
    const config = autoTradeConfig.autoSell.wallets[walletAddress];
    if (!config || !config.enabled || config.triggers.length === 0) return;
    
    console.log(`Starting auto-sell monitoring for wallet: ${walletAddress}`);
    
    // Clear existing monitors
    if (autoSellMonitors.has(walletAddress)) {
        clearInterval(autoSellMonitors.get(walletAddress));
    }
    
    // Start monitoring
    const intervalId = setInterval(() => {
        checkAutoSellTriggers(walletAddress);
    }, 1000); // Check every second
    
    autoSellMonitors.set(walletAddress, intervalId);
}

function stopAutoSellMonitoring(walletAddress) {
    if (autoSellMonitors.has(walletAddress)) {
        clearInterval(autoSellMonitors.get(walletAddress));
        autoSellMonitors.delete(walletAddress);
        console.log(`Stopped auto-sell monitoring for wallet: ${walletAddress}`);
    }
}

function stopAllAutoSellMonitoring() {
    autoSellMonitors.forEach((intervalId, walletAddress) => {
        clearInterval(intervalId);
    });
    autoSellMonitors.clear();
    console.log('Stopped all auto-sell monitoring');
}

function checkAutoSellTriggers(walletAddress) {
    const walletData = walletPositions.get(walletAddress);
    if (!walletData || !walletData.position || walletData.position.balance <= 0) {
        stopAutoSellMonitoring(walletAddress);
        return;
    }
    
    const config = autoTradeConfig.autoSell.wallets[walletAddress];
    if (!config || !config.enabled) return;
    
    const position = walletData.position;
    const currentTime = Date.now() / 1000;
    
    // Check each trigger
    for (const trigger of config.triggers) {
        let shouldSell = false;
        
        switch (trigger.type) {
            case 'time':
                // Check if enough time has passed since entry
                if (position.entryTimestamp && (currentTime - position.entryTimestamp) >= trigger.value) {
                    shouldSell = true;
                }
                break;
                
            case 'profit':
                // Check if profit multiplier reached
                const currentMarketCapSol = position.currentMarketCapSol || position.entryMarketCapSol;
                const multiplier = currentMarketCapSol / position.entryMarketCapSol;
                if (multiplier >= trigger.value) {
                    shouldSell = true;
                }
                break;
                
            case 'marketcap':
                // Check if market cap reached
                if (currentMarketCapUSD >= trigger.value) {
                    shouldSell = true;
                }
                break;
                
            case 'devSell':
                // Check if dev wallet has sold
                if (DEV_WALLET) {
                    const devData = walletPositions.get(DEV_WALLET.address);
                    if (!devData || !devData.position || devData.position.balance === 0) {
                        shouldSell = true;
                    }
                }
                break;
        }
        
        if (shouldSell) {
            console.log(`Auto-sell triggered for ${walletAddress} - ${trigger.type} trigger`);
            
            // Execute sell
            sellToken(walletAddress, trigger.sellPercent);
            
            // Remove this trigger after execution
            const triggerIndex = config.triggers.indexOf(trigger);
            if (triggerIndex > -1) {
                config.triggers.splice(triggerIndex, 1);
            }
            
            // Stop monitoring if no triggers left
            if (config.triggers.length === 0) {
                stopAutoSellMonitoring(walletAddress);
            }
            
            break; // Only execute one trigger at a time
        }
    }
}

// ========================================
// PART 5.4: SETTINGS PERSISTENCE
// ========================================

function saveAutoTradeSettings() {
    console.log('=== SAVING AUTO TRADE SETTINGS ===');
    console.log('Saving config:', JSON.parse(JSON.stringify(autoTradeConfig)));
    
    localStorage.setItem('autoTradeConfig', JSON.stringify(autoTradeConfig));
    
    // Verify it saved correctly
    const saved = localStorage.getItem('autoTradeConfig');
    console.log('Verified saved:', JSON.parse(saved));
    
    console.log('Auto trade settings saved');
    closeAutoTrade();
    updateAutoTradeButton();
}

function loadAutoTradeSettings() {
    console.log('=== LOADING AUTO TRADE SETTINGS ===');
    
    const saved = localStorage.getItem('autoTradeConfig');
    if (saved) {
        try {
            const loaded = JSON.parse(saved);
            console.log('Loaded config from storage:', loaded);
            
            // Make sure we're actually updating the global variable
            autoTradeConfig = loaded;
            
            console.log('autoTradeConfig after load:', autoTradeConfig);
            console.log('Auto-buy enabled?', autoTradeConfig.autoBuy.enabled);
            
        } catch (e) {
            console.error('Error loading auto trade settings:', e);
        }
    } else {
        console.log('No saved auto trade settings found');
    }
    updateAutoTradeButton();
}

// ========================================
// PART 5.5: DRAG AND DROP
// ========================================

// Drag and drop for buy sequence
function initializeDragAndDrop() {
    const items = document.querySelectorAll('.buy-sequence-item');
    let draggedItem = null;
    
    items.forEach(item => {
        item.addEventListener('dragstart', function(e) {
            draggedItem = this;
            this.classList.add('dragging');
        });
        
        item.addEventListener('dragend', function(e) {
            this.classList.remove('dragging');
        });
        
        item.addEventListener('dragover', function(e) {
            e.preventDefault();
            const afterElement = getDragAfterElement(this.parentElement, e.clientY);
            if (afterElement == null) {
                this.parentElement.appendChild(draggedItem);
            } else {
                this.parentElement.insertBefore(draggedItem, afterElement);
            }
        });
    });
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.buy-sequence-item:not(.dragging)')];
    
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// Initialize auto trade dragging
function initializeAutoTradeWindowDragging() {
    const window = document.getElementById('autoTradeWindow');
    const header = document.getElementById('autoTradeHeader');
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;

    header.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);

    function dragStart(e) {
        if (e.target.closest('.window-close')) return;
        
        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;

        if (e.target === header || header.contains(e.target)) {
            isDragging = true;
        }
    }

    function dragEnd(e) {
        initialX = currentX;
        initialY = currentY;
        isDragging = false;
    }

    function drag(e) {
        if (isDragging) {
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;

            xOffset = currentX;
            yOffset = currentY;

            window.style.transform = `translate(calc(-50% + ${currentX}px), calc(-50% + ${currentY}px))`;
        }
    }
}

// ========================================
// PART 6: SPAM LAUNCH FUNCTIONS
// ========================================

// Spam Launch Window Management
function toggleSpamLaunch() {
    const window = document.getElementById('spamLaunchWindow');
    const overlay = document.getElementById('spamLaunchOverlay');
    
    if (window.classList.contains('active')) {
        closeSpamLaunch();
    } else {
        window.classList.add('active');
        overlay.classList.add('active');
        updateSpamLaunchUI();
    }
}

function closeSpamLaunch() {
    document.getElementById('spamLaunchWindow').classList.remove('active');
    document.getElementById('spamLaunchOverlay').classList.remove('active');
}

function toggleSpamLaunchEnabled() {
    spamLaunchConfig.enabled = !spamLaunchConfig.enabled;
    updateSpamLaunchUI();
    updateSpamLaunchButton();
}

function updateSpamLaunchButton() {
    const btn = document.getElementById('spamLaunchBtn');
    if (spamLaunchConfig.enabled && spamLaunchConfig.launches.length > 0) {
        btn.classList.add('active');
    } else {
        btn.classList.remove('active');
    }
}

function updateSpamLaunchUI() {
    // Update toggle
    const toggle = document.getElementById('spamLaunchToggle');
    if (spamLaunchConfig.enabled) {
        toggle.classList.add('active');
    } else {
        toggle.classList.remove('active');
    }
    
    // Update launch list
    updateSpamLaunchList();
}

// ========================================
// PART 6.1: SPAM LAUNCH CONFIGURATION
// ========================================

// In script.js - Replace the entire updateSpamLaunchList function
function updateSpamLaunchList() {
    const container = document.getElementById('spamLaunchList');
    
    container.innerHTML = spamLaunchConfig.launches.map((launch, index) => {
        return `
            <div class="spam-launch-item">
                <div class="launch-header">
                    <div class="launch-number">${index + 1}</div>
                    <div class="launch-title">Spam Launch Configuration</div>
                    <button class="launch-remove" onclick="removeSpamLaunchItem(${index})">×</button>
                </div>
                
                <div class="launch-wallet-section">
                    <div class="section-divider">Wallet Credentials</div>
                    <div class="wallet-inputs-grid">
                        <div class="form-group">
                            <label class="form-label">Wallet Name (Optional)</label>
                            <input type="text" class="form-input" 
                                value="${launch.walletName || ''}" 
                                placeholder="e.g., Spam Wallet 1"
                                onchange="updateSpamLaunchItem(${index}, 'walletName', this.value)">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Wallet Address *</label>
                            <input type="text" class="form-input" 
                                value="${launch.walletAddress || ''}" 
                                placeholder="Solana wallet address..."
                                onchange="updateSpamLaunchItem(${index}, 'walletAddress', this.value)">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Private Key *</label>
                            <input type="password" class="form-input" 
                                value="${launch.privateKey || ''}" 
                                placeholder="Base58 private key..."
                                onchange="updateSpamLaunchItem(${index}, 'privateKey', this.value)">
                        </div>
                        <div class="form-group">
                            <label class="form-label">API Key (PumpPortal) *</label>
                            <input type="password" class="form-input" 
                                value="${launch.apiKey || ''}" 
                                placeholder="PumpPortal API key..."
                                onchange="updateSpamLaunchItem(${index}, 'apiKey', this.value)">
                        </div>
                    </div>
                </div>
                
                <div class="launch-token-section">
                    <div class="section-divider">Token Information</div>
                    <div class="launch-token-info">
                        <div class="form-group">
                            <label class="form-label">Token Name *</label>
                            <input type="text" class="form-input" 
                                value="${launch.tokenName || ''}" 
                                placeholder="e.g., Doge Killer"
                                onchange="updateSpamLaunchItem(${index}, 'tokenName', this.value)">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Symbol *</label>
                            <input type="text" class="form-input" 
                                value="${launch.symbol || ''}" 
                                placeholder="e.g., DKILL"
                                maxlength="10"
                                onchange="updateSpamLaunchItem(${index}, 'symbol', this.value)">
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Description</label>
                        <textarea class="form-textarea" 
                            placeholder="Token description..."
                            onchange="updateSpamLaunchItem(${index}, 'description', this.value)">${launch.description || ''}</textarea>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Image URL (Optional)</label>
                        <input type="text" class="form-input" 
                            value="${launch.imageUrl || ''}" 
                            placeholder="https://i.ibb.co/... (direct image URL)"
                            onchange="updateSpamLaunchItem(${index}, 'imageUrl', this.value)">
                    </div>
                    
                    <div class="social-links-section">
                        <label class="form-label">Social Links (Optional)</label>
                        <div class="social-links-row">
                            <input type="text" class="form-input" 
                                value="${launch.socialLinks?.twitter || ''}" 
                                placeholder="Twitter URL"
                                onchange="updateSpamLaunchSocial(${index}, 'twitter', this.value)">
                            <input type="text" class="form-input" 
                                value="${launch.socialLinks?.telegram || ''}" 
                                placeholder="Telegram URL"
                                onchange="updateSpamLaunchSocial(${index}, 'telegram', this.value)">
                            <input type="text" class="form-input" 
                                value="${launch.socialLinks?.website || ''}" 
                                placeholder="Website URL"
                                onchange="updateSpamLaunchSocial(${index}, 'website', this.value)">
                        </div>
                    </div>
                </div>
                
                <div class="launch-trading-section">
                    <div class="section-divider">Trading Configuration</div>
                    <div class="trading-inputs-grid">
                        <div class="form-group">
                            <label class="form-label">Initial Buy (SOL) *</label>
                            <input type="number" class="form-input" 
                                value="${launch.initialBuy || 0.1}" 
                                step="0.1" 
                                min="0.01"
                                placeholder="0.1"
                                onchange="updateSpamLaunchItem(${index}, 'initialBuy', this.value)">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Launch Delay (ms)</label>
                            <input type="number" class="form-input" 
                                value="${launch.delay || 1000}" 
                                step="100" 
                                min="0"
                                placeholder="1000"
                                onchange="updateSpamLaunchItem(${index}, 'delay', this.value)">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Auto-Sell After (seconds) *</label>
                            <input type="number" class="form-input" 
                                value="${launch.sellAfterSeconds || 30}" 
                                step="1" 
                                min="0"
                                placeholder="30"
                                onchange="updateSpamLaunchItem(${index}, 'sellAfterSeconds', this.value)">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Sell Percentage *</label>
                            <input type="number" class="form-input" 
                                value="${launch.sellPercent || 100}" 
                                step="1" 
                                min="1"
                                max="100"
                                placeholder="100"
                                onchange="updateSpamLaunchItem(${index}, 'sellPercent', this.value)">
                        </div>
                    </div>
                    <div class="auto-sell-info">
                        <span>💡 Token will be automatically sold ${launch.sellPercent || 100}% after ${launch.sellAfterSeconds || 30} seconds</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Replace the addSpamLaunchItem function
function addSpamLaunchItem() {
    spamLaunchConfig.launches.push({
        // Wallet info
        walletName: '',
        walletAddress: '',
        privateKey: '',
        apiKey: '',
        // Token info
        tokenName: '',
        symbol: '',
        description: '',
        imageUrl: '',
        socialLinks: {
            twitter: '',
            telegram: '',
            website: ''
        },
        // Trading config
        initialBuy: 0.1,
        delay: spamLaunchConfig.launches.length * 1000, // Stagger by 1 second
        sellAfterSeconds: 30, // Default 30 seconds
        sellPercent: 100 // Default 100% sell
    });
    updateSpamLaunchList();
}

function removeSpamLaunchItem(index) {
    spamLaunchConfig.launches.splice(index, 1);
    updateSpamLaunchList();
}

function updateSpamLaunchWallet(index, walletAddress) {
    spamLaunchConfig.launches[index].walletAddress = walletAddress;
}

function updateSpamLaunchItem(index, field, value) {
    if (field === 'initialBuy' || field === 'delay') {
        const numValue = parseFloat(value);
        if (!isNaN(numValue) && numValue >= 0) {
            spamLaunchConfig.launches[index][field] = numValue;
        }
    } else {
        spamLaunchConfig.launches[index][field] = value;
    }
}

function updateSpamLaunchSocial(index, platform, value) {
    if (!spamLaunchConfig.launches[index].socialLinks) {
        spamLaunchConfig.launches[index].socialLinks = {};
    }
    spamLaunchConfig.launches[index].socialLinks[platform] = value;
}

// ========================================
// PART 6.2: SPAM LAUNCH EXECUTION
// ========================================

// In PART 6.2: SPAM LAUNCH EXECUTION

async function executeSpamLaunches() {
    if (!spamLaunchConfig.enabled || spamLaunchConfig.launches.length === 0) return;
    
    console.log('=== EXECUTING SPAM LAUNCHES ===');
    console.log(`Launching ${spamLaunchConfig.launches.length} tokens with auto-sell`);
    
    // Check if server is running
    try {
        const healthCheck = await fetch('http://localhost:3000/health');
        if (!healthCheck.ok) {
            console.error('Spam launch server is not running! Start it with: node server.js');
            alert('Spam launch server is not running! Please start the server first.');
            return;
        }
    } catch (error) {
        console.error('Cannot connect to spam launch server at http://localhost:3000');
        alert('Cannot connect to spam launch server. Please start it with: node server.js');
        return;
    }
    
    // Execute launches sequentially with delays
    for (let i = 0; i < spamLaunchConfig.launches.length; i++) {
        const launch = spamLaunchConfig.launches[i];
        
        console.log(`\n=== SPAM LAUNCH ${i + 1} ===`);
        
        // Validate required fields
        if (!launch.walletAddress || !launch.privateKey || !launch.apiKey) {
            console.log(`Skipping launch ${i + 1}: Missing wallet credentials`);
            alert(`Launch ${i + 1} skipped: Missing wallet credentials`);
            continue;
        }
        
        if (!launch.tokenName || !launch.symbol) {
            console.log(`Skipping launch ${i + 1}: Missing token information`);
            alert(`Launch ${i + 1} skipped: Missing token name or symbol`);
            continue;
        }
        
        // Wait for delay
        if (launch.delay > 0 && i > 0) {
            console.log(`Waiting ${launch.delay}ms before launch ${i + 1}`);
            await new Promise(resolve => setTimeout(resolve, launch.delay));
        }
        
        console.log(`Executing launch ${i + 1}: ${launch.tokenName} (${launch.symbol})`);
        console.log(`Will auto-sell ${launch.sellPercent}% after ${launch.sellAfterSeconds} seconds`);
        
        try {
            // Call the server endpoint with wallet embedded
            const response = await fetch('http://localhost:3000/spam-launch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    wallet: {
                        name: launch.walletName || `Spam Wallet ${i + 1}`,
                        address: launch.walletAddress,
                        privateKey: launch.privateKey,
                        apiKey: launch.apiKey
                    },
                    launch: launch
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                console.log(`✅ Token ${launch.symbol} created successfully!`);
                console.log(`Transaction: https://solscan.io/tx/${result.signature}`);
                console.log(`Mint: ${result.mint}`);
                if (result.sellScheduled) {
                    console.log(`⏱️  Auto-sell scheduled for ${launch.sellAfterSeconds} seconds from now`);
                }
                
                // Add to activity (but don't track in main system)
                recentActivity.unshift({
                    txType: 'spam-launch',
                    walletName: launch.walletName || `Spam Wallet ${i + 1}`,
                    walletAddress: launch.walletAddress,
                    symbol: launch.symbol,
                    tokenName: launch.tokenName,
                    mint: result.mint,
                    signature: result.signature,
                    timestamp: Date.now() / 1000,
                    initialBuy: launch.initialBuy,
                    autoSell: `${launch.sellPercent}% after ${launch.sellAfterSeconds}s`
                });
                
                updateRecentActivity();
                
            } else {
                console.error(`❌ Failed to create token ${launch.symbol}:`, result.error);
                alert(`Failed to create ${launch.symbol}: ${result.error}`);
            }
            
        } catch (error) {
            console.error(`❌ Error creating token ${launch.symbol}:`, error);
            alert(`Error creating ${launch.symbol}: ${error.message}`);
        }
    }
    
    console.log('\n=== ALL SPAM LAUNCHES COMPLETED ===');
    alert(`Spam launches completed! Tokens will auto-sell according to their timers.`);
    
    // Clear the launches after execution
    spamLaunchConfig.launches = [];
    spamLaunchConfig.enabled = false;
    
    // Save settings and update UI
    saveSpamLaunchSettings();
    updateSpamLaunchUI();
    updateSpamLaunchButton();
}

// ========================================
// PART 6.3: SPAM LAUNCH SETTINGS
// ========================================

function saveSpamLaunchSettings() {
    localStorage.setItem('spamLaunchConfig', JSON.stringify(spamLaunchConfig));
    console.log('Spam launch settings saved:', spamLaunchConfig);
    closeSpamLaunch();
    updateSpamLaunchButton();
}

function loadSpamLaunchSettings() {
    const saved = localStorage.getItem('spamLaunchConfig');
    if (saved) {
        try {
            spamLaunchConfig = JSON.parse(saved);
            console.log('Spam launch settings loaded:', spamLaunchConfig);
        } catch (e) {
            console.error('Error loading spam launch settings:', e);
        }
    }
    updateSpamLaunchButton();
}

// Initialize spam launch window dragging
function initializeSpamLaunchWindowDragging() {
    const window = document.getElementById('spamLaunchWindow');
    const header = document.getElementById('spamLaunchHeader');
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;

    header.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);

    function dragStart(e) {
        if (e.target.closest('.window-close')) return;
        
        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;

        if (e.target === header || header.contains(e.target)) {
            isDragging = true;
        }
    }

    function dragEnd(e) {
        initialX = currentX;
        initialY = currentY;
        isDragging = false;
    }

    function drag(e) {
        if (isDragging) {
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;

            xOffset = currentX;
            yOffset = currentY;

            window.style.transform = `translate(calc(-50% + ${currentX}px), calc(-50% + ${currentY}px))`;
        }
    }
}

// ========================================
// PART 7: INITIALIZATION AND STARTUP
// ========================================

// Initialize the application
function init() {
    console.log('=== INITIALIZING PUMP.FUN MULTI-WALLET DASHBOARD ===');
    
    // Load trading wallets from storage
    loadTradingWallets();
    
    // Load dev wallet configuration
    loadDevWallet();
    updateDevWalletStatus();
    
    // Initialize wallet positions and settings
    const allWallets = getAllWallets();
    allWallets.forEach(wallet => {
        // Initialize position tracking
        walletPositions.set(wallet.address, {
            wallet: wallet,
            position: null
        });
        
        // Initialize default settings if not already set
        if (!walletSettings.has(wallet.address)) {
            walletSettings.set(wallet.address, {
                buyAmounts: [0.1, 0.5, 1], // Default buy amounts
                sellPercentages: [25, 50, 100], // Default sell percentages
                buySlippage: 80, // Default 80% slippage for buys
                sellSlippage: 99, // Default 99% slippage for sells
                priorityFee: 0.00005 // Default priority fee
            });
        }
    });
    
    // Load saved wallet settings
    loadWalletSettings();
    
    // Set wallet count after initialization
    updateWalletCount();
    
    // Update wallet grid immediately to show all wallets
    updateWalletGrid();
    
    // Fetch initial balances immediately
    fetchAllWalletBalances(true);
    
    // Connect single WebSocket for all wallets
    connectWebSocket();
    
    // Update balances periodically (every 30 seconds)
    setInterval(() => fetchAllWalletBalances(false), 30000);
    
    // Initialize window dragging for all windows
    initializeWindowDragging();
    initializeActivityWindowDragging();
    initializeAutoTradeWindowDragging();
    initializeSpamLaunchWindowDragging();
    
    // Initialize UI elements
    updatePortfolioStats();
    updateRecentActivity();
    updateAutoTradeButton();
    updateSpamLaunchButton();
    
    console.log('=== INITIALIZATION COMPLETE ===');
    console.log(`Loaded ${WALLETS.length} trading wallets`);
    console.log(`Dev wallet: ${DEV_WALLET ? 'Configured' : 'Not configured'}`);
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// ========================================
// PART 8: EXPORT/IMPORT FUNCTIONS
// ========================================

// Export wallets to JSON function
function exportWalletsToJSON() {
    const allWallets = getAllWallets();
    const exportData = {
        exportDate: new Date().toISOString(),
        exportedBy: "Pump.fun Multi-Wallet Dashboard",
        walletsCount: allWallets.length,
        devWallet: DEV_WALLET ? {
            name: DEV_WALLET.name,
            address: DEV_WALLET.address,
            privateKey: DEV_WALLET.privateKey,
            apiKey: DEV_WALLET.apiKey,
            currentBalance: walletBalances.get(DEV_WALLET.address) || 0,
            position: walletPositions.get(DEV_WALLET.address)?.position || null
        } : null,
        tradingWallets: WALLETS.map(wallet => {
            const settings = walletSettings.get(wallet.address) || {
                buyAmounts: [0.1, 0.5, 1],
                sellPercentages: [25, 50, 100],
                buySlippage: 80,
                sellSlippage: 99,
                priorityFee: 0.00005
            };
            const position = walletPositions.get(wallet.address)?.position;
            
            return {
                name: wallet.name,
                address: wallet.address,
                privateKey: wallet.privateKey,
                apiKey: wallet.apiKey,
                currentBalance: walletBalances.get(wallet.address) || 0,
                initialBalance: initialBalances.get(wallet.address) || 0,
                settings: {
                    buyAmounts: settings.buyAmounts,
                    sellPercentages: settings.sellPercentages,
                    buySlippage: settings.buySlippage,
                    sellSlippage: settings.sellSlippage,
                    priorityFee: settings.priorityFee
                },
                currentPosition: position ? {
                    token: position.symbol,
                    tokenMint: position.mint,
                    balance: position.balance,
                    totalInvested: position.totalInvested,
                    avgPrice: position.avgPrice,
                    entryMarketCap: position.entryMarketCapSol * SOL_PRICE_USD // Convert to USD
                } : null
            };
        }),
        autoTradeSettings: {
            autoBuy: {
                enabled: autoTradeConfig.autoBuy.enabled,
                sequence: autoTradeConfig.autoBuy.sequence.map(item => {
                    const wallet = allWallets.find(w => w.address === item.walletAddress);
                    return {
                        walletName: wallet ? wallet.name : 'Unknown',
                        walletAddress: item.walletAddress,
                        amount: item.amount,
                        delay: item.delay,
                        slippage: item.slippage,
                        priorityFee: item.priorityFee
                    };
                })
            },
            autoSell: {
                enabled: autoTradeConfig.autoSell.enabled,
                walletConfigs: Object.entries(autoTradeConfig.autoSell.wallets).map(([address, config]) => {
                    const wallet = allWallets.find(w => w.address === address);
                    return {
                        walletName: wallet ? wallet.name : 'Unknown',
                        walletAddress: address,
                        enabled: config.enabled,
                        triggers: config.triggers
                    };
                })
            }
        },
        spamLaunchSettings: {
            enabled: spamLaunchConfig.enabled,
            launches: spamLaunchConfig.launches.map(launch => {
                const wallet = allWallets.find(w => w.address === launch.walletAddress);
                return {
                    walletName: wallet ? wallet.name : 'Unknown',
                    walletAddress: launch.walletAddress,
                    tokenName: launch.tokenName,
                    symbol: launch.symbol,
                    description: launch.description,
                    imageUrl: launch.imageUrl,
                    socialLinks: launch.socialLinks,
                    initialBuy: launch.initialBuy,
                    delay: launch.delay
                };
            })
        },
        portfolioStats: {
            winCount: winCount,
            lossCount: lossCount,
            totalInitialBalance: Array.from(initialBalances.values()).reduce((sum, bal) => sum + bal, 0),
            totalCurrentBalance: Array.from(walletBalances.values()).reduce((sum, bal) => sum + bal, 0),
            initialBalanceTime: initialBalanceTime
        },
        activeToken: currentActiveToken ? {
            mint: currentActiveToken.mint,
            symbol: currentActiveToken.symbol,
            name: currentActiveToken.name,
            detectedAt: currentActiveToken.detectedAt,
            stats: {
                buyCount: tokenBuyCount,
                sellCount: tokenSellCount,
                netFlow: netTokenFlow,
                totalVolume: totalTokenVolume,
                currentMarketCapUSD: currentMarketCapUSD
            }
        } : null
    };
    
    // Create blob and download
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    // Create download link
    const a = document.createElement('a');
    a.href = url;
    a.download = `pump-wallets-export-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log('Wallets exported successfully');
    alert(`Exported ${allWallets.length} wallets to JSON file`);
}

// Handle file import
function handleImportFile(input) {
    const file = input.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            importWalletsFromJSON(data);
        } catch (error) {
            console.error('Error parsing import file:', error);
            alert('Error: Invalid import file format');
        }
    };
    reader.readAsText(file);
    
    // Clear the input so the same file can be imported again
    input.value = '';
}

// Import wallets from JSON
function importWalletsFromJSON(data) {
    // Validate the import data
    if (!data || !data.exportedBy || data.exportedBy !== "Pump.fun Multi-Wallet Dashboard") {
        alert('Error: Invalid import file - not from Pump.fun Multi-Wallet Dashboard');
        return;
    }
    
    console.log('=== IMPORTING WALLET CONFIGURATION ===');
    console.log('Import date:', data.exportDate);
    console.log('Total wallets to import:', data.walletsCount);
    
    // Ask for confirmation
    const confirmMessage = `This will import ${data.walletsCount} wallets and replace your current configuration.\n\nDo you want to continue?`;
    if (!confirm(confirmMessage)) {
        return;
    }
    
    try {
        // 1. Import Dev Wallet
        if (data.devWallet) {
            DEV_WALLET = {
                name: data.devWallet.name,
                address: data.devWallet.address,
                privateKey: data.devWallet.privateKey,
                apiKey: data.devWallet.apiKey,
                isDevWallet: true
            };
            
            // Save to localStorage
            localStorage.setItem('devWallet', JSON.stringify(DEV_WALLET));
            
            // Update form fields
            document.getElementById('devWalletAddress').value = DEV_WALLET.address;
            document.getElementById('devWalletPrivateKey').value = DEV_WALLET.privateKey;
            document.getElementById('devWalletApiKey').value = DEV_WALLET.apiKey;
            
            // Initialize position tracking for dev wallet
            walletPositions.set(DEV_WALLET.address, {
                wallet: DEV_WALLET,
                position: null
            });
            
            console.log('Dev wallet imported:', DEV_WALLET.address);
        }
        
        // 2. Import Trading Wallets
        WALLETS = []; // Clear existing wallets
        walletPositions.clear();
        walletSettings.clear();
        
        data.tradingWallets.forEach(walletData => {
            const wallet = {
                name: walletData.name,
                address: walletData.address,
                privateKey: walletData.privateKey,
                apiKey: walletData.apiKey
            };
            
            WALLETS.push(wallet);
            
            // Initialize position tracking
            walletPositions.set(wallet.address, {
                wallet: wallet,
                position: null
            });
            
            // Import wallet settings
            if (walletData.settings) {
                walletSettings.set(wallet.address, {
                    buyAmounts: walletData.settings.buyAmounts || [0.1, 0.5, 1],
                    sellPercentages: walletData.settings.sellPercentages || [25, 50, 100],
                    buySlippage: walletData.settings.buySlippage || 80,
                    sellSlippage: walletData.settings.sellSlippage || 99,
                    priorityFee: walletData.settings.priorityFee || 0.00005
                });
            }
            
            console.log('Imported wallet:', wallet.name);
        });
        
        // Save trading wallets
        saveTradingWallets();
        saveWalletSettingsToStorage();
        
        // 3. Import Auto Trade Settings
        if (data.autoTradeSettings) {
            autoTradeConfig = {
                autoBuy: {
                    enabled: data.autoTradeSettings.autoBuy.enabled || false,
                    sequence: data.autoTradeSettings.autoBuy.sequence || []
                },
                autoSell: {
                    enabled: data.autoTradeSettings.autoSell.enabled || false,
                    wallets: {}
                }
            };
            
            // Convert autoSell wallet configs back to object format
            if (data.autoTradeSettings.autoSell.walletConfigs) {
                data.autoTradeSettings.autoSell.walletConfigs.forEach(config => {
                    autoTradeConfig.autoSell.wallets[config.walletAddress] = {
                        enabled: config.enabled,
                        triggers: config.triggers || []
                    };
                });
            }
            
            // Save auto trade settings
            localStorage.setItem('autoTradeConfig', JSON.stringify(autoTradeConfig));
            console.log('Auto trade settings imported');
        }
        
        // 4. Import Spam Launch Settings
        if (data.spamLaunchSettings) {
            spamLaunchConfig = {
                enabled: data.spamLaunchSettings.enabled || false,
                launches: data.spamLaunchSettings.launches || []
            };
            
            // Save spam launch settings
            localStorage.setItem('spamLaunchConfig', JSON.stringify(spamLaunchConfig));
            console.log('Spam launch settings imported');
        }
        
        // 5. Import Portfolio Stats (optional - for reference)
        if (data.portfolioStats) {
            winCount = data.portfolioStats.winCount || 0;
            lossCount = data.portfolioStats.lossCount || 0;
            console.log(`Imported portfolio stats: ${winCount}W/${lossCount}L`);
        }
        
        // Update all UI elements
        updateDevWalletStatus();
        updateWalletCount();
        updateWalletGrid();
        updateWalletManagerList();
        updateAutoTradeButton();
        updateSpamLaunchButton();
        updatePortfolioStats();
        
        // Fetch current balances for all imported wallets
        fetchAllWalletBalances(true);
        
        // Re-subscribe to WebSocket for all wallets
        if (ws && ws.readyState === WebSocket.OPEN) {
            const allWallets = getAllWallets();
            allWallets.forEach((wallet, index) => {
                setTimeout(() => {
                    const payload = {
                        method: "subscribeAccountTrade",
                        keys: [wallet.address]
                    };
                    console.log(`Re-subscribing to ${wallet.name}`);
                    ws.send(JSON.stringify(payload));
                }, index * 100);
            });
        }
        
        console.log('=== IMPORT COMPLETE ===');
        alert(`Successfully imported ${WALLETS.length} trading wallets${DEV_WALLET ? ' and dev wallet' : ''}`);
        
        // Close wallet manager window if open
        closeWalletManager();
        
    } catch (error) {
        console.error('Error during import:', error);
        alert('Error during import: ' + error.message);
    }
}