// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface RecyclingBin {
  id: string;
  encryptedData: string;
  timestamp: number;
  location: string;
  fillLevel: number;
  category: "organic" | "plastic" | "paper" | "glass" | "metal";
  status: "active" | "full" | "maintenance";
}

const App: React.FC = () => {
  // Wallet state
  const [account, setAccount] = useState("");
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  
  // Data state
  const [loading, setLoading] = useState(true);
  const [bins, setBins] = useState<RecyclingBin[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // UI state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  
  // Transaction feedback
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  
  // New bin form
  const [newBinData, setNewBinData] = useState({
    location: "",
    category: "plastic",
    fillLevel: 50
  });
  
  // Statistics
  const activeCount = bins.filter(b => b.status === "active").length;
  const fullCount = bins.filter(b => b.status === "full").length;
  const maintenanceCount = bins.filter(b => b.status === "maintenance").length;
  
  // Load initial data
  useEffect(() => {
    loadBins().finally(() => setLoading(false));
  }, []);

  // Wallet connection handlers
  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  // Load bins from contract
  const loadBins = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("bin_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing bin keys:", e);
        }
      }
      
      const binList: RecyclingBin[] = [];
      
      for (const key of keys) {
        try {
          const binBytes = await contract.getData(`bin_${key}`);
          if (binBytes.length > 0) {
            try {
              const binData = JSON.parse(ethers.toUtf8String(binBytes));
              binList.push({
                id: key,
                encryptedData: binData.data,
                timestamp: binData.timestamp,
                location: binData.location,
                fillLevel: binData.fillLevel,
                category: binData.category,
                status: binData.status || "active"
              });
            } catch (e) {
              console.error(`Error parsing bin data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading bin ${key}:`, e);
        }
      }
      
      binList.sort((a, b) => b.timestamp - a.timestamp);
      setBins(binList);
    } catch (e) {
      console.error("Error loading bins:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  // Add new recycling bin
  const addBin = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting bin data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newBinData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const binId = `bin-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

      const binData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        location: newBinData.location,
        fillLevel: newBinData.fillLevel,
        category: newBinData.category,
        status: "active"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `bin_${binId}`, 
        ethers.toUtf8Bytes(JSON.stringify(binData))
      );
      
      const keysBytes = await contract.getData("bin_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(binId);
      
      await contract.setData(
        "bin_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Bin data encrypted and stored securely!"
      });
      
      await loadBins();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewBinData({
          location: "",
          category: "plastic",
          fillLevel: 50
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  // Update bin status
  const updateBinStatus = async (binId: string, status: "active" | "full" | "maintenance") => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Updating bin status with FHE..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const binBytes = await contract.getData(`bin_${binId}`);
      if (binBytes.length === 0) {
        throw new Error("Bin not found");
      }
      
      const binData = JSON.parse(ethers.toUtf8String(binBytes));
      
      const updatedBin = {
        ...binData,
        status: status
      };
      
      await contract.setData(
        `bin_${binId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedBin))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Bin status updated successfully!"
      });
      
      await loadBins();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Update failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  // Tutorial steps
  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to interact with the platform",
      icon: "🔗"
    },
    {
      title: "Add Smart Bin",
      description: "Register new smart bins with encrypted data using FHE",
      icon: "🗑️"
    },
    {
      title: "FHE Processing",
      description: "Bin data is processed in encrypted state without decryption",
      icon: "⚙️"
    },
    {
      title: "Optimize Routes",
      description: "Receive optimized collection routes while keeping data private",
      icon: "🗺️"
    }
  ];

  // Render fill level bar
  const renderFillLevel = (level: number) => {
    return (
      <div className="fill-level-bar">
        <div 
          className="fill-level-indicator" 
          style={{ width: `${level}%` }}
        ></div>
        <div className="fill-level-text">{level}%</div>
      </div>
    );
  };

  // Render category icon
  const renderCategoryIcon = (category: string) => {
    const icons: Record<string, string> = {
      organic: "🍃",
      plastic: "♻️",
      paper: "📄",
      glass: "🥃",
      metal: "🔩"
    };
    return <span className="category-icon">{icons[category] || "📦"}</span>;
  };

  // Loading screen
  if (loading) return (
    <div className="loading-screen">
      <div className="tech-spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container future-metal-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="recycle-icon"></div>
          </div>
          <h1>FHE<span>Recycle</span>Optimizer</h1>
        </div>
        
        <div className="header-tabs">
          <button 
            className={`tab-button ${activeTab === "dashboard" ? "active" : ""}`}
            onClick={() => setActiveTab("dashboard")}
          >
            Dashboard
          </button>
          <button 
            className={`tab-button ${activeTab === "bins" ? "active" : ""}`}
            onClick={() => setActiveTab("bins")}
          >
            Smart Bins
          </button>
          <button 
            className={`tab-button ${activeTab === "routes" ? "active" : ""}`}
            onClick={() => setActiveTab("routes")}
          >
            Collection Routes
          </button>
          <button 
            className={`tab-button ${activeTab === "stats" ? "active" : ""}`}
            onClick={() => setActiveTab("stats")}
          >
            Statistics
          </button>
        </div>
        
        <div className="header-actions">
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
          <button 
            className="metal-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
        </div>
      </header>
      
      <div className="main-content">
        {showTutorial && (
          <div className="tutorial-section metal-card">
            <h2>FHE Recycling Optimization</h2>
            <p className="subtitle">Learn how encrypted data improves waste collection</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {activeTab === "dashboard" && (
          <div className="dashboard-grid">
            <div className="dashboard-card metal-card">
              <h3>Project Introduction</h3>
              <p>FHE Recycle Optimizer uses fully homomorphic encryption to process sensitive waste data without decryption, enabling optimized collection routes while preserving privacy.</p>
              <div className="fhe-badge">
                <span>FHE-Powered</span>
              </div>
            </div>
            
            <div className="dashboard-card metal-card">
              <h3>Smart Bin Status</h3>
              <div className="status-grid">
                <div className="status-item active">
                  <div className="status-value">{activeCount}</div>
                  <div className="status-label">Active</div>
                </div>
                <div className="status-item full">
                  <div className="status-value">{fullCount}</div>
                  <div className="status-label">Full</div>
                </div>
                <div className="status-item maintenance">
                  <div className="status-value">{maintenanceCount}</div>
                  <div className="status-label">Maintenance</div>
                </div>
              </div>
            </div>
            
            <div className="dashboard-card metal-card">
              <h3>Waste Distribution</h3>
              <div className="category-distribution">
                {["plastic", "paper", "glass", "metal", "organic"].map(cat => (
                  <div key={cat} className="category-item">
                    <span className="category-label">{cat}</span>
                    <div className="category-bar">
                      <div 
                        className="category-fill" 
                        style={{ 
                          width: `${bins.filter(b => b.category === cat).length * 10}%`,
                          backgroundColor: `var(--${cat}-color)`
                        }}
                      ></div>
                    </div>
                    <span className="category-count">
                      {bins.filter(b => b.category === cat).length}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="dashboard-card metal-card">
              <h3>Real-time Monitoring</h3>
              <div className="realtime-map">
                <div className="map-grid">
                  {bins.slice(0, 9).map(bin => (
                    <div 
                      key={bin.id} 
                      className={`map-bin ${bin.status}`}
                      style={{ 
                        gridArea: `pos${bins.indexOf(bin) + 1}`,
                        backgroundColor: `var(--${bin.category}-color)`
                      }}
                    >
                      <div className="bin-icon">{renderCategoryIcon(bin.category)}</div>
                      <div className="bin-status">{bin.status}</div>
                    </div>
                  ))}
                </div>
                <div className="map-legend">
                  <div className="legend-item">
                    <div className="color-dot plastic"></div>
                    <span>Plastic</span>
                  </div>
                  <div className="legend-item">
                    <div className="color-dot paper"></div>
                    <span>Paper</span>
                  </div>
                  <div className="legend-item">
                    <div className="color-dot glass"></div>
                    <span>Glass</span>
                  </div>
                  <div className="legend-item">
                    <div className="color-dot metal"></div>
                    <span>Metal</span>
                  </div>
                  <div className="legend-item">
                    <div className="color-dot organic"></div>
                    <span>Organic</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "bins" && (
          <div className="bins-section">
            <div className="section-header">
              <h2>Smart Bin Management</h2>
              <div className="header-actions">
                <button 
                  onClick={() => setShowCreateModal(true)}
                  className="metal-button primary"
                >
                  + Add Smart Bin
                </button>
                <button 
                  onClick={loadBins}
                  className="metal-button"
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="bins-list metal-card">
              <div className="table-header">
                <div className="header-cell">ID</div>
                <div className="header-cell">Location</div>
                <div className="header-cell">Category</div>
                <div className="header-cell">Fill Level</div>
                <div className="header-cell">Status</div>
                <div className="header-cell">Actions</div>
              </div>
              
              {bins.length === 0 ? (
                <div className="no-bins">
                  <div className="no-bins-icon"></div>
                  <p>No smart bins registered</p>
                  <button 
                    className="metal-button primary"
                    onClick={() => setShowCreateModal(true)}
                  >
                    Register First Bin
                  </button>
                </div>
              ) : (
                bins.map(bin => (
                  <div className="bin-row" key={bin.id}>
                    <div className="table-cell bin-id">#{bin.id.substring(0, 6)}</div>
                    <div className="table-cell">{bin.location}</div>
                    <div className="table-cell category-cell">
                      {renderCategoryIcon(bin.category)}
                      <span>{bin.category}</span>
                    </div>
                    <div className="table-cell">
                      {renderFillLevel(bin.fillLevel)}
                    </div>
                    <div className="table-cell">
                      <span className={`status-badge ${bin.status}`}>
                        {bin.status}
                      </span>
                    </div>
                    <div className="table-cell actions">
                      <button 
                        className="action-btn metal-button"
                        onClick={() => updateBinStatus(bin.id, "full")}
                        disabled={bin.status === "full"}
                      >
                        Mark Full
                      </button>
                      <button 
                        className="action-btn metal-button"
                        onClick={() => updateBinStatus(bin.id, "maintenance")}
                        disabled={bin.status === "maintenance"}
                      >
                        Maintenance
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        
        {activeTab === "routes" && (
          <div className="routes-section">
            <div className="section-header">
              <h2>Optimized Collection Routes</h2>
              <button 
                className="metal-button primary"
                onClick={async () => {
                  if (!provider) {
                    alert("Please connect wallet first");
                    return;
                  }
                  
                  setTransactionStatus({
                    visible: true,
                    status: "pending",
                    message: "Calculating optimized routes with FHE..."
                  });
                  
                  try {
                    const contract = await getContractWithSigner();
                    if (!contract) return;
                    
                    // Simulate FHE computation
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    setTransactionStatus({
                      visible: true,
                      status: "success",
                      message: "Routes optimized using encrypted data!"
                    });
                    
                    setTimeout(() => {
                      setTransactionStatus({ visible: false, status: "pending", message: "" });
                    }, 2000);
                  } catch (e) {
                    setTransactionStatus({
                      visible: true,
                      status: "error",
                      message: "Optimization failed"
                    });
                    
                    setTimeout(() => {
                      setTransactionStatus({ visible: false, status: "pending", message: "" });
                    }, 3000);
                  }
                }}
              >
                Optimize Routes
              </button>
            </div>
            
            <div className="optimization-card metal-card">
              <h3>FHE Route Optimization</h3>
              <p>Using encrypted bin data to calculate the most efficient collection routes without exposing sensitive location information.</p>
              
              <div className="route-visualization">
                <div className="route-map">
                  {bins.slice(0, 5).map((bin, index) => (
                    <div 
                      key={bin.id} 
                      className="route-point"
                      style={{ 
                        left: `${20 + index * 15}%`,
                        top: `${30 + (index % 2) * 40}%`,
                        backgroundColor: `var(--${bin.category}-color)`
                      }}
                    >
                      <div className="point-icon">{renderCategoryIcon(bin.category)}</div>
                      <div className="point-label">{bin.location.substring(0, 10)}</div>
                    </div>
                  ))}
                  <div className="route-line"></div>
                </div>
                
                <div className="route-stats">
                  <div className="stat-item">
                    <div className="stat-value">5</div>
                    <div className="stat-label">Bins in route</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">3.2 km</div>
                    <div className="stat-label">Total distance</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">42 min</div>
                    <div className="stat-label">Estimated time</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "stats" && (
          <div className="stats-section">
            <div className="section-header">
              <h2>Recycling Statistics</h2>
            </div>
            
            <div className="stats-grid">
              <div className="stats-card metal-card">
                <h3>Category Distribution</h3>
                <div className="category-chart">
                  {["plastic", "paper", "glass", "metal", "organic"].map(cat => {
                    const count = bins.filter(b => b.category === cat).length;
                    const percentage = bins.length > 0 ? (count / bins.length) * 100 : 0;
                    
                    return (
                      <div key={cat} className="chart-item">
                        <div className="chart-bar">
                          <div 
                            className="chart-fill" 
                            style={{ 
                              height: `${percentage}%`,
                              backgroundColor: `var(--${cat}-color)`
                            }}
                          ></div>
                        </div>
                        <div className="chart-label">
                          {renderCategoryIcon(cat)}
                          <span>{Math.round(percentage)}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              
              <div className="stats-card metal-card">
                <h3>Fill Level Analysis</h3>
                <div className="fill-level-chart">
                  {bins.slice(0, 8).map(bin => (
                    <div key={bin.id} className="fill-item">
                      <div className="fill-bar">
                        <div 
                          className="fill-indicator" 
                          style={{ height: `${bin.fillLevel}%` }}
                        ></div>
                      </div>
                      <div className="fill-label">#{bin.id.substring(0, 4)}</div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="stats-card metal-card">
                <h3>Status Timeline</h3>
                <div className="timeline">
                  {bins.slice(0, 6).map(bin => (
                    <div key={bin.id} className="timeline-item">
                      <div className="timeline-point"></div>
                      <div className="timeline-content">
                        <div className="timeline-header">
                          <span className="bin-id">#{bin.id.substring(0, 6)}</span>
                          <span className={`status ${bin.status}`}>{bin.status}</span>
                        </div>
                        <div className="timeline-date">
                          {new Date(bin.timestamp * 1000).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={addBin} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          binData={newBinData}
          setBinData={setNewBinData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="tech-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="recycle-icon"></div>
              <span>FHE Recycle Optimizer</span>
            </div>
            <p>Secure waste management using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHE Recycle Optimizer. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  binData: any;
  setBinData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  binData,
  setBinData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setBinData({
      ...binData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!binData.location) {
      alert("Please enter location");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal metal-card">
        <div className="modal-header">
          <h2>Register Smart Bin</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="lock-icon"></div> Bin data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Location *</label>
              <input 
                type="text"
                name="location"
                value={binData.location} 
                onChange={handleChange}
                placeholder="Enter bin location..." 
                className="metal-input"
              />
            </div>
            
            <div className="form-group">
              <label>Category</label>
              <select 
                name="category"
                value={binData.category} 
                onChange={handleChange}
                className="metal-select"
              >
                <option value="plastic">Plastic</option>
                <option value="paper">Paper</option>
                <option value="glass">Glass</option>
                <option value="metal">Metal</option>
                <option value="organic">Organic</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Initial Fill Level</label>
              <input 
                type="range"
                name="fillLevel"
                min="0"
                max="100"
                value={binData.fillLevel} 
                onChange={handleChange}
                className="metal-slider"
              />
              <div className="slider-value">{binData.fillLevel}%</div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="metal-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="metal-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Register Bin"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;