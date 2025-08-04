// server.js - Spam Launch Server with Auto-Sell
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const FormData = require('form-data');
const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 3000;

// Enable CORS for your local dashboard
app.use(cors());
app.use(express.json());

// Spam wallets storage file
const SPAM_WALLETS_FILE = path.join(__dirname, 'spam-wallets.json');

// Helper function to load spam wallets
async function loadSpamWallets() {
    try {
        const data = await fs.readFile(SPAM_WALLETS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // File doesn't exist yet, return empty object
        return {};
    }
}

// Helper function to save spam wallets
async function saveSpamWallets(wallets) {
    await fs.writeFile(SPAM_WALLETS_FILE, JSON.stringify(wallets, null, 2));
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'Server is running' });
});

// Helper function to fetch image from URL
async function fetchImageAsBuffer(imageUrl) {
    try {
        console.log(`Fetching image from: ${imageUrl}`);
        const response = await fetch(imageUrl);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
        }
        
        const buffer = await response.buffer();
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        
        console.log(`Image fetched successfully. Size: ${buffer.length} bytes, Type: ${contentType}`);
        return { buffer, contentType };
    } catch (error) {
        console.error('Error fetching image:', error);
        throw error;
    }
}

// Helper function to execute sell after delay
async function executeSellAfterDelay(wallet, tokenMint, tokenSymbol, sellDelaySeconds, sellPercent) {
    console.log(`\n⏱️  Scheduling sell of ${sellPercent}% ${tokenSymbol} after ${sellDelaySeconds} seconds...`);
    
    setTimeout(async () => {
        console.log(`\n💰 Executing auto-sell for ${tokenSymbol}`);
        console.log(`Wallet: ${wallet.name || wallet.address}`);
        console.log(`Selling: ${sellPercent}%`);
        
        try {
            // Execute sell
            const response = await fetch(`https://pumpportal.fun/api/trade?api-key=${wallet.apiKey}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    "action": "sell",
                    "mint": tokenMint,
                    "privateKey": wallet.privateKey,
                    "amount": sellPercent === 100 ? "100%" : sellPercent, // PumpPortal accepts "100%" for full sell
                    "denominatedInSol": "false",
                    "slippage": 99, // High slippage for spam tokens
                    "priorityFee": 0.0005,
                    "pool": "pump"
                })
            });
            
            const data = await response.json();
            
            if (data.signature) {
                console.log(`✅ Auto-sell successful!`);
                console.log(`Transaction: https://solscan.io/tx/${data.signature}`);
            } else {
                console.error(`❌ Auto-sell failed:`, data.error || 'Unknown error');
            }
        } catch (error) {
            console.error(`❌ Auto-sell error:`, error);
        }
    }, sellDelaySeconds * 1000);
}

// Spam launch endpoint
app.post('/spam-launch', async (req, res) => {
    try {
        const { wallet, launch } = req.body;
        
        console.log('\n=== NEW SPAM LAUNCH REQUEST ===');
        console.log(`Token: ${launch.tokenName} (${launch.symbol})`);
        console.log(`Wallet: ${wallet.address}`);
        console.log(`Auto-sell: ${launch.sellPercent}% after ${launch.sellAfterSeconds} seconds`);
        console.log('Launch config:', JSON.stringify(launch, null, 2));
        
        // Save wallet to spam wallets file (if it has a name)
        if (wallet.name) {
            const spamWallets = await loadSpamWallets();
            spamWallets[wallet.address] = {
                name: wallet.name,
                address: wallet.address,
                privateKey: wallet.privateKey,
                apiKey: wallet.apiKey,
                lastUsed: new Date().toISOString()
            };
            await saveSpamWallets(spamWallets);
            console.log('Wallet saved to spam wallets storage');
        }
        
        // Step 1: Create metadata on pump.fun IPFS
        console.log('\nStep 1: Creating metadata on pump.fun IPFS...');
        
        const formData = new FormData();
        
        // Handle image if provided
        if (launch.imageUrl) {
            try {
                const { buffer, contentType } = await fetchImageAsBuffer(launch.imageUrl);
                
                // Determine file extension from content type
                let extension = 'jpg';
                if (contentType.includes('png')) extension = 'png';
                else if (contentType.includes('gif')) extension = 'gif';
                else if (contentType.includes('webp')) extension = 'webp';
                
                // Append image as file with proper filename
                formData.append('file', buffer, {
                    filename: `token-image.${extension}`,
                    contentType: contentType
                });
                
                console.log(`Image added to form data: token-image.${extension}`);
            } catch (imageError) {
                console.error('Failed to fetch image, continuing without it:', imageError.message);
                // Continue without image rather than failing completely
            }
        }
        
        // Append all metadata fields
        formData.append("name", launch.tokenName);
        formData.append("symbol", launch.symbol);
        formData.append("description", launch.description || "A new token on pump.fun");
        formData.append("twitter", launch.socialLinks?.twitter || "");
        formData.append("telegram", launch.socialLinks?.telegram || "");
        formData.append("website", launch.socialLinks?.website || "");
        formData.append("showName", "true");
        
        console.log('Sending metadata request to pump.fun...');
        
        const metadataResponse = await fetch("https://pump.fun/api/ipfs", {
            method: "POST",
            body: formData,
            headers: {
                ...formData.getHeaders(),
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        
        console.log('Metadata response status:', metadataResponse.status);
        
        const responseText = await metadataResponse.text();
        
        if (metadataResponse.status !== 200) {
            console.log('Metadata response body:', responseText);
            throw new Error(`Metadata creation failed (${metadataResponse.status}): ${responseText}`);
        }
        
        let metadataResponseJSON;
        try {
            metadataResponseJSON = JSON.parse(responseText);
        } catch (e) {
            throw new Error(`Failed to parse metadata response: ${responseText}`);
        }
        
        console.log('Metadata created successfully:', metadataResponseJSON);
        
        // Step 2: Generate a random keypair for token
        console.log('\nStep 2: Generating keypair...');
        const mintKeypair = Keypair.generate();
        const mintAddress = mintKeypair.publicKey.toBase58();
        console.log('Generated mint address:', mintAddress);
        
        // Step 3: Create token via PumpPortal
        console.log('\nStep 3: Creating token via PumpPortal...');
        
        const tradePayload = {
            "action": "create",
            "tokenMetadata": {
                name: metadataResponseJSON.metadata.name,
                symbol: metadataResponseJSON.metadata.symbol,
                uri: metadataResponseJSON.metadataUri
            },
            "mint": bs58.encode(mintKeypair.secretKey),
            "denominatedInSol": "true",
            "amount": launch.initialBuy || 1,
            "slippage": 10,
            "priorityFee": 0.0005,
            "pool": "pump"
        };
        
        console.log('Trade payload:', JSON.stringify({
            ...tradePayload,
            mint: 'HIDDEN_FOR_SECURITY'
        }, null, 2));
        
        const pumpPortalUrl = `https://pumpportal.fun/api/trade?api-key=${wallet.apiKey}`;
        
        const response = await fetch(pumpPortalUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(tradePayload)
        });
        
        console.log('PumpPortal response status:', response.status);
        
        const pumpPortalResponseText = await response.text();
        console.log('PumpPortal response:', pumpPortalResponseText);
        
        if (response.status === 200) {
            const data = JSON.parse(pumpPortalResponseText);
            console.log(`\n✅ Token created successfully!`);
            console.log(`Transaction: https://solscan.io/tx/${data.signature}`);
            console.log(`Mint address: ${data.mint || mintAddress}`);
            
            // Schedule auto-sell if configured
            if (launch.sellAfterSeconds && launch.sellAfterSeconds > 0 && launch.sellPercent && launch.sellPercent > 0) {
                executeSellAfterDelay(
                    wallet, 
                    data.mint || mintAddress, 
                    launch.symbol,
                    launch.sellAfterSeconds,
                    launch.sellPercent
                );
            }
            
            res.json({
                success: true,
                signature: data.signature,
                mint: data.mint || mintAddress,
                sellScheduled: launch.sellAfterSeconds > 0
            });
        } else {
            throw new Error(`Token creation failed (${response.status}): ${pumpPortalResponseText}`);
        }
        
    } catch (error) {
        console.error('\n❌ Spam launch error:', error);
        console.error('Error stack:', error.stack);
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get saved spam wallets endpoint
app.get('/spam-wallets', async (req, res) => {
    try {
        const wallets = await loadSpamWallets();
        res.json(wallets);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete spam wallet endpoint
app.delete('/spam-wallet/:address', async (req, res) => {
    try {
        const { address } = req.params;
        const wallets = await loadSpamWallets();
        delete wallets[address];
        await saveSpamWallets(wallets);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`\n🚀 Spam launch server running on http://localhost:${PORT}`);
    console.log('Your dashboard can now call http://localhost:3000/spam-launch');
    console.log('\nFeatures:');
    console.log('- Separate spam wallet storage');
    console.log('- Automatic selling after X seconds');
    console.log('- Complete isolation from main trading wallets');
    console.log('\nWaiting for requests...\n');
});