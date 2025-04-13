import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import './App.css';
import perp from './abi.json';

const PERPS_MARKET_PROXY_ADDRESS = '0xf53Ca60F031FAf0E347D44FbaA4870da68250c8d';

function App() {
  const [account, setAccount] = useState('');
  const [chainId, setChainId] = useState(null);
  const [provider, setProvider] = useState(null);
  const [contract, setContract] = useState(null);
  const [markets, setMarkets] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [marketCreationStatus, setMarketCreationStatus] = useState('');

  // New market form state
  const [newMarket, setNewMarket] = useState({
    name: '',
    symbol: '',
    price: '',
    maxLeverage: '10',
    maxMarketValue: '1000000',
    liquidationBufferRatio: '1000', // 10% in basis points
    skewScale: '1000000000000000000', // 1.0 in 18 decimals
    makerFee: '10', // 0.1% in basis points
    takerFee: '15', // 0.15% in basis points
  });

  // Handle wallet account changes
  useEffect(() => {
    const handleAccountsChanged = (accounts) => {
      if (accounts.length === 0) {
        // User disconnected wallet
        setAccount('');
        setChainId(null);
        setProvider(null);
        setContract(null);
      } else if (accounts[0] !== account) {
        // Account changed
        setAccount(accounts[0]);
        setupContractWithSigner();
      }
    };

    const handleChainChanged = (chainIdHex) => {
      window.location.reload();
    };

    // Add listeners for account and chain changes
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);
    }

    // Detect WalletConnect provider
    if (window.ethereum?.isWalletConnect) {
      console.log("WalletConnect provider detected");
    }

    // Check for Rainbow or other wallets
    if (window.ethereum?.isRainbow) {
      console.log("Rainbow wallet detected");
    }

    return () => {
      if (window.ethereum) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
      }
    };
  }, [account]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setNewMarket({
      ...newMarket,
      [name]: value
    });
  };

  const detectEthereumProvider = async () => {
    // First check for window.ethereum
    if (window.ethereum) {
      return window.ethereum;
    }

    // Check for multiple wallet providers
    if (window.providers) {
      return window.providers.find(p => p.isMetaMask || p.isRainbow || p.isCoinbaseWallet || p.isWalletConnect);
    }

    // No provider found
    return null;
  };

  const setupContractWithSigner = async () => {
    try {
      if (!provider) return;

      const signer = await provider.getSigner();
      const account = await signer.getAddress();
      console.log('Setting up contract with signer from account:', account);

      const contractAddress = ethers.getAddress(PERPS_MARKET_PROXY_ADDRESS);
      const contract = new ethers.Contract(contractAddress, perp, signer);

      setContract(contract);
    } catch (err) {
      console.error('Failed to setup contract with signer:', err);
      setError('Failed to setup contract: ' + err.message);
    }
  };

  const switchToBaseSepolia = async (provider) => {
    const BASE_SEPOLIA_CHAIN_ID = '0x14a34'; // 84532 in hex

    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: BASE_SEPOLIA_CHAIN_ID }],
      });
      return true;
    } catch (switchError) {
      // This error code indicates that the chain has not been added to the wallet
      if (switchError.code === 4902) {
        try {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: BASE_SEPOLIA_CHAIN_ID,
                chainName: 'Base Sepolia',
                rpcUrls: ['https://sepolia.base.org'],
                nativeCurrency: {
                  name: 'ETH',
                  symbol: 'ETH',
                  decimals: 18,
                },
                blockExplorerUrls: ['https://sepolia-explorer.base.org'],
              },
            ],
          });
          // Try switching again after adding
          await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: BASE_SEPOLIA_CHAIN_ID }],
          });
          return true;
        } catch (addError) {
          console.error('Error adding Base Sepolia to wallet:', addError);
          throw addError;
        }
      } else {
        console.error('Error switching to Base Sepolia:', switchError);
        throw switchError;
      }
    }
  };

  const connectWallet = async () => {
    setLoading(true);
    setError('');

    try {
      // Detect any available Ethereum provider
      const ethereumProvider = await detectEthereumProvider();

      if (!ethereumProvider) {
        throw new Error('No Ethereum wallet detected. Please install MetaMask, Rainbow, or another web3 wallet.');
      }

      console.log('Wallet provider details:', {
        isMetaMask: ethereumProvider.isMetaMask,
        isRainbow: ethereumProvider.isRainbow,
        isCoinbaseWallet: ethereumProvider.isCoinbaseWallet,
        isWalletConnect: ethereumProvider.isWalletConnect,
        selectedAddress: ethereumProvider.selectedAddress,
        chainId: ethereumProvider.chainId,
      });

      // Request accounts access
      console.log('Requesting accounts...');
      const accounts = await ethereumProvider.request({ method: 'eth_requestAccounts' });
      console.log('Accounts received:', accounts);

      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts returned by wallet.');
      }

      // Initialize ethers provider with the detected Ethereum provider
      const ethersProvider = new ethers.BrowserProvider(ethereumProvider);

      // Disable ENS resolution to avoid potential issues
      ethersProvider.resolveName = async () => null;

      // Get current chain ID
      const { chainId } = await ethersProvider.getNetwork();
      console.log('Chain ID:', chainId);
      setChainId(Number(chainId));

      // Switch to Base Sepolia if needed
      if (Number(chainId) !== 84532) {
        console.log('Switching to Base Sepolia...');
        await switchToBaseSepolia(ethereumProvider);

        // Get updated provider after chain switch
        const updatedProvider = new ethers.BrowserProvider(ethereumProvider);
        updatedProvider.resolveName = async () => null;
        setProvider(updatedProvider);
      } else {
        setProvider(ethersProvider);
      }

      // Get signer and address
      const signer = await ethersProvider.getSigner();
      const account = await signer.getAddress();
      console.log('Connected account:', account);

      // Initialize contract with signer
      const contractAddress = ethers.getAddress(PERPS_MARKET_PROXY_ADDRESS);
      const contract = new ethers.Contract(contractAddress, perp, signer);

      setAccount(account);
      setContract(contract);
    } catch (err) {
      console.error('Connection error:', err);
      if (err.code === 4001) {
        setError('Wallet connection rejected. Please approve the connection.');
      } else if (err.code === -32002) {
        setError('Wallet request pending. Check your wallet and try again.');
      } else {
        setError(err.message || 'Failed to connect wallet.');
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchMarkets = async () => {
    try {
      setLoading(true);
      setError('');

      if (!contract) {
        setError('Connect wallet first');
        return;
      }

      const marketIds = (await contract.getMarkets()).map(id => id.toString()).slice(0, 10);
      console.log('Market IDs:', marketIds);

      const marketDetails = await Promise.all(
        marketIds.map(async (id) => {
          try {
            const summary = await contract.getMarketSummary(id);
            console.log(`Market ${id} summary:`, summary);
            return {
              id,
              name: summary.marketName || 'Unknown',
              symbol: summary.marketSymbol || '---',
              summary: summary, // Store the summary here
            };
          } catch (err) {
            console.log(`Error fetching market ${id}:`, err);
            return {
              id,
              name: 'Error loading',
              symbol: '---',
              summary: null, // Or some error indicator
            };
          }
        })
      );

      console.log('Market Details:', marketDetails);
      setMarkets(marketDetails);
    } catch (err) {
      console.error('Error fetching markets:', err);
      setError('Failed to fetch markets: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Function to create a market
  const createMarket = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMarketCreationStatus('');
    setError('');

    try {
      if (!contract) {
        throw new Error('Connect wallet first');
      }

      // Prepare parameters for market creation
      const params = {
        marketName: newMarket.name,
        marketSymbol: newMarket.symbol,
        initialPrice: ethers.parseUnits(newMarket.price, 18),
        maxLeverage: ethers.parseUnits(newMarket.maxLeverage, 18),
        maxMarketValue: ethers.parseUnits(newMarket.maxMarketValue, 18),
        liquidationBufferRatio: newMarket.liquidationBufferRatio,
        makerFee: newMarket.makerFee,
        takerFee: newMarket.takerFee,
        skewScale: newMarket.skewScale,
      };

      console.log('Creating market with params:', params);
      setMarketCreationStatus('Sending transaction...');

      // Call the contract's createMarket function
      const tx = await contract.createMarket(
        params.marketName,
        params.marketSymbol,
        params.initialPrice,
        params.maxLeverage,
        params.maxMarketValue,
        params.liquidationBufferRatio,
        params.makerFee,
        params.takerFee,
        params.skewScale
      );

      setMarketCreationStatus('Transaction sent! Waiting for confirmation...');
      console.log('Transaction hash:', tx.hash);

      // Wait for transaction to be mined
      const receipt = await tx.wait();
      console.log('Transaction confirmed:', receipt);

      // Look for the MarketCreated event to get the market ID
      const marketCreatedEvent = receipt.logs
        .filter(log => log.fragment?.name === 'MarketCreated')
        .map(log => contract.interface.parseLog(log));

      if (marketCreatedEvent.length > 0) {
        const marketId = marketCreatedEvent[0].args.marketId;
        setMarketCreationStatus(`Market created successfully! Market ID: ${marketId}`);

        // Reset form
        setNewMarket({
          name: '',
          symbol: '',
          price: '',
          maxLeverage: '10',
          maxMarketValue: '1000000',
          liquidationBufferRatio: '1000',
          skewScale: '1000000000000000000',
          makerFee: '10',
          takerFee: '15',
        });

        // Refresh markets list
        await fetchMarkets();
      } else {
        setMarketCreationStatus('Market created but could not find market ID in transaction receipt');
      }
    } catch (err) {
      console.error('Error creating market:', err);
      setError(`Failed to create market: ${err.message}`);
      setMarketCreationStatus('');
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (value) => {
    return new Intl.NumberFormat('en-US').format(value);
  };

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  };

  // Helper to identify the wallet provider type
  const getWalletName = () => {
    if (!window.ethereum) return 'Wallet';

    if (window.ethereum.isRainbow) return 'Rainbow';
    if (window.ethereum.isMetaMask) return 'MetaMask';
    if (window.ethereum.isCoinbaseWallet) return 'Coinbase Wallet';
    if (window.ethereum.isWalletConnect) return 'WalletConnect';

    return 'Wallet';
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Perps v3 Dashboard - Base Sepolia</h1>
      </header>

      <main className="app-main">
        <div className="connection-panel">
          {!account ? (
            <button
              className="connect-button"
              onClick={connectWallet}
              disabled={loading}
            >
              {loading ? 'Connecting...' : `Connect ${getWalletName()}`}
            </button>
          ) : (
            <div className="connection-info">
              <div className="account-info">
                <span className="label">Account:</span>
                <span className="address">{account.substring(0, 6)}...{account.substring(account.length - 4)}</span>
              </div>
              <div className="network-info">
                <span className="label">Network:</span>
                <span className={`network ${chainId === 84532 ? 'valid' : 'invalid'}`}>
                  {chainId === 84532 ? 'Base Sepolia ✅' : `Unknown Network (${chainId}) ❌`}
                </span>
              </div>
            </div>
          )}
          {error && <p className="error-message">{error}</p>}
        </div>

        {account && chainId === 84532 && (
          <div className="actions-panel">
            <div className="section markets-section">
              <div className="section-header">
                <h2>Market Explorer</h2>
                <button
                  className="fetch-button"
                  onClick={fetchMarkets}
                  disabled={loading || !contract}
                >
                  {loading ? 'Loading...' : 'Fetch Markets'}
                </button>
              </div>

              {markets.length > 0 && (
                <div className="markets-list">
                  {markets.map((market) => (
                    <div key={market.id} className="market-card">
                      <div className="market-header">
                        <h3>{market.name || 'No Name'}</h3>
                        <div className="market-meta">
                          <span className="market-symbol">{market.symbol || '---'}</span>
                          <span className="market-id">ID: {market.id}</span>
                        </div>
                      </div>

                      {market.summary && (
                        <div className="market-details">
                          <div className="market-stats">
                            <div className="stat">
                              <span className="stat-label">Open Interest</span>
                              <span className="stat-value">{formatCurrency(Number(ethers.formatUnits(market.summary[0], 18)))}</span>
                            </div>
                            <div className="stat">
                              <span className="stat-label">Funding Rate</span>
                              <span className="stat-value">{Number(market.summary[1]) / 10 ** 9}%</span>
                            </div>
                            <div className="stat">
                              <span className="stat-label">Volume</span>
                              <span className="stat-value">{formatNumber(Number(ethers.formatUnits(market.summary[2], 18)))}</span>
                            </div>
                            <div className="stat">
                              <span className="stat-label">Unrealized PNL</span>
                              <span className="stat-value">{formatCurrency(Number(ethers.formatUnits(market.summary[4], 18)))}</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {market.summary === null && (
                        <p className="error-message">Error loading market summary</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="section create-market-section">
              <h2>Create New Market</h2>
              <form onSubmit={createMarket} className="create-market-form">
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="name">Market Name</label>
                    <input
                      type="text"
                      id="name"
                      name="name"
                      value={newMarket.name}
                      onChange={handleInputChange}
                      placeholder="e.g., Bitcoin Perpetual"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="symbol">Symbol</label>
                    <input
                      type="text"
                      id="symbol"
                      name="symbol"
                      value={newMarket.symbol}
                      onChange={handleInputChange}
                      placeholder="e.g., BTC-PERP"
                      required
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="price">Initial Price (USD)</label>
                    <input
                      type="text"
                      id="price"
                      name="price"
                      value={newMarket.price}
                      onChange={handleInputChange}
                      placeholder="e.g., 50000"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="maxLeverage">Max Leverage</label>
                    <input
                      type="text"
                      id="maxLeverage"
                      name="maxLeverage"
                      value={newMarket.maxLeverage}
                      onChange={handleInputChange}
                      placeholder="e.g., 10"
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="maxMarketValue">Max Market Value</label>
                    <input
                      type="text"
                      id="maxMarketValue"
                      name="maxMarketValue"
                      value={newMarket.maxMarketValue}
                      onChange={handleInputChange}
                      placeholder="e.g., 1000000"
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="liquidationBufferRatio">Liquidation Buffer (basis points)</label>
                    <input
                      type="text"
                      id="liquidationBufferRatio"
                      name="liquidationBufferRatio"
                      value={newMarket.liquidationBufferRatio}
                      onChange={handleInputChange}
                      placeholder="e.g., 1000 (10%)"
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="makerFee">Maker Fee (basis points)</label>
                    <input
                      type="text"
                      id="makerFee"
                      name="makerFee"
                      value={newMarket.makerFee}
                      onChange={handleInputChange}
                      placeholder="e.g., 10 (0.1%)"
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="takerFee">Taker Fee (basis points)</label>
                    <input
                      type="text"
                      id="takerFee"
                      name="takerFee"
                      value={newMarket.takerFee}
                      onChange={handleInputChange}
                      placeholder="e.g., 15 (0.15%)"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="skewScale">Skew Scale (in wei)</label>
                  <input
                    type="text"
                    id="skewScale"
                    name="skewScale"
                    value={newMarket.skewScale}
                    onChange={handleInputChange}
                    placeholder="e.g., 1000000000000000000 (1.0)"
                  />
                </div>

                <div className="form-actions">
                  <button
                    type="submit"
                    className="submit-button"
                    disabled={loading || !contract}
                  >
                    {loading ? 'Processing...' : 'Create Market'}
                  </button>
                </div>
              </form>

              {marketCreationStatus && (
                <div className="status-message">
                  <p>{marketCreationStatus}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>Perps v3 Tester | Using contract: {PERPS_MARKET_PROXY_ADDRESS}</p>
      </footer>
    </div>
  );
}

export default App;